"""One bounded, short-lived Debian worker per network or author-defined action."""
import ctypes
import datetime
import errno
import json
import math
import re
import resource
import socket
import statistics
import subprocess
import sys
from contextlib import redirect_stdout
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


def tr(russian, english):
    return english if sys.argv[1:] == ["en"] else russian


def restrict_python():
    # Only computation and the already-open diagnostic/result streams are needed by run(context).
    lib = ctypes.CDLL("libseccomp.so.2")
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    policy = lib.seccomp_init(0x00050000 | errno.EPERM)
    if not policy:
        raise RuntimeError(tr("Не удалось создать ограничения процесса Python", "Could not create the Python process restrictions"))
    for name in ("read write fstat close lseek brk mmap mmap2 mremap munmap mprotect madvise futex "
                 "clock_gettime gettimeofday time clock_nanosleep nanosleep rt_sigaction rt_sigreturn "
                 "rt_sigprocmask getrandom getpid gettid exit exit_group").split():
        number = lib.seccomp_syscall_resolve_name(name.encode())
        if number >= 0 and lib.seccomp_rule_add(policy, 0x7fff0000, number, 0) != 0:
            raise RuntimeError(tr("Не удалось ограничить процесс Python", "Could not restrict the Python process"))
    if lib.seccomp_load(policy) != 0:
        raise RuntimeError(tr("Не удалось применить ограничения процесса Python", "Could not apply the Python process restrictions"))


class HttpRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlsplit(newurl).scheme not in ("http", "https"):
            raise ValueError(tr("HTTP GET поддерживает только переадресацию на HTTP(S)", "HTTP GET only supports redirects to HTTP(S)"))
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def run(action, context, commands):
    if action["kind"] == "python":
        def emit(command):
            if not isinstance(command, str) or not command.strip() or len(command) > 100:
                raise ValueError(tr("emit ожидает непустое имя команды длиной до 100 символов", "emit requires a nonempty command name of up to 100 characters"))
            if len(commands) >= 64:
                raise ValueError(tr("Одно действие может отправить до 64 команд", "An action can emit up to 64 commands"))
            commands.append(command)

        scope = {"emit": emit, "__name__": "__widget__", "math": math, "datetime": datetime,
                 "statistics": statistics, "json": json, "re": re}
        restrict_python()
        with redirect_stdout(sys.stderr):
            exec(compile(action["code"], "<widget>", "exec"), scope)
            if not callable(scope.get("run")):
                raise ValueError(tr("Определите функцию run(context)", "Define the run(context) function"))
            return scope["run"](context)
    if action["kind"] == "reach":
        if action["port"] is None:
            try:
                ping = subprocess.run(["ping", "-n", "-c", "1", "-W", "2", "--", action["host"]],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            except FileNotFoundError as exc:
                raise ValueError(tr("Для проверки ICMP установите iputils-ping", "Install iputils-ping to run ICMP checks")) from exc
            if ping.returncode not in (0, 1):
                raise ValueError(ping.stderr.decode(errors="replace").strip() or tr("Ошибка ICMP", "ICMP check failed"))
            ok = ping.returncode == 0
        else:
            try:
                with socket.create_connection((action["host"], action["port"]), timeout=2):
                    ok = True
            except OSError:
                ok = False
        return {"available": ok, "text": tr("Доступен", "Available") if ok else tr("Недоступен", "Unavailable"), "color": "green" if ok else "red"}
    try:
        request = Request(action["url"], headers={"Accept": "application/json"})
        with build_opener(HttpRedirects()).open(request, timeout=3) as response:
            data = response.read(1048577)
    except HTTPError as exc:
        raise ValueError(f"HTTP {exc.code}: {exc.reason}") from exc
    except OSError as exc:
        reason = exc.reason if isinstance(exc, URLError) else exc
        if isinstance(reason, TimeoutError):
            raise ValueError(tr("Истекло время ожидания HTTP-ответа (3 с)", "The HTTP response timed out (3 s)")) from exc
        raise ValueError(tr(f"Источник недоступен: {reason}", f"Source unreachable: {reason}")) from exc
    if len(data) > 1048576:
        raise ValueError(tr("Ответ HTTP больше 1 МиБ", "The HTTP response exceeds 1 MiB"))
    try:
        return json.loads(data)
    except (ValueError, UnicodeError) as exc:
        raise ValueError(tr("Источник вернул некорректный JSON", "The source returned invalid JSON")) from exc


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_AS, (192 << 20, 192 << 20))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2 << 20, 2 << 20))
    try:
        commands = []
        result = run(*json.load(sys.stdin), commands)
        print(json.dumps({"value": result, "commands": commands}, allow_nan=False, ensure_ascii=False))
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}")
        sys.exit(1)
