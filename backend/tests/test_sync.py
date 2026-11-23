import io
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from fastapi.testclient import TestClient

from backend import events, storage
from backend.main import app
from backend.tests.test_wireguard import configuration
from plugins.wireguard import backend as wireguard


class SyncTest(unittest.TestCase):
    def setUp(self):
        directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.object(storage, "DB_PATH", directory / "terminal.db"))
        self.client = self.enterContext(TestClient(app))
        self.other = self.enterContext(TestClient(app))

    def state(self, client=None):
        return (client or self.client).get("/api/state").json()

    def widget(self, plugin, desktop=1):
        response = self.client.post(f"/api/desktops/{desktop}/widgets", json={"plugin_id": plugin})
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_two_subscribers_observe_only_committed_changes_and_reconnect(self):
        start = self.state()["revision"]
        with self.client.websocket_connect("/api/events") as first, self.other.websocket_connect("/api/events") as second:
            expected = {"type": "ready", "revision": start}
            self.assertEqual(first.receive_json(), expected)
            self.assertEqual(second.receive_json(), expected)
            with self.assertRaises(RuntimeError):
                with storage.database(write=True) as conn:
                    conn.execute("UPDATE desktops SET name='Rolled back' WHERE id=1")
                    conn.changed("desktops", 1)
                    raise RuntimeError()
            self.assertEqual(self.state()["revision"], start)
            response = self.other.post("/api/desktops")
            desk = response.json()
            message = {"type": "changes", "revision": start + 1, "changes": [{"kind": "desktops", "id": desk["id"]}]}
            self.assertEqual(first.receive_json(), message)
            self.assertEqual(second.receive_json(), message)
            self.assertIn(desk["id"], [d["id"] for d in self.state()["desktops"]])
        self.assertEqual(self.client.put(f"/api/desktops/{desk['id']}/name", json={"name": "Servers"}).status_code, 200)
        storage.initialize()
        with self.other.websocket_connect("/api/events") as reconnected:
            self.assertEqual(reconnected.receive_json(), {"type": "ready", "revision": start + 2})
            self.assertEqual(self.state(self.other)["desktops"][-1]["name"], "Servers")

    def test_partial_updates_check_only_competing_fields(self):
        widget_id = self.widget("clock")["id"]
        base = f"/api/widgets/{widget_id}/"
        moved = self.client.put(base + "position", json={"slot": 5, "expected": {"slot": 0}})
        self.assertEqual(moved.status_code, 200)
        self.assertEqual(self.other.put(base + "position", json={"slot": 6, "expected": {"slot": 0}}).status_code, 409)
        renamed = self.other.put(base + "configuration", json={
            "appearance": {"customTitle": "Time"}, "expected": {"appearance": {"customTitle": None}},
        })
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.json()["slot"], 5)
        colored = self.client.put(base + "configuration", json={
            "appearance": {"cardPalette": "green"}, "expected": {"appearance": {"cardPalette": None}},
        })
        self.assertEqual(colored.json()["appearance"], {"customTitle": "Time", "cardPalette": "green"})
        revision = self.state()["revision"]
        stale = self.client.put(base + "configuration", json={
            "appearance": {"customTitle": "Stale"}, "expected": {"appearance": {"customTitle": None}},
        })
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.state()["revision"], revision)

        self.client.put(base + "settings", json={"settings": {"label": "Old", "unrelated": True}})
        patch_response = self.other.put(base + "configuration", json={
            "settings": {"size": 3}, "removeSettings": ["label"],
            "expected": {"settings": {"label": "Old", "size": None}},
        })
        self.assertEqual(patch_response.json()["settings"], {"size": 3, "unrelated": True})

    def test_cross_desktop_move_and_removal(self):
        second = self.client.post("/api/desktops").json()["id"]
        widget_id = self.widget("clock")["id"]
        self.assertEqual(self.other.post("/api/desktops/swap", json={"first": 1, "second": second}).status_code, 200)
        origin = self.state()["revision"]
        path = f"/api/widgets/{widget_id}"
        self.assertEqual(self.client.put(path + "/position", json={"slot": 5, "desktop_id": second}).status_code, 200)
        state = self.state(self.other)
        self.assertEqual(state["widgets"][0]["desktop_id"], second)
        self.assertEqual([d["id"] for d in state["desktops"]], [second, 1])
        self.assertIn({"kind": "widgets", "id": widget_id}, events.read_events(origin)["changes"])
        self.assertEqual(self.other.delete(f"/api/desktops/{second}").status_code, 200)
        self.assertEqual(self.state()["widgets"], [])

    def test_templates_import_and_plugin_events_exclude_payloads(self):
        initial = self.state()["revision"]
        definition = {"name": "Sync", "actions": [], "rows": [[{"id": "label", "kind": "text", "label": "Before"}]]}
        template = self.client.post("/api/templates", json=definition).json()
        template_path = "/api/templates/" + template["id"]
        self.assertEqual(self.other.put(template_path, json={**template, "name": "Updated"}).status_code, 200)
        self.assertEqual(self.client.put(template_path, json=template).status_code, 409)
        self.assertEqual(self.client.delete(template_path + "?revision=2").status_code, 200)
        file_id, zip_id = "template:" + "1" * 32, "template:" + "2" * 32
        self.assertEqual(self.client.post("/api/templates/import?path=pack/template.json",
                                         content=json.dumps({**definition, "id": file_id}),
                                         headers={"Content-Type": "application/json"}).status_code, 201)
        archive = io.BytesIO()
        with ZipFile(archive, "w") as bundle:
            bundle.writestr("pack/template.json", json.dumps({**definition, "id": zip_id}))
        self.assertEqual(self.other.post("/api/templates/import", content=archive.getvalue(),
                                        headers={"Content-Type": "application/zip"}).status_code, 201)
        wg_id = self.widget("wireguard")["id"]
        schedule = {"automatic": False, "interval": 12}
        wg_path = f"/api/plugins/wireguard/{wg_id}/schedule"
        self.assertEqual(self.client.put(wg_path, json=schedule).status_code, 200)
        self.assertEqual(self.other.put(wg_path, json={**schedule, "expected": {"automatic": True}}).status_code, 409)
        sb_id = self.widget("sing-box-latency")["id"]
        sb_path = f"/api/plugins/sing-box-latency/{sb_id}/profiles"
        self.assertEqual(self.client.put(sb_path, json={"profiles": [], "schedule": schedule, "revision": 0}).status_code, 200)
        self.assertEqual(self.other.put(sb_path, json={"profiles": [], "schedule": schedule, "revision": 0}).status_code, 409)
        integration = self.client.post("/api/integrations", json={
            "name": "LAN", "tasks": [{"name": "Connect", "operation": "wireguard/connect"}],
        })
        self.assertEqual(integration.status_code, 201)
        change_list = events.read_events(initial)["changes"]
        for entry in (
            {"kind": "templates", "id": template["id"]},
            {"kind": "templates", "id": file_id},
            {"kind": "templates", "id": zip_id},
            {"kind": "plugin", "id": wg_id, "plugin": "wireguard"},
            {"kind": "plugin", "id": sb_id, "plugin": "sing-box-latency"},
            {"kind": "integrations", "id": integration.json()["id"]},
        ):
            self.assertIn(entry, change_list)
        self.assertTrue(all(change.keys() <= {"kind", "id", "plugin"} for change in change_list))

    def test_wireguard_profile_and_successful_toggle_notify_the_widget(self):
        widget_id = self.widget("wireguard")["id"]
        base = f"/api/plugins/wireguard/{widget_id}/profiles"
        with self.other.websocket_connect("/api/events") as socket:
            current = socket.receive_json()["revision"]
            response = self.client.post(base + "?name=LAN", content=configuration().encode(),
                                        headers={"Content-Type": "application/x-wireguard"})
            self.assertEqual(response.status_code, 201)
            profile_id = response.json()["id"]
            change = [{"kind": "plugin", "id": widget_id, "plugin": "wireguard"}]
            self.assertEqual(socket.receive_json(), {"type": "changes", "revision": current + 1, "changes": change})
            with patch.object(wireguard, "control") as control:
                wireguard.connection(widget_id, profile_id, "up")
                control.assert_called_once()
            self.assertEqual(socket.receive_json(), {"type": "changes", "revision": current + 2, "changes": change})
            self.assertEqual(self.client.delete(base + "/" + profile_id).status_code, 204)
            self.assertEqual(socket.receive_json(), {"type": "changes", "revision": current + 3, "changes": change})

    def test_parallel_changes_have_distinct_revisions_and_get_coalesced(self):
        initial = self.state()["revision"]
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda i: self.client.put("/api/desktops/1/name", json={"name": f"Desktop {i}"}), range(12)))
        self.assertTrue(all(r.status_code == 200 for r in results))
        self.assertEqual(events.read_events(initial), {
            "type": "changes", "revision": initial + 12, "changes": [{"kind": "desktops", "id": 1}],
        })
        with patch.object(storage, "HISTORY", 2), patch.object(events, "HISTORY", 2):
            self.other.put("/api/desktops/1/name", json={"name": "Latest"})
            self.assertEqual(events.read_events(initial), {"type": "ready", "revision": initial + 13})
