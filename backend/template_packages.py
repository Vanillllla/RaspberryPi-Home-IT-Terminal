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

from .i18n import tr, validation_message
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
        raise ValueError(tr("Недопустимый путь внутри пакета", "Invalid path inside the package"))
    if len(parts) != 2 or parts[1] != "template.json":
        raise ValueError(tr("В пакете должна быть одна папка с файлом template.json", "The package must contain one folder with a template.json file"))
    return parts[0]


def import_file(path, content, *, automatic=False):
    check_path(path)
    if len(content) > MAX_BYTES:
        raise ValueError(tr("Размер template.json превышает 8 МиБ", "template.json exceeds 8 MiB"))
    try:
        package = PackagedTemplate.model_validate_json(content, strict=True)
    except ValidationError as exc:
        issue = exc.errors(include_input=False)[0]
        field = ".".join(map(str, issue["loc"]))
        if field == "id":
            reason = tr("нужен ID вида template: и 32 строчные шестнадцатеричные цифры", "expected template: followed by 32 lowercase hexadecimal digits")
        elif issue["type"] == "missing":
            reason = tr("обязательное поле отсутствует", "required field is missing")
        elif issue["type"] == "json_invalid":
            reason = tr("некорректный JSON", "invalid JSON")
        else:
            reason = validation_message(issue)
        raise ValueError(f"template.json · {field or 'JSON'}: {reason}") from exc

    package.validate_links()
    package.description = package.description.strip()
    with database(write=True) as conn:
        deleted = conn.execute("SELECT revision FROM deleted_templates WHERE id=?", (package.id,)).fetchone()
        if automatic and deleted is not None:
            return
        # An editor or action request from before deletion must remain stale after re-import.
        package.revision = deleted["revision"] + 1 if deleted else 1
        inserted = conn.execute(
            "INSERT INTO templates(id, definition) VALUES (?, ?) ON CONFLICT(id) DO NOTHING",
            (package.id, package.model_dump_json(exclude={"id"})),
        )
        if not inserted.rowcount:
            raise TemplateConflict(tr(f"Шаблон с ID {package.id} уже есть в каталоге", f"A template with ID {package.id} already exists in the catalog"))
        if deleted:
            conn.execute("DELETE FROM deleted_templates WHERE id=?", (package.id,))
        conn.changed("templates", package.id)
    return package.model_dump()


def import_zip(content):
    try:
        with ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            files = [e for e in entries if not e.is_dir()]
            if len(files) != 1:
                raise ValueError(tr("ZIP должен содержать один файл — папка/template.json", "The ZIP must contain one file at folder/template.json"))
            entry = files[0]
            folder = check_path(entry.orig_filename)
            for member in entries:
                mode = stat.S_IFMT(member.external_attr >> 16)
                if member.is_dir():
                    if member.orig_filename != folder + "/" or mode not in (0, stat.S_IFDIR):
                        raise ValueError(tr("Недопустимый путь папки в ZIP", "Invalid folder path in the ZIP"))
                elif mode not in (0, stat.S_IFREG):
                    raise ValueError(tr("В ZIP разрешены только обычные файлы", "The ZIP may only contain regular files"))
            if entry.file_size > MAX_BYTES:
                raise ValueError(tr("Размер template.json превышает 8 МиБ", "template.json exceeds 8 MiB"))
            if entry.flag_bits & 1 or entry.compress_type not in (ZIP_STORED, ZIP_DEFLATED):
                raise ValueError(tr("Нужен ZIP без пароля, со сжатием Deflate или без сжатия", "Use an unencrypted ZIP with Deflate compression or no compression"))
            with archive.open(entry) as stream:
                definition = stream.read(MAX_BYTES + 1)
    except (BadZipFile, EOFError, zlib.error, NotImplementedError) as exc:
        raise ValueError(tr("Не удалось прочитать ZIP-архив", "Could not read the ZIP archive")) from exc
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
                import_file(folder.name + "/template.json", stream.read(MAX_BYTES + 1), automatic=True)
        except (OSError, ValueError, RecursionError) as exc:
            log.warning("Пропущен пакет %s: %s", folder.name, exc)


@router.post("/import", status_code=201)
async def upload_package(request: Request, path: str | None = None):
    media_type = request.headers.get("content-type", "").partition(";")[0].lower()
    if media_type != ("application/json" if path is not None else "application/zip"):
        raise HTTPException(415, tr("Выберите файл template.json в папке или ZIP-архив", "Select a folder with template.json or a ZIP archive"))
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_BYTES:
            raise HTTPException(413, tr("Размер загружаемого пакета превышает 8 МиБ", "The uploaded package exceeds 8 MiB"))
        content.extend(chunk)
    try:
        if path is None:
            return await run_in_threadpool(import_zip, content)
        return await run_in_threadpool(import_file, path, content)
    except TemplateConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except (ValueError, RecursionError) as exc:
        raise HTTPException(422, str(exc)) from exc
