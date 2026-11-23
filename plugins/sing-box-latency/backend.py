import json
import math
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.i18n import tr
from backend.storage import attach_private_profiles, check_expected, database, private_directory

router = APIRouter()
workers = ThreadPoolExecutor(max_workers=4)
PROBE_URL = os.environ.get("SING_BOX_PROBE_URL", "https://cp.cloudflare.com/generate_204")


def measure(port: int) -> int | None:
    try:
        result = subprocess.run(
            ["curl", "--disable", "--silent", "--noproxy", "", "--socks5-hostname",
             f"127.0.0.1:{port}", "--max-time", "4", "--output", "/dev/null",
             "--proto", "=http,https", "--write-out", "%{http_code} %{time_starttransfer}", "--", PROBE_URL],
            env={"PATH": "/usr/bin:/bin"}, capture_output=True, text=True, timeout=5, check=True,
        )
        status, duration = result.stdout.split()
        seconds = float(duration)
        if status == "204" and math.isfinite(seconds) and seconds >= 0:
            return round(seconds * 1000)
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    return None



def open_profiles(conn):
    attach_private_profiles(conn)
    conn.execute("""CREATE TABLE IF NOT EXISTS private_profiles.sing_box_profiles (
        widget_id INTEGER PRIMARY KEY,
        profiles TEXT NOT NULL
    )""")


def legacy_profiles(legacy):
    if not isinstance(legacy, list):
        return []
    return [{"id": f"legacy-{i}", "name": p["name"], "kind": "port", "port": p["port"]}
            for i, p in enumerate(legacy[:8]) if isinstance(p, dict)
            and isinstance(p.get("name"), str) and type(p.get("port")) is int and 1 <= p["port"] <= 65535]


def initialize_profiles():
    with database(write=True) as conn:
        table = conn.execute("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name='sing_box_profiles'").fetchone()
        legacy = conn.execute("""SELECT id, settings FROM widgets WHERE plugin_id='sing-box-latency'
            AND json_type(settings, '$.profiles') IS NOT NULL""").fetchall()
        if not table and not legacy:
            return
        open_profiles(conn)
        conn.execute("PRAGMA main.secure_delete = ON")
        if table:
            conn.execute("""INSERT INTO private_profiles.sing_box_profiles (widget_id, profiles)
                SELECT widget_id, profiles FROM main.sing_box_profiles""")
            conn.execute("DROP TABLE main.sing_box_profiles")
        for row in legacy:
            profiles = legacy_profiles(json.loads(row["settings"]).get("profiles"))
            conn.execute("INSERT OR IGNORE INTO private_profiles.sing_box_profiles VALUES (?, ?)",
                         (row["id"], json.dumps(profiles)))
            conn.execute("UPDATE widgets SET settings=json_remove(settings, '$.profiles') WHERE id=?", (row["id"],))


def load_profiles(conn, widget_id):
    if not conn.execute("SELECT 1 FROM widgets WHERE id=? AND plugin_id='sing-box-latency'", (widget_id,)).fetchone():
        raise HTTPException(404, tr("Виджет отсутствует", "Widget not found"))
    open_profiles(conn)
    row = conn.execute("SELECT profiles FROM private_profiles.sing_box_profiles WHERE widget_id=?", (widget_id,)).fetchone()
    return json.loads(row[0]) if row else []


def before_widget_delete(conn, widget_id):
    open_profiles(conn)
    conn.execute("DELETE FROM private_profiles.sing_box_profiles WHERE widget_id=?", (widget_id,))


def public_profiles(profiles):
    return [{key: p[key] for key in ("id", "name", "kind")} for p in profiles]


class ProfileEdit(BaseModel):
    id: str = Field(default="", max_length=40)
    name: str = Field(min_length=1, max_length=100)
    config: str | None = Field(default=None, max_length=256_000)
    link: str | None = Field(default=None, max_length=4096)


