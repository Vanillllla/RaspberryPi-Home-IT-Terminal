# Creating an importable widget for RaspberryPi-Home-IT-Terminal

**The output is a folder containing exactly one `template.json` file.** This file defines a shared template for the visual builder. Importing it adds the template to the catalog; users then add separate instances to their desktops. The elements and their internal positions belong to the shared template. The outer card's desktop location, size, appearance, and current values belong to each instance.

## Folder and ZIP archive

```text
hello-card/
└── template.json
```

The author chooses the folder name. The lowercase filename `template.json` is fixed and required; the package format contains no additional files. Save valid UTF-8 JSON without comments or trailing commas. Even Python action code is stored as a JSON string.

To create a ZIP, run the command from the directory **containing** the widget folder. For the first example this produces an archive entry `hello-card/template.json`:

```bash
python3 -m zipfile -c hello-card.zip hello-card/
```

The archive must contain one ordinary file exactly one directory deep. A directory entry itself is allowed. Exclude auxiliary files such as `.DS_Store`. Use relative paths separated by `/`. The importer rejects absolute paths, `.` and `..` components, drive prefixes, backslashes, and symbolic links. Unencrypted ZIP files using **Deflate** or **Stored** compression are supported. Both the uploaded archive and the extracted JSON are limited to 8 MiB each.

## Template fields

The JSON root must be an object. Types are validated strictly: for example, an interval of one second is the number `1`, and an enabled switch is the boolean `true`.

| Field | Type / required | Meaning |
|---|---|---|
| `id` | string, required | Unique template ID matching `^template:[0-9a-f]{32}$`: 32 lowercase hexadecimal digits without hyphens after the prefix. |
| `name` | string, required | Catalog and card title, 1–100 characters, containing at least one non-whitespace character. |
| `rows` | array of arrays of objects, required | 1–64 rows and 1–128 elements in total. |
| `actions` | array of objects, required | At most 64 actions; use `[]` for a static card. |
| `description` | string, optional | Catalog description, up to 2000 characters, trimmed on import; empty by default. |
| `defaultWidth`, `defaultHeight` | integers, optional | Initial instance size in desktop cells: width 1–12 (default 4), height 1–2732 (default 2). The visible grid must contain enough free space. Changing the template affects future instances. |
| `revision` | integer, optional | Internal revision. Omit it in a new package. The first import uses revision `1`; importing again after a deletion increases the last stored revision. |

Generate a unique ID for a **new** template, for example:

```bash
python3 -c 'import uuid; print("template:" + uuid.uuid4().hex)'
```

Importing an ID that is already installed is rejected, even if the folder name differs. Edit installed templates using the visual builder.

### Rows, columns, and elements

For a new card, place all elements in an inner array inside `rows`. Give each element a `frame`, for example `"frame": {"x": 2, "y": 1, "width": 8, "height": 3}`. The frame is a rectangle of fine cells beneath the card header. The top-left coordinates are zero-based nonnegative integers; width and height are positive integers. Each desktop cell contains five fine divisions along each axis: a 4×2 card therefore provides 20×10 fine cells. Frames may touch edges, but cannot overlap or exceed the bounds. Relative layout is preserved when the instance is resized.

Text, buttons, input fields, and switch/slider labels accept `fontSize` in points (integer 1–144, default 12) and `fontFamily` (`system`, `serif`, or `monospace`). Resizing a frame changes the available room, not the font size. Excess text is clipped. An empty switch or slider label leaves more room for its control.

Legacy packages may use automatically arranged rows, `cell` coordinates in coarse cells, and `span` widths 1–12. The builder converts these layouts to frames for editing. For new frame-based packages, define a `frame` on every element and omit `cell` and `span`.

Every element requires the strings `id`, `kind`, and `label`. Its ID must match `^[A-Za-z][A-Za-z0-9_-]{0,63}$` and be unique across **all** rows. The label is up to 2000 characters. Bindings refer to IDs, so labels can change safely.

| `kind` | Behavior and additional fields |
|---|---|
| `text` | Displays its `label` until an action supplies a result. Without a bound action the text is static. |
| `button` | Displays its `label`, optionally sending the string `command` when clicked. |
| `switch` | Labeled toggle. Initial boolean `checked` defaults to `false`; changing it may send a `command`. |
| `slider` | Labeled slider. Numeric `minimum`, `maximum`, `step`, and `initial` default to 0, 100, 1, and 0. Changing it may send a `command`. |
| `indicator` | Colored dot with an accessible label/tooltip. Initial `color` is `green`, `yellow`, or `red` (default `green`). |
| `input` | One-line field. `inputMode`: `text` (default), `number`, `ipv4`, `date`, or `time`. An optional `placeholder` has a 200-character limit; empty uses a format-specific default. Optional `resetCommand` (up to 100 characters) clears the field after a matching command. |

