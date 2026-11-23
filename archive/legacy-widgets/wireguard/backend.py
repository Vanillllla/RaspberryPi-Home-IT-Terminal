import json
import re
import secrets
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend import storage
from backend.i18n import tr
from plugins.wireguard import tunnel

router = APIRouter()
HELPER = Path("/usr/local/libexec/raspberry-dashboard-wireguard")


def check_widget(conn, widget_id):
    if not conn.execute("SELECT 1 FROM widgets WHERE id=? AND plugin_id='wireguard'", (widget_id,)).fetchone():
        raise HTTPException(404, tr("Виджет отсутствует", "Widget not found"))


def open_profiles(conn):
    storage.attach_private_profiles(conn)
    conn.execute("""CREATE TABLE IF NOT EXISTS private_profiles.wireguard_profiles (
        id TEXT PRIMARY KEY, widget_id INTEGER NOT NULL,
        name TEXT NOT NULL, target TEXT NOT NULL, config TEXT NOT NULL)""")


def initialize_profiles():
    with storage.database(write=True) as conn:
        if not conn.execute("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name='wireguard_profiles'").fetchone():
            return
        open_profiles(conn)
        conn.execute("""INSERT INTO private_profiles.wireguard_profiles (id, widget_id, name, target, config)
            SELECT id, widget_id, name, target, config FROM main.wireguard_profiles ORDER BY rowid""")
        conn.execute("PRAGMA main.secure_delete = ON")
        conn.execute("DROP TABLE main.wireguard_profiles")


def selected(conn, widget_id, profile_id):
    check_widget(conn, widget_id)
    open_profiles(conn)
    row = conn.execute("SELECT * FROM private_profiles.wireguard_profiles WHERE widget_id=? AND id=?",
                       (widget_id, profile_id)).fetchone()
    if row is None:
        raise HTTPException(404, tr("Профиль отсутствует", "Profile not found"))
    return row


def require_type(request, content_type):
    if request.headers.get("content-type", "").split(";")[0] != content_type:
        raise HTTPException(415, tr("Неподдерживаемый формат", "Unsupported format"))


def add_profile(widget_id, name, body):
    try:
        config = body.decode("utf-8-sig")
        _, target, *_ = tunnel.read_config(config)
    except ValueError as exc:
        if str(exc) == "directive":
            raise HTTPException(422, tr("Конфигурация содержит неподдерживаемую директиву.",
                                        "The configuration contains an unsupported directive.")) from None
        if str(exc) == "subnet":
            raise HTTPException(422, tr("В AllowedIPs нужен маршрут к x.x.x.1 локальной IPv4-сети.",
                                        "AllowedIPs must include x.x.x.1 in the local IPv4 network.")) from None
        raise HTTPException(422, tr("Проверьте адрес, ключи и секции файла WireGuard.",
                                    "Check the address, keys and sections in the WireGuard file.")) from None
    with storage.database(write=True) as conn:
        check_widget(conn, widget_id)
        open_profiles(conn)
        profile_id = secrets.token_hex(5)
        conn.execute("INSERT INTO private_profiles.wireguard_profiles VALUES (?, ?, ?, ?, ?)",
                     (profile_id, widget_id, name, target, config))
        conn.changed("plugin", widget_id, plugin="wireguard")
    return {"id": profile_id}


@router.post("/{widget_id}/profiles", status_code=201)
async def upload(widget_id: int, name: str, request: Request):
    require_type(request, "application/x-wireguard")
    if not name.strip() or len(name) > 128:
        raise HTTPException(422, tr("Проверьте название профиля", "Check the profile name"))
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > tunnel.LIMIT:
            raise HTTPException(413, tr("Максимальный размер файла — 64 КиБ", "Maximum file size is 64 KiB"))
        body.extend(chunk)
    return await run_in_threadpool(add_profile, widget_id, name.strip(), body)


def status(row, probe=True):
    result = dict(row)
    result.update(connected=False, ping=None)
    try:
        result["connected"] = bool(tunnel.interface_state(row["id"]))
        if probe and result["connected"]:
            reply = subprocess.run(
                ["/usr/bin/ping", "-n", "-I", tunnel.device(row["id"]), "-c", "1", "-W", "1", row["target"]],
                env=tunnel.ENV, capture_output=True, text=True, timeout=2,
            )
            match = re.search(r"time[=<]([\d.]+) ms", reply.stdout)
            if reply.returncode == 0 and match:
                result["ping"] = float(match[1])
    except (OSError, subprocess.SubprocessError, ValueError):
        result["error"] = True
    return result


