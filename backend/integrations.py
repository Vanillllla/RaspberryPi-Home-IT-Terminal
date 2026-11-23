"""Reusable mappings to operations installed on this host."""
import json
import logging
import os
import re
import shlex
import signal
import subprocess
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, TypeAdapter, model_validator

from .discovery import PLUGINS
from .i18n import tr
from .storage import database

router = APIRouter(prefix="/api/integrations")


class Operation(BaseModel):
    argv: list[str] = Field(min_length=1)
    inputs: int = Field(default=0, ge=0, le=16)

    @model_validator(mode="after")
    def absolute_program(self):
        if not os.path.isabs(self.argv[0]):
            raise ValueError("Expected an absolute program path")
        return self


def operations():
    result = {}
    for path in sorted(PLUGINS.glob("*/operations.json")):
        try:
            entries = TypeAdapter(dict[str, Operation]).validate_json(path.read_bytes())
            result.update({f"{path.parent.name}/{key}": op for key, op in entries.items()})
        except (OSError, ValueError):
            logging.getLogger(__name__).exception("Invalid integration operations in %s", path)
    return result


class Task(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    operation: str = Field(default="", max_length=200)
    script: str = Field(default="", max_length=4096)
    inputs: int = Field(default=0, ge=0, le=16)


def service_names():
    names = set()
    for path in PLUGINS.glob("*/services.json"):
        try:
            names.update(TypeAdapter(list[str]).validate_json(path.read_bytes()))
        except (ValueError, OSError):
            logging.getLogger(__name__).exception("Invalid integration services in %s", path)
    return names


def service_commands(task, args=None):
    commands = []
    services = service_names()
    for line in task.script.splitlines():
        try:
            words = shlex.split(line, comments=True)
        except ValueError as exc:
            raise ValueError(tr("Проверьте кавычки команды", "Check command quoting")) from exc
        if not words:
            continue
        if len(words) != 3 or words[0] != "systemctl":
            raise ValueError(tr("Ожидается systemctl, действие и служба", "Expected systemctl, a verb and a service"))
        verb, service = words[1:]
        arguments = []
        for token in (verb, service):
            ref = re.fullmatch(r"\$([1-9][0-9]?)", token)
            if ref:
                index = int(ref[1]) - 1
                if index >= task.inputs:
                    raise ValueError(tr("Проверьте номер аргумента", "Check the argument number"))
                token = args[index] if args is not None else None
            arguments.append(token)
        verb, service = arguments
        if verb is not None and verb not in ("start", "stop", "restart", "reload", "is-active"):
            raise ValueError(tr("Недопустимое действие systemctl", "Unsupported systemctl verb"))
        if service is not None:
            if not isinstance(service, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,127}", service):
                raise ValueError(tr("Недопустимое имя службы", "Invalid service name"))
            if not service.endswith(".service"):
                service += ".service"
            template = re.sub(r"@[^@.]+(?=\.service$)", "@", service)
            if service not in services and template not in services:
                raise ValueError(tr("Служба отсутствует в интеграциях устройства", "Service unavailable in installed integrations"))
        commands.append(["/usr/bin/systemctl", "--no-ask-password", verb, service])
    if not 1 <= len(commands) <= 16:
        raise ValueError(tr("Введите от 1 до 16 команд", "Enter 1 to 16 commands"))
    return commands


class Integration(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    tasks: list[Task] = Field(min_length=1, max_length=32)


@router.get("")
def catalog():
    with database() as conn:
        rows = conn.execute("SELECT * FROM integrations ORDER BY rowid")
        return {"elements": [dict(id=r["id"], **json.loads(r["definition"])) for r in rows],
                "operations": {key: op.inputs for key, op in operations().items()}}


@router.post("", status_code=201)
def create(body: Integration):
    available = operations()
    if not body.name.strip() or any(not t.name.strip() or (not t.script and t.operation not in available) or (t.script and t.operation) for t in body.tasks):
        raise HTTPException(422, tr("Проверьте название и операции", "Check the name and operations"))
    try:
        for task in body.tasks:
            if task.script:
                service_commands(task)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    key = uuid4().hex
    with database(write=True) as conn:
        conn.execute("INSERT INTO integrations VALUES (?, ?)", (key, body.model_dump_json()))
        conn.changed("integrations", key)
    return {"id": key, **body.model_dump()}


@router.delete("/{key}")
def remove(key: str):
    with database(write=True) as conn:
        if conn.execute("DELETE FROM integrations WHERE id=?", (key,)).rowcount:
            conn.changed("integrations", key)
    return {}


class Binding(BaseModel):
    trigger: str = Field(default="", max_length=64)
    context: str = Field(default="", max_length=4096)

    def references(self):
        refs = []
        for part in self.context.split(",") if self.context.strip() else ():
            token = part.strip()
            match = re.fullmatch(r'context\["values"\]\["([A-Za-z][\w-]*)"\]', token)
            refs.append(match[1] if match else token)
        return refs


def invoke(key, index, args):
    with database() as conn:
        row = conn.execute("SELECT definition FROM integrations WHERE id=?", (key,)).fetchone()
    if not row:
        raise ValueError(tr("Элемент интеграции удалён", "Integration element was deleted"))
    tasks = Integration.model_validate_json(row[0]).tasks
    if not 0 <= index < len(tasks):
        raise ValueError(tr("Действие отсутствует", "Action unavailable"))
    task = tasks[index]
    if task.script:
        if len(args) != task.inputs:
            raise ValueError(tr("Проверьте число аргументов", "Check the argument count"))
        for argv in service_commands(task, args):
            run_program(argv)
        return
    op = operations().get(task.operation)
    if not op:
        raise ValueError(tr("Системная операция недоступна", "System operation unavailable"))
    if len(args) != op.inputs:
        raise ValueError(tr(f"Ожидается аргументов: {op.inputs}", f"Expected arguments: {op.inputs}"))
    argv = [*op.argv, *(v if isinstance(v, str) else json.dumps(v) for v in args)]
    run_program(argv)


def run_program(argv):
    if any("\x00" in arg for arg in argv):
        raise ValueError(tr("Аргумент содержит нулевой символ", "Argument contains a null character"))
    try:
        with subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, start_new_session=True) as process:
            try:
                code = process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                raise ValueError(tr("Истекло время операции", "Operation timed out"))
    except OSError as exc:
        raise ValueError(tr("Не удалось запустить программу", "Could not start the program")) from exc
    if code:
        raise ValueError(tr(f"Операция завершилась с кодом {code}", f"Operation exited with code {code}"))
