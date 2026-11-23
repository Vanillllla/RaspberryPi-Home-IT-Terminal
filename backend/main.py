import json
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .i18n import language, tr, validation_message
from .discovery import discover, initialize_plugins
from .events import router as events_router
from .layout import COLUMNS, DEFAULT_WIDTH, DEFAULT_HEIGHT, MAX_ROWS, Layout, row_count
from .template_packages import discover_packages, router as packages_router
from .templates import router as templates_router, templates
from .integrations import router as integrations_router
from .storage import check_expected, database, initialize, insert_desktop, instance, state_revision


@asynccontextmanager
async def lifespan(app):
    initialize()
    initialize_plugins(app)
    discover_packages()
    yield


app = FastAPI(title="Pi Terminal", lifespan=lifespan)
app.include_router(integrations_router)
app.include_router(templates_router)
app.include_router(packages_router)
app.include_router(events_router)
plugins = discover(app)


@app.middleware("http")
async def request_language(request: Request, call_next):
    preference = request.headers.get("accept-language", "").split(",")[0].split(";")[0].strip().lower()
    token = language.set("en" if preference.split("-")[0] == "en" else "ru")
    try:
        return await call_next(request)
    finally:
        language.reset(token)


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError):
    if request.url.path.startswith("/api/plugins/"):
        details = [{"loc": issue["loc"], "type": issue["type"], "msg": validation_message(issue)}
                   for issue in error.errors()]
    else:
        details = [{**issue, "msg": validation_message(issue)} for issue in error.errors()]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(details)})


class DesktopName(BaseModel):
    name: str
    expected: str | None = None


class DesktopSwap(BaseModel):
    first: int = Field(strict=True)
    second: int = Field(strict=True)


class ViewportLayout(BaseModel):
    rows: int | None = Field(default=None, strict=True, ge=1, le=MAX_ROWS)


class AddWidget(ViewportLayout):
    plugin_id: str


class MoveWidget(ViewportLayout):
    desktop_id: int | None = Field(default=None, strict=True, gt=0)
    slot: int = Field(strict=True, ge=0, lt=COLUMNS * MAX_ROWS)
    expected: dict[str, int] | None = None


class WidgetSize(ViewportLayout):
    width: int = Field(strict=True, gt=0)
    height: int = Field(strict=True, gt=0)


class ContentAlignment(BaseModel):
    horizontalAlign: Literal["left", "center", "right"]
    verticalAlign: Literal["top", "center", "bottom"]


Palette = Literal["white", "black", "green", "red", "purple", "yellow", "orange"]


class CardAppearance(BaseModel):
    customTitle: str | None = Field(default=None, max_length=100)
    titlePalette: Palette | None = None
    cardPalette: Palette | None = None
    hideTitle: bool | None = Field(default=None, strict=True)
    horizontalAlign: Literal["left", "center", "right"] | None = None
    verticalAlign: Literal["top", "center", "bottom"] | None = None


class ConfigurationExpected(BaseModel):
    width: int | None = None
    height: int | None = None
    appearance: dict = Field(default_factory=dict)
    settings: dict = Field(default_factory=dict)


class WidgetConfiguration(ViewportLayout):
    width: int | None = Field(default=None, strict=True, gt=0)
    height: int | None = Field(default=None, strict=True, gt=0)
    appearance: CardAppearance = Field(default_factory=CardAppearance)
    settings: dict | None = None
    expected: ConfigurationExpected | None = None
    removeSettings: list[str] = Field(default_factory=list)


class Settings(BaseModel):
    settings: dict
    expected: dict | None = None


def read_state(conn):
    widgets = [instance(row) for row in conn.execute("SELECT * FROM widgets ORDER BY id")]
    desktops = [dict(row) for row in conn.execute("SELECT id, name, default_name FROM desktops ORDER BY sort_order")]
    for desktop in desktops:
        desktop["default_name"] = bool(desktop["default_name"])
        desktop["rows"] = row_count(w for w in widgets if w["desktop_id"] == desktop["id"])
    return {
        "revision": state_revision(conn),
        "columns": COLUMNS,
        "max_rows": MAX_ROWS,
        "desktops": desktops,
        "widgets": widgets,
        "plugins": list(plugins.values()),
        "templates": templates(conn),
    }


@app.get("/api/state")
def state():
    with database() as conn:
        return read_state(conn)


@app.post("/api/desktops", status_code=201)
def create_desktop():
    with database(write=True) as conn:
        desktop = insert_desktop(conn)
        conn.changed("desktops", desktop["id"])
        return {**desktop, "rows": row_count(())}


