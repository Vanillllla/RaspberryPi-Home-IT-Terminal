"""Import a builder definition from a package without extracting or executing its contents."""
import io
import logging
import stat
import zlib
from pathlib import Path, PureWindowsPath
from zipfile import ZIP_DEFLATED, ZIP_STORED, BadZipFile, ZipFile

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import Field, ValidationError

from .storage import database
from .templates import Definition

router = APIRouter(prefix="/api/templates")
PACKAGES = Path(__file__).resolve().parents[1] / "template-packages"
MAX_BYTES = 8 * 1024 * 1024
log = logging.getLogger(__name__)


class TemplateConflict(ValueError):
    pass


class PackagedTemplate(Definition):
    id: str = Field(pattern=r"^template:[0-9a-f]{32}$")


def check_path(path):
    parts = path.split("/")
    if ("\\" in path or "\0" in path or any(
        part in ("", ".", "..") or PureWindowsPath(part).drive for part in parts
    )):
        raise ValueError("Недопустимый путь внутри пакета")
    if len(parts) != 2 or parts[1] != "template.json":
        raise ValueError("В пакете должна быть одна папка с файлом template.json")
    return parts[0]


def import_file(path, content):
    check_path(path)
    if len(content) > MAX_BYTES:
        raise ValueError("Размер template.json превышает 8 МиБ")
    try:
        package = PackagedTemplate.model_validate_json(content, strict=True)
    except ValidationError as exc:
        issue = exc.errors(include_input=False)[0]
        field = ".".join(map(str, issue["loc"]))
        if field == "id":
            reason = "нужен ID вида template: и 32 строчные шестнадцатеричные цифры"
        elif issue["type"] == "missing":
            reason = "обязательное поле отсутствует"
        elif issue["type"] == "json_invalid":
            reason = "некорректный JSON"
        else:
            reason = issue["msg"]
        raise ValueError(f"template.json · {field or 'JSON'}: {reason}") from exc

    package.validate_links()
    package.description = package.description.strip()
    package.revision = 1
    with database(write=True) as conn:
        inserted = conn.execute(
            "INSERT INTO templates(id, definition) VALUES (?, ?) ON CONFLICT(id) DO NOTHING",
            (package.id, package.model_dump_json(exclude={"id"})),
        )
        if not inserted.rowcount:
            raise TemplateConflict(f"Шаблон с ID {package.id} уже есть в каталоге")
    return package.model_dump()


def import_zip(content):
    try:
        with ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            files = [e for e in entries if not e.is_dir()]
            if len(files) != 1:
                raise ValueError("ZIP должен содержать один файл — папка/template.json")
            entry = files[0]
            folder = check_path(entry.orig_filename)
            for member in entries:
                mode = stat.S_IFMT(member.external_attr >> 16)
                if member.is_dir():
                    if member.orig_filename != folder + "/" or mode not in (0, stat.S_IFDIR):
                        raise ValueError("Недопустимый путь папки в ZIP")
                elif mode not in (0, stat.S_IFREG):
                    raise ValueError("В ZIP разрешены только обычные файлы")
            if entry.file_size > MAX_BYTES:
                raise ValueError("Размер template.json превышает 8 МиБ")
            if entry.flag_bits & 1 or entry.compress_type not in (ZIP_STORED, ZIP_DEFLATED):
                raise ValueError("Нужен ZIP без пароля, со сжатием Deflate или без сжатия")
            with archive.open(entry) as stream:
                definition = stream.read(MAX_BYTES + 1)
    except (BadZipFile, EOFError, zlib.error, NotImplementedError) as exc:
        raise ValueError("Не удалось прочитать ZIP-архив") from exc
    return import_file(entry.orig_filename, definition)


def discover_packages(root=PACKAGES):
    if not root.is_dir():
        return
    for folder in sorted(root.iterdir()):
        if not folder.is_dir():
            continue
        try:
            file = folder / "template.json"
            if folder.is_symlink() or file.is_symlink() or not file.is_file() or list(folder.iterdir()) != [file]:
                raise ValueError("В папке нужен один обычный файл template.json")
            with file.open("rb") as stream:
                import_file(folder.name + "/template.json", stream.read(MAX_BYTES + 1))
        except (OSError, ValueError, RecursionError) as exc:
            log.warning("Пропущен пакет %s: %s", folder.name, exc)


@router.post("/import", status_code=201)
async def upload_package(request: Request, path: str | None = None):
    media_type = request.headers.get("content-type", "").partition(";")[0].lower()
    if media_type != ("application/json" if path is not None else "application/zip"):
        raise HTTPException(415, "Выберите файл template.json в папке или ZIP-архив")
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_BYTES:
            raise HTTPException(413, "Размер загружаемого пакета превышает 8 МиБ")
        content.extend(chunk)
    try:
        if path is None:
            return await run_in_threadpool(import_zip, content)
        return await run_in_threadpool(import_file, path, content)
    except TemplateConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except (ValueError, RecursionError) as exc:
        raise HTTPException(422, str(exc)) from exc