Slider values must be finite, `minimum < maximum`, and `step > 0`. The initial value must be inside the range and aligned to a step from the minimum. For example, 0.5 is valid between −1 and 1 with a step of 0.25. The `command` of any sender defaults to an empty string and is limited to 100 characters.

## Actions and result targets

An input field stores up to 2000 characters separately for each card instance. `number` accepts digits and one decimal point without range validation. Dates are sent as `YYYY-MM-DD`, times as `HH:MM` in 24-hour format. IPv4 displays four dot-separated sections, each accepting 0–255; an incomplete address is passed as the entered string. Python actions read values by element ID in `context["values"]`. If `resetCommand` matches a sender command on the same card, the input clears 500 ms later and shows its placeholder again. Actions receive the value as of command dispatch; changes typed during the delay are preserved.

Each item in `actions` requires:

| Field | Type / values |
|---|---|
| `id` | Unique string among actions, following the same ID rules as elements. |
| `name` | Editor-facing action name, 1–100 characters. |
| `kind` | `time`, `reach`, `http`, or `python`. |
| `trigger` | `command` or `timer`. |
| `targets` | Up to 128 result mappings. A command-triggered Python action may have an empty array. All other actions need at least one target to execute. |

### Update modes

**No updates:** Leave the element out of every `targets` array. Text displays its `label`; an indicator displays its initial `color`. There is no JSON binding for this mode.

**On command:** Set `"trigger": "command"` and a nonempty `command` string of at most 100 characters. Send the case-sensitive command through Python `emit`, or put it in the `command` field of a button, switch, or slider. Buttons dispatch on click; switches and sliders on value change. Every matching action with targets runs in that instance, as do targetless Python actions. Results are saved to SQLite per instance. Use distinct commands and action IDs for independent pairs.

**On timer:** Set `"trigger": "timer"` with optional integer `interval` between 1 and 86400 seconds (default 1). The action executes immediately on the active desktop, then periodically. Timers pause when switching desktops, hiding the browser tab, or opening the builder. A tick is skipped if the previous execution is still running. Timer outputs remain in memory. Example for the text element `clockText`:

```json
{"id":"tick","name":"Update clock","kind":"time","trigger":"timer","interval":1,"targets":[{"element":"clockText"}]}
```

**Targets:** Every `targets` object requires an `element` ID of an existing `text` or `indicator`. The optional `field` string (up to 256 characters) selects part of the result. Omitting it, or setting `""`, selects the whole result. Dots traverse object properties and decimal indices select array elements, for example `sensors.0.value`. A text element can display `{"text": "98", "color": "red"}` as a red 98. For colored text, return an object with **exactly** `text` (string or number) and `color` (`green`, `yellow`, or `red`). To show only the number with normal text styling, set the target `field` to `text`. Other strings display unchanged; other JSON values are serialized to text. An indicator result must be exactly `"green"`, `"yellow"`, or `"red"`.

One action can update multiple targets; each target element may only occur once in the entire template. In the builder, selecting **On command** or **On timer** for an unbound element creates a separate action. Use **Update action** for a shared binding. **Create separate action** clones the shared configuration for one target. When cloning a command-triggered action, update the sender's command too.

### Action kinds and results

| `kind` | Input | Result |
|---|---|---|
| `time` | No extra fields. | A server-local-time string in `HH:MM:SS` format. Assign the whole string to text. |
| `reach` | `host`: hostname or IP without a URL scheme, up to 253 characters. Missing or null `port` uses ICMP (`iputils-ping` required on Debian). Integer `port` 1–65535 selects TCP. | An object with `available` (boolean), `text` (available/unavailable, localized), and `color` (`green`/`red`). |
| `http` | `url`: HTTP(S) URL with a hostname. The server GETs up to 1 MiB of JSON. Optional `path` (e.g. `cpu.temperature`) selects a value. | Selected value, or the entire JSON if `path` is empty. Target `field` is applied **after** `path`. |
| `python` | `code`: string of up to 32768 characters containing `def run(context)`. Represent newlines as `\\n` inside JSON. | Whatever the function `return`s, provided it is JSON-serializable. Returning a dictionary makes it easy to route individual fields to different targets. |

Python's `context["values"]` holds element values for the current instance, including switch booleans, slider numbers, and input strings. The fields `context["instance_id"]`, `context["template_id"]`, and `context["action_id"]` are also available. `math`, `datetime`, `statistics`, `json`, and `re` are preloaded. The function runs in a restricted separate Debian process with a four-second timeout. Use the built-in actions for network requests. `print()` output is diagnostic information shown on the card.

A `run(context)` function may dispatch another command in the same instance. For example, a button sends `refresh`; its handler branches according to the switch named `enabledSwitch`:

```python
def run(context):
    if context["values"]["enabledSwitch"]:
        emit("read_sensor")
    else:
        emit("show_idle")
```

Define matching command-triggered actions named `read_sensor` and `show_idle`. Their command values must match `emit` arguments exactly, including case. The branching action should have `"targets": []`. It is possible to call `emit` and also `return` a result. After a result is handled successfully, emitted commands run in dispatch order, including nested steps. Each step sees updated outputs and the inputs captured when the chain began. A command can also reset an input. Unknown commands, step errors, loops, or more than 64 action executions halt the chain with a card message.

