"""The filesystem is authoritative. Publishing a manifest switches UI and code together."""
import hashlib
import json
import logging
import os
import re
import tempfile
from contextlib import contextmanager
from pathlib import Path

from pydantic import ValidationError

from .contracts import Element, Project
from .i18n import tr

ROOT = Path(__file__).resolve().parents[1]
WIDGETS = Path(os.environ.get("TERMINAL_WIDGETS", ROOT / "widgets")).resolve()
ELEMENTS = Path(os.environ.get("TERMINAL_ELEMENTS", ROOT / "elements")).resolve()
INTEGRATIONS = Path(os.environ.get("TERMINAL_INTEGRATIONS", ROOT / "integrations")).resolve()
elements = {}
projects = {}
operations = {}
diagnostics = {}
log = logging.getLogger(__name__)


class Definition:
    def __init__(self, project):
        self.project = project
        self.nodes = {n.id: n for n in project.nodes()}
        self.revision = hashlib.sha256(project.model_dump_json().encode()).hexdigest()
        self.public = {**project.model_dump(exclude={"source"}), "revision": self.revision}
        self.public["dependencies"]["elements"] = sorted(set(project.dependencies.elements) |
                                                        {n.type for n in self.nodes.values()})


def contained(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or path == root.resolve():
        raise ValueError(tr("Недопустимый путь", "Invalid path"))
    return path


def read_definition(folder):
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf8"))
    if not isinstance(manifest, dict) or "source" in manifest:
        raise ValueError("Expected a project manifest with a logic file reference")
    logic = contained(folder, manifest.pop("logic"))
    project = Project.model_validate({**manifest, "source": logic.read_text(encoding="utf8")})
    if project.id != folder.name:
        raise ValueError("Folder and manifest ID differ")
    project.validate_contracts(elements)
    return Definition(project)


def report(package, exc):
    if isinstance(exc, ValidationError):
        detail = "; ".join(".".join(map(str, issue["loc"])) + " " + issue["msg"]
                           for issue in exc.errors(include_input=False, include_url=False))
    else:
        detail = str(exc)
    diagnostics[package] = detail
    log.warning("%s: %s", package, detail)


def discover():
    elements.clear()
    projects.clear()
    operations.clear()
    diagnostics.clear()
    for path in sorted(ELEMENTS.glob("*/manifest.json")):
        try:
            element = Element.model_validate_json(path.read_bytes())
            if element.id != path.parent.name or not (path.parent / "Component.tsx").is_file():
                raise ValueError("Check module directory and Component.tsx")
            elements[element.id] = element
        except (ValueError, OSError) as exc:
            report(f"elements/{path.parent.name}", exc)
    for path in sorted(INTEGRATIONS.glob("*/operations.json")):
        try:
            module = json.loads(path.read_bytes())
            entries = {}
            for name, op in module.items():
                argv, inputs = op["argv"], op.get("inputs", 0)
                if not (isinstance(argv, list) and argv and all(isinstance(v, str) for v in argv)
                        and os.path.isabs(argv[0]) and type(inputs) is int and 0 <= inputs <= 16):
                    raise ValueError("Invalid host operation")
                entries[f"{path.parent.name}/{name}"] = {"argv": argv, "inputs": inputs}
            operations.update(entries)
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
            report(f"integrations/{path.parent.name}", exc)
    for path in sorted(WIDGETS.glob("*/manifest.json")):
        if path.parent.name.startswith("."):
            continue
        try:
            definition = read_definition(path.parent)
            projects[definition.project.id] = definition
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
            report(f"widgets/{path.parent.name}", exc)


def atomic_write(path, content):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temp:
        try:
            temp.write(content)
            temp.flush()
            os.fsync(temp.fileno())
            temp.close()
            os.replace(temp.name, path)
        finally:
            Path(temp.name).unlink(missing_ok=True)


@contextmanager
def publish(project):
    folder = contained(WIDGETS, project.id)
    folder.mkdir(parents=True, exist_ok=True)
    contained(folder, "assets").mkdir(exist_ok=True)
    manifest = contained(folder, "manifest.json")
    old = manifest.read_bytes() if manifest.exists() else None
    source = project.source.encode()
    digest = hashlib.sha256(source).hexdigest()
    logic = f"logic/{digest}.py"
    path = contained(folder, logic)
    path.parent.mkdir(exist_ok=True)
    if not path.exists() or path.read_bytes() != source:
        atomic_write(path, source)
    contents = project.model_dump(exclude={"source"})
    contents["logic"] = logic
    contents["dependencies"]["elements"] = sorted(set(contents["dependencies"]["elements"]) |
                                                {node.type for node in project.nodes()})
    atomic_write(manifest, (json.dumps(contents, ensure_ascii=False, indent=2) + "\n").encode())
    try:
        yield
    except BaseException:
        if old is None:
            manifest.unlink()
        else:
            atomic_write(manifest, old)
        raise
    if old:
        previous = json.loads(old).get("logic", "")
        if previous != logic and re.fullmatch(r"logic/[a-f0-9]{64}\.py", previous):
            try:
                contained(folder, previous).unlink(missing_ok=True)
            except OSError:
                log.warning("Could not clean unused source %s", previous)
