"""One bounded process per handler. Projects contain trusted, ordinary Python."""
import copy
import json
import math
import os
import re
import resource
import sqlite3
import subprocess
import sys
import time
import traceback
from contextlib import closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from values import HISTORY_LIMIT, checked


class Context:
    def __init__(self, request, functions):
        self._r = request
        self._functions = functions
        self._writes = []
        self._settings = {}
        self._samples = []
        self._depth = 0
        self.instance_id = request.get("instance_id")
        self.event = request["event"]

    def get(self, element, prop):
        return copy.deepcopy(self._r["values"][element][prop])

    def set(self, element, prop, value, persist=False):
        if type(persist) is not bool:
            raise TypeError("persist must be bool")
        kind = self._r["types"][element]
        value = copy.deepcopy(checked(self._r["contracts"][kind][prop], value))
        self._r["values"][element][prop] = value
        self._writes.append([element, prop, value, persist])

    def setting(self, name):
        spec = self._r["schema"][name]
        return copy.deepcopy(self._r["settings"].get(name, spec["default"]))

    def set_setting(self, name, value):
        value = copy.deepcopy(checked(self._r["schema"][name], value))
        self._settings[name] = self._r["settings"][name] = value

    def call(self, name):
        if self._depth >= 24:
            raise RecursionError("Too many nested handlers")
        self._depth += 1
        try:
            return self._functions[name](self)
        finally:
            self._depth -= 1

    def emit(self, name):
        old = self.event
        self.event = {"name": name, "element": None, "changes": {}}
        try:
            return self.call(self._r["events"][name])
        finally:
            self.event = old

    def sample(self, series, value):
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", series):
            raise ValueError("Invalid series name")
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError("Expected a finite numeric sample")
        self._samples.append([series, time.time(), value])

    def history(self, series, limit=120):
        if type(limit) is not int or not 1 <= limit <= HISTORY_LIMIT:
            raise ValueError("Expected 1 to 3600 samples")
        points = list(self._r.get("history", {}).get(series, []))
        if self.instance_id is not None:
            with closing(sqlite3.connect(Path(self._r["db"]).as_uri() + "?mode=ro", uri=True)) as conn:
                rows = conn.execute("""SELECT time,value FROM samples WHERE widget_id=? AND series=?
                                       ORDER BY id DESC LIMIT ?""", (self.instance_id, series, limit)).fetchall()
            points = [list(row) for row in reversed(rows)]
        points.extend([at, value] for key, at, value in self._samples if key == series)
        return points[-limit:]

    def invoke(self, name, *args):
        op = self._r["operations"][name]
        if len(args) != op["inputs"]:
            raise ValueError("Incorrect operation argument count")
        argv = [*op["argv"], *(a if isinstance(a, str) else json.dumps(a) for a in args)]
        result = subprocess.run(argv, check=True, stdin=subprocess.DEVNULL, capture_output=True, timeout=5)
        return result.stdout[:65536].decode(errors="replace")

    def asset(self, name):
        root = Path(self._r["folder"]) / "assets"
        path = (root / name).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file():
            raise FileNotFoundError(name)
        return path


def main():
    # Keep prints and subprocess stdout away from the result protocol.
    channel = os.fdopen(os.dup(1), "w")
    with open(os.devnull, "w") as sink:
        os.dup2(sink.fileno(), 1)
        os.dup2(sink.fileno(), 2)
    resource.setrlimit(resource.RLIMIT_CPU, (6, 7))
    resource.setrlimit(resource.RLIMIT_AS, (384 << 20, 384 << 20))
    try:
        req = json.load(sys.stdin)
        fn = {"__name__": "widget_logic", "__file__": str(Path(req["folder"]) / "logic/main.py")}
        sys.path.insert(0, str(Path(req["folder"]) / "logic"))
        ctx = Context(req, fn)
        exec(compile(req["source"], "logic/main.py", "exec"), fn)
        for prop, value in ctx.event["changes"].items():
            ctx.set(ctx.event["element"], prop, value)
        if req["handler"]:
            ctx.call(req["handler"])
        result = json.dumps({"writes": ctx._writes, "settings": ctx._settings, "samples": ctx._samples},
                            allow_nan=False)
        if len(result) > 2 << 20:
            raise ValueError("Handler output exceeds 2 MiB")
    except BaseException as exc:
        line = next((f.lineno for f in reversed(traceback.extract_tb(exc.__traceback__))
                     if f.filename == "logic/main.py"), None)
        detail = str(exc)
        if "ctx" in locals():
            for key, spec in ctx._r["schema"].items():
                value = ctx._r["settings"].get(key)
                if spec["type"] == "secret" and value:
                    detail = detail.replace(value, "••••")
        result = json.dumps({"error": type(exc).__name__, "line": line, "detail": detail[:300]})
    channel.write(result)
    channel.close()


if __name__ == "__main__":
    main()