On import, the backend validates structure, references, and Python syntax. Actions only run on a deployed instance: use a card on a desktop to test execution errors or missing result fields.

## Example 1: Static greeting card

Create **`hello-card/template.json`** with this complete content:

```json
{
  "id": "template:fba592d8d6854c808a50c9abc211eb14",
  "name": "Greeting",
  "rows": [
    [{"id": "greeting", "kind": "text", "label": "Welcome home!", "frame": {"x": 1, "y": 1, "width": 18, "height": 5}}]
  ],
  "actions": []
}
```

## Example 2: Check a button/action connection

Create **`command-check/template.json`**. This checks local card updates without an external service:

```json
{
  "id": "template:b90cd6aa039f49459af72cc39466ece2",
  "name": "Action check",
  "description": "Update the message and indicator color when pressed.",
  "rows": [
    [{"id": "checkButton", "kind": "button", "label": "Check", "command": "refresh", "frame": {"x": 0, "y": 0, "width": 9, "height": 4}}],
    [
      {"id": "statusText", "kind": "text", "label": "Waiting for check", "frame": {"x": 0, "y": 5, "width": 15, "height": 4}},
      {"id": "statusLight", "kind": "indicator", "label": "Check result", "color": "yellow", "frame": {"x": 16, "y": 5, "width": 3, "height": 3}}
    ]
  ],
  "actions": [
    {
      "id": "check",
      "name": "Confirm execution",
      "kind": "python",
      "trigger": "command",
      "command": "refresh",
      "code": "def run(context):\n    return {'message': 'Check passed', 'color': 'green'}",
      "targets": [
        {"element": "statusText", "field": "message"},
        {"element": "statusLight", "field": "color"}
      ]
    }
  ]
}
```

A new instance initially shows "Waiting for check" and a yellow dot. Click **Check**. The `refresh` command runs `check` once. The `message` field becomes "Check passed" and `color` turns the dot green.

## Example 3: Two independent buttons and time stamps

Save this template as **`two-buttons/template.json`**. Each button updates only its own text with the current server time. Clicking **Second** does not change the previous first time:

```json
{
  "id": "template:041fb3d735764aa8bc829ab0f5964ac3",
  "name": "Two time stamps",
  "rows": [[
    {"id": "firstText", "kind": "text", "label": "First time", "frame": {"x": 0, "y": 0, "width": 12, "height": 4}},
    {"id": "firstButton", "kind": "button", "label": "First", "command": "refresh_first", "frame": {"x": 12, "y": 0, "width": 8, "height": 4}},
    {"id": "secondText", "kind": "text", "label": "Second time", "frame": {"x": 0, "y": 5, "width": 12, "height": 4}},
    {"id": "secondButton", "kind": "button", "label": "Second", "command": "refresh_second", "frame": {"x": 12, "y": 5, "width": 8, "height": 4}}
  ]],
  "actions": [
    {"id": "stampFirst", "name": "First time", "kind": "time", "trigger": "command", "command": "refresh_first", "targets": [{"element": "firstText"}]},
    {"id": "stampSecond", "name": "Second time", "kind": "time", "trigger": "command", "command": "refresh_second", "targets": [{"element": "secondText"}]}
  ]
}
```

## Installation and adding instances

**Using the UI:** On a desktop select **Create widget → Import template**. Choose **Select folder** and pick the `hello-card` folder itself, or **Select ZIP** and choose an archive containing that folder. After import, **Open in builder** allows you to inspect or edit the template.

**Manually:** Copy the folder to `template-packages/<folder-name>/template.json` relative to the repository root. For example: `/home/user/Projects/RaspberryPi-Home-IT-Terminal/template-packages/hello-card/template.json`. Stop the previous backend with Ctrl+C and restart it from the repository root:

```bash
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

The backend checks packages at startup and imports new templates to SQLite. Rejections are logged. If the ID is already installed, its saved version and builder edits remain unchanged.

**Add an instance:** Select the desired desktop, click **+ Widget**, and choose the template from the catalog. Repeat to create a second instance. Reopen the shared definition using **Create widget → Template**.

**Delete a template:** Select it in the builder, press **Delete template**, and confirm. Existing instances become placeholders. Startup discovery skips packages marked as deleted. To restore, upload a package using the same ID through the UI.

## Prompt for another AI assistant

> Using the WIDGET_AUTHORING.md guide, create an importable widget for RaspberryPi-Home-IT-Terminal. Widget requirements: [describe what the user sees, which controls they use, and expected results]. Return the complete package directory tree and the full, unabridged contents of the only template.json file in a JSON code block. Generate a new valid template ID. Set a fine-cell frame on every element. Verify boundaries, overlaps, field types, unique IDs, matching commands, and the result field assigned to each target.
