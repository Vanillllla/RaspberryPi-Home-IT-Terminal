import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import main, storage
from backend.discovery import initialize_plugins

sing_box = importlib.import_module("plugins.sing-box-latency.backend")


class PrivateProfilesTest(unittest.TestCase):
    def test_move_existing_profiles_without_changing_widget_ids(self):
        directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.object(storage, "DB_PATH", directory / "test.db"))
        storage.initialize()
        wg = main.create_widget(1, main.AddWidget(plugin_id="wireguard"))["id"]
        sing = main.create_widget(1, main.AddWidget(plugin_id="sing-box-latency"))["id"]
        legacy = main.create_widget(1, main.AddWidget(plugin_id="sing-box-latency"))["id"]
        configs = [{"id": "first", "kind": "link", "name": "Proxy",
                    "config": {"outbounds": [{"password": "example-proxy-secret-for-test"}]}}]
        wg_config = "[Interface]\nPrivateKey = test-only-wireguard-key"
        with storage.database(write=True) as conn:
            conn.execute("CREATE TABLE wireguard_profiles(id, widget_id, name, target, config)")
            conn.execute("INSERT INTO wireguard_profiles VALUES (?, ?, ?, ?, ?)",
                         ("0123456789", wg, "LAN", "10.77.77.1", wg_config))
            conn.execute("CREATE TABLE sing_box_profiles(widget_id, profiles)")
            conn.execute("INSERT INTO sing_box_profiles VALUES (?, ?)", (sing, json.dumps(configs)))
            conn.execute("UPDATE widgets SET settings = ? WHERE id = ?", (json.dumps({
                "profiles": [{"name": "Legacy", "port": 1080}],
                "singBoxSchedule": {"automatic": False, "interval": 10},
            }), legacy))
        initialize_plugins(main.app)
        initialize_plugins(main.app)
        with storage.database(write=True) as conn:
            self.assertEqual(sing_box.load_profiles(conn, sing), configs)
            self.assertEqual(sing_box.load_profiles(conn, legacy), [
                {"id": "legacy-0", "name": "Legacy", "kind": "port", "port": 1080},
            ])
            self.assertEqual(sing_box.load_schedule(conn, legacy).interval, 10)
            self.assertEqual(conn.execute("SELECT config FROM private_profiles.wireguard_profiles").fetchone()[0], wg_config)
            self.assertFalse(conn.execute("SELECT 1 FROM main.sqlite_master WHERE name IN "
                                          "('wireguard_profiles', 'sing_box_profiles')").fetchall())
            self.assertNotIn("profiles", json.loads(conn.execute("SELECT settings FROM widgets WHERE id=?",
                                                                  (legacy,)).fetchone()[0]))
        self.assertNotIn(b"example-proxy-secret-for-test", storage.DB_PATH.read_bytes())
        self.assertNotIn(b"test-only-wireguard-key", storage.DB_PATH.read_bytes())
        main.delete_widget(sing)
        with storage.database() as conn:
            storage.attach_private_profiles(conn)
            self.assertIsNone(conn.execute("SELECT 1 FROM private_profiles.sing_box_profiles WHERE widget_id=?",
                                           (sing,)).fetchone())
