# RaspberryPi-Home-IT-Terminal

## Overall project goal

Build RaspberryPi-Home-IT-Terminal, an open, modular web platform that turns a Raspberry Pi 5 into an interactive home IT terminal with a touchscreen.

The application should serve as an information dashboard, a monitoring system, and a general platform for user-created widgets.

GitHub: https://github.com/Vanillllla/RaspberryPi-Home-IT-Terminal

### 1. Development and deployment environment

Development takes place on Debian running under WSL on Windows. The interface is tested in a Windows browser.

The intended device is a Raspberry Pi 5 (8 GB RAM) with a 7–10-inch landscape touchscreen.

Requirements:

- Backend: Python and FastAPI.
- Frontend: React and TypeScript.
- Persistence: SQLite.
- Data updates: REST API; WebSocket where necessary.
- Local installation without Docker.
- Automatic startup on Raspberry Pi using systemd in a future phase.
- Browser access from other devices on a local network or a trusted VPN.
- Chromium kiosk mode as the primary Raspberry Pi usage mode.

### 2. Architectural philosophy

The main value of the project is its modularity and extensibility.

The core manages desktops, widget placement, configuration, saved state, profiles, the interface, and the extension lifecycle.

Widgets are independent plugins. The core should not contain logic specific to any particular widget.

Key requirements:

1. The application must start correctly with no plugins installed.
2. Installing a new plugin must not require manual changes to the core source code.
3. A failed or missing plugin must not break other widgets or desktops.
4. Missing plugins should appear as placeholders while preserving instance settings.
5. One plugin can have multiple instances with independent settings and appearance.
6. The architecture should allow a visual builder and a Python code editor to be added later.
7. The data model should accommodate future profiles, themes, appearance options, and component types.

Avoid premature abstraction and unnecessary complexity. Provide extension points without implementing speculative features.

### 3. Desktops

The interface resembles a minimalist Android home screen with widgets:

- Multiple independent pages.
- Horizontal swipe navigation.
- Mouse and keyboard navigation.
- Ctrl + Left / Ctrl + Right shortcuts.
- No desktop switching with the mouse wheel.
- Grid-based widget placement.
- Widget resizing.
- Dragging after a long press.
- Persistent positions after changes.
- Optional expanded views over the current desktop.

The touchscreen has priority, but all essential operations must also work with a mouse in a regular browser.

### 4. Plugin system

Each plugin lives in its own directory under `plugins/`.

Its structure should support:

- A manifest describing the ID, version, description, and capabilities.
- A React component for the compact widget.
- An optional React component for an expanded view.
- An optional settings component.
- An optional Python backend.
- Its own resources and dependencies.

Define a stable plugin contract and API so the platform can grow without constantly modifying the core.

Early phases may require rebuilding the frontend and restarting the backend when a plugin is installed. Dynamic package installation is a future goal.

### 5. Widget instance structure

Keep **Plugin** and **WidgetInstance** separate.

- **Plugin** describes functionality and source code.
- **WidgetInstance** is a specific placement of that plugin on a desktop.

An instance has its own ID, functional settings, appearance, size, position, and desktop association.

Functional configuration must not be tightly coupled to visual appearance.

### 6. Widget interfaces

Support three independent views:

- **Widget:** compact representation on the desktop.
- **Details:** optional near-full-screen expanded view.
- **Settings:** settings for one specific instance.

The expanded view opens above the current desktop, has a close button, and does not constitute a separate desktop page.

Controls inside widgets must remain interactive without interfering with drag or swipe gestures.

### 7. Appearance

The initial design is minimal, responsive, and uses tidy rounded cards.

Introduce centralized design tokens and separate appearance from functionality from the start.

Future capabilities may include themes, wallpapers, transparency, gradients, colors, dimensions, and per-instance appearance.

Do not implement complete customization in the initial version.

### 8. Profiles

One profile is sufficient initially, but the data model must not prevent more profiles.

In the future profiles will be saved on the server, each with its own desktops, widget layout, and display preferences.

A future mechanism should select a profile automatically by device size or class, with a manual override.

### 9. Security and access

The first version is intended for one user in a trusted local environment.

Authentication and action confirmations are outside the MVP. The MVP must not add potentially dangerous administrative actions against external systems.

Do not expose the application to the public internet. Future integration secrets must be handled on the server.

The architecture should allow authentication, authorization, plugin permissions, and execution isolation to be added later.

### 10. Planned integrations

Potential future plugins:

- Clock and calendar date.
- Reachability checks for Hysteria 2 VPN servers.
- Proxmox, virtual machine, CPU, RAM, and GPU monitoring.
- Home Assistant.
- Local network monitoring.
- Custom HTTP/API integrations.
- Additional plugins from third-party developers.

Each integration must remain independent of the core.

### 11. Future development

Maintain architectural room for:

- A graphical widget builder.
- A Python handler editor.
- Installing widgets from ZIP files.
- A public plugin library or marketplace.
- Permission and dependency management.
- Multiple profiles.
- Full appearance customization.
- Separate execution environments for complex plugins.

These are long-term directions, not requirements for the initial version.

## Project development rules

Work strictly in iterations. Do not attempt to implement the entire long-term vision in one request.

Before a substantial phase:

1. Review the current repository.
2. Determine the smallest practical scope.
3. Write a brief plan.
4. Implement only the agreed phase.
5. Check that it works.
6. Record the result and next steps.

Priority order:

1. Sound architecture.
2. Modularity.
3. Working functionality.
4. Maintainability and extensibility.
5. Visual appearance.
6. Additional features.

Do not add speculative functionality prematurely. Keep extension points available.

The long-term objective is a robust core in which new widgets can be developed, added, configured, and removed independently of the platform.
