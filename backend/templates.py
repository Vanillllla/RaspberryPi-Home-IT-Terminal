"""Stored card definitions, instance inputs and action dispatch."""
import base64
import json
import math
import re
from datetime import date
from threading import Lock
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .i18n import tr
from .actions import execute, get_field
from .layout import COLUMNS, MAX_ROWS, DEFAULT_WIDTH, DEFAULT_HEIGHT
from .storage import database

router = APIRouter(prefix="/api")
Id = Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")]
Color = Literal["green", "yellow", "red"]


class Cell(BaseModel):
    x: int = Field(strict=True, ge=0, lt=COLUMNS)
    y: int = Field(strict=True, ge=0, lt=MAX_ROWS)


SUBDIVISIONS = 5


class Frame(BaseModel):
    x: int = Field(strict=True, ge=0)
    y: int = Field(strict=True, ge=0)
    width: int = Field(strict=True, gt=0)
    height: int = Field(strict=True, gt=0)

    def overlaps(self, other):
        return (self.x < other.x + other.width and other.x < self.x + self.width
                and self.y < other.y + other.height and other.y < self.y + self.height)


class Element(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: Id
    kind: Literal["text", "button", "switch", "slider", "indicator", "input", "shortcut"]
    label: str = Field(max_length=2000)
    href: str = Field(default="", max_length=4096)
    png: str = Field(default="", max_length=350000)
    siteIcon: bool = False
    defaultLabel: bool = False
    frame: Frame | None = None
    fontFamily: Literal["system", "serif", "monospace"] = "system"
    fontSize: int = Field(default=12, strict=True, ge=1, le=144)
    cell: Cell | None = None
    span: int | None = Field(default=None, strict=True, ge=1, le=COLUMNS)
    command: str = Field(default="", max_length=100)
    checked: bool = False
    minimum: float = 0
    maximum: float = 100
    step: float = 1
    initial: float = 0
    color: Color = "green"
    inputMode: Literal["text", "number", "ipv4", "date", "time"] = "text"
    placeholder: str = Field(default="", max_length=200)
    resetCommand: str = Field(default="", max_length=100)


class Target(BaseModel):
    element: Id
    field: str = Field(default="", max_length=256)


class Action(BaseModel):
    id: Id
    name: str = Field(min_length=1, max_length=100)
    defaultName: bool = False
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

    def runtime_elements(self):
        return {k: e.model_dump(exclude={"cell", "span", "frame", "fontSize", "fontFamily"}) for k, e in self.elements().items()}

    def validate_links(self):
        elements = self.elements()
        count = sum(map(len, self.rows))
        if not self.name.strip() or not count:
            raise ValueError(tr("Введите название и добавьте хотя бы один элемент", "Enter a name and add at least one element"))
        if len(elements) != count or count > 128:
            raise ValueError(tr("Нужны уникальные ID элементов (до 128 элементов)", "Element IDs must be unique (up to 128 elements)"))
        if len({a.id for a in self.actions}) != len(self.actions):
            raise ValueError(tr("ID действий должны быть уникальны", "Action IDs must be unique"))
        frames = [e.frame for e in elements.values() if e.frame is not None]
        if frames and (len(frames) != count or any(e.cell or e.span for e in elements.values())):
            raise ValueError(tr("Задайте frame для всех элементов без старых полей cell и span", "Set frame for every element and omit the legacy cell and span fields"))
        for index, frame in enumerate(frames):
            if (frame.x + frame.width > self.defaultWidth * SUBDIVISIONS
                    or frame.y + frame.height > self.defaultHeight * SUBDIVISIONS):
                raise ValueError(tr("Элемент выходит за границы мелкой сетки", "The element extends beyond the fine grid"))
            if any(frame.overlaps(other) for other in frames[:index]):
                raise ValueError(tr("Рамки элементов пересекаются", "Element frames overlap"))
        occupied = set()
        for e in elements.values():
            if e.kind == "shortcut":
                url = urlsplit(e.href)
                if url.scheme not in ("http", "https") or not url.hostname:
                    raise ValueError(tr("Введите адрес HTTP или HTTPS", "Enter an HTTP or HTTPS URL"))
                if not (e.label.strip() or e.png or e.siteIcon):
                    raise ValueError(tr("Добавьте подпись или иконку", "Add a label or an icon"))
                if e.png:
                    prefix, _, data = e.png.partition(",")
                    try:
                        valid = prefix == "data:image/png;base64" and base64.b64decode(data, validate=True).startswith(bytes.fromhex("89504e470d0a1a0a"))
                    except ValueError:
                        valid = False
                    if not valid:
                        raise ValueError(tr("Выберите PNG-картинку", "Choose a PNG image"))
            if e.cell is not None:
                end = e.cell.x + (e.span or 1)
                if end > self.defaultWidth or e.cell.y >= self.defaultHeight:
                    raise ValueError(tr(f"{e.label}: позиция выходит за границы шаблона", f"{e.label}: the position extends beyond the template"))
                footprint = {(x, e.cell.y) for x in range(e.cell.x, end)}
                if occupied & footprint:
                    raise ValueError(tr(f"{e.label}: ячейка шаблона занята", f"{e.label}: the template cell is occupied"))
                occupied.update(footprint)
            if e.kind == "slider" and not valid_slider(e, e.initial):
                raise ValueError(tr(f"{e.label}: проверьте диапазон, шаг и начальное значение", f"{e.label}: check the range, step, and initial value"))
        commands = {e.command for e in elements.values() if e.kind in ("button", "switch", "slider")}
        python_sender = any(a.kind == "python" for a in self.actions)
        bound = set()
        for a in self.actions:
            if a.trigger == "command" and not a.command.strip():
                raise ValueError(tr(f"{a.name}: задайте команду запуска", f"{a.name}: enter a trigger command"))
            if a.targets and a.trigger == "command" and a.command not in commands and not python_sender:
                raise ValueError(tr(f"{a.name}: нет элемента, отправляющего команду {a.command}", f"{a.name}: no element sends the command {a.command}"))
            if a.kind == "reach" and not re.fullmatch(r"[a-zA-Z0-9:][a-zA-Z0-9:.%-]{0,252}", a.host):
                raise ValueError(tr(f"{a.name}: укажите имя хоста или IP", f"{a.name}: enter a hostname or IP address"))
            if a.kind == "http" and (urlsplit(a.url).scheme not in ("http", "https") or not urlsplit(a.url).hostname):
                raise ValueError(tr(f"{a.name}: нужен URL HTTP или HTTPS", f"{a.name}: an HTTP or HTTPS URL is required"))
            if a.kind == "python":
                try:
                    compile(a.code, "<widget>", "exec")
                except SyntaxError as exc:
                    raise ValueError(tr(f"{a.name}: {exc.msg}, строка {exc.lineno}", f"{a.name}: {exc.msg}, line {exc.lineno}")) from exc
            for t in a.targets:
                e = elements.get(t.element)
                if not e or e.kind not in ("text", "indicator"):
                    raise ValueError(tr(f"{a.name}: получатель {t.element} удалён или недопустим", f"{a.name}: recipient {t.element} was deleted or is invalid"))
                if e.id in bound:
                    raise ValueError(tr(f"{e.label}: выберите одно действие обновления", f"{e.label}: select one update action"))
                bound.add(e.id)


def element_label(element):
    if not element.defaultLabel:
        return element.label
    russian, english = {
        "text": ("Текст", "Text"),
        "button": ("Кнопка", "Button"),
        "switch": ("Переключатель", "Switch"),
        "slider": ("Слайдер", "Slider"),
        "indicator": ("Индикатор состояния", "Status indicator"),
        "shortcut": ("Ярлык", "Shortcut"),
        "input": ("Поле ввода", "Input field"),
    }[element.kind]
    return tr(russian, english)


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
            if conn.execute("SELECT 1 FROM deleted_templates WHERE id=?", (template_id,)).fetchone():
                raise HTTPException(409, tr("Шаблон удалён. Создайте новый черновик.", "The template was deleted. Create a new draft."))
            body.revision = 1
            existing = conn.execute("SELECT definition FROM templates WHERE id=?", (template_id,)).fetchone()
            if existing is None:
                conn.execute("INSERT INTO templates VALUES (?, ?)", (template_id, body.model_dump_json()))
            elif Definition.model_validate_json(existing["definition"]) != body:
                raise HTTPException(409, tr("Шаблон уже сохранён. Откройте его для редактирования.", "The template has already been saved. Open it to edit it."))
        else:
            revision = body.revision
            body.revision += 1
            row = conn.execute("SELECT definition FROM templates WHERE id=?", (template_id,)).fetchone()
            previous = Definition.model_validate_json(row["definition"]) if row else None
            if previous is None or previous.revision != revision:
                if previous == body:
                    return {"id": template_id, **body.model_dump()}
                raise HTTPException(409, tr("Версия шаблона изменилась. Откройте его заново.", "The template version has changed. Reopen it."))
            conn.execute("UPDATE templates SET definition=? WHERE id=?", (body.model_dump_json(), template_id))
            if previous.actions == body.actions and previous.runtime_elements() == body.runtime_elements():
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
        return [
            f"{row['id']}:{row['revision']}"
            for row in conn.execute("SELECT id, json_extract(definition,'$.revision') AS revision FROM templates ORDER BY id")
        ]


@router.post("/templates", status_code=201)
def create_template(body: Definition, creation_key: UUID | None = None):
    return save(body, creation_key=creation_key)


@router.put("/templates/{template_id}")
def edit_template(template_id: str, body: Definition):
    return save(body, template_id)


@router.delete("/templates/{template_id}")
def delete_template(template_id: str, revision: int | None = None):
    with database(write=True) as conn:
        row = conn.execute(
            "SELECT json_extract(definition,'$.revision') AS revision FROM templates WHERE id=?", (template_id,)
        ).fetchone()
        if row is None:
            if conn.execute("SELECT 1 FROM deleted_templates WHERE id=?", (template_id,)).fetchone():
                return {"id": template_id}
            raise HTTPException(404, tr("Шаблон отсутствует", "Template not found"))
        if revision is not None and row["revision"] != revision:
            raise HTTPException(409, tr("Версия шаблона изменилась. Откройте его заново.", "The template version has changed. Reopen it."))
        conn.execute("DELETE FROM templates WHERE id=?", (template_id,))
        conn.execute("INSERT INTO deleted_templates VALUES (?, ?)", (template_id, row["revision"]))
    return {"id": template_id}


def inputs(definition, supplied):
    result = {}
    for e in definition.elements().values():
        value = supplied.get(e.id)
        if e.kind == "switch":
            result[e.id] = value if isinstance(value, bool) else e.checked
        elif e.kind == "slider":
            result[e.id] = value if valid_slider(e, value) else e.initial
        elif e.kind == "input":
            result[e.id] = value if valid_input(e, value) else ""
    return result


def valid_input(element, value):
    if not isinstance(value, str) or len(value) > 2000 or "\n" in value or "\r" in value:
        return False
    if element.inputMode == "text":
        return True
    if element.inputMode == "number":
        return re.fullmatch(r"[0-9]*\.?[0-9]*", value) is not None
    if element.inputMode == "date":
        if not value:
            return True
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            return False
        try:
            date.fromisoformat(value)
        except ValueError:
            return False
        return True
    if element.inputMode == "time":
        return not value or re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", value) is not None
    # Accept partial octets while editing. A completed address has four nonempty octets.
    octets = value.split(".")
    return len(octets) <= 4 and all(not octet or (
        re.fullmatch(r"[0-9]{1,3}", octet) and int(octet) <= 255
    ) for octet in octets)


class Invocation(BaseModel):
    revision: int
    outputs: dict[str, str] = Field(default_factory=dict, max_length=128)
    inputs: dict[str, bool | float | str] = Field(default_factory=dict, max_length=128)


def load_instance(conn, widget_id, revision):
    row = conn.execute("""SELECT w.settings, t.id, t.definition FROM widgets w
        JOIN templates t ON t.id=w.plugin_id WHERE w.id=?""", (widget_id,)).fetchone()
    if row is None:
        raise HTTPException(404, tr("Экземпляр шаблона отсутствует", "Template instance not found"))
    definition = Definition.model_validate_json(row["definition"])
    if definition.revision != revision:
        raise HTTPException(409, tr("Версия шаблона изменилась. Обновите рабочий стол.", "The template version has changed. Refresh the desktop."))
    return row, definition


@router.put("/widgets/{widget_id}/inputs")
def save_inputs(widget_id: int, body: Invocation):
    with database(write=True) as conn:
        row, definition = load_instance(conn, widget_id, body.revision)
        saved = json.loads(row["settings"]).get("inputs", {})
        values = inputs(definition, {**saved, **body.inputs})
        if any(k not in values or values[k] != v for k, v in body.inputs.items()):
            raise HTTPException(422, tr("Недопустимое значение элемента", "Invalid element value"))
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
            raise HTTPException(404, tr("Действие отсутствует в шаблоне экземпляра", "Action not found in this instance's template"))
        settings = json.loads(row["settings"])
        values = {e.id: (e.color if e.kind == "indicator" else element_label(e)) for e in definition.elements().values()}
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
        result, diagnostic, commands = execute(action, context)
        outputs = {}
        elements = definition.elements()
        for t in action.targets:
            value = get_field(result, t.field)
            if elements[t.element].kind == "indicator":
                if value not in ("green", "yellow", "red"):
                    raise ValueError(tr("Для индикатора требуется green, yellow или red", "The indicator requires green, yellow, or red"))
            elif not isinstance(value, str):
                value = json.dumps(value, ensure_ascii=False, allow_nan=False)
            outputs[t.element] = value
        if action.trigger == "command":
            with database(write=True) as conn:
                row, _ = load_instance(conn, widget_id, body.revision)
                saved = json.loads(row["settings"]).get("outputs", {})
                conn.execute("UPDATE widgets SET settings=json_set(settings,'$.outputs',json(?)) WHERE id=?",
                             (json.dumps({**saved, **outputs}), widget_id))
        return {"outputs": outputs, "diagnostic": diagnostic, "commands": commands}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        if action.trigger == "timer":
            with running_lock:
                running.discard(key)
