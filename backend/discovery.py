import importlib.util
import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, FastAPI
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)
PLUGINS = Path(__file__).resolve().parents[1] / "plugins"


class LocalizedManifest(BaseModel):
    name: str
    description: str


class Manifest(BaseModel):
    apiVersion: Literal[1]
    id: str = Field(pattern=r"^[a-z][a-z0-9-]*$")
    name: str = Field(min_length=1)
    version: str = Field(min_length=1)
    description: str
    translations: dict[str, LocalizedManifest] = Field(default_factory=dict)
    capabilities: list[Literal["details", "settings", "backend"]]


def backend_router(folder: Path) -> APIRouter:
    spec = importlib.util.spec_from_file_location(f"terminal_plugin_{folder.name}", folder / "backend.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not isinstance(module.router, APIRouter):
        raise ValueError("backend.py должен экспортировать router типа APIRouter")
    return module.router


def discover(app: FastAPI):
    registry = {}
    for path in sorted(PLUGINS.glob("*/manifest.json")):
        try:
            manifest = Manifest.model_validate_json(path.read_bytes())
            if path.parent.name != manifest.id or not (path.parent / "index.tsx").is_file():
                raise ValueError("Проверьте имя папки и наличие index.tsx")
            if "backend" in manifest.capabilities:
                app.include_router(backend_router(path.parent), prefix=f"/api/plugins/{manifest.id}")
            registry[manifest.id] = manifest
        except Exception:
            log.exception("Ошибка загрузки плагина %s", path.parent.name)
    return registry
