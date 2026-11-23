"""Run serial events per instance, then commit their property, setting and history changes together."""
import json
import os
import signal
import subprocess
import sys
from pathlib import Path
from threading import Lock

from fastapi import HTTPException
from pydantic import Field, JsonValue

from . import catalog, storage
from .contracts import Identifier, Model
from .i18n import tr
from .values import HISTORY_LIMIT, checked

# Bounded striping keeps deleted instance IDs out of process memory.
_locks = [Lock() for _ in range(97)]
WORKER = Path(__file__).with_name("worker.py")


class Event(Model):
    name: Identifier
    element: Identifier | None = None
    changes: dict[Identifier, JsonValue] = Field(default_factory=dict)
    revision: str = ""


def require_project(key):
    definition = catalog.projects.get(key)
    if definition is None:
        raise HTTPException(404, tr("Проект недоступен", "Project unavailable") + ": " + key)
    return definition


def row_state(row, definition):
    public = storage.instance(row, definition)
    return public["properties"], storage.setting_values(row, definition)


def request_for(definition, event, properties, settings, *, periodic=False):
    project = definition.project
    if event.revision and event.revision != definition.revision:
        raise HTTPException(409, tr("Определение проекта изменилось", "Project definition changed"))
    contracts = {}
    values = {}
    types = {}
    for node in definition.nodes.values():
        element = catalog.elements.get(node.type)
        if not element:
            continue
        if node.type not in contracts:
            contracts[node.type] = {k: v.model_dump() for k, v in element.properties.items()}
        schema = contracts[node.type]
        types[node.id] = node.type
        current = {k: node.props.get(k, spec["default"]) for k, spec in schema.items()}
        for k, v in properties.get(node.id, {}).items():
            if k in schema:
                try:
                    current[k] = checked(schema[k], v)
                except ValueError:
                    pass  # A project revision may change a property's type.
        values[node.id] = current

    if event.element:
        node = definition.nodes.get(event.element)
        element = node and catalog.elements.get(node.type)
        spec = element and element.events.get(event.name)
        if spec is None or set(event.changes) - set(spec.writes):
            raise HTTPException(422, tr("Неизвестное событие или свойство", "Unknown event or property"))
        try:
            for k, v in event.changes.items():
                checked(contracts[node.type][k], v)
        except ValueError as exc:
            raise HTTPException(422, tr("Недопустимое значение", "Invalid value") + f": {exc}") from exc
        handler = node.events.get(event.name)
    elif periodic:
        handler = project.execution.handler
    else:
        if event.name not in project.events or event.changes:
            raise HTTPException(422, tr("Неизвестное событие проекта", "Unknown project event"))
        handler = project.events[event.name]
    return {"event": event.model_dump(exclude={"revision"}), "handler": handler, "source": project.source,
            "folder": str(catalog.WIDGETS / project.id), "contracts": contracts, "values": values, "types": types,
            "settings": settings, "schema": {k: v.model_dump() for k, v in project.settings.items()},
            "events": project.events, "operations": catalog.operations}


def execute(req):
    if not req["handler"]:
        event = req["event"]
        return {"writes": [[event["element"], k, v, False] for k, v in event["changes"].items()],
                "settings": {}, "samples": []}
    with subprocess.Popen([sys.executable, "-I", str(WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, start_new_session=True) as process:
        try:
            reply, _ = process.communicate(json.dumps(req).encode(), timeout=8)
        except subprocess.TimeoutExpired as exc:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            raise HTTPException(422, tr("Истекло время выполнения Python", "Python execution timed out")) from exc
        finally:
            # A trusted handler may still leave an accidental child running.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    try:
        result = json.loads(reply)
    except ValueError as exc:
        raise HTTPException(422, tr("Процесс Python завершился без результата",
                                    "Python worker exited without a result")) from exc
    if "error" in result:
        message = tr("Ошибка Python", "Python error")
        if result["line"]:
            message += tr(" в строке ", " on line ") + str(result["line"])
        detail = result["detail"]
        for name, spec in req["schema"].items():
            secret = req["settings"].get(name)
            if spec["type"] == "secret" and secret:
                detail = detail.replace(str(secret), "••••")
        raise HTTPException(422, f"{message}: {result['error']}: {detail}")
    return result


def apply_result(conn, row, result):
    id_ = row["id"]
    durable = json.loads(row["properties"])
    live = json.loads(row["temporary"] or "{}")
    for node, prop, value, persist in result["writes"]:
        if persist:
            durable.setdefault(node, {})[prop] = value
            if node in live:
                live[node].pop(prop, None)
        else:
            live.setdefault(node, {})[prop] = value
    if any(write[3] for write in result["writes"]):
        conn.execute("UPDATE widgets SET properties=? WHERE id=?", (json.dumps(durable), id_))
    if result["settings"]:
        definition = require_project(row["project_id"])
        settings = {**storage.setting_values(row, definition), **result["settings"]}
        plain, private = storage.split_settings(settings, definition)
        conn.execute("UPDATE widgets SET settings=?,secrets=?,config_version=config_version+1 WHERE id=?",
                     (plain, private, id_))
    conn.execute("INSERT OR REPLACE INTO runtime.live(id,properties,error) VALUES (?,?,'')", (id_, json.dumps(live)))
    conn.executemany("INSERT INTO samples(widget_id,series,time,value) VALUES (?,?,?,?)",
                     ((id_, *sample) for sample in result["samples"]))
    for series in {point[0] for point in result["samples"]}:
        conn.execute("""DELETE FROM samples WHERE widget_id=? AND series=? AND id < (
            SELECT id FROM samples WHERE widget_id=? AND series=? ORDER BY id DESC LIMIT 1 OFFSET ?)""",
                     (id_, series, id_, series, HISTORY_LIMIT - 1))
    conn.changed("widgets", id_)


def instance_lock(widget_id):
    return _locks[widget_id % len(_locks)]


def dispatch(widget_id, event, *, periodic=False):
    with instance_lock(widget_id):
        with storage.database() as conn:
            row = storage.load_widget(conn, widget_id)
            definition = require_project(row["project_id"])
            if periodic and not should_tick(row, definition):
                return
            props, settings = row_state(row, definition)
            req = request_for(definition, event, props, settings, periodic=periodic)
            req.update(instance_id=widget_id, db=str(storage.DB_PATH.resolve()))
        try:
            result = execute(req)
        except HTTPException as exc:
            with storage.database(write=True) as conn:
                current_row(conn, widget_id, definition, row)
                conn.execute("""INSERT INTO runtime.live(id,error) VALUES (?,?)
                        ON CONFLICT(id) DO UPDATE SET error=excluded.error""", (widget_id, exc.detail))
                conn.changed("widgets", widget_id)
            raise
        with storage.database(write=True) as conn:
            current = current_row(conn, widget_id, definition, row)
            if result["writes"] or result["settings"] or result["samples"] or current["error"]:
                apply_result(conn, current, result)
        return {"ok": True}


def current_row(conn, widget_id, definition, previous):
    row = storage.load_widget(conn, widget_id)
    if (catalog.projects.get(row["project_id"]) is not definition or previous["config_version"] != row["config_version"]
            or previous["execution"] != row["execution"]):
        raise HTTPException(409, tr("Проект или настройки изменились во время выполнения",
                                    "The project or settings changed during execution"))
    return row


def effective_execution(row, definition):
    return {**definition.project.execution.model_dump(), **json.loads(row["execution"])}


def should_tick(row, definition):
    from .events import visible
    run = effective_execution(row, definition)
    return run["handler"] and (run["mode"] == "background" or
                               (run["mode"] == "visible" and visible(row["id"])))
