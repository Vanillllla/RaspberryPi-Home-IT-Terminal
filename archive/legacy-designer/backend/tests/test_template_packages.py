import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from fastapi import HTTPException

from backend.main import AddWidget, create_widget, state
from backend.storage import initialize
from backend.template_packages import TemplateConflict, discover_packages, import_file, import_zip
from backend.templates import catalog_version, delete_template


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch("backend.storage.DB_PATH", self.root / "db"))
        initialize()
        self.path = "clock/template.json"
        self.package = {"id": "template:" + "1" * 32, "name": "Часы", "description": "Время",
                        "rows": [[{"id": "value", "kind": "text", "label": "Время"}]], "actions": []}

    def archive(self, path):
        buf = io.BytesIO()
        with ZipFile(buf, "w") as archive:
            archive.writestr(path, json.dumps(self.package))
        return buf.getvalue()

    def test_duplicate_across_sources_preserves_catalog(self):
        saved = import_zip(self.archive(self.path))
        self.package["description"] = "Замена"
        data = json.dumps(self.package).encode()
        with self.assertRaises(TemplateConflict):
            import_file(self.path, data)
        file = self.root / self.path
        file.parent.mkdir()
        file.write_bytes(data)
        with self.assertLogs("backend.template_packages", "WARNING"):
            discover_packages(self.root)
        self.assertEqual(state()["templates"], [saved])
        self.assertEqual(state()["widgets"], [])

    def test_delete_keeps_placement_and_requires_explicit_reimport(self):
        file = self.root / self.path
        file.parent.mkdir()
        file.write_text(json.dumps(self.package), encoding="utf-8")
        discover_packages(self.root)
        saved, = state()["templates"]
        template_id = saved["id"]
        widget = create_widget(1, AddWidget(plugin_id=template_id))
        revision = saved["revision"]
        with self.assertRaises(HTTPException) as stale:
            delete_template(template_id, revision - 1)
        self.assertEqual(stale.exception.status_code, 409)
        self.assertEqual(catalog_version(), [f"{template_id}:{revision}"])

        delete_template(template_id, revision)
        initialize()
        discover_packages(self.root)
        self.assertEqual(catalog_version(), [])
        self.assertEqual(state()["templates"], [])
        self.assertEqual(state()["widgets"], [widget])

        restored = import_file(self.path, file.read_bytes())
        self.assertEqual(restored["revision"], revision + 1)
        with self.assertRaises(HTTPException) as stale:
            delete_template(template_id, revision)
        self.assertEqual(stale.exception.status_code, 409)
        self.assertEqual(state()["templates"], [restored])
        self.assertEqual(state()["widgets"], [widget])

    def test_reject_invalid_definition_and_archive_paths(self):
        for fields in [
            {"id": "clock"}, {"description": {}}, {"rows": []},
            {"rows": [[{"id": "v", "kind": "unknown", "label": "?"}]]},
            {"actions": [{"id": "read", "kind": "time", "name": "Часы", "trigger": "timer",
                          "targets": [{"element": "missing"}]}]},
        ]:
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                import_file(self.path, json.dumps({**self.package, **fields}).encode())
        for path in ("template.json", "../template.json", "/clock/template.json", "C:/template.json",
                     "clock/../template.json", "clock\\template.json"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                import_zip(self.archive(path))
        self.assertEqual(state()["templates"], [])
