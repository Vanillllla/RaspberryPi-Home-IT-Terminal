import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException

from backend.main import AddWidget, create_widget, state
from backend.storage import initialize
from backend.templates import Definition, Invocation, create_template, edit_template, run_action


class TemplateTests(unittest.TestCase):
    def setUp(self):
        folder = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch("backend.storage.DB_PATH", Path(folder) / "test.db"))
        initialize()
        self.draft = {
            "name": "Датчик", "rows": [[{"id": "out", "kind": "text", "label": "Ожидание"},
                                      {"id": "button", "kind": "button", "label": "Обновить", "command": "go"}]],
            "actions": [{"id": "read", "name": "Время", "kind": "time", "trigger": "command",
                         "command": "go", "targets": [{"element": "out"}]}],
        }

    def test_create_retry_and_stale_edit(self):
        key = uuid4()
        first = create_template(Definition(**self.draft), key)
        self.assertEqual(first, create_template(Definition(**self.draft), key))
        edit_template(first["id"], Definition(**{**first, "name": "Часы"}))
        with self.assertRaises(HTTPException) as stale:
            edit_template(first["id"], Definition(**{**first, "name": "Старый черновик"}))
        self.assertEqual(stale.exception.status_code, 409)
        initialize()
        self.assertEqual([t["name"] for t in state()["templates"]], ["Часы"])

    def test_template_dimensions_apply_only_on_placement(self):
        template = create_template(Definition(**self.draft))
        add = AddWidget(plugin_id=template["id"], rows=3)
        first = create_widget(1, add)
        self.assertEqual((first["width"], first["height"]), (4, 2))
        edit_template(template["id"], Definition(**{**template, "defaultWidth": 7, "defaultHeight": 3}))
        second = create_widget(1, add)
        self.assertEqual((second["slot"], second["width"], second["height"]), (4, 7, 3))
        with self.assertRaises(HTTPException) as full:
            create_widget(1, add)
        self.assertEqual(full.exception.status_code, 409)
        self.assertEqual(state()["widgets"], [first, second])

    def test_running_action_does_not_write_into_edited_template(self):
        template = create_template(Definition(**self.draft))
        widget = create_widget(1, AddWidget(plugin_id=template["id"]))
        started, finish = Event(), Event()

        def execute(action, context):
            started.set()
            self.assertTrue(finish.wait(3))
            return "устаревший результат", ""

        with patch("backend.templates.execute", execute), ThreadPoolExecutor() as pool:
            work = pool.submit(run_action, widget["id"], "read", Invocation(revision=1))
            self.assertTrue(started.wait(3))
            edit_template(template["id"], Definition(**{**template, "name": "Новая версия"}))
            finish.set()
            with self.assertRaises(HTTPException) as stale:
                work.result()
            self.assertEqual(stale.exception.status_code, 409)
        self.assertNotIn("outputs", state()["widgets"][0]["settings"])

    def test_timer_skips_only_the_busy_instance(self):
        self.draft["actions"][0]["trigger"] = "timer"
        template = create_template(Definition(**self.draft))
        ids = [create_widget(1, AddWidget(plugin_id=template["id"]))["id"] for _ in range(2)]
        started, finish = Event(), Event()

        def execute(action, context):
            if context["instance_id"] == ids[0]:
                started.set()
                self.assertTrue(finish.wait(3))
            return "готово", ""

        with patch("backend.templates.execute", execute), ThreadPoolExecutor() as pool:
            request = Invocation(revision=1)
            work = pool.submit(run_action, ids[0], "read", request)
            self.assertTrue(started.wait(3))
            self.assertEqual(run_action(ids[0], "read", request), {"skipped": True})
            self.assertEqual(run_action(ids[1], "read", request)["outputs"], {"out": "готово"})
            finish.set()
            self.assertEqual(work.result()["outputs"], {"out": "готово"})
