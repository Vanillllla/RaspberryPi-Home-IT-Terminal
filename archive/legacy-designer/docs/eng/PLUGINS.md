# Plugin contract v1

At startup, the server discovers `plugins/*/manifest.json`. Vite discovers `plugins/*/index.tsx` modules and loads the React component when it is first displayed. The plugin ID is the folder name and must remain stable across versions: existing instances refer to that ID.

## Minimal example

Create `plugins/greeting/` containing these two files. In `manifest.json`:

```json
{
  "apiVersion": 1,
  "id": "greeting",
  "name": "Greeting",
  "version": "1.0.0",
  "description": "A short message on the desktop",
  "capabilities": []
}
```

Identifiers may contain lowercase ASCII letters, digits, and hyphens, and must begin with a letter. Export an object with a Widget component from `index.tsx`:

```tsx
import type { Plugin } from '@terminal/plugin'

export default {
  Widget: ({ instance }) => <p>Hello from desktop {instance.desktop_id}!</p>,
} satisfies Plugin
```

Restart the backend and Vite, refresh the browser, and select **+ Widget → Greeting**. To check the build, run `npm run build` from `frontend/`. CSS and other resources can be imported relative to the plugin directory; prefix styles to avoid collisions. React and React DOM are supplied by the frontend.

## Optional entry points

| Capability in the manifest | Entry point | Core behavior |
| --- | --- | --- |
| `details` | The exported object contains a React `Details` component | The **Details** button opens it over the desktop. |
| `settings` | The same object contains a React `Settings` component | A plugin-specific form appears in instance settings. |
| `backend` | `backend.py` exports a FastAPI `APIRouter` named `router` | The server mounts routes at `/api/plugins/<id>`. |

Instances contain `id`, `plugin_id`, `desktop_id`, `slot`, `width`, `height`, `settings`, and `appearance`. `slot` is the zero-based index of the upper-left cell in reading order. The state API returns `columns`, `max_rows`, and a server-derived `rows` count for each desktop. When creating, moving, or resizing an instance, the shell sends the number of rows visible in the current viewport as JSON `rows`. For older clients that omit it, the server derives enough rows for existing content, at least six. The default size is 4×2 square cells. The shell owns position and dimensions. `PUT /api/widgets/{id}/size` accepts positive integer `width` and `height` and preserves the upper-left cell. Overlaps or out-of-bounds changes return HTTP 409.

The ⋯ → Settings menu offers **Appearance**, **Size**, and **Content alignment** for every instance. Compact content alignment is stored as `appearance.horizontalAlign` (`left`, `center`, `right`) and `appearance.verticalAlign` (`top`, `center`, `bottom`). The shell applies these values; cards without them use legacy placement. `PUT /api/widgets/{id}/alignment` accepts both fields and merges them into the existing appearance object. Title and card palettes are stored in `appearance.titlePalette` and `appearance.cardPalette`. A single **Save** button updates everything through `PUT /api/widgets/{id}/configuration`. For plugins with `settings`, it also submits the plugin's HTML form, whose handler supplies the functional settings. Other buttons within the form should use `type="button"`.

The Settings component also receives `saveSettings(next)`. Pass the **complete** functional settings object, await the returned Promise, and handle errors inside the form. A successful save updates the core state. Types are defined in the [TypeScript contract](../../frontend/src/plugin.ts).

The working [developer-demo](../../plugins/developer-demo/index.tsx) illustrates all three views. When changing a label, its form sends `{ ...instance.settings, label }`. After an error, the entered value remains available for another attempt. Appearance is stored separately. The counter is local component state while it is mounted.

The shell owns the ⋯ menu. **Delete widget** calls `DELETE /api/widgets/{id}`, including for placeholders belonging to missing plugins. On success the backend returns the instance ID; an unknown ID returns HTTP 404. Deleting frees the former `slot` without moving other widgets.

Minimal `backend.py` for a greeting plugin declaring the `backend` capability:

```python
from fastapi import APIRouter

router = APIRouter()

@router.get("/message")
def message():
    return {"text": "Hello!"}
```

A component can call `fetch('/api/plugins/greeting/message')`. Python plugins execute within the FastAPI process and are only appropriate for trusted local code. Keep integration secrets on the server. The developer must install any additional dependencies in the relevant environment.

## Lifecycle verification

1. Add two instances and move one. Reload the page and check their positions.
2. Stop both processes and temporarily move the plugin folder outside `plugins/`. On restart, the original positions should show placeholders. The core must also run with no plugins.
3. Restore the folder and restart both processes. Instances with the same plugin ID recover their saved settings. Check backend logs if a manifest or Python module fails to load.

## Visual builder templates

The catalog also reads saved definitions from SQLite. Each template has an ID such as `template:<uuid>`, a shared card component, and a revision number. `WidgetInstance` still stores its placement and appearance. The colon-based template ID namespace does not conflict with v1 plugin folder names.

`POST /api/templates` creates a definition; `PUT /api/templates/{id}` updates it using the original revision. `POST /api/widgets/{id}/actions/{action_id}` invokes a saved action definition and validates the instance revision.

Text and indicator elements receive action results on commands or timers. Unbound elements display initial values. Commands are matched exactly to action `command` fields; actions target element IDs and optionally select a nested field of the result. Consult the [update modes and JSON examples](WIDGET_AUTHORING.md#update-modes) in the [template authoring guide](WIDGET_AUTHORING.md).

## Synchronizing plugin data

Record a notification in the same database transaction as the change. Call `conn.changed("plugin", widget_id, plugin="your-plugin-id")` on a connection from `backend.storage.database(write=True)`. If the operation changes `widgets.settings`, also call `conn.changed("widgets", widget_id)`. The database context publishes the revision after commit. Include identifiers only. Keep credentials on the server and fetch public profile data through the existing REST endpoints.

In React, import `onSharedChange` from `@terminal/plugin`. Subscribe inside an effect with `onSharedChange({ kind: 'plugin', plugin: 'your-plugin-id', id: instance.id }, refresh)` and return the unsubscribe callback. Use the notification to refresh saved data. Keep unsaved form inputs separate and check the version used to open the form before saving a replacement.
