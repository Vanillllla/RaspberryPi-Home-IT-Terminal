# Optional Electron launch (experimental)

The normal browser mode is unchanged. Electron connects to the existing local Vite and FastAPI processes. Requires a 64-bit OS (arm64 on Raspberry Pi 5), graphical session, Node.js 22.12+ and Chromium/GTK system libraries. Do not run as root or disable sandboxing.

From the repository root, follow the README installation steps, then:

```bash
npm --prefix electron install
npm --prefix electron test
```

Start the usual backend and a fixed loopback Vite server in separate terminals:

```bash
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

```bash
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

In a third terminal in the graphical desktop:

```bash
npm --prefix electron start
```

Subsequent sessions only need the three launch commands. Closing Electron does not stop the servers.

Add ChatGPT (6×4 cells) from the widget library. The Browser view element accepts an HTTPS URL and zoom. It renders native web content only in fully visible live desktop cards. Designer, Details, Settings and normal browsers show an external link. The external link always remains available. The persistent Electron web session is separate from your system browser. Sign in to ChatGPT directly. No OpenAI API, Codex, token extraction or page modification is used.

Popups, downloads and additional permissions are denied; known ChatGPT sign-in origins are allowed, but OAuth, CAPTCHA and actual ChatGPT sign-in and messaging need manual validation. The system browser fallback has a separate session. Up to three views are cached; hidden views can be evicted. Native views hide when clipped, during desktop transitions, dragging or dialogs; do not overlap them with other elements. Explicit local address blocking is not a network firewall.

Run npm --prefix electron test and npm --prefix frontend run build. Manually test signing in, sending messages, restarting Electron, switching desktops, dialogs, dragging, resizing and normal browser fallback. Restart Electron to retry failed loads. Electron 45.4.1 is isolated from frontend dependencies; regularly update to a patched version.