@app.put("/api/desktops/{desktop_id}/name")
def rename_desktop(desktop_id: int, body: DesktopName):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, tr("Введите название рабочего стола", "Enter a desktop name"))
    with database(write=True) as conn:
        if body.expected is not None:
            row = conn.execute("SELECT name FROM desktops WHERE id=?", (desktop_id,)).fetchone()
            if row:
                check_expected(dict(row), {"name": body.expected})
        if not conn.execute("UPDATE desktops SET name=?, default_name=0 WHERE id=?", (name, desktop_id)).rowcount:
            raise HTTPException(404, tr("Рабочий стол отсутствует", "Desktop not found"))
        conn.changed("desktops", desktop_id)
        return {"id": desktop_id, "name": name, "default_name": False}


@app.post("/api/desktops/swap")
def swap_desktops(body: DesktopSwap):
    with database(write=True) as conn:
        rows = conn.execute("SELECT id, sort_order FROM desktops ORDER BY sort_order").fetchall()
        for first, second in zip(rows, rows[1:]):
            if first["id"] == body.first and second["id"] == body.second:
                conn.executemany("UPDATE desktops SET sort_order=? WHERE id=?", (
                    (second["sort_order"], body.first), (first["sort_order"], body.second),
                ))
                conn.changed("desktops")
                return read_state(conn)
        raise HTTPException(409, tr("Список столов изменился. Проверьте порядок и повторите перемещение.",
                                    "The desktop list changed. Check the order and try again."))


def prepare_widget_deletion(conn, widgets):
    for widget in widgets:
        cleanup = app.state.before_widget_delete.get(widget["plugin_id"])
        if cleanup:
            cleanup(conn, widget["id"])


@app.delete("/api/desktops/{desktop_id}")
def delete_desktop(desktop_id: int):
    with database(write=True) as conn:
        if not conn.execute("SELECT 1 FROM desktops WHERE id=?", (desktop_id,)).fetchone():
            raise HTTPException(404, tr("Рабочий стол отсутствует", "Desktop not found"))
        if not conn.execute("SELECT 1 FROM desktops WHERE id<>? LIMIT 1", (desktop_id,)).fetchone():
            raise HTTPException(409, tr("Последний рабочий стол удалить нельзя", "The last desktop cannot be deleted"))
        prepare_widget_deletion(conn, conn.execute("SELECT id, plugin_id FROM widgets WHERE desktop_id=?", (desktop_id,)))
        conn.execute("DELETE FROM widgets WHERE desktop_id=?", (desktop_id,))
        conn.execute("DELETE FROM desktops WHERE id=?", (desktop_id,))
        conn.changed("desktops", desktop_id)
        conn.changed("widgets")
        return read_state(conn)


@app.post("/api/desktops/{desktop_id}/widgets", status_code=201)
def create_widget(desktop_id: int, body: AddWidget):
    with database(write=True) as conn:
        template = conn.execute("SELECT definition FROM templates WHERE id=?", (body.plugin_id,)).fetchone()
        if body.plugin_id not in plugins and template is None:
            raise HTTPException(404, tr("Плагин или шаблон недоступен", "Plugin or template unavailable"))
        if not conn.execute("SELECT id FROM desktops WHERE id=?", (desktop_id,)).fetchone():
            raise HTTPException(404, tr("Рабочий стол отсутствует", "Desktop not found"))
        definition = json.loads(template["definition"]) if template else {}
        width = definition.get("defaultWidth", DEFAULT_WIDTH)
        height = definition.get("defaultHeight", DEFAULT_HEIGHT)
        layout = Layout(conn, desktop_id, rows=body.rows)
        slot = next((s for s in range(layout.rows * COLUMNS)
                     if not layout.conflict(s, width, height)), None)
        if slot is None:
            raise HTTPException(409, tr("Нет свободного места для виджета", "There is no room for the widget"))
        widget_id = conn.execute("UPDATE widget_sequence SET last_id=last_id+1 RETURNING last_id").fetchone()[0]
        row = conn.execute(
            "INSERT INTO widgets(id, desktop_id, plugin_id, slot, width, height) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
            (widget_id, desktop_id, body.plugin_id, slot, width, height),
        ).fetchone()
        conn.changed("widgets", widget_id)
        return instance(row)


def load_widget(conn, widget_id):
    w = conn.execute("SELECT * FROM widgets WHERE id=?", (widget_id,)).fetchone()
    if w is None:
        raise HTTPException(404, tr("Экземпляр отсутствует", "Widget instance not found"))
    return w


