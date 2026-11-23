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


def load_backend(folder: Path):
    spec = importlib.util.spec_from_file_location(f"terminal_plugin_{folder.name}", folder / "backend.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not isinstance(module.router, APIRouter):
        raise ValueError("backend.py должен экспортировать router типа APIRouter")
    return module


def discover(app: FastAPI):
    registry = {}
    app.state.before_widget_delete = {}
    app.state.initialize_plugins = {}
    for path in sorted(PLUGINS.glob("*/manifest.json")):
        try:
            manifest = Manifest.model_validate_json(path.read_bytes())
            if path.parent.name != manifest.id or not (path.parent / "index.tsx").is_file():
                raise ValueError("Проверьте имя папки и наличие index.tsx")
            if "backend" in manifest.capabilities:
                module = load_backend(path.parent)
                app.include_router(module.router, prefix=f"/api/plugins/{manifest.id}")
                if callable(getattr(module, "before_widget_delete", None)):
                    app.state.before_widget_delete[manifest.id] = module.before_widget_delete
                if callable(getattr(module, "initialize_profiles", None)):
                    app.state.initialize_plugins[manifest.id] = module.initialize_profiles
            registry[manifest.id] = manifest
        except Exception:
            log.exception("Ошибка загрузки плагина %s", path.parent.name)
    return registry


def initialize_plugins(app: FastAPI):
    for plugin_id, initialize in app.state.initialize_plugins.items():
        try:
            initialize()
        except Exception:
            log.error("Не удалось подготовить хранилище плагина %s", plugin_id)