@router.get("/{widget_id}/profiles")
def list_profiles(widget_id: int, probe: bool = True):
    with storage.database(write=True) as conn:
        check_widget(conn, widget_id)
        open_profiles(conn)
        rows = conn.execute("SELECT id, name, target FROM private_profiles.wireguard_profiles WHERE widget_id=? ORDER BY rowid",
                            (widget_id,)).fetchall()
    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(lambda row: status(row, probe), rows))


class Schedule(BaseModel):
    automatic: bool = Field(default=True, strict=True)
    interval: int = Field(default=5, strict=True, ge=1, le=3600)


class ScheduleEdit(Schedule):
    expected: Schedule | None = None


def read_schedule(conn, widget_id):
    check_widget(conn, widget_id)
    settings = conn.execute("SELECT settings FROM widgets WHERE id=?", (widget_id,)).fetchone()[0]
    return Schedule.model_validate(json.loads(settings).get("wireguardSchedule", {}))


@router.get("/{widget_id}/schedule", response_model=Schedule)
def get_schedule(widget_id: int):
    with storage.database() as conn:
        return read_schedule(conn, widget_id)


@router.put("/{widget_id}/schedule", response_model=Schedule)
def save_schedule(widget_id: int, body: ScheduleEdit):
    with storage.database(write=True) as conn:
        current = read_schedule(conn, widget_id)
        if body.expected is not None:
            storage.check_expected(current.model_dump(), body.expected.model_dump())
        schedule = Schedule(automatic=body.automatic, interval=body.interval)
        conn.execute("UPDATE widgets SET settings=json_set(settings, '$.wireguardSchedule', json(?)) WHERE id=?",
                     (schedule.model_dump_json(), widget_id))
        conn.changed("widgets", widget_id)
        conn.changed("plugin", widget_id, plugin="wireguard")
    return schedule


def control(row, action):
    if not HELPER.is_file():
        raise HTTPException(503, tr("Установите помощник WireGuard по инструкции в README.",
                                    "Install the WireGuard helper as described in the README."))
    payload = {"action": action, "id": row["id"]}
    if action == "up":
        payload["config"] = row["config"]
    try:
        subprocess.run(["/usr/bin/sudo", "-n", str(HELPER)], input=json.dumps(payload, ensure_ascii=False), text=True,
                       capture_output=True, timeout=20, check=True)
    except (OSError, subprocess.SubprocessError) as exc:
        if isinstance(exc, subprocess.CalledProcessError) and exc.returncode == 3:
            raise HTTPException(409, tr("Эту сеть или интерфейс уже использует другое подключение.",
                                        "Another connection already uses this network or interface.")) from None
        raise HTTPException(409, tr("Не удалось изменить подключение. Проверьте права помощника, адрес узла и маршруты.",
                                    "Could not change the connection. Check helper permissions, endpoint and routes.")) from None


@router.put("/{widget_id}/profiles/{profile_id}/connection/{action}", status_code=204)
def connection(widget_id: int, profile_id: str, action: str):
    if action not in ("up", "down"):
        raise HTTPException(404)
    with storage.database(write=True) as conn:
        row = selected(conn, widget_id, profile_id)
        control(row, action)
        conn.changed("plugin", widget_id, plugin="wireguard")


def disconnect_if_present(row):
    try:
        state = tunnel.interface_state(row["id"])
    except tunnel.TunnelError:
        return  # An unrelated interface owns the name.
    if state is not None:
        control(row, "down")


@router.delete("/{widget_id}/profiles/{profile_id}", status_code=204)
def remove(widget_id: int, profile_id: str):
    with storage.database(write=True) as conn:
        row = selected(conn, widget_id, profile_id)
        disconnect_if_present(row)
        conn.execute("DELETE FROM private_profiles.wireguard_profiles WHERE id=?", (profile_id,))
        conn.changed("plugin", widget_id, plugin="wireguard")


def before_widget_delete(conn, widget_id):
    open_profiles(conn)
    for row in conn.execute("SELECT id FROM private_profiles.wireguard_profiles WHERE widget_id=?", (widget_id,)):
        disconnect_if_present(row)
    conn.execute("DELETE FROM private_profiles.wireguard_profiles WHERE widget_id=?", (widget_id,))
