"""Project editing, preview, and atomic placement updates."""
import mimetypes
import secrets
import time
from threading import Lock
from contextlib import ExitStack

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import Field

from . import catalog, runtime, storage
from .contracts import Model, Project
from .i18n import tr
from .layout import COLUMNS, row_count

router = APIRouter(prefix="/api")


def resize_instances(conn, project):
    rows = conn.execute("SELECT * FROM widgets WHERE project_id=? ORDER BY id", (project.id,)).fetchall()
    if all((w["width"], w["height"]) == (project.width, project.height) for w in rows):
        return
    for desktop_id in sorted({w["desktop_id"] for w in rows}):
        occupants = conn.execute("SELECT * FROM widgets WHERE desktop_id=? ORDER BY slot", (desktop_id,)).fetchall()
        height = row_count(occupants)
        occupied = [0] * height

        def reserve(slot, width, length):
            y, x = divmod(slot, COLUMNS)
            mask = ((1 << width) - 1) << x
            if x + width > COLUMNS or y + length > height or any(v & mask for v in occupied[y:y + length]):
                return False
            for line in range(y, y + length):
                occupied[line] |= mask
            return True

        for w in occupants:
            if w["project_id"] != project.id:
                reserve(w["slot"], w["width"], w["height"])
        displaced = []
        for w in occupants:
            if w["project_id"] == project.id and not reserve(w["slot"], project.width, project.height):
                displaced.append(w)
        for w in displaced:
            slot = next((s for s in range(height * COLUMNS) if reserve(s, project.width, project.height)), None)
            if slot is None:
                raise HTTPException(409, tr("Освободите место на рабочем столе", "Free space on desktop")
                                    + f" #{desktop_id} ({project.width}×{project.height})")
            conn.execute("UPDATE widgets SET slot=? WHERE id=?", (slot, w["id"]))
        conn.execute("UPDATE widgets SET width=?,height=? WHERE desktop_id=? AND project_id=?",
                     (project.width, project.height, desktop_id, project.id))
        conn.changed("widgets")


def validate(project):
    try:
        project.validate_contracts(catalog.elements)
    except (ValueError, RecursionError) as exc:
        raise HTTPException(422, str(exc)) from exc


class Save(Model):
    project: Project
    expected: str | None


@router.put("/projects/{project_id}")
def save_project(project_id: str, body: Save):
    project = body.project
    if project.id != project_id:
        raise HTTPException(422, tr("ID проекта должен совпадать с путём", "Project ID must match its path"))
    with storage.gate, ExitStack() as publication:
        validate(project)
        current = catalog.projects.get(project_id)
        if body.expected != (current.revision if current else None):
            raise HTTPException(409, tr("Проект изменился. Откройте актуальную версию.",
                                        "Project changed. Open the current version."))
        if not current and (catalog.WIDGETS / project_id / "manifest.json").exists():
            raise HTTPException(409, tr("Этот ID занят проектом на диске", "A project on disk owns this ID"))
        if current:
            try:
                disk = catalog.read_definition(catalog.WIDGETS / project_id)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                raise HTTPException(409, tr("Проверьте файлы проекта на диске", "Check the project files on disk")) from exc
            if disk.revision != current.revision:
                raise HTTPException(409, tr("Файлы изменены вручную. Перезапустите backend и откройте проект.",
                                            "Files changed on disk. Restart the backend and reopen the project."))
        project.dependencies.elements = sorted({n.type for n in project.nodes()} | set(project.dependencies.elements))
        definition = catalog.Definition(project)
        with storage.database(write=True) as conn:
            resize_instances(conn, project)
            publication.enter_context(catalog.publish(project))
            conn.changed("projects", project.id)
        catalog.projects[project_id] = definition
        return {"revision": definition.revision}


@router.get("/projects/{project_id}")
def open_project(project_id: str):
    with storage.gate:
        definition = runtime.require_project(project_id)
        return {"project": definition.project, "revision": definition.revision}


@router.get("/projects/{project_id}/assets/{name:path}")
def asset(project_id: str, name: str):
    runtime.require_project(project_id)
    try:
        folder = catalog.contained(catalog.WIDGETS / project_id, "assets")
        path = catalog.contained(folder, name)
    except ValueError:
        path = None
    if not path or not path.is_file() or path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico"}:
        raise HTTPException(404, tr("Ресурс недоступен", "Asset unavailable"))
    return FileResponse(path, media_type=mimetypes.guess_type(path)[0], headers={"X-Content-Type-Options": "nosniff"})


class PreviewState(Model):
    properties: dict[str, dict] = Field(default_factory=dict)
    settings: dict = Field(default_factory=dict)
    history: dict[str, list[list[float]]] = Field(default_factory=dict)


class Preview(Model):
    project: Project
    token: str | None = None
    event: runtime.Event | None = None
    tick: bool = False


class Session:
    def __init__(self, revision):
        self.revision = revision
        self.state = PreviewState()
        self.last_use = time.monotonic()
        self.lock = Lock()


_previews = {}
_preview_lock = Lock()


def preview_session(token, revision):
    now = time.monotonic()
    with _preview_lock:
        for key, session in list(_previews.items()):
            if now - session.last_use > 600:
                del _previews[key]
        if token is None:
            if len(_previews) >= 64:
                del _previews[min(_previews, key=lambda key: _previews[key].last_use)]
            token = secrets.token_urlsafe(24)
            _previews[token] = Session(revision)
        session = _previews.get(token)
        if not session or session.revision != revision:
            raise HTTPException(409, tr("Откройте предпросмотр заново", "Reopen the preview"))
        session.last_use = now
        return token, session


@router.post("/preview")
def preview(body: Preview):
    validate(body.project)
    if not body.event and not body.tick:
        return {"ok": True}
    definition = catalog.Definition(body.project)
    token, session = preview_session(body.token, definition.revision)
    with session.lock:
        state = session.state
        event = body.event or runtime.Event(name="tick")
        request = runtime.request_for(definition, event, state.properties, state.settings.copy(), periodic=body.tick)
        request["history"] = state.history
        result = runtime.execute(request)
        for node, prop, value, _ in result["writes"]:
            state.properties.setdefault(node, {})[prop] = value
        state.settings.update(result["settings"])
        for series, at, value in result["samples"]:
            points = state.history.setdefault(series, [])
            points.append([at, value])
            del points[:-runtime.HISTORY_LIMIT]
        return {"token": token, "properties": state.properties}


@router.post("/widgets/{widget_id}/events")
def widget_event(widget_id: int, body: runtime.Event):
    return runtime.dispatch(widget_id, body)
