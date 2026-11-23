"""JSON property contract shared by the API process and the Python worker."""
import json
import sys
import re

LIMIT = 256 * 1024
HISTORY_LIMIT = 3600


def checked(spec, value):
    kind = spec["type"]
    if kind in ("string", "secret", "color", "choice"):
        valid = isinstance(value, str) and len(value) <= 65536
    elif kind == "number":
        valid = type(value) in (int, float) and -sys.float_info.max <= value <= sys.float_info.max
    elif kind == "boolean":
        valid = type(value) is bool
    else:
        encoded = json.dumps(value, allow_nan=False)
        valid = len(encoded) <= LIMIT
    if not valid:
        raise ValueError(f"Expected {kind}")
    if kind == "number":
        if spec.get("min") is not None and value < spec["min"]:
            raise ValueError(f"Minimum: {spec['min']}")
        if spec.get("max") is not None and value > spec["max"]:
            raise ValueError(f"Maximum: {spec['max']}")
    if kind == "choice" and value not in spec["options"]:
        raise ValueError(f"Expected one of {spec['options']}")
    if kind == "color" and not re.fullmatch(r"#(?:[a-fA-F0-9]{3,4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})|[A-Za-z]{1,24}", value):
        raise ValueError("Expected a CSS color name or hex color")
    return value
