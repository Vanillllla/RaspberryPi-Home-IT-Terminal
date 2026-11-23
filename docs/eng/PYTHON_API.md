# Python API · version 1

## Handlers and context

Bind an event to a synchronous top-level function taking one argument, ctx. All functions belong to the same module. For each invocation the server loads it in a separate Python process using the backend environment. Standard-library and installed Python packages are available. Module variables last one invocation. A return value goes back to the caller. Use ctx.set to update the UI.

```python
def label_for(level):
    return f"{level} °C"

def refresh(ctx):
    level = ctx.get("temperature", "value")
    ctx.set("caption", "text", label_for(level))
    ctx.set("lamp", "color", "red" if level > 50 else "green")
```

## Properties

ctx.get(element, prop) returns a copy of the current value. Element IDs are unique across the three views of an instance. The precedence from lowest to highest is element manifest default, project node property, durable instance override, then temporary override. The event's input changes are already visible inside the handler. Python uses the original property strings. Presentation translates localized captions for each browser.

ctx.set(element, prop, value, persist=False) validates the value against the installed element contract, changes it in the current context and returns None. A durable write survives server restarts. A temporary write over a durable value is shared with all clients until restart or the next durable write to that property. Both writes can occur in one event. JSON properties accept lists, objects and JSON scalars. To change a collection returned by get, pass the modified copy to set.

```python
def advance(ctx):
    value = ctx.get("myGauge", "value") + 1
    ctx.set("myGauge", "value", min(value, 100), persist=True)
    ctx.set("myGauge", "color", "#157552")
```

Unknown IDs, properties and settings raise KeyError. Invalid types, ranges, colors, options and oversized JSON raise ValueError or TypeError. Numbers must be finite. Pass True/False for booleans and str for strings. The slider emits numbers. Input emits strings. An uncaught error rolls back the event's entire set of model changes. The editor and card display the error type and source line where available. External HTTP requests and host operations have their own side effects.

## Instances and settings

ctx.instance_id is the integer placement ID, or None during preview. ctx.setting(name) returns a declared setting or its default. ctx.set_setting(name, value) validates and persists an individual setting and returns None. Declare parameters on the Project tab. For tokens use a secret field with an empty default. Enter the value in the instance's password field. The dashboard snapshot exposes only the presence of a secret. Keep secrets out of element properties, source code, history, URLs and error messages.

```python
def apply_name(ctx):
    name = ctx.get("nameInput", "value").strip()
    ctx.set_setting("stationName", name)
    ctx.set("cardTitle", "text", name, persist=True)
```

## Events and return values

ctx.event is a dictionary with name, element and changes. A periodic invocation uses the name tick and element None. A component can update properties only from the event's declared writes list. Event inputs are temporary. To retain an input, write it using set with persist=True.

ctx.call(name) synchronously invokes a module function with the current ctx and returns its result. ctx.emit(name) calls the handler from the project's events mapping and returns its result. During that call ctx.event describes the internal event. It is restored on return. Dispatch nesting is limited to 24 calls. Ordinary Python helpers can accept any arguments.

```python
def apply(ctx):
    ctx.set("power", "value", ctx.get("power", "value"), persist=True)
    ctx.emit("updated")  # events = {"updated": "refresh"}

def refresh(ctx):
    ctx.set("lamp", "color", "green" if ctx.get("power", "value") else "red")
```

An external trusted client can POST {"name":"updated"} to /api/widgets/ID/events. Send the project snapshot's revision to reject an event from an obsolete interface.

If the project declares settingsChanged in events, saving functional parameters through the instance form invokes it with the proposed settings. The settings and handler result commit together. A regular handler can call ctx.emit("settingsChanged") after ctx.set_setting to run the same update.

## Scheduling and charts

Set the periodic handler to a function name. Background mode runs on the server even with every browser closed. While visible requires a visible instance on at least one client. Events only disables scheduling. The interval is 1–86400 seconds. Each instance can override the mode and interval. On startup or resumption, the first tick is eligible immediately. Invocations on one instance are serialized. Up to three periodic handlers can run concurrently. Samples may be delayed under load.

ctx.sample(series, value) appends a finite number with a server Unix timestamp and returns None. Series names begin with a Latin letter and can contain letters, digits and underscores, with a 64-character limit. SQLite retains the latest 3600 samples per series per instance. ctx.history(series, limit=120) returns up to limit [time, value] pairs, oldest first, including points appended during this call. The limit is 1–3600. Pass the pairs to the points property of line-chart.

```python
from math import sin
from time import time

def measure(ctx):
    value = round(50 + 30 * sin(time() / 12), 1)
    ctx.sample("signal", value)
    ctx.set("current", "text", str(value))
    ctx.set("plot", "points", ctx.history("signal", 240), persist=True)
```

## HTTP, assets and integrations

Python makes HTTP requests from the host. This example assumes an endpoint setting and a JSON response containing temperature. Set a timeout below the invocation deadline.

```python
import json
from urllib.request import urlopen

def read_sensor(ctx):
    with urlopen(ctx.setting("endpoint"), timeout=3) as response:
        reading = json.load(response)["temperature"]
    ctx.set("temperature", "text", f"{reading} °C")
```

ctx.asset(name) returns a pathlib.Path to an existing file under the project's assets directory. A missing or out-of-directory path raises FileNotFoundError. A React element can resolve raster icons through its own asset function.

ctx.invoke(name, *args) runs an installed host operation. The editor lists operation names and argument counts. Install integrations/NAME/operations.json and restart the backend. Each key describes an operation with argv starting with an absolute executable path, and inputs giving the number of additional arguments. A test definition is {"echo":{"argv":["/usr/bin/echo"],"inputs":1}}. If installed under demo, ctx.invoke("demo/echo", "hello") returns the output string. Each argument is a separate program argument. Objects are JSON encoded. The timeout is five seconds. Errors include KeyError, ValueError, OSError and subprocess exceptions. Compose operations and select arguments in ordinary Python functions bound to buttons, internal events or timers.

## Execution and diagnostics

One invocation has eight seconds of wall time, six seconds of CPU with a seven-second hard limit, and a 384 MiB address-space limit. A result is limited to 2 MiB and a JSON property to 256 KiB of serialized text. These are resource bounds for trusted code. Python executes with the backend user's privileges. Install projects and elements from trusted sources. A project or configuration edit during a long-running function invalidates its stale results. Deleting an instance removes its samples and properties.

Check Python validates syntax and bound function names. Preview lets you interact with elements, switch views and run a periodic handler manually. The test instance has separate properties and history. External operations in preview code really execute. Place sample-monitor on a desktop to test monitoring with every browser closed.
