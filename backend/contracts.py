"""Version 1 of the on-disk designer and element contracts."""
import ast
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, JsonValue, model_validator

from .i18n import tr
from .values import checked


def safe_key(key):
    if key in {"constructor", "prototype", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf",
               "propertyIsEnumerable", "toLocaleString"}:
        raise ValueError(tr("Зарезервированное имя", "Reserved name"))
    return key


PackageId = Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]{0,63}$")]
Identifier = Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$"), AfterValidator(safe_key)]
Length = Annotated[int, Field(ge=1, le=8192)]
Coordinate = Annotated[int, Field(ge=0, le=8192)]
Mode = Literal["event", "visible", "background"]
Palette = Literal["white", "black", "green", "red", "purple", "yellow", "orange"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Label(Model):
    ru: str
    en: str


class Property(Model):
    type: Literal["string", "number", "boolean", "color", "choice", "json", "secret"]
    label: Label
    description: Label | None = None
    default: JsonValue
    min: float | None = None
    max: float | None = None
    options: list[str] = Field(default_factory=list)
    optionLabels: dict[str, Label] = Field(default_factory=dict)
    localized: bool = False

    @model_validator(mode="after")
    def default_matches(self):
        checked(self.model_dump(), self.default)
        if self.type == "secret" and self.default != "":
            raise ValueError(tr("Секрет задаётся в экземпляре", "Set secrets on the instance"))
        return self


class ElementEvent(Model):
    description: Label
    writes: list[Identifier] = Field(default_factory=list)


class Frame(Model):
    x: Coordinate = 0
    y: Coordinate = 0
    w: Length = 120
    h: Length = 44


class Element(Model):
    apiVersion: Literal[1]
    id: PackageId
    name: Label
    description: Label
    version: str
    defaultFrame: Frame = Field(default_factory=Frame)
    properties: dict[Identifier, Property]
    events: dict[Identifier, ElementEvent]
    strings: dict[str, Label] = Field(default_factory=dict)
    container: bool = False

    @model_validator(mode="after")
    def valid_events(self):
        if any(p.type == "secret" for p in self.properties.values()):
            raise ValueError("Secret fields belong to instance settings")
        for event in self.events.values():
            if set(event.writes) - self.properties.keys():
                raise ValueError("Unknown property in event.writes")
        return self


class LayoutSpec(Model):
    mode: Literal["fixed", "row", "column"] = "fixed"
    align: Literal["start", "center", "end", "stretch"] = "start"
    gap: Coordinate = 8


class Node(Model):
    id: Identifier
    type: PackageId
    frame: Frame = Field(default_factory=Frame)
    grow: bool = False
    props: dict[Identifier, JsonValue] = Field(default_factory=dict)
    events: dict[Identifier, Identifier] = Field(default_factory=dict)
    layout: LayoutSpec = Field(default_factory=LayoutSpec)
    children: list["Node"] = Field(default_factory=list)


class View(Model):
    width: Length = 720
    height: Length = 480
    layout: LayoutSpec = Field(default_factory=LayoutSpec)
    nodes: list[Node] = Field(default_factory=list)


class Views(Model):
    widget: View
    details: View | None = None
    settings: View | None = None


class Appearance(Model):
    customTitle: str | None = Field(default=None, max_length=100)
    hideTitle: bool | None = None
    cardPalette: Palette | None = None
    titlePalette: Palette | None = None


class Execution(Model):
    mode: Mode = "event"
    interval: int = Field(default=30, ge=1, le=86400)
    handler: Identifier | None = None


class Dependencies(Model):
    elements: list[PackageId] = Field(default_factory=list)
    python: list[str] = Field(default_factory=list)
    host: list[str] = Field(default_factory=list)


def walk(nodes):
    for node in nodes:
        yield node
        yield from walk(node.children)


class Project(Model):
    apiVersion: Literal[1]
    id: PackageId
    name: Label
    description: Label
    version: str = Field(min_length=1, max_length=80)
    author: str = ""
    icon: str = ""
    width: int = Field(default=4, ge=1, le=12)
    height: int = Field(default=3, ge=1, le=24)
    appearance: Appearance = Field(default_factory=Appearance)
    execution: Execution = Field(default_factory=Execution)
    dependencies: Dependencies = Field(default_factory=Dependencies)
    settings: dict[Identifier, Property] = Field(default_factory=dict)
    events: dict[Identifier, Identifier] = Field(default_factory=dict)
    strings: dict[str, Label] = Field(default_factory=dict)
    views: Views
    source: str = Field(default="", max_length=262144)

    def nodes(self):
        for view in (self.views.widget, self.views.details, self.views.settings):
            if view:
                yield from walk(view.nodes)

    def validate_contracts(self, elements):
        ids = set()
        handlers = set(self.events.values())
        if self.execution.handler:
            handlers.add(self.execution.handler)
        elif self.execution.mode != "event":
            raise ValueError(tr("Назначьте периодический обработчик", "Assign a periodic handler"))
        for node in self.nodes():
            if node.id in ids:
                raise ValueError(tr("ID повторяется", "Duplicate ID") + ": " + node.id)
            ids.add(node.id)
            if len(ids) > 512:
                raise ValueError(tr("Лимит проекта — 512 элементов", "Project limit is 512 elements"))
            handlers.update(node.events.values())
            element = elements.get(node.type)
            if element is None:
                continue
            if node.children and not element.container:
                raise ValueError(tr("Ожидается контейнер", "Expected a container") + ": " + node.id)
            for name, value in node.props.items():
                if name not in element.properties:
                    raise ValueError(f"{node.id}.{name}: " + tr("неизвестное свойство", "unknown property"))
                try:
                    checked(element.properties[name].model_dump(), value)
                except ValueError as exc:
                    raise ValueError(f"{node.id}.{name}: " + tr("проверьте значение", "check value") + f" ({exc})") from exc
            if missing := set(node.events) - element.events.keys():
                raise ValueError(f"{node.id}: " + tr("неизвестное событие", "unknown event") + f" {sorted(missing)}")
        try:
            tree = ast.parse(self.source, "logic/main.py")
            compile(tree, "logic/main.py", "exec")
        except SyntaxError as exc:
            raise ValueError(tr("Ошибка Python в строке", "Python error on line") + f" {exc.lineno}: {exc.msg}") from exc
        functions = {f.name: f for f in tree.body if isinstance(f, ast.FunctionDef)}
        if missing := handlers - functions.keys():
            raise ValueError(tr("Отсутствует функция", "Missing function") + ": " + ", ".join(sorted(missing)))
        for name in handlers:
            fn = functions[name]
            args = fn.args
            positional = len(args.posonlyargs) + len(args.args)
            if (positional - len(args.defaults) > 1 or (not positional and not args.vararg)
                    or any(v is None for v in args.kw_defaults)):
                raise ValueError(f"{name} ({fn.lineno}): " + tr("обработчик должен принимать ctx",
                                                               "handler must accept one positional ctx"))
