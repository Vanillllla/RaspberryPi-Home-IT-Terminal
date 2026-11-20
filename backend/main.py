import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .discovery import discover
from .storage import database, initialize, instance


@asynccontextmanager
async def lifespan(app):
    initialize()
    yield


app = FastAPI(title="Pi Terminal", lifespan=lifespan)
plugins = discover(app)


class AddWidget(BaseModel):
    plugin_id: str


class MoveWidget(BaseModel):
    slot: int = Field(ge=0, le=4095)


class Settings(BaseModel):
    settings: dict


@app.get("/api/state")
def state():
    with database() as conn:
        return {
            "desktops": [dict(row) for row in conn.execute("SELECT * FROM desktops ORDER BY id")],
            "widgets": [instance(row) for row in conn.execute("SELECT * FROM widgets ORDER BY id")],
            "plugins": list(plugins.values()),
        }


@app.post("/api/desktops", status_code=201)
def create_desktop():
    with database(write=True) as conn:
        number = conn.execute("SELECT MAX(id) + 1 FROM desktops").fetchone()[0]
        name = f"Рабочий стол {number}"
        conn.execute("INSERT INTO desktops VALUES (?, ?)", (number, name))
        return {"id": number, "name": name}


@app.post("/api/desktops/{desktop_id}/widgets", status_code=201)
def create_widget(desktop_id: int, body: AddWidget):
    if body.plugin_id not in plugins:
        raise HTTPException(404, "Плагин недоступен")
    with database(write=True) as conn:
        if not conn.execute("SELECT id FROM desktops WHERE id=?", (desktop_id,)).fetchone():
            raise HTTPException(404, "Рабочий стол отсутствует")
        occupied = {row[0] for row in conn.execute("SELECT slot FROM widgets WHERE desktop_id=?", (desktop_id,))}
        slot = next(i for i in range(len(occupied) + 1) if i not in occupied)
        if slot > 4095:
            raise HTTPException(409, "Нет свободных ячеек")
        widget_id = conn.execute("UPDATE widget_sequence SET last_id=last_id+1 RETURNING last_id").fetchone()[0]
        row = conn.execute(
            "INSERT INTO widgets(id, desktop_id, plugin_id, slot) VALUES (?, ?, ?, ?) RETURNING *",
            (widget_id, desktop_id, body.plugin_id, slot),
        ).fetchone()
        return instance(row)


@app.put("/api/widgets/{widget_id}/position")
def move_widget(widget_id: int, body: MoveWidget):
    with database(write=True) as conn:
        widget = conn.execute("SELECT desktop_id FROM widgets WHERE id=?", (widget_id,)).fetchone()
        if widget is None:
            raise HTTPException(404, "Экземпляр отсутствует")
        if conn.execute("SELECT id FROM widgets WHERE desktop_id=? AND slot=? AND id<>?",
                        (widget[0], body.slot, widget_id)).fetchone():
            raise HTTPException(409, "Ячейка занята")
        conn.execute("UPDATE widgets SET slot=? WHERE id=?", (body.slot, widget_id))
    return {"slot": body.slot}


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
