"""Stored card definitions, instance inputs and action dispatch."""
import json
import math
import re
from threading import Lock
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .actions import execute, get_field
from .layout import COLUMNS, MAX_ROWS, DEFAULT_WIDTH, DEFAULT_HEIGHT
from .storage import database

router = APIRouter(prefix="/api")
Id = Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")]
Color = Literal["green", "yellow", "red"]


class Element(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: Id
    kind: Literal["text", "button", "switch", "slider", "indicator"]
    label: str = Field(max_length=2000)
    span: int | None = Field(default=None, strict=True, ge=1, le=COLUMNS)
    command: str = Field(default="", max_length=100)
    checked: bool = False
    minimum: float = 0
    maximum: float = 100
    step: float = 1
    initial: float = 0
    color: Color = "green"


class Target(BaseModel):
    element: Id
    field: str = Field(default="", max_length=256)


class Action(BaseModel):
    id: Id
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["time", "reach", "http", "python"]
    trigger: Literal["command", "timer"]
    command: str = Field(default="", max_length=100)
    interval: int = Field(default=1, ge=1, le=86400)
    host: str = ""
    port: int | None = Field(default=None, ge=1, le=65535)
    url: str = ""
    path: str = ""
    code: str = Field(default="", max_length=32768)
    targets: list[Target] = Field(max_length=128)


class Definition(BaseModel):
    defaultWidth: int = Field(default=DEFAULT_WIDTH, strict=True, ge=1, le=COLUMNS)
    defaultHeight: int = Field(default=DEFAULT_HEIGHT, strict=True, ge=1, le=MAX_ROWS)
    description: str = Field(default="", max_length=2000)
    name: str = Field(min_length=1, max_length=100)
    rows: list[list[Element]] = Field(min_length=1, max_length=64)
    actions: list[Action] = Field(max_length=64)
    revision: int = 0

    def elements(self):
        return {e.id: e for row in self.rows for e in row}

    def validate_links(self):
        elements = self.elements()
        count = sum(map(len, self.rows))
        if not self.name.strip() or not count:
            raise ValueError("Введите название и добавьте хотя бы один элемент")
        if len(elements) != count or count > 128:
            raise ValueError("Нужны уникальные ID элементов (до 128 элементов)")
        if len({a.id for a in self.actions}) != len(self.actions):
            raise ValueError("ID действий должны быть уникальны")
        for e in elements.values():
            if e.kind == "slider" and not valid_slider(e, e.initial):
                raise ValueError(f"{e.label}: проверьте диапазон, шаг и начальное значение")
        commands = {e.command for e in elements.values() if e.kind in ("button", "switch", "slider")}
        bound = set()
        for a in self.actions:
            if a.trigger == "command" and not a.command.strip():
                raise ValueError(f"{a.name}: задайте команду запуска")
            if a.targets and a.trigger == "command" and a.command not in commands:
                raise ValueError(f"{a.name}: нет элемента, отправляющего команду {a.command}")
            if a.kind == "reach" and not re.fullmatch(r"[a-zA-Z0-9:][a-zA-Z0-9:.%-]{0,252}", a.host):
                raise ValueError(f"{a.name}: укажите имя хоста или IP")
            if a.kind == "http" and (urlsplit(a.url).scheme not in ("http", "https") or not urlsplit(a.url).hostname):
                raise ValueError(f"{a.name}: нужен URL HTTP или HTTPS")
            if a.kind == "python":
                try:
                    compile(a.code, "<widget>", "exec")
                except SyntaxError as exc:
                    raise ValueError(f"{a.name}: {exc.msg}, строка {exc.lineno}") from exc
            for t in a.targets:
                e = elements.get(t.element)
                if not e or e.kind not in ("text", "indicator"):
                    raise ValueError(f"{a.name}: получатель {t.element} удалён или недопустим")
                if e.id in bound:
                    raise ValueError(f"{e.label}: выберите одно действие обновления")
                bound.add(e.id)


def valid_slider(e, value):
    if type(value) not in (int, float) or not all(math.isfinite(v) for v in (value, e.minimum, e.maximum, e.step)):
        return False
    if not (e.minimum < e.maximum and e.minimum <= value <= e.maximum and e.step > 0):
        return False
    ticks = (value - e.minimum) / e.step
    return math.isfinite(ticks) and abs(ticks - round(ticks)) < 1e-7


def templates(conn):
    return [dict(id=row["id"], **json.loads(row["definition"])) for row in
            conn.execute("SELECT * FROM templates ORDER BY rowid")]


def save(body, template_id=None, creation_key=None):
    try:
        body.validate_links()
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    with database(write=True) as conn:
        if template_id is None:
            template_id = "template:" + (creation_key or uuid4()).hex
            body.revision = 1
            existing = conn.execute("SELECT definition FROM templates WHERE id=?", (template_id,)).fetchone()
            if existing is None:
                conn.execute("INSERT INTO templates VALUES (?, ?)", (template_id, body.model_dump_json()))
            elif Definition.model_validate_json(existing["definition"]) != body:
                raise HTTPException(409, "Шаблон уже сохранён. Откройте его для редактирования.")
        else:
            revision = body.revision
            body.revision += 1
            row = conn.execute("SELECT definition FROM templates WHERE id=?", (template_id,)).fetchone()
            previous = Definition.model_validate_json(row["definition"]) if row else None
            if previous is None or previous.revision != revision:
                if previous == body:
                    return {"id": template_id, **body.model_dump()}
                raise HTTPException(409, "Версия шаблона изменилась. Откройте его заново.")
            conn.execute("UPDATE templates SET definition=? WHERE id=?", (body.model_dump_json(), template_id))
            if previous.rows == body.rows and previous.actions == body.actions:
                return {"id": template_id, **body.model_dump()}
            # Revalidate saved controls against the edited ranges. Outputs belong to the old bindings.
            for widget in conn.execute("SELECT id,settings FROM widgets WHERE plugin_id=?", (template_id,)).fetchall():
                settings = json.loads(widget["settings"])
                settings["inputs"] = inputs(body, settings.get("inputs", {}))
                settings.pop("outputs", None)
                conn.execute("UPDATE widgets SET settings=? WHERE id=?", (json.dumps(settings), widget["id"]))
    return {"id": template_id, **body.model_dump()}


@router.get("/templates/version")
def catalog_version():
    with database() as conn:
        return conn.execute("SELECT COALESCE(SUM(json_extract(definition,'$.revision')), 0) FROM templates").fetchone()[0]


@router.post("/templates", status_code=201)
def create_template(body: Definition, creation_key: UUID | None = None):
    return save(body, creation_key=creation_key)


@router.put("/templates/{template_id}")
def edit_template(template_id: str, body: Definition):
    return save(body, template_id)


def inputs(definition, supplied):
    result = {}
    for e in definition.elements().values():
        value = supplied.get(e.id)
        if e.kind == "switch":
            result[e.id] = value if isinstance(value, bool) else e.checked
        elif e.kind == "slider":
            result[e.id] = value if valid_slider(e, value) else e.initial
    return result


class Invocation(BaseModel):
    revision: int
    outputs: dict[str, str] = Field(default_factory=dict, max_length=128)
    inputs: dict[str, bool | float] = Field(default_factory=dict, max_length=128)


def load_instance(conn, widget_id, revision):
    row = conn.execute("""SELECT w.settings, t.id, t.definition FROM widgets w
        JOIN templates t ON t.id=w.plugin_id WHERE w.id=?""", (widget_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Экземпляр шаблона отсутствует")
    definition = Definition.model_validate_json(row["definition"])
    if definition.revision != revision:
        raise HTTPException(409, "Версия шаблона изменилась. Обновите рабочий стол.")
    return row, definition


@router.put("/widgets/{widget_id}/inputs")
def save_inputs(widget_id: int, body: Invocation):
    with database(write=True) as conn:
        row, definition = load_instance(conn, widget_id, body.revision)
        saved = json.loads(row["settings"]).get("inputs", {})
        values = inputs(definition, {**saved, **body.inputs})
        if any(k not in values or values[k] != v for k, v in body.inputs.items()):
            raise HTTPException(422, "Недопустимое значение элемента")
        conn.execute("UPDATE widgets SET settings=json_set(settings,'$.inputs',json(?)) WHERE id=?",
                     (json.dumps(values), widget_id))
    return values


running = set()
running_lock = Lock()


@router.post("/widgets/{widget_id}/actions/{action_id}")
def run_action(widget_id: int, action_id: str, body: Invocation):
    with database() as conn:
        row, definition = load_instance(conn, widget_id, body.revision)
        action = next((a for a in definition.actions if a.id == action_id), None)
        if not action:
            raise HTTPException(404, "Действие отсутствует в шаблоне экземпляра")
        settings = json.loads(row["settings"])
        values = {e.id: (e.color if e.kind == "indicator" else e.label) for e in definition.elements().values()}
        values.update({k: v for k, v in body.outputs.items() if k in values})
        values.update(settings.get("outputs", {}))
        values.update(inputs(definition, {**settings.get("inputs", {}), **body.inputs}))
        context = {"values": values, "instance_id": widget_id, "template_id": row["id"], "action_id": action_id}
    key = (widget_id, action_id)
    if action.trigger == "timer":
        with running_lock:
            if key in running:
                return {"skipped": True}
            running.add(key)
    try:
        result, diagnostic = execute(action, context)
        outputs = {}
        elements = definition.elements()
        for t in action.targets:
            value = get_field(result, t.field)
            if elements[t.element].kind == "indicator":
                if value not in ("green", "yellow", "red"):
                    raise ValueError("Для индикатора требуется green, yellow или red")
            elif not isinstance(value, str):
                value = json.dumps(value, ensure_ascii=False, allow_nan=False)
            outputs[t.element] = value
        if action.trigger == "command":
            with database(write=True) as conn:
                row, _ = load_instance(conn, widget_id, body.revision)
                saved = json.loads(row["settings"]).get("outputs", {})
                conn.execute("UPDATE widgets SET settings=json_set(settings,'$.outputs',json(?)) WHERE id=?",
                             (json.dumps({**saved, **outputs}), widget_id))
        return {"outputs": outputs, "diagnostic": diagnostic}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        if action.trigger == "timer":
            with running_lock:
                running.discard(key)
