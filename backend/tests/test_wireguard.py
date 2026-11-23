import base64
import json
import secrets
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend import main, storage
from plugins.wireguard import backend, tunnel


def configuration():
    private, public = (base64.b64encode(secrets.token_bytes(32)).decode() for _ in range(2))
    return f"""[Interface]
Address = 10.77.77.2/32
PrivateKey = {private}
DNS = 10.77.77.1
[Peer]
PublicKey = {public}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = example.org:51820
"""


class WireGuardTest(unittest.TestCase):
    def test_only_local_routes_and_native_directives(self):
        config = configuration()
        addr, target, _, routes, native = tunnel.read_config(config)
        self.assertEqual((addr, target), ("10.77.77.2", "10.77.77.1"))
        self.assertEqual(list(map(str, routes)), ["10.77.77.0/24"])
        self.assertIn("AllowedIPs = 10.77.77.0/24", native)
        self.assertNotIn("DNS", native)
        for bad in (config + "PostUp = echo hello", config.replace("0.0.0.0/0", "10.0.0.0/24"),
                    config.replace("example.org:", "example.org;bad:")):
            with self.assertRaises(tunnel.TunnelError):
                tunnel.read_config(bad)

    def test_reject_overlapping_host_route(self):
        routes = tunnel.read_config(configuration())[3]
        table = json.dumps([{"dst": "default"}, {"dst": "10.77.77.1"}])
        with patch.object(tunnel.subprocess, "check_output", return_value=table), self.assertRaises(tunnel.TunnelError):
            tunnel.check_routes(routes)

    def test_profile_isolation_and_widget_cleanup(self):
        directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.object(storage, "DB_PATH", directory / "test.db"))
        storage.initialize()
        one, two = (main.create_widget(1, main.AddWidget(plugin_id="wireguard"))["id"] for _ in range(2))
        config = configuration()
        profile = backend.add_profile(one, "Home", config.encode())["id"]
        self.assertEqual(storage.DB_PATH.stat().st_mode & 0o777, 0o600)
        info, = backend.list_profiles(one)
        self.assertEqual(info, dict(id=profile, name="Home", target="10.77.77.1", connected=False, ping=None))
        self.assertNotIn(config.split("PrivateKey = ")[1].splitlines()[0], json.dumps(main.state()["widgets"]))
        self.assertEqual(backend.list_profiles(two), [])
        with self.assertRaises(HTTPException):
            backend.remove(two, profile)
        with patch.object(tunnel, "interface_state", return_value=True), patch.object(backend.subprocess, "run") as run:
            run.side_effect = FileNotFoundError()
            with self.assertRaises(HTTPException):
                main.delete_widget(one)
        self.assertEqual(len(backend.list_profiles(one)), 1)
        main.delete_widget(one)
        with storage.database() as conn:
            self.assertFalse(conn.execute("SELECT id FROM wireguard_profiles").fetchall())
