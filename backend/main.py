import json
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .discovery import discover
from .layout import COLUMNS, DEFAULT_WIDTH, DEFAULT_HEIGHT, MAX_ROWS, Layout, row_count
from .template_packages import discover_packages, router as packages_router
from .templates import router as templates_router, templates
from .storage import database, initialize, insert_desktop, instance


@asynccontextmanager
async def lifespan(app):
    initialize()
    discover_packages()
    yield


app = FastAPI(title="Pi Terminal", lifespan=lifespan)
app.include_router(templates_router)
app.include_router(packages_router)
plugins = discover(app)


class DesktopName(BaseModel):
    name: str


class ViewportLayout(BaseModel):
    rows: int | None = Field(default=None, strict=True, ge=1, le=MAX_ROWS)


class AddWidget(ViewportLayout):
    plugin_id: str


class MoveWidget(ViewportLayout):
    slot: int = Field(strict=True, ge=0, lt=COLUMNS * MAX_ROWS)


class WidgetSize(ViewportLayout):
    width: int = Field(strict=True, gt=0)
    height: int = Field(strict=True, gt=0)


class ContentAlignment(BaseModel):
    horizontalAlign: Literal["left", "center", "right"]
    verticalAlign: Literal["top", "center", "bottom"]


Palette = Literal["white", "black", "green", "red", "purple", "yellow", "orange"]


class CardAppearance(BaseModel):
    titlePalette: Palette
    cardPalette: Palette
    horizontalAlign: Literal["left", "center", "right"] | None = None
    verticalAlign: Literal["top", "center", "bottom"] | None = None


class WidgetConfiguration(WidgetSize):
    appearance: CardAppearance
    settings: dict | None = None


class Settings(BaseModel):
    settings: dict


def read_state(conn):
    widgets = [instance(row) for row in conn.execute("SELECT * FROM widgets ORDER BY id")]
    desktops = [dict(row) for row in conn.execute("SELECT * FROM desktops ORDER BY id")]
    for desktop in desktops:
        desktop["rows"] = row_count(w for w in widgets if w["desktop_id"] == desktop["id"])
    return {
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
        return {**insert_desktop(conn), "rows": row_count(())}


@app.put("/api/desktops/{desktop_id}/name")
def rename_desktop(desktop_id: int, body: DesktopName):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Введите название рабочего стола")
    with database(write=True) as conn:
        if not conn.execute("UPDATE desktops SET name=? WHERE id=?", (name, desktop_id)).rowcount:
            raise HTTPException(404, "Рабочий стол отсутствует")
        return {"id": desktop_id, "name": name}


@app.delete("/api/desktops/{desktop_id}")
def delete_desktop(desktop_id: int):
    with database(write=True) as conn:
        if not conn.execute("SELECT 1 FROM desktops WHERE id=?", (desktop_id,)).fetchone():
            raise HTTPException(404, "Рабочий стол отсутствует")
        if not conn.execute("SELECT 1 FROM desktops WHERE id<>? LIMIT 1", (desktop_id,)).fetchone():
            raise HTTPException(409, "Последний рабочий стол удалить нельзя")
        conn.execute("DELETE FROM widgets WHERE desktop_id=?", (desktop_id,))
        conn.execute("DELETE FROM desktops WHERE id=?", (desktop_id,))
        return read_state(conn)


@app.post("/api/desktops/{desktop_id}/widgets", status_code=201)
def create_widget(desktop_id: int, body: AddWidget):
    with database(write=True) as conn:
        template = conn.execute("SELECT definition FROM templates WHERE id=?", (body.plugin_id,)).fetchone()
        if body.plugin_id not in plugins and template is None:
            raise HTTPException(404, "Плагин или шаблон недоступен")
        if not conn.execute("SELECT id FROM desktops WHERE id=?", (desktop_id,)).fetchone():
            raise HTTPException(404, "Рабочий стол отсутствует")
        definition = json.loads(template["definition"]) if template else {}
        width = definition.get("defaultWidth", DEFAULT_WIDTH)
        height = definition.get("defaultHeight", DEFAULT_HEIGHT)
        layout = Layout(conn, desktop_id, rows=body.rows)
        slot = next((s for s in range(layout.rows * COLUMNS)
                     if not layout.conflict(s, width, height)), None)
        if slot is None:
            raise HTTPException(409, "Нет свободного места для виджета")
        widget_id = conn.execute("UPDATE widget_sequence SET last_id=last_id+1 RETURNING last_id").fetchone()[0]
        row = conn.execute(
            "INSERT INTO widgets(id, desktop_id, plugin_id, slot, width, height) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
            (widget_id, desktop_id, body.plugin_id, slot, width, height),
        ).fetchone()
        return instance(row)


def update_layout(conn, widget_id, *, rows, slot=None, size=None):
    w = conn.execute("SELECT * FROM widgets WHERE id=?", (widget_id,)).fetchone()
    if w is None:
        raise HTTPException(404, "Экземпляр отсутствует")
    slot = w["slot"] if slot is None else slot
    width, height = (size.width, size.height) if size else (w["width"], w["height"])
    reason = Layout(conn, w["desktop_id"], rows=rows, exclude=widget_id).conflict(slot, width, height)
    if reason:
        raise HTTPException(409, reason)
    conn.execute("UPDATE widgets SET slot=?, width=?, height=? WHERE id=?", (slot, width, height, widget_id))
    return {"slot": slot, "width": width, "height": height}


@app.put("/api/widgets/{widget_id}/configuration")
def configure_widget(widget_id: int, body: WidgetConfiguration):
    with database(write=True) as conn:
        update_layout(conn, widget_id, rows=body.rows, size=body)
        appearance = body.appearance.model_dump(exclude_none=True)
        row = conn.execute(
            """UPDATE widgets SET appearance=json_patch(appearance, ?), settings=COALESCE(?, settings)
               WHERE id=? RETURNING *""",
            (json.dumps(appearance), json.dumps(body.settings) if body.settings is not None else None, widget_id),
        ).fetchone()
        return instance(row)


@app.put("/api/widgets/{widget_id}/position")
def move_widget(widget_id: int, body: MoveWidget):
    with database(write=True) as conn:
        return update_layout(conn, widget_id, rows=body.rows, slot=body.slot)


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
            raise HTTPException(404, "Экземпляр отсутствует")
    return body


@app.put("/api/widgets/{widget_id}/settings")
def save_settings(widget_id: int, body: Settings):
    with database(write=True) as conn:
        if not conn.execute("UPDATE widgets SET settings=? WHERE id=?",
                            (json.dumps(body.settings), widget_id)).rowcount:
            raise HTTPException(404, "Экземпляр отсутствует")
    return body


@app.delete("/api/widgets/{widget_id}")
def delete_widget(widget_id: int):
    with database(write=True) as conn:
        if not conn.execute("DELETE FROM widgets WHERE id=?", (widget_id,)).rowcount:
            raise HTTPException(404, "Экземпляр отсутствует")
    return {"id": widget_id}
