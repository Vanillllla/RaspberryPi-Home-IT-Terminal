# RaspberryPi-Home-IT-Terminal roadmap

The proposed development sequence follows the [project vision](PROJECT_VISION.md). The scope of each new iteration is agreed separately.

## Completed iterations

Stage 1 established a Debian/WSL development setup, desktops and SQLite persistence, plugin discovery, Clock, and the Widget/Details/Settings contract with an optional Python backend. The original development sequence is retained below; when selecting a new phase, consider the work already completed from items 1–5. For startup instructions, see the [README](../../README.md).

Stage 2 introduced desktop swipes using touch and mouse, button/keyboard navigation, cancellable long-press dragging, and selecting a vacant cell. Placement is stored in the existing `slot` field. Resizing, duplication, and appearance editing were initially deferred.

Stage 3 applied the v1 plugin contract to a second plugin implementing Widget, Settings, and Details. The ⋯ menu manages individual instances, including removal and freeing their cells.

A later iteration implemented a square-cell grid, per-instance dimensions, and drag-and-drop snapping.

The first visual builder stores shared templates in SQLite. It supports basic elements, timer/command bindings, built-in actions, and Python execution in a separate process.

## 0. Establish requirements

**Acceptance:** A complete project vision, persistent development instructions, and a roadmap with verifiable outcomes exist in the repository.

## 1. Launch an empty core in WSL

Start FastAPI and a React/TypeScript desktop shell. Introduce centralized design tokens for a responsive interface. Document local startup commands.

**Verification:** On Debian under WSL the application runs without Docker and with an empty plugin directory. An empty desktop opens in a Windows browser and the REST API responds.

## 2. Persist desktop state

Define SQLite tables and REST endpoints for one profile, its desktops, and widget instances. Store the plugin identifier independently of whether its files are installed. Each WidgetInstance holds an ID, desktop, position, size, functional settings, and appearance.

**Verification:** Create two instances of the same plugin through the API on different desktops. Change the settings and location of one, restart the server, and retrieve both. Only the selected instance should have changed.

## 3. Integrate the first independent plugin

Document the manifest and the Widget, Details, Settings, and optional Python backend entry points, including resources and dependencies. Discover plugin directories under `plugins/`. Use a clock/date plugin to validate installation without core changes. Frontend rebuilds and backend restarts are acceptable at this stage.

**Verification:** Add Clock without editing the core. Removing its directory leaves placeholders; restoring it brings the same instances and settings back. A failing test plugin must not disable Clock or the desktops.

## 4. Implement navigation and grid editing

Provide independent desktop pages, horizontal touch and mouse swipes, Ctrl + Left / Ctrl + Right shortcuts, instance creation/removal, long-press dragging, and resizing.

**Verification:** Place two widgets, move one, resize it, and reload the page. Layout is preserved. Repeat basic actions with both touch and mouse. The mouse wheel does not change desktops.

## 5. Verify widget views and complete the MVP

Connect optional Details and Settings to the shell. Check that each instance's functional settings remain independent of appearance. Validate responsive cards on a 7–10-inch landscape screen.

**Verification:** Open Details near full-screen and close it to return to the same desktop. Change the settings of only one instance. Clicking within a widget must not start dragging or switch desktops. Repeat with a Widget-only plugin. Test access from a trusted local network within the security boundaries of the project vision.

## 6. Deploy to Raspberry Pi 5

Move the verified application to Raspberry Pi 5 with 8 GB RAM. Add systemd-based startup and Chromium kiosk mode. Check layout and gestures on a physical landscape display.

**Verification:** After a reboot, the terminal automatically opens its saved desktop. A second device can access the UI over LAN or a configured trusted VPN.

## 7. Develop integrations one at a time

Select individual phases for Hysteria 2 reachability, Proxmox/resource monitoring, Home Assistant, LAN monitoring, or custom HTTP/API integration. Use WebSockets when low-latency updates are necessary. Process secrets on the server.

**Verification for each integration:** Install the plugin through the published contract. Verify both normal data and an unavailable data source. Other widgets remain functional.

## Long-term directions

Prioritize these phases after validating the core in real scenarios:

- Add server-managed profiles with manual selection and automatic selection by screen size/device class. Verify independent desktops and settings are restored.
- Expand appearance to themes, wallpapers, and instance-specific options. Verify functional settings survive theme changes.
- Expand the security and plugin-delivery model. Agree on authentication, permissions, dependencies, and execution isolation before dynamic ZIP installation or a public plugin marketplace.
- Expand the visual builder and Python handler editor. Verify that a widget created in the builder uses the same common plugin contract.
