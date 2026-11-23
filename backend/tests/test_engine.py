import json
import shutil
import sqlite3
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import catalog, events, storage
from backend.main import app


class EngineTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        for name in ("widgets", "elements"):
            shutil.copytree(catalog.ROOT / name, self.root / name)
            self.enterContext(patch.object(catalog, name.upper(), self.root / name))
        self.enterContext(patch.object(catalog, "INTEGRATIONS", self.root / "integrations"))
        self.enterContext(patch.object(storage, "DB_PATH", self.root / "state.sqlite"))
        self.client = None
        self.restart()
        self.addCleanup(self.stop)

    def stop(self):
        if self.client is not None:
            self.client.__exit__(None, None, None)
            self.client = None

    def restart(self):
        self.stop()
        self.client = TestClient(app)
        self.client.__enter__()

    def snapshot(self):
        return self.client.get("/api/state").json()

    def widget(self, project="signal-lab", desktop=1):
        response = self.client.post(f"/api/desktops/{desktop}/widgets", json={"project_id": project})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["id"]

    def instance(self, widget_id):
        return next(w for w in self.snapshot()["widgets"] if w["id"] == widget_id)

    def project(self, name):
        return self.client.get("/api/projects/" + name).json()

    def save(self, definition, status=200):
        response = self.client.put("/api/projects/" + definition["project"]["id"],
                                   json={"project": definition["project"], "expected": definition["revision"]})
        self.assertEqual(response.status_code, status, response.text[:1000])
        return response.json()

    def send(self, widget_id, name, element=None, changes=None, status=200):
        response = self.client.post(f"/api/widgets/{widget_id}/events",
                                    json={"name": name, "element": element, "changes": changes or {}})
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def configure(self, widget_id, **patches):
        r = self.client.put(f"/api/widgets/{widget_id}/configuration", json=patches)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_empty_and_faulty_modules_are_isolated(self):
        widget = self.widget()
        self.stop()
        (catalog.WIDGETS / "signal-lab").rename(self.root / "signal")
        (catalog.ELEMENTS / "button" / "manifest.json").write_text("invalid")
        self.restart()
        self.assertEqual(self.instance(widget)["project_id"], "signal-lab")
        self.assertIn("elements/button", self.snapshot()["diagnostics"])
        self.assertEqual(len(self.snapshot()["projects"]), 3)
        self.stop()
        shutil.rmtree(catalog.WIDGETS)
        shutil.rmtree(catalog.ELEMENTS)
        self.restart()
        state = self.snapshot()
        self.assertEqual((state["projects"], state["elements"]), ([], []))
        self.assertEqual(state["widgets"][0]["slot"], 0)

    def test_cross_element_values_and_persistence_after_restart(self):
        a, b = self.widget(), self.widget()
        self.send(a, "onChange", "level", {"value": 73})
        self.send(a, "onClick", "apply")
        props = self.instance(a)["properties"]
        self.assertEqual(props["result"]["text"], "73 %")
        self.assertEqual(props["lamp"]["label"], "On")
        self.assertEqual(self.instance(b)["properties"], {})
        self.restart()
        self.assertEqual(self.instance(a)["properties"], {"result": {"text": "73 %"}})

    def test_property_contract_validation_and_event_rollback(self):
        draft = self.project("signal-lab")
        draft["project"]["source"] = """def apply_signal(ctx):
    ctx.set("result","text","discard me",persist=True)
    ctx.set("power","value",123)
"""
        self.save(draft)
        w = self.widget()
        result = self.send(w, "onClick", "apply", status=422)
        self.assertIn("3", result["detail"])
        self.assertEqual(self.instance(w)["properties"], {})
        self.send(w, "onChange", "power", {"value": "true"}, status=422)
        self.send(w, "onClick", "apply", {"text": "unapproved input"}, status=422)
        self.send(w, "onHover", "apply", status=422)

    def test_emit_call_and_ordered_temporary_and_durable_writes(self):
        draft = self.project("signal-lab")
        draft["project"]["events"] = {"changed": "change"}
        draft["project"]["source"] = """def apply_signal(ctx):
    assert ctx.event["element"] == "apply"
    ctx.emit("changed")
    assert ctx.event["element"] == "apply"
    return "ignored"
def helper(ctx):
    return "committed"
def change(ctx):
    assert ctx.event["name"] == "changed"
    ctx.set("result","text",ctx.call("helper"),persist=True)
    ctx.set("result","text","session")
"""
        self.save(draft)
        w = self.widget()
        self.send(w, "onClick", "apply")
        self.assertEqual(self.instance(w)["properties"]["result"]["text"], "session")
        self.restart()
        self.assertEqual(self.instance(w)["properties"]["result"]["text"], "committed")

    def test_all_views_share_only_one_instances_data(self):
        a, b = self.widget("station-panel"), self.widget("station-panel")
        self.send(a, "onChange", "nameInput", {"value": "North"})
        self.send(a, "onClick", "inspect")
        instance = self.instance(a)
        for key in ("station", "detailName"):
            self.assertEqual(instance["properties"][key]["text"], "North")
        self.assertEqual(instance["settings"], {"stationName": "North"})
        self.assertEqual(self.instance(b)["settings"], {"stationName": "Station"})
        self.assertEqual(instance["properties"]["reading"]["text"], "Checked")

    def test_secret_fields_never_enter_snapshots_or_events(self):
        draft = self.project("station-panel")
        draft["project"]["settings"]["token"] = {"type": "secret", "default": "", "label": {"ru": "Токен", "en": "Token"}}
        draft["project"]["source"] += '\ndef fail(ctx):\n    raise ValueError(ctx.setting("token"))\n'
        draft["project"]["events"]["fail"] = "fail"
        self.save(draft)
        w = self.widget("station-panel")
        secret = "test-only-opaque-value"
        public = self.configure(w, settings={"token": secret})
        self.assertNotIn(secret, json.dumps(public))
        self.assertEqual(public["configuredSecrets"], ["token"])
        error = self.send(w, "fail", status=422)
        self.assertNotIn(secret, str(error))
        self.assertNotIn(secret, str(self.snapshot()))
        self.assertNotIn(secret, str(events.read_events(0)))
        # Changing a setting's kind cannot publish a previously private value.
        draft = self.project("station-panel")
        draft["project"]["settings"]["token"]["type"] = "string"
        self.save(draft)
        self.assertNotIn(secret, str(self.snapshot()))

    def test_size_conflicts_roll_back_files_all_desktops_and_state(self):
        a = self.widget()
        b = self.widget()
        other = self.client.post("/api/desktops").json()["id"]
        self.widget(desktop=other)
        self.configure(a, appearance={"customTitle": "Local", "cardPalette": "green"})
        draft = self.project("signal-lab")
        draft["project"].update(width=6, height=3, appearance={"cardPalette": "purple", "hideTitle": True})
        self.save(draft)
        self.assertEqual(self.instance(a)["slot"], 0)
        self.assertEqual(self.instance(b)["slot"], 6)
        self.assertEqual(self.instance(a)["appearance"], {"customTitle": "Local", "cardPalette": "green"})
        self.assertEqual(self.instance(b)["appearance"], {})
        manifest = catalog.WIDGETS / "signal-lab/manifest.json"
        original = manifest.read_bytes()
        before = self.snapshot()
        draft = self.project("signal-lab")
        draft["project"].update(width=12, height=6)
        self.assertIn("#1", self.save(draft, 409)["detail"])
        self.assertEqual(manifest.read_bytes(), original)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.client.put(f"/api/widgets/{a}/configuration", json={"width": 8}).status_code, 422)

    def test_manual_project_and_editor_roundtrip_stale_revision_and_assets(self):
        draft = self.project("signal-lab")
        draft["project"]["id"] = "manual-copy"
        draft["revision"] = None
        revision = self.save(draft)["revision"]
        folder = catalog.WIDGETS / "manual-copy"
        manifest = json.loads((folder / "manifest.json").read_text())
        self.assertEqual((folder / manifest["logic"]).read_text(), draft["project"]["source"])
        (folder / "assets/icon.png").write_bytes(b"example")
        self.assertEqual(self.client.get("/api/projects/manual-copy/assets/icon.png").content, b"example")
        self.save(draft, 409)
        self.restart()
        self.assertEqual(self.project("manual-copy")["revision"], revision)
        duplicate = self.project("manual-copy")
        duplicate["project"]["views"]["details"] = duplicate["project"]["views"]["widget"]
        self.save(duplicate, 422)
        draft = self.project("manual-copy")
        draft["project"]["source"] = "def bad(:"
        self.save(draft, 422)
        self.assertEqual(self.project("manual-copy")["revision"], revision)

    def test_custom_element_removal_and_restore_keeps_runtime_data(self):
        w = self.widget("gauge-lab")
        self.send(w, "onClick", "dial")
        self.assertEqual(self.instance(w)["properties"]["dial"]["value"], 35)
        before = self.project("gauge-lab")
        self.stop()
        path = catalog.ELEMENTS / "circular-gauge"
        path.rename(self.root / "detached")
        self.restart()
        self.assertEqual(self.project("gauge-lab"), before)
        self.send(w, "onClick", "advance")
        self.assertEqual(self.instance(w)["properties"]["percent"]["text"], "0 %")
        self.stop()
        (self.root / "detached").rename(path)
        self.restart()
        self.assertEqual(self.instance(w)["properties"]["dial"]["value"], 35)

    def test_preview_executes_draft_without_creating_files_or_instances(self):
        draft = self.project("signal-lab")["project"]
        draft["id"] = "unsaved"
        payload = {"project": draft, "event": {"name": "onChange", "element": "level", "changes": {"value": 91}}}
        start = self.snapshot()["revision"]
        first = self.client.post("/api/preview", json=payload).json()
        payload.update(token=first["token"], event={"name": "onClick", "element": "apply"})
        result = self.client.post("/api/preview", json=payload).json()
        self.assertEqual(result["properties"]["result"]["text"], "91 %")
        self.assertFalse((catalog.WIDGETS / "unsaved").exists())
        self.assertEqual(self.snapshot()["revision"], start)

    def test_host_operation_receives_declared_arguments_from_instance(self):
        folder = catalog.INTEGRATIONS / "lab"
        folder.mkdir(parents=True)
        (folder / "operations.json").write_text(json.dumps({"echo": {"argv": ["/usr/bin/echo"], "inputs": 1}}))
        self.restart()
        draft = self.project("signal-lab")
        draft["project"]["source"] = """def apply_signal(ctx):
    result = ctx.invoke("lab/echo", ctx.get("level", "value"))
    ctx.set("result", "text", result.strip())
"""
        self.save(draft)
        w = self.widget()
        self.send(w, "onClick", "apply")
        self.assertEqual(self.instance(w)["properties"]["result"]["text"], "35")
        self.assertEqual(self.snapshot()["operations"], {"lab/echo": 1})

    def test_concurrent_events_serialize_and_stale_properties_are_rejected(self):
        w = self.widget("gauge-lab")
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = [pool.submit(self.send, w, "onClick", "advance") for _ in range(3)]
            for f in futures:
                f.result()
        self.assertEqual(self.instance(w)["properties"]["dial"]["value"], 55)
        r = self.client.post(f"/api/widgets/{w}/events", json={"name": "onClick", "element": "advance", "revision": "old"})
        self.assertEqual(r.status_code, 409)

    def test_sync_desktop_navigation_configuration_and_cleanup(self):
        with self.client.websocket_connect("/api/events") as a, self.client.websocket_connect("/api/events") as b:
            self.assertEqual(a.receive_json(), b.receive_json())
            w = self.widget()
            committed = a.receive_json()
            self.assertEqual(committed, b.receive_json())
            self.assertIn({"kind": "widgets", "id": w}, committed["changes"])
            self.send(w, "onClick", "apply")
            self.assertEqual(a.receive_json(), b.receive_json())
        desk = self.client.post("/api/desktops").json()["id"]
        self.assertEqual(self.client.put(f"/api/desktops/{desk}/name", json={"name": "Office"}).status_code, 200)
        self.assertEqual(self.client.post("/api/desktops/swap", json={"first": 1, "second": desk}).status_code, 200)
        self.assertEqual(self.client.put(f"/api/widgets/{w}/position", json={"slot": 1, "desktop_id": desk}).status_code, 200)
        self.configure(w, appearance={"hideTitle": True}, expected=0)
        self.assertEqual(self.client.put(f"/api/widgets/{w}/configuration", json={"expected": 0}).status_code, 409)
        self.assertEqual(self.client.delete(f"/api/desktops/{desk}").status_code, 200)
        self.assertEqual(self.snapshot()["widgets"], [])
        self.assertEqual(self.client.delete("/api/desktops/1").status_code, 409)

    def count(self, widget):
        with closing(sqlite3.connect(storage.DB_PATH)) as conn:
            return conn.execute("SELECT count(*) FROM samples WHERE widget_id=?", (widget,)).fetchone()[0]

    def wait_samples(self, w, count):
        deadline = time.monotonic() + 4
        while self.count(w) < count and time.monotonic() < deadline:
            time.sleep(.06)
        self.assertGreaterEqual(self.count(w), count)

    def test_background_visibility_union_disconnect_and_history_cleanup(self):
        w = self.widget("sample-monitor")
        self.wait_samples(w, 1)  # No websocket clients.
        self.configure(w, execution={"mode": "visible", "interval": 1})
        samples = self.count(w)
        time.sleep(1.3)
        self.assertEqual(self.count(w), samples)
        with self.client.websocket_connect("/api/events") as a:
            a.receive_json()
            a.send_json({"visible": [w]})
            with self.client.websocket_connect("/api/events") as b:
                b.receive_json()
                b.send_json({"visible": [w]})
                self.wait_samples(w, samples + 1)
                a.send_json({"visible": []})
                self.wait_samples(w, samples + 2)
                self.assertEqual(self.count(w), samples + 2)
            time.sleep(.35)
            stopped = self.count(w)
            time.sleep(1.1)
            self.assertEqual(self.count(w), stopped)
        self.configure(w, execution={"mode": "background"})
        self.wait_samples(w, stopped + 1)
        self.assertEqual(len(self.instance(w)["properties"]["plot"]["points"]), self.count(w))
        self.client.delete(f"/api/widgets/{w}")
        self.assertEqual(self.count(w), 0)

    def test_external_file_changes_and_bad_handler_signature_keep_original(self):
        draft = self.project("signal-lab")
        draft["project"]["source"] = "def apply_signal():\n    pass\n"
        self.assertIn("ctx", self.save(draft, 422)["detail"])
        draft = self.project("signal-lab")
        source = catalog.WIDGETS / "signal-lab/logic/main.py"
        source.write_text(source.read_text() + "\n# Edited on the host\n")
        self.save(draft, 409)
        self.assertIn("Edited on the host", source.read_text())

    def test_failure_during_publication_recovers_manifest_and_placements(self):
        from backend.storage import Connection
        self.widget()
        draft = self.project("signal-lab")
        before = self.snapshot()
        manifest = catalog.WIDGETS / "signal-lab/manifest.json"
        original = manifest.read_bytes()
        draft["project"].update(width=3, height=3)
        with patch.object(Connection, "commit", side_effect=sqlite3.OperationalError("simulated storage failure")):
            with self.assertRaises(sqlite3.OperationalError):
                self.save(draft)
        self.assertEqual(manifest.read_bytes(), original)
        self.assertEqual(self.snapshot(), before)

    def test_settings_lifecycle_uses_proposed_values_and_commits_atomically(self):
        w = self.widget("station-panel")
        first = self.configure(w, settings={"stationName": "North"})
        self.assertEqual(first["properties"]["station"]["text"], "North")
        self.assertEqual(first["properties"]["nameInput"]["value"], "North")
        draft = self.project("station-panel")
        draft["project"]["source"] += '\ndef broken(ctx):\n    raise ValueError("failed")\n'
        draft["project"]["events"]["settingsChanged"] = "broken"
        self.save(draft)
        r = self.client.put(f"/api/widgets/{w}/configuration", json={"settings": {"stationName": "West"}})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(self.instance(w), first)

    def test_slow_handler_cannot_commit_to_a_changed_project(self):
        from threading import Event
        from backend import runtime
        w = self.widget()
        started, finish = Event(), Event()
        execute = runtime.execute

        def slow(req):
            started.set()
            self.assertTrue(finish.wait(3))
            return execute(req)

        with patch.object(runtime, "execute", side_effect=slow), ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.send, w, "onClick", "apply", None, 409)
            self.assertTrue(started.wait(3))
            draft = self.project("signal-lab")
            draft["project"]["version"] = "2.0"
            self.save(draft)
            finish.set()
            future.result()
        self.assertEqual(self.instance(w)["properties"], {})

    def test_preview_secret_and_history_are_scoped_to_a_server_session(self):
        draft = self.project("signal-lab")["project"]
        draft["settings"]["pin"] = {"type": "secret", "label": {"ru": "PIN", "en": "PIN"}, "default": ""}
        draft["events"] = {"first": "first", "second": "second"}
        draft["source"] += '''
def first(ctx):
    ctx.set_setting("pin", "sample-secret")
    ctx.sample("n", 1)
def second(ctx):
    assert ctx.setting("pin") == "sample-secret"
    assert len(ctx.history("n")) == 1
    ctx.set("result", "text", "ok")
'''
        endpoint = "/api/preview"
        payload = {"project": draft, "event": {"name": "first"}}
        r = self.client.post(endpoint, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("sample-secret", r.text)
        payload["event"] = {"name": "second"}
        self.assertEqual(self.client.post(endpoint, json=payload).status_code, 422)
        payload["token"] = r.json()["token"]
        self.assertEqual(self.client.post(endpoint, json=payload).json()["properties"]["result"]["text"], "ok")

    def test_history_retention_is_per_instance_and_includes_current_batch(self):
        w = self.widget("gauge-lab")
        draft = self.project("gauge-lab")
        draft["project"]["source"] = '''def advance(ctx):
    for n in range(3602):
        ctx.sample("series", n)
    assert ctx.history("series", 1)[0][1] == 3601
'''
        self.save(draft)
        self.send(w, "onClick", "advance")
        with storage.database() as conn:
            record = conn.execute("SELECT count(*),min(value),max(value) FROM samples WHERE widget_id=?", (w,)).fetchone()
        self.assertEqual(tuple(record), (3600, 2, 3601))
