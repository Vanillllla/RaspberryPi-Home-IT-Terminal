import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(os.environ.get("TERMINAL_DB", Path(__file__).parent / "data/terminal.sqlite3"))


@contextmanager
def database(*, write=False):
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield conn
        conn.commit()
    finally:
        conn.close()


def initialize():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with database(write=True) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, definition TEXT NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS deleted_templates (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)")
        conn.execute("""CREATE TABLE IF NOT EXISTS desktops (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL
        )""")
        if "default_name" not in {column["name"] for column in conn.execute("PRAGMA table_info(desktops)")}:
            conn.execute("ALTER TABLE desktops ADD COLUMN default_name INTEGER NOT NULL DEFAULT 0")
            conn.execute("UPDATE desktops SET default_name=1 WHERE name='Рабочий стол ' || id")
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
    conn.execute("INSERT INTO desktops(id, name, default_name) VALUES (?, ?, 1)", (number, name))
    return {"id": number, "name": name, "default_name": True}


def instance(row):
    return {**row, "settings": json.loads(row["settings"]), "appearance": json.loads(row["appearance"])}
