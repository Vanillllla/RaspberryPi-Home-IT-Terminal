import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend import storage
from backend.main import (
    AddWidget, ContentAlignment, MoveWidget, WidgetSize, align_content,
    create_widget, move_widget, resize_widget, state,
)


class LayoutTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "legacy.sqlite3"
        patcher = patch.object(storage, "DB_PATH", path)
        patcher.start()
        self.addCleanup(patcher.stop)
        with sqlite3.connect(path) as db:
            db.executescript("""
                CREATE TABLE desktops(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
                INSERT INTO desktops VALUES (1,'Main');
                CREATE TABLE widgets(id INTEGER PRIMARY KEY, desktop_id INTEGER NOT NULL,
                    plugin_id TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot>=0),
                    settings TEXT NOT NULL DEFAULT '{}', appearance TEXT NOT NULL DEFAULT '{}',
                    UNIQUE(desktop_id, slot));
            """)
            for slot in (0, 1, 4, 4095):
                db.execute("INSERT INTO widgets VALUES (?,1,'clock',?,?,?)",
                           (slot + 1, slot, '{"label":"saved"}', '{"color":"blue"}'))
        storage.initialize()

    def test_migration_is_ordered_and_idempotent(self):
        first = state()
        storage.initialize()
        self.assertEqual(first, state())
        self.assertEqual([w["slot"] for w in first["widgets"]], [0, 4, 28, 32760])
        for w in first["widgets"]:
            self.assertEqual((w["width"], w["height"]), (4, 2))
            self.assertEqual(w["settings"], {"label": "saved"})
            self.assertEqual(w["appearance"], {"color": "blue"})

    def test_alignment_preserves_other_appearance_keys_and_instances(self):
        expected = state()
        align_content(1, ContentAlignment(horizontalAlign="right", verticalAlign="top"))
        expected["widgets"][0]["appearance"].update(horizontalAlign="right", verticalAlign="top")
        self.assertEqual(state(), expected)

    def test_full_rectangle_and_atomic_rejection(self):
        before = state()
        for change in (lambda: resize_widget(1, WidgetSize(width=5, height=1)),
                       lambda: move_widget(1, MoveWidget(slot=13)),
                       lambda: move_widget(1, MoveWidget(slot=10))):
            with self.assertRaises(HTTPException) as error:
                change()
            self.assertEqual(error.exception.status_code, 409)
            self.assertEqual(before, state())
        resize_widget(1, WidgetSize(width=3, height=2))
        with patch.dict("backend.main.plugins", {"clock": object()}):
            self.assertEqual(create_widget(1, AddWidget(plugin_id="clock"))["slot"], 8)
        move_widget(1, MoveWidget(slot=1))  # May overlap its own former footprint.
        self.assertEqual(state()["widgets"][0]["slot"], 1)