def from_link(link):
    try:
        url = urlsplit(link.strip())
    except ValueError:
        raise ValueError(tr("Некорректный адрес сервера", "Invalid server address")) from None
    params = parse_qs(url.query, keep_blank_values=True)
    if url.scheme not in ("hysteria2", "hy2") or not url.hostname or url.path not in ("", "/"):
        raise ValueError(tr("Ожидается ссылка hysteria2:// или hy2:// с адресом сервера",
                            "Expected a hysteria2:// or hy2:// link with a server address"))
    if params.keys() - {"obfs", "obfs-password", "sni", "insecure", "alpn"}:
        raise ValueError(tr("Ссылка содержит неподдерживаемые параметры. Импортируйте JSON sing-box",
                            "The link contains unsupported parameters. Import a sing-box JSON configuration"))
    if any(len(v) != 1 for v in params.values()):
        raise ValueError(tr("В ссылке повторяется один из параметров", "The link repeats a parameter"))
    auth, separator, address = url.netloc.rpartition("@")
    password = unquote(auth)
    if not separator or not password:
        raise ValueError(tr("В ссылке отсутствует пароль", "The link is missing credentials"))
    insecure = params.get("insecure", ["0"])[0].lower()
    if insecure not in ("0", "1", "true", "false"):
        raise ValueError(tr("Параметр insecure должен быть 0, 1, true или false",
                            "The insecure parameter must be 0, 1, true or false"))
    tls = {"enabled": True, "server_name": params.get("sni", [url.hostname])[0] or url.hostname,
           "insecure": insecure in ("1", "true")}
    if "alpn" in params:
        protocols = params["alpn"][0].split(",")
        if not all(protocol and len(protocol) <= 255 for protocol in protocols):
            raise ValueError(tr("Проверьте список ALPN", "Check the ALPN list"))
        tls["alpn"] = protocols
    outbound = {"type": "hysteria2", "tag": "proxy", "server": url.hostname, "password": password, "tls": tls}
    authority = address.split("]", 1)[-1] if address.startswith("[") else address
    raw_ports = authority.partition(":")[2] if ":" in authority else "443"
    ranges = []
    for port in raw_ports.split(","):
        match = re.fullmatch(r"([0-9]{1,5})(?:-([0-9]{1,5}))?", port)
        if not match or not 1 <= int(match[1]) <= int(match[2] or match[1]) <= 65535:
            raise ValueError(tr("Проверьте порт или диапазоны портов в ссылке",
                                "Check the port or port ranges in the link"))
        ranges.append(f"{int(match[1])}:{int(match[2] or match[1])}")
    if len(ranges) == 1 and "-" not in raw_ports:
        outbound["server_port"] = int(raw_ports)
    else:
        outbound["server_ports"] = ranges
    if "obfs" in params or "obfs-password" in params:
        if params.get("obfs", [""])[0] not in ("salamander", "gecko") or not params.get("obfs-password", [""])[0]:
            raise ValueError(tr("Проверьте тип и пароль обфускации", "Check the obfuscation type and password"))
        outbound["obfs"] = {"type": params["obfs"][0], "password": params["obfs-password"][0]}
    return {"outbounds": [outbound], "route": {"final": "proxy"}}


def from_json(content):
    raw = json.loads(content)
    if not isinstance(raw, dict) or not isinstance(raw.get("outbounds"), list) or not raw["outbounds"]:
        raise ValueError()
    config = {key: raw[key] for key in ("outbounds", "dns", "route") if key in raw}
    route = config.setdefault("route", {})
    if not isinstance(route, dict):
        raise ValueError()
    return config


def probe_config(config, port):
    result = {**config, "inbounds": [
        {"type": "mixed", "tag": "panel-probe", "listen": "127.0.0.1", "listen_port": port},
    ], "log": {"disabled": True}}
    result.setdefault("dns", {"servers": [{"type": "local", "tag": "panel-dns"}]})
    route = result.setdefault("route", {})
    if "dns" not in config and "default_domain_resolver" not in route:
        result["route"] = {**route, "default_domain_resolver": "panel-dns"}
    return result


def config_command(command, path):
    binary = os.environ.get("SING_BOX_BIN") or shutil.which("sing-box") or str(Path.home() / ".local/bin/sing-box")
    return [binary, command, "-c", str(path)]


def check_config(config):
    try:
        with tempfile.TemporaryDirectory(dir=private_directory(), prefix="sing-box-") as folder:
            path = Path(folder) / "config.json"
            path.write_text(json.dumps(probe_config(config, 1080)))
            subprocess.run(config_command("check", path), cwd=folder, stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=6, check=True)
    except FileNotFoundError as exc:
        raise HTTPException(503, tr("Установите sing-box на сервере", "Install sing-box on the server")) from exc
    except (OSError, subprocess.SubprocessError) as exc:
        raise HTTPException(422, tr("sing-box отклонил конфиг", "sing-box rejected the configuration")) from exc


