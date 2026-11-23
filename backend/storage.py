import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from .events import HISTORY, notify_committed
from .i18n import tr
from .values import checked

DB_PATH = Path(os.environ.get("TERMINAL_DB", Path(__file__).parent / "data/engine.sqlite3"))
# Transactions are short. Python handlers and network calls run outside this lock.
gate = threading.RLock()
_memory = None
_memory_uri = ""


class Connection(sqlite3.Connection):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.changes = {}

    def changed(self, kind, item_id=None):
        change = {"kind": kind}
        if item_id is not None:
            change["id"] = item_id
        self.changes[(kind, item_id)] = change


def state_revision(conn):
    committed = conn.execute("SELECT COALESCE(MAX(revision), 0) FROM state_events").fetchone()[0]
    return committed + bool(conn.changes)


def check_expected(current, expected):
    if any(current.get(key) != value for key, value in expected.items()):
        raise HTTPException(409, tr("Данные изменились. Загрузите актуальную версию.",
                                    "The data changed. Load the current version."))


@contextmanager
def database(*, write=False):
    with gate:
        conn = sqlite3.connect(DB_PATH, timeout=10, factory=Connection, uri=True)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("ATTACH DATABASE ? AS runtime", (_memory_uri,))
            conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield conn
            if conn.changes:
                assert write
                revision = conn.execute("INSERT INTO state_events(changes) VALUES (?) RETURNING revision",
                                        (json.dumps(list(conn.changes.values())),)).fetchone()[0]
                conn.execute("DELETE FROM state_events WHERE revision <= ?", (revision - HISTORY,))
            conn.commit()
            if conn.changes:
                notify_committed()
        finally:
            conn.close()


def initialize():
    global _memory, _memory_uri
    with gate:
        shutdown()
        _memory_uri = f"file:runtime-{uuid4().hex}?mode=memory&cache=shared"
        _memory = sqlite3.connect(_memory_uri, uri=True, check_same_thread=False)
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with database(write=True) as conn:
            existing = {r["name"] for r in conn.execute("PRAGMA table_info(widgets)")}
            if existing and "project_id" not in existing:
                raise RuntimeError("Legacy database. Set TERMINAL_DB to a new file / Укажите новый файл TERMINAL_DB.")
            DB_PATH.chmod(0o600)
            conn.execute("CREATE TABLE IF NOT EXISTS state_events (revision INTEGER PRIMARY KEY, changes TEXT NOT NULL)")
            conn.execute("""CREATE TABLE IF NOT EXISTS desktops (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT '',
                default_name INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0)""")
            conn.execute("""CREATE TABLE IF NOT EXISTS widgets (
                id INTEGER PRIMARY KEY AUTOINCREMENT, desktop_id INTEGER NOT NULL REFERENCES desktops ON DELETE CASCADE,
                project_id TEXT NOT NULL, config_version INTEGER NOT NULL DEFAULT 0, slot INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
                settings TEXT NOT NULL DEFAULT '{}', secrets TEXT NOT NULL DEFAULT '{}', appearance TEXT NOT NULL DEFAULT '{}',
                execution TEXT NOT NULL DEFAULT '{}', properties TEXT NOT NULL DEFAULT '{}')""")
            conn.execute("""CREATE TABLE IF NOT EXISTS samples (
                id INTEGER PRIMARY KEY, widget_id INTEGER NOT NULL REFERENCES widgets ON DELETE CASCADE,
                series TEXT NOT NULL, time REAL NOT NULL, value REAL NOT NULL)""")
            conn.execute("CREATE INDEX IF NOT EXISTS sample_lookup ON samples(widget_id, series, id)")
            conn.execute("""CREATE TABLE runtime.live (
                id INTEGER PRIMARY KEY, properties TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '')""")
            if conn.execute("SELECT 1 FROM desktops LIMIT 1").fetchone() is None:
                insert_desktop(conn)


def shutdown():
    global _memory
    if _memory:
        _memory.close()
        _memory = None


def insert_desktop(conn):
    number = conn.execute("INSERT INTO desktops DEFAULT VALUES RETURNING id").fetchone()[0]
    name = f"Рабочий стол {number}"
    conn.execute("UPDATE desktops SET name=?,sort_order=? WHERE id=?", (name, number, number))
    return {"id": number, "name": name, "default_name": True}


def load_widget(conn, widget_id):
    row = conn.execute("""SELECT w.*, l.properties AS temporary, COALESCE(l.error,'') AS error
                          FROM widgets w LEFT JOIN runtime.live l USING(id) WHERE w.id=?""", (widget_id,)).fetchone()
    if row is None:
        raise HTTPException(404, tr("Экземпляр отсутствует", "Widget instance not found"))
    return row


def setting_values(row, definition):
    plain = json.loads(row["settings"])
    private = json.loads(row["secrets"])
    overrides = {}
    for key, spec in definition.project.settings.items():
        source = private if spec.type == "secret" else plain
        if key in source:
            try:
                overrides[key] = checked(spec.model_dump(), source[key])
            except ValueError:
                continue
    return overrides


def split_settings(settings, definition):
    schema = definition.project.settings
    plain = {k: v for k, v in settings.items() if k in schema and schema[k].type != "secret"}
    private = {k: v for k, v in settings.items() if k in schema and schema[k].type == "secret"}
    return json.dumps(plain), json.dumps(private)


def instance(row, definition):
    result = {k: row[k] for k in ("id", "desktop_id", "project_id", "slot", "width", "height", "error", "config_version")}
    result["appearance"] = json.loads(row["appearance"])
    result["execution"] = json.loads(row["execution"])
    result["settings"] = {}
    result["configuredSecrets"] = []
    if definition:
        raw = setting_values(row, definition)
        for key, spec in definition.project.settings.items():
            if spec.type == "secret":
                if raw.get(key):
                    result["configuredSecrets"].append(key)
            else:
                result["settings"][key] = raw.get(key, spec.default)
    props = json.loads(row["properties"])
    for node, values in json.loads(row["temporary"] or "{}").items():
        props.setdefault(node, {}).update(values)
    if definition:
        from .catalog import elements
        for node_id, values in list(props.items()):
            node = definition.nodes.get(node_id)
            contract = node and elements.get(node.type)
            if not contract:
                props.pop(node_id)
                continue
            for key, value in list(values.items()):
                try:
                    checked(contract.properties[key].model_dump(), value)
                except (KeyError, ValueError):
                    values.pop(key)
    result["properties"] = props
    return result
