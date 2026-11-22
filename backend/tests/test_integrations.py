import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend import integrations, storage
from backend.main import AddWidget, create_widget
from backend.templates import Definition, Invocation, create_template, run_action


class IntegrationTest(unittest.TestCase):
    def test_command_snapshot_arguments_and_missing_definition(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.object(storage, "DB_PATH", root / "test.db"))
        self.enterContext(patch.object(integrations, "PLUGINS", root))
        storage.initialize()
        folder = root / "demo"
        folder.mkdir()
        output = root / "received.json"
        program = folder / "record.py"
        program.write_text("import json,sys\nfrom pathlib import Path\nPath(sys.argv[1]).write_text(json.dumps(sys.argv[2:]))")
        (folder / "operations.json").write_text(json.dumps({
            "record": {"argv": [sys.executable, str(program), str(output)], "inputs": 3},
            "ping": {"argv": [sys.executable, str(program), str(output)]},
        }))
        element = integrations.create(integrations.Integration(name="Demo", tasks=[
            integrations.Task(name="Record", operation="demo/record"), integrations.Task(name="Ping", operation="demo/ping")]))
        definition = Definition(name="Card", rows=[[
            {"kind": kind, "id": key, "label": key} for kind, key in
            [("input", "text"), ("switch", "enabled"), ("slider", "amount")]
        ] + [{"kind": "integration", "label": "Demo", "id": "demo", "integration": element["id"], "bindings": [
            {"trigger": "record", "context": 'context["values"]["text"], enabled, amount'}, {"trigger": "ping"}]}]],
            actions=[{"kind": "activate", "trigger": "command", "command": key, "name": key, "id": key, "targets": []}
                     for key in ("record", "ping")])
        template = create_template(definition)
        widget = create_widget(1, AddWidget(plugin_id=template["id"]))
        call = Invocation(revision=1, inputs={"text": "two words; literal", "enabled": True, "amount": 5})
        run_action(widget["id"], "record", call)
        args = json.loads(output.read_text())
        self.assertEqual(args[:2], ["two words; literal", "true"])
        self.assertEqual(float(args[2]), 5)
        run_action(widget["id"], "ping", call)
        self.assertEqual(json.loads(output.read_text()), [])
        integrations.remove(element["id"])
        with self.assertRaises(HTTPException) as error:
            run_action(widget["id"], "ping", call)
        self.assertEqual(error.exception.status_code, 422)
