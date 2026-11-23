import json
import os
import signal
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from .i18n import language, tr


def get_field(value, path):
    for key in path.split(".") if path else ():
        try:
            value = value[int(key)] if isinstance(value, list) and key.isdecimal() else value[key]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ValueError(tr(f"В результате отсутствует поле {path}", f"The result has no field named {path}")) from exc
    return value


def execute(action, context):
    if action.kind == "time":
        return datetime.now().strftime("%H:%M:%S"), "", []
    worker = Path(__file__).with_name("action_worker.py")
    with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as log:
        with subprocess.Popen([sys.executable, "-I", str(worker), language.get()], stdin=subprocess.PIPE, stdout=output,
                              stderr=log, cwd=folder, env={"PATH": os.defpath}, start_new_session=True) as process:
            try:
                process.communicate(json.dumps([action.model_dump(), context]).encode(), timeout=4)
            except subprocess.TimeoutExpired as exc:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                raise ValueError(tr("Превышено время выполнения действия (4 с)", "The action timed out (4 s)")) from exc
        log.seek(0)
        diagnostic = log.read(4096).decode(errors="replace").strip()
        if process.returncode:
            output.seek(0)
            message = output.read(8192).decode(errors="replace").strip()
            detail = "\n".join(part for part in (message, diagnostic) if part)
            raise ValueError(detail or tr("Действие остановлено по лимиту ресурсов", "The action exceeded its resource limit"))
        output.seek(0)
        try:
            reply = json.load(output)
            result = reply["value"]
        except ValueError as exc:
            raise ValueError(tr("Результат действия слишком велик или не сериализуется в JSON", "The action result is too large or cannot be serialized as JSON")) from exc
        if action.kind == "http":
            result = get_field(result, action.path)
        return result, diagnostic, reply["commands"]
