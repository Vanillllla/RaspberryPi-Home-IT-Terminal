# Authoring a widget project

## Build the first widget

Open Create widget. The designer starts with an empty project. In Project, choose a permanent folder ID and enter English and Russian names and descriptions. IDs start with a lowercase Latin letter and allow digits and hyphens. The ID is fixed on first save. Use Library to reopen a saved project.

1. In Design, select Widget. Click Text in the palette or drag it onto the canvas. Set its ID to `message` and set its initial text in the inspector. Add a button with the ID `refreshButton`. The tree can select overlapping elements.
2. Select the button, type `refresh` next to onClick, then select Create function. Replace pass with the statement below. Define helpers in the same module. Use Go to function for an existing handler.
3. Select Check Python, then Preview. Clicking the test instance should update the text. The draft is still local to the editor. Test values belong to the current preview.
4. Save project, close the designer and select the project under + Widget. Add a second instance and compare their values.

```python
def refresh(ctx):
    ctx.set("message", "text", "OK", persist=True)
```

## Canvas and views

One desktop cell corresponds to 96 × 96 logical pixels. Select the root to change Widget dimensions in cells. Details and Settings each have their own logical pixel dimensions. Changing height adds or removes vertical space. Node rectangles retain their geometry. Zoom uses the same scale on both axes. Scroll to edit a large canvas.

Select a node on the canvas or in the tree. Drag the node or its bottom-right handle to move or resize it. Free placement snaps to an 8 px grid and the edges and centers of nearby siblings. Enter exact X, Y, width and height in the inspector. Backward and Forward change stacking or flow order. Coordinates are relative to the parent. Palette buttons, the tree, geometry fields and the parent selector support keyboard input. On touchscreens tap a palette item and move it on the canvas.

Add a Container. When a container is selected, new nodes become its children. The Parent selector reparents existing nodes. Fixed layout uses coordinates. Row and Column use child order, a gap and cross-axis alignment. Grow to fill distributes surplus length. Select Row or Column on the view itself for a responsive root.

Use the Details and Settings tabs to create optional views. All node IDs must be unique across every view and container in the project. IDs begin with a Latin letter and allow letters, digits and underscores. Update Python references when renaming nodes. Reusing an old ID reconnects that node to retained instance properties for the ID. Events from any view update the same instance. The arrow in the card header opens Details. The ⋯ menu opens Settings alongside individual appearance and execution options.

## Author a folder by hand

Create or copy a directory under widgets/. A minimal project needs manifest.json and logic/main.py. Put raster resources in assets/ and author notes in README.md. The folder name must equal the project ID. Stop the backend before editing files by hand and start it again to rediscover them.

```json
{
  "apiVersion": 1, "id": "hello-panel", "version": "1.0",
  "name": {"en": "Hello", "ru": "Привет"},
  "description": {"en": "Event example", "ru": "Пример события"},
  "width": 3, "height": 2, "logic": "logic/main.py",
  "views": {"widget": {"nodes": [
    {"id": "message", "type": "text", "frame": {"x": 8, "y": 8, "w": 220, "h": 48}},
    {"id": "refreshButton", "type": "button", "frame": {"x": 8, "y": 72, "w": 150, "h": 48},
     "props": {"text": "OK"}, "events": {"onClick": "refresh"}}
  ]}}
}
```

views.details and views.settings may be omitted or null. A node contains type, id, frame, props, events and optionally children and layout. Width w and height h are positive. Coordinates are nonnegative. Widget dimensions range from 1–12 × 1–24 cells. Other views use views.<name>.width and height. Layout and stacking order belong to the project.

The metadata fields author, version and icon describe ownership, the package version and an optional raster icon in assets. The strings table maps source text to {"ru":"…","en":"…"} for properties marked localized by their modules. The dependencies object contains elements, python and host lists. Saving includes referenced element types. The owner installs any required Python packages in the backend environment. Installed host operation names appear in the designer's reference.

The editor writes Python to logic/<hash>.py and atomically replaces manifest.json last, pointing logic at this source. Follow the current logic field when editing files manually. This publishes the UI and code as one revision. User files, notes and assets stay in the folder. Copy the whole folder to transfer the project. Concurrent saves based on obsolete revisions return HTTP 409 and retain the draft in the editor.

## Instances, layout conflicts and sync

SQLite holds desktops, placements, allowed appearance overrides, functional settings, durable properties and series. Each placement caches project width and height for collision detection and missing-project placeholders. When a project changes size, the engine leaves unrelated projects in place, tries to keep existing slots, then finds free rectangles for displaced instances. A conflict identifies the desktop that needs free space. Move another card or free space and save again.

In Project, choose the default title, title visibility and the two background colors. Instance settings can override or inherit these values. Declare functional parameters in settings using a type, bilingual labels and a default. Read and update them with ctx.setting and ctx.set_setting. Use the secret type and the instance password field for credentials. Temporary properties live in server memory. The shared WebSocket invalidates REST snapshots when a revision changes.

Removing an element leaves a placeholder with its type ID. The project retains the node, frame and settings. Removing a project preserves its instance placement and project ID. Restore the folder and restart the affected processes.

## Four working examples

- signal-lab reads a switch and slider in a button handler. Its result persists and the indicator color is temporary.
- station-panel connects Settings, Details and Widget. Change the station name in Settings and press Enter. Run the check in Details and compare a second instance.
- sample-monitor writes a series every two seconds. Details shows a time-labeled chart. Close all browsers, wait and reopen the dashboard. Then override the instance to While visible and repeat.
- gauge-lab drives the separately installed circular-gauge module. Stop the server, temporarily move the element folder outside elements/, restart the backend and rebuild the frontend. Inspect the placeholder, then restore the folder and repeat.

See the [Python API reference](PYTHON_API.md) for signatures, errors and examples. See the [element guide](ELEMENTS.md) to author a new component type.
