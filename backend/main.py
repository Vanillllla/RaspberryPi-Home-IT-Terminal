import json
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .discovery import discover
from .layout import COLUMNS, DEFAULT_WIDTH, DEFAULT_HEIGHT, MAX_ROWS, Layout, row_count
from .storage import database, initialize, instance


@asynccontextmanager
async def lifespan(app):
    initialize()
    yield


app = FastAPI(title="Pi Terminal", lifespan=lifespan)
plugins = discover(app)


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


class Settings(BaseModel):
    settings: dict


@app.get("/api/state")
def state():
    with database() as conn:
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
        }


@app.post("/api/desktops", status_code=201)
def create_desktop():
    with database(write=True) as conn:
        number = conn.execute("SELECT MAX(id) + 1 FROM desktops").fetchone()[0]
        name = f"Рабочий стол {number}"
        conn.execute("INSERT INTO desktops VALUES (?, ?)", (number, name))
        return {"id": number, "name": name, "rows": row_count(())}


@app.post("/api/desktops/{desktop_id}/widgets", status_code=201)
def create_widget(desktop_id: int, body: AddWidget):
    if body.plugin_id not in plugins:
        raise HTTPException(404, "Плагин недоступен")
    with database(write=True) as conn:
        if not conn.execute("SELECT id FROM desktops WHERE id=?", (desktop_id,)).fetchone():
            raise HTTPException(404, "Рабочий стол отсутствует")
        layout = Layout(conn, desktop_id, rows=body.rows)
        slot = next((s for s in range(layout.rows * COLUMNS)
                     if not layout.conflict(s, DEFAULT_WIDTH, DEFAULT_HEIGHT)), None)
        if slot is None:
            raise HTTPException(409, "Нет свободного места для виджета")
        widget_id = conn.execute("UPDATE widget_sequence SET last_id=last_id+1 RETURNING last_id").fetchone()[0]
        row = conn.execute(
            "INSERT INTO widgets(id, desktop_id, plugin_id, slot) VALUES (?, ?, ?, ?) RETURNING *",
            (widget_id, desktop_id, body.plugin_id, slot),
        ).fetchone()
        return instance(row)


def update_layout(widget_id, *, rows, slot=None, size=None):
    with database(write=True) as conn:
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


@app.put("/api/widgets/{widget_id}/position")
def move_widget(widget_id: int, body: MoveWidget):
    return update_layout(widget_id, rows=body.rows, slot=body.slot)


@app.put("/api/widgets/{widget_id}/size")
def resize_widget(widget_id: int, body: WidgetSize):
    return update_layout(widget_id, rows=body.rows, size=body)


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
