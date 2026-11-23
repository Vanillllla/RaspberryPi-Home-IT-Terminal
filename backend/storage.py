import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException

from .events import HISTORY, notify_committed
from .i18n import tr

DB_PATH = Path(os.environ.get("TERMINAL_DB", Path(__file__).parent / "data/terminal.sqlite3"))


def private_directory():
    directory = DB_PATH.parent / "secrets"
    directory.mkdir(mode=0o700, exist_ok=True)
    directory.chmod(0o700)
    return directory


def attach_private_profiles(conn):
    if any(row["name"] == "private_profiles" for row in conn.execute("PRAGMA database_list")):
        return
    path = private_directory() / DB_PATH.name
    conn.execute("ATTACH DATABASE ? AS private_profiles", (str(path),))
    path.chmod(0o600)
    conn.execute("PRAGMA private_profiles.secure_delete = ON")


class Connection(sqlite3.Connection):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.changes = {}

    def changed(self, kind, item_id=None, *, plugin=None):
        """Record an invalidation in the current write transaction."""
        change = {"kind": kind}
        if item_id is not None:
            change["id"] = item_id
        if plugin is not None:
            change["plugin"] = plugin
        self.changes[(kind, item_id, plugin)] = change


def state_revision(conn):
    committed = conn.execute("SELECT COALESCE(MAX(revision), 0) FROM state_events").fetchone()[0]
    return committed + bool(conn.changes)


def check_expected(current, expected):
    if any(current.get(key) != value for key, value in expected.items()):
        raise HTTPException(409, tr("Эти данные изменились на другом устройстве. Загрузите актуальные данные и повторите правки.",
                                    "This data changed on another device. Load the current data and reapply your edits."))


@contextmanager
def database(*, write=False):
    conn = sqlite3.connect(DB_PATH, timeout=10, factory=Connection)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield conn
        if conn.changes:
            assert write, "State changes require database(write=True)"
            revision = conn.execute("INSERT INTO state_events(changes) VALUES (?) RETURNING revision",
                                    (json.dumps(list(conn.changes.values())),)).fetchone()[0]
            conn.execute("DELETE FROM state_events WHERE revision <= ?", (revision - HISTORY,))
        conn.commit()
        if conn.changes:
            notify_committed()
    finally:
        conn.close()


def initialize():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with database(write=True) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS state_events (revision INTEGER PRIMARY KEY, changes TEXT NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS integrations (id TEXT PRIMARY KEY, definition TEXT NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, definition TEXT NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS deleted_templates (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)")
        conn.execute("""CREATE TABLE IF NOT EXISTS desktops (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL
        )""")
        desktop_columns = {column["name"] for column in conn.execute("PRAGMA table_info(desktops)")}
        if "default_name" not in desktop_columns:
            conn.execute("ALTER TABLE desktops ADD COLUMN default_name INTEGER NOT NULL DEFAULT 0")
            conn.execute("UPDATE desktops SET default_name=1 WHERE name='Рабочий стол ' || id")
        if "sort_order" not in desktop_columns:
            conn.execute("ALTER TABLE desktops ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            conn.execute("UPDATE desktops SET sort_order=id")
        conn.execute("""CREATE TABLE IF NOT EXISTS widgets (
            id INTEGER PRIMARY KEY,
            desktop_id INTEGER NOT NULL REFERENCES desktops(id),
            plugin_id TEXT NOT NULL,
            slot INTEGER NOT NULL CHECK(slot >= 0),
            settings TEXT NOT NULL DEFAULT '{}',
            appearance TEXT NOT NULL DEFAULT '{}',
            UNIQUE(desktop_id, slot)
        )""")
        if "width" not in {column["name"] for column in conn.execute("PRAGMA table_info(widgets)")}:
            conn.execute("ALTER TABLE widgets ADD COLUMN width INTEGER NOT NULL DEFAULT 4 CHECK(width > 0)")
            conn.execute("ALTER TABLE widgets ADD COLUMN height INTEGER NOT NULL DEFAULT 2 CHECK(height > 0)")
            # Descending order vacates larger old slots before a migrated row can claim them.
            old = conn.execute("SELECT id, slot FROM widgets ORDER BY slot DESC").fetchall()
            for row in old:
                y, x = divmod(row["slot"], 3)
                conn.execute("UPDATE widgets SET slot=? WHERE id=?", (24 * y + 4 * x, row["id"]))
        # Keep instance IDs stable across deletion, including for pre-existing databases.
        conn.execute("CREATE TABLE IF NOT EXISTS widget_sequence (last_id INTEGER NOT NULL)")
        if conn.execute("SELECT last_id FROM widget_sequence").fetchone() is None:
            conn.execute("INSERT INTO widget_sequence SELECT COALESCE(MAX(id), 0) FROM widgets")
        conn.execute("CREATE TABLE IF NOT EXISTS desktop_sequence (last_id INTEGER NOT NULL)")
        if conn.execute("SELECT last_id FROM desktop_sequence").fetchone() is None:
            conn.execute("INSERT INTO desktop_sequence SELECT COALESCE(MAX(id), 0) FROM desktops")
        if conn.execute("SELECT id FROM desktops LIMIT 1").fetchone() is None:
            insert_desktop(conn)


def insert_desktop(conn):
    number = conn.execute("UPDATE desktop_sequence SET last_id=last_id+1 RETURNING last_id").fetchone()[0]
    name = f"Рабочий стол {number}"
    conn.execute("INSERT INTO desktops(id, name, default_name, sort_order) VALUES (?, ?, 1, ?)", (number, name, number))
    return {"id": number, "name": name, "default_name": True}


def instance(row):
    return {**row, "settings": json.loads(row["settings"]), "appearance": json.loads(row["appearance"])}
