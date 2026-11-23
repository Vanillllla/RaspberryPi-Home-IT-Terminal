import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .i18n import language, tr, validation_message
from . import catalog, runtime, scheduler, storage
from .contracts import Appearance, Mode, Model
from .events import router as events_router
from .layout import COLUMNS, MAX_ROWS, Layout, row_count
from .projects import resize_instances, router as project_router
from .runtime import require_project
from .storage import check_expected, database, initialize, insert_desktop, instance, load_widget, state_revision
from .values import checked


@asynccontextmanager
async def lifespan(app):
    initialize()
    catalog.discover()
    # Recover materialized footprints after an offline edit or an interrupted publication.
    for key, definition in list(catalog.projects.items()):
        try:
            with database(write=True) as conn:
                resize_instances(conn, definition.project)
        except HTTPException as exc:
            catalog.diagnostics[f"widgets/{key}"] = exc.detail
            del catalog.projects[key]
    stop = asyncio.Event()
    task = asyncio.create_task(scheduler.run(stop))
    try:
        yield
    finally:
        stop.set()
        await task
        storage.shutdown()


app = FastAPI(title="Pi Terminal", lifespan=lifespan)
app.include_router(project_router)
app.include_router(events_router)


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
    details = [{"loc": issue["loc"], "type": issue["type"], "msg": validation_message(issue)}
               for issue in error.errors()]
    return JSONResponse(status_code=422, content={"detail": details})


class DesktopName(BaseModel):
    name: str
    expected: str | None = None


class DesktopSwap(BaseModel):
    first: int = Field(strict=True)
    second: int = Field(strict=True)


class ViewportLayout(BaseModel):
    rows: int | None = Field(default=None, strict=True, ge=1, le=MAX_ROWS)


class AddWidget(ViewportLayout):
    project_id: str


class MoveWidget(ViewportLayout):
    desktop_id: int | None = Field(default=None, strict=True, gt=0)
    slot: int = Field(strict=True, ge=0, lt=COLUMNS * MAX_ROWS)
    expected: dict[str, int] | None = None


class Overrides(Model):
    mode: Mode | None = None
    interval: int | None = Field(default=None, ge=1, le=86400)


class Configuration(Model):
    appearance: Appearance = Field(default_factory=Appearance)
    execution: Overrides = Field(default_factory=Overrides)
    settings: dict = Field(default_factory=dict)
    expected: int | None = None


def read_state(conn):
    widgets = [instance(row, catalog.projects.get(row["project_id"])) for row in conn.execute(
        """SELECT w.*, l.properties AS temporary, COALESCE(l.error,'') AS error
           FROM widgets w LEFT JOIN runtime.live l USING(id) ORDER BY w.id""")]
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
        "projects": [p.public for p in catalog.projects.values()],
        "elements": list(catalog.elements.values()),
        "operations": {k: op["inputs"] for k, op in catalog.operations.items()},
        "diagnostics": catalog.diagnostics,
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


@app.delete("/api/desktops/{desktop_id}")
def delete_desktop(desktop_id: int):
    with database(write=True) as conn:
        if not conn.execute("SELECT 1 FROM desktops WHERE id=?", (desktop_id,)).fetchone():
            raise HTTPException(404, tr("Рабочий стол отсутствует", "Desktop not found"))
        if not conn.execute("SELECT 1 FROM desktops WHERE id<>? LIMIT 1", (desktop_id,)).fetchone():
            raise HTTPException(409, tr("Последний рабочий стол удалить нельзя", "The last desktop cannot be deleted"))
        conn.execute("DELETE FROM runtime.live WHERE id IN (SELECT id FROM widgets WHERE desktop_id=?)", (desktop_id,))
        conn.execute("DELETE FROM widgets WHERE desktop_id=?", (desktop_id,))
        conn.execute("DELETE FROM desktops WHERE id=?", (desktop_id,))
        conn.changed("desktops", desktop_id)
        conn.changed("widgets")
        return read_state(conn)