def probe_profile(profile):
    if profile["kind"] == "port":
        return measure(profile["port"])
    with tempfile.TemporaryDirectory(dir=private_directory(), prefix="sing-box-") as folder:
        with socket.socket() as reserve:
            reserve.bind(("127.0.0.1", 0))
            port = reserve.getsockname()[1]
        path = Path(folder) / "config.json"
        path.write_text(json.dumps(probe_config(profile["config"], port)))
        try:
            process = subprocess.Popen(config_command("run", path), cwd=folder, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            return None
        try:
            deadline = time.monotonic() + 2
            while process.poll() is None and time.monotonic() < deadline:
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=.1):
                        return measure(port) if process.poll() is None else None
                except OSError:
                    time.sleep(.05)
            return None
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


class Schedule(BaseModel):
    automatic: bool = Field(default=True, strict=True)
    interval: int = Field(default=30, strict=True, ge=1, le=3600)


class ProfileSettings(BaseModel):
    profiles: list[ProfileEdit]
    schedule: Schedule
    revision: int | None = Field(default=None, ge=0)


def load_schedule(conn, widget_id):
    row = conn.execute("SELECT settings FROM widgets WHERE id=?", (widget_id,)).fetchone()
    value = json.loads(row[0]).get("singBoxSchedule")
    return Schedule.model_validate(value) if value is not None else Schedule()


def profile_revision(conn, widget_id):
    return conn.execute("SELECT COALESCE(json_extract(settings, '$.singBoxProfilesRevision'), 0) FROM widgets WHERE id=?",
                        (widget_id,)).fetchone()[0]


@router.get("/{widget_id}/profiles")
def profiles(widget_id: int):
    with database(write=True) as conn:
        return {"profiles": public_profiles(load_profiles(conn, widget_id)), "schedule": load_schedule(conn, widget_id),
                "revision": profile_revision(conn, widget_id)}


@router.put("/{widget_id}/profiles")
def save_profiles(widget_id: int, body: ProfileSettings):
    edits = body.profiles
    if len(edits) > 8:
        raise HTTPException(422, tr("Можно сохранить до восьми профилей", "Up to eight profiles can be saved"))
    prepared = []
    for index, edit in enumerate(edits, 1):
        name = edit.name.strip()
        try:
            if not name or (edit.config is not None and edit.link is not None):
                raise ValueError()
            config = from_json(edit.config) if edit.config is not None else None
        except (TypeError, ValueError, RecursionError) as exc:
            raise HTTPException(422, tr(f"Проверьте источник профиля {index}", f"Check the source of profile {index}")) from exc
        if edit.link is not None:
            try:
                config = from_link(edit.link)
            except ValueError as exc:
                raise HTTPException(422, tr(f"Профиль {index}. {exc}", f"Profile {index}. {exc}")) from exc
        if config is not None:
            check_config(config)
        prepared.append((edit, name, config))

    with database(write=True) as conn:
        existing = {p["id"]: p for p in load_profiles(conn, widget_id)}
        revision = profile_revision(conn, widget_id)
        if body.revision is not None:
            check_expected({"revision": revision}, {"revision": body.revision})
        saved = []
        for edit, name, config in prepared:
            if config is not None:
                saved.append({"id": uuid4().hex, "name": name, "config": config,
                              "kind": "json" if edit.config is not None else "link"})
            elif edit.id in existing:
                saved.append({**existing.pop(edit.id), "name": name})
            else:
                raise HTTPException(409, tr("Выберите JSON или вставьте ссылку", "Choose JSON or paste a link"))
        conn.execute("INSERT OR REPLACE INTO private_profiles.sing_box_profiles VALUES (?, ?)",
                     (widget_id, json.dumps(saved)))
        conn.execute("""UPDATE widgets SET settings=json_set(settings, '$.singBoxSchedule', json(?),
            '$.singBoxProfilesRevision', ?) WHERE id=?""", (body.schedule.model_dump_json(), revision + 1, widget_id))
        conn.changed("widgets", widget_id)
        conn.changed("plugin", widget_id, plugin="sing-box-latency")
    return {"profiles": public_profiles(saved), "schedule": body.schedule, "revision": revision + 1}


@router.get("/{widget_id}/latency")
def latency(widget_id: int):
    with database(write=True) as conn:
        profiles = load_profiles(conn, widget_id)
    return [{**p, "delay": delay} for p, delay in zip(public_profiles(profiles), workers.map(probe_profile, profiles))]