def update_layout(conn, widget_id, *, rows, slot=None, size=None, desktop_id=None, expected=None):
    w = load_widget(conn, widget_id)
    if expected is not None:
        check_expected(dict(w), expected)
    slot = w["slot"] if slot is None else slot
    width, height = (size.width, size.height) if size else (w["width"], w["height"])
    if desktop_id is None:
        desktop_id = w["desktop_id"]
    elif not conn.execute("SELECT 1 FROM desktops WHERE id=?", (desktop_id,)).fetchone():
        raise HTTPException(404, tr("Рабочий стол отсутствует", "Desktop not found"))
    reason = Layout(conn, desktop_id, rows=rows, exclude=widget_id).conflict(slot, width, height)
    if reason:
        raise HTTPException(409, reason)
    conn.execute("UPDATE widgets SET desktop_id=?, slot=?, width=?, height=? WHERE id=?",
                 (desktop_id, slot, width, height, widget_id))
    conn.changed("widgets", widget_id)
    return {"slot": slot, "width": width, "height": height}


@app.put("/api/widgets/{widget_id}/configuration")
def configure_widget(widget_id: int, body: WidgetConfiguration):
    with database(write=True) as conn:
        w = instance(load_widget(conn, widget_id))
        if body.expected is not None:
            check_expected(w, body.expected.model_dump(include={"width", "height"}, exclude_none=True))
            check_expected(w["appearance"], body.expected.appearance)
            check_expected(w["settings"], body.expected.settings)
        if body.width is not None or body.height is not None:
            size = WidgetSize(width=body.width or w["width"], height=body.height or w["height"])
            update_layout(conn, widget_id, rows=body.rows, size=size)
        appearance = body.appearance.model_dump(exclude_none=True)
        if body.appearance.customTitle is not None:
            appearance["customTitle"] = body.appearance.customTitle.strip() or None
        settings = body.settings
        if settings is not None and body.expected is not None:
            settings = {**w["settings"], **settings}
            for key in body.removeSettings:
                settings.pop(key, None)
        row = conn.execute(
            """UPDATE widgets SET appearance=json_patch(appearance, ?), settings=COALESCE(?, settings)
               WHERE id=? RETURNING *""",
            (json.dumps(appearance), json.dumps(settings) if settings is not None else None, widget_id),
        ).fetchone()
        if appearance or settings is not None:
            conn.changed("widgets", widget_id)
        return instance(row)


@app.put("/api/widgets/{widget_id}/position")
def move_widget(widget_id: int, body: MoveWidget):
    with database(write=True) as conn:
        return update_layout(conn, widget_id, rows=body.rows, slot=body.slot, desktop_id=body.desktop_id,
                             expected=body.expected)


@app.put("/api/widgets/{widget_id}/size")
def resize_widget(widget_id: int, body: WidgetSize):
    with database(write=True) as conn:
        return update_layout(conn, widget_id, rows=body.rows, size=body)


@app.put("/api/widgets/{widget_id}/alignment")
def align_content(widget_id: int, body: ContentAlignment):
    with database(write=True) as conn:
        updated = conn.execute(
            """UPDATE widgets SET appearance = json_set(appearance,
                '$.horizontalAlign', ?, '$.verticalAlign', ?) WHERE id = ?""",
            (body.horizontalAlign, body.verticalAlign, widget_id),
        )
        if not updated.rowcount:
            raise HTTPException(404, tr("Экземпляр отсутствует", "Widget instance not found"))
        conn.changed("widgets", widget_id)
    return body


@app.put("/api/widgets/{widget_id}/settings")
def save_settings(widget_id: int, body: Settings):
    with database(write=True) as conn:
        current = instance(load_widget(conn, widget_id))["settings"]
        check_expected(current, body.expected or {})
        settings = body.settings if body.expected is None else {**current, **body.settings}
        conn.execute("UPDATE widgets SET settings=? WHERE id=?", (json.dumps(settings), widget_id))
        conn.changed("widgets", widget_id)
    return {"settings": settings}


@app.delete("/api/widgets/{widget_id}")
def delete_widget(widget_id: int):
    with database(write=True) as conn:
        prepare_widget_deletion(conn, conn.execute("SELECT id, plugin_id FROM widgets WHERE id=?", (widget_id,)))
        if not conn.execute("DELETE FROM widgets WHERE id=?", (widget_id,)).rowcount:
            raise HTTPException(404, tr("Экземпляр отсутствует", "Widget instance not found"))
        conn.changed("widgets", widget_id)
    return {"id": widget_id}