@app.post("/api/desktops/{desktop_id}/widgets", status_code=201)
def create_widget(desktop_id: int, body: AddWidget):
    with database(write=True) as conn:
        project = require_project(body.project_id).project
        if not conn.execute("SELECT id FROM desktops WHERE id=?", (desktop_id,)).fetchone():
            raise HTTPException(404, tr("Рабочий стол отсутствует", "Desktop not found"))
        width, height = project.width, project.height
        layout = Layout(conn, desktop_id, rows=body.rows)
        slot = next((s for s in range(layout.rows * COLUMNS)
                     if not layout.conflict(s, width, height)), None)
        if slot is None:
            raise HTTPException(409, tr("Нет свободного места для виджета", "There is no room for the widget"))
        widget_id = conn.execute(
            "INSERT INTO widgets(desktop_id,project_id,slot,width,height) VALUES (?,?,?,?,?) RETURNING id",
            (desktop_id, project.id, slot, width, height),
        ).fetchone()[0]
        conn.changed("widgets", widget_id)
        return instance(load_widget(conn, widget_id), catalog.projects[project.id])


def update_layout(conn, widget_id, *, rows, slot, desktop_id=None, expected=None):
    w = load_widget(conn, widget_id)
    if expected is not None:
        check_expected(dict(w), expected)
    width, height = w["width"], w["height"]
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


def configuration_values(row, definition, body):
    if body.expected is not None:
        check_expected(dict(row), {"config_version": body.expected})
    settings = storage.setting_values(row, definition) if definition else {}
    for key, value in body.settings.items():
        spec = definition and definition.project.settings.get(key)
        if spec is None:
            raise HTTPException(422, tr("Неизвестная настройка", "Unknown setting") + ": " + key)
        if value is None:
            settings.pop(key, None)
        else:
            try:
                settings[key] = checked(spec.model_dump(), value)
            except ValueError as exc:
                raise HTTPException(422, tr("Проверьте настройку", "Check setting") + f" {key}: {exc}") from exc
    execution = json.loads(row["execution"])
    for key, value in body.execution.model_dump(exclude_unset=True).items():
        if value is None:
            execution.pop(key, None)
        else:
            execution[key] = value
    if execution.get("mode") in ("visible", "background") and not (definition and definition.project.execution.handler):
        raise HTTPException(422, tr("Назначьте периодический обработчик", "Assign a periodic handler"))
    return settings, execution


@app.put("/api/widgets/{widget_id}/configuration")
def configure_widget(widget_id: int, body: Configuration):
    with runtime.instance_lock(widget_id):
        with database() as conn:
            row = load_widget(conn, widget_id)
            definition = catalog.projects.get(row["project_id"])
            settings, execution = configuration_values(row, definition, body)
            request = None
            if body.settings and definition and "settingsChanged" in definition.project.events:
                properties, _ = runtime.row_state(row, definition)
                request = runtime.request_for(definition, runtime.Event(name="settingsChanged"), properties, settings)
                request.update(instance_id=widget_id, db=str(storage.DB_PATH.resolve()))
        result = runtime.execute(request) if request else None
        with database(write=True) as conn:
            runtime.current_row(conn, widget_id, definition, row)
            plain, private = storage.split_settings(settings, definition) if definition else (row["settings"], row["secrets"])
            conn.execute("""UPDATE widgets SET appearance=json_patch(appearance,?), execution=?,settings=?,secrets=?,
                            config_version=config_version+1 WHERE id=?""",
                         (body.appearance.model_dump_json(exclude_unset=True), json.dumps(execution),
                          plain, private, widget_id))
            if result:
                runtime.apply_result(conn, load_widget(conn, widget_id), result)
            conn.changed("widgets", widget_id)
            return instance(load_widget(conn, widget_id), definition)


@app.put("/api/widgets/{widget_id}/position")
def move_widget(widget_id: int, body: MoveWidget):
    with database(write=True) as conn:
        return update_layout(conn, widget_id, rows=body.rows, slot=body.slot, desktop_id=body.desktop_id,
                             expected=body.expected)


@app.delete("/api/widgets/{widget_id}")
def delete_widget(widget_id: int):
    with database(write=True) as conn:
        conn.execute("DELETE FROM runtime.live WHERE id=?", (widget_id,))
        if not conn.execute("DELETE FROM widgets WHERE id=?", (widget_id,)).rowcount:
            raise HTTPException(404, tr("Экземпляр отсутствует", "Widget instance not found"))
        conn.changed("widgets", widget_id)
    return {"id": widget_id}
