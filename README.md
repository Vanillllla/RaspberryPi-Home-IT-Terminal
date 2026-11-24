# RaspberryPi-Home-IT-Terminal

[Русский](#русский) · [English](#english)

## Русский

Сенсорная панель для Raspberry Pi 5 с несколькими рабочими столами и визуальным конструктором. Виджет состоит из декларативных представлений Widget, Details, Settings и модуля Python. Один проект можно разместить на нескольких столах. Библиотека элементов расширяется отдельными React-модулями.

### Запуск в Debian WSL2

Нужны Python 3.11+, python3-venv, Node.js 22.12+ и npm, установленные внутри Linux. Выполняйте команды из корня репозитория. Для первого запуска:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
```

В первом терминале запустите один процесс FastAPI:

```bash
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Во втором запустите интерфейс:

```bash
npm --prefix frontend run dev
```

Откройте http://localhost:5173 в браузере Windows. Кнопка «+ Виджет» открывает библиотеку, «Создать виджет» — конструктор и редактор существующих проектов. Через настройки панели доступны русский и английский языки. Ctrl + ←/→ переключает столы, ручка на карточке позволяет её переместить. Для сенсорного ввода поддерживаются свайп и удержание. Оба сервиса можно остановить через Ctrl+C. Для повторного запуска нужны только две команды запуска.

### Необязательный запуск через Electron

Для встроенных веб-виджетов установите отдельную оболочку: `npm --prefix electron install`. Запустите backend и Vite на `127.0.0.1:5173`, затем `npm --prefix electron start`. Подробности и ограничения: [Electron](docs/ru/ELECTRON.md).

### Архитектура

| Каталог | Назначение |
| --- | --- |
| widgets/ | Папка проекта с manifest.json, исходником Python и ресурсами |
| elements/ | Контракт свойств и событий в manifest.json, React-реализация в Component.tsx |
| integrations/ | Необязательные установленные на хосте описания операций для Python |
| backend/ | FastAPI, публикация проектов, планировщик, процессы Python, SQLite и уведомления WebSocket |
| frontend/src/engine/ | Единый рендерер представлений и контракт React-элемента |
| frontend/src/designer/ | Холст, дерево, палитра, инспектор, редактор Python, справка и предпросмотр |
| archive/ | Исторические исходники из v0.4.0 |

SQLite по умолчанию создаётся в backend/data/engine.sqlite3. Прежняя terminal.sqlite3 остаётся в своём файле. В новой базе находятся экземпляры, отдельные настройки и оформление, сохраняемые свойства и история. Временные свойства живут в памяти сервера. Изменения файлов через конструктор видны сразу во всех экземплярах. Изменения вручную на диске и новые пакеты обнаруживаются при запуске backend. После добавления React-элемента перезапустите Vite или пересоберите frontend.

Снимок состояния доступен через GET /api/state, описание REST — по адресу http://127.0.0.1:8000/docs. Существующий канал /api/events сообщает клиентам о новых ревизиях и принимает видимость их экземпляров. Браузер сохраняет собственную навигацию и черновики. В режиме «В фоне» сервер продолжает выполнять Python при закрытых браузерах. Для локальной проверки используйте один процесс Uvicorn. При проксировании внутри доверенной сети передавайте и HTTP, и WebSocket Upgrade. Авторский Python выполняется с правами пользователя backend. Платформа предназначена для доверенного кода и доверенной сети.

Настраиваемые пути — TERMINAL_DB, TERMINAL_WIDGETS, TERMINAL_ELEMENTS и TERMINAL_INTEGRATIONS. TERMINAL_API меняет адрес backend в прокси Vite. Каталог модулей в сборке Vite — elements/ в корне проекта. При запуске дополнительного стенда задайте отдельные порты, базу и каталог проектов.

[Руководство автора виджетов](docs/ru/WIDGET_AUTHORING.md) · [Разработка элементов](docs/ru/ELEMENTS.md) · [Справочник Python API](docs/ru/PYTHON_API.md) · [Концепция](docs/ru/PROJECT_VISION.md) · [Дорожная карта](docs/ru/ROADMAP.md)

### Проверки

```bash
.venv/bin/python -m pip install -r backend/requirements-test.txt
.venv/bin/python -m unittest discover -s backend/tests -v
npm --prefix frontend run build
```

Проверьте четыре примера из библиотеки. «Проверка сигнала» связывает входы с обработчиком, «Панель станции» показывает общее состояние трёх представлений, «Монитор значений» пишет историю в фоне, «Круговая шкала» использует самостоятельный элемент. Тесты backend используют временные каталоги и базы.

Для проверки конструктора запустите панель и выполните в Windows PowerShell из корня проекта команду `node --test frontend/tests/designer.test.mjs`. Требуются Node.js и Microsoft Edge в Windows. Тест собирает черновик из палитры, меняет высоту холста, создаёт Python-обработчик и проверяет быстрые переключения и отклонённый ввод в предпросмотре. Адрес панели задаётся через `TERMINAL_UI_URL`, канал установленного браузера — через `PLAYWRIGHT_CHANNEL`.

## English

A touchscreen dashboard for Raspberry Pi 5 with multiple desktops and a visual widget designer. Each project contains declarative Widget, Details and Settings views and a Python logic module. Place the same project multiple times for independent instances. Separate React modules extend the element palette.

### Run on Debian under WSL2

Install Python 3.11+, python3-venv, Node.js 22.12+ and npm inside Linux. From the repository root, prepare the environment once:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
```

Run one backend process in the first terminal:

```bash
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Start the frontend in the second terminal:

```bash
npm --prefix frontend run dev
```

Open http://localhost:5173 in a Windows browser. + Widget opens the library. Create widget opens the designer for new and existing projects. Panel settings switches between English and Russian. Use Ctrl + Left/Right or swipe to switch desktops. Use the card handle to move an instance. Stop services with Ctrl+C. Subsequent sessions require just the two start commands.

### Optional Electron launch

For native web widgets, install the separate shell: `npm --prefix electron install`. Start the backend and Vite on `127.0.0.1:5173`, then `npm --prefix electron start`. See [Electron setup and limitations](docs/eng/ELECTRON.md).

### Project layout

widgets/ holds project folders with manifests, Python and assets. elements/ holds independent element manifests and React components. Optional host adapters live in integrations/. backend/ handles FastAPI, project publication, scheduling, Python execution, SQLite and shared WebSocket notifications. frontend/src/engine/ provides the renderer. frontend/src/designer/ provides the canvas, tree, palette, inspector, Python editor, reference and preview. archive/ contains historical v0.4.0 source.

The default database is backend/data/engine.sqlite3. The old terminal.sqlite3 remains separate. SQLite holds placements, instance configuration, appearance overrides, durable properties and samples. Temporary properties live in server memory. Saving in the designer updates all instances live. Restart the backend after manual edits or package installation. Restart Vite or rebuild the frontend after adding React elements.

GET /api/state returns the shared snapshot. Open http://127.0.0.1:8000/docs for the REST schema. The existing /api/events WebSocket delivers revision notifications and receives instance visibility. Each browser retains its local navigation and drafts. Background-mode handlers run on the host after browsers close. Use one Uvicorn process. Forward both HTTP and WebSocket upgrades when serving a trusted network. Author Python runs with the backend account's privileges. Operate the dashboard with trusted code on a trusted network.

Configure paths with TERMINAL_DB, TERMINAL_WIDGETS, TERMINAL_ELEMENTS and TERMINAL_INTEGRATIONS. TERMINAL_API sets the Vite backend proxy target. Vite bundles modules from elements/ in the repository root. Use separate ports, a database and a widget directory for a second test installation.

[Widget authoring](docs/eng/WIDGET_AUTHORING.md) · [Element development](docs/eng/ELEMENTS.md) · [Python API reference](docs/eng/PYTHON_API.md) · [Project vision](docs/eng/PROJECT_VISION.md) · [Roadmap](docs/eng/ROADMAP.md)

### Verification

```bash
.venv/bin/python -m pip install -r backend/requirements-test.txt
.venv/bin/python -m unittest discover -s backend/tests -v
npm --prefix frontend run build
```

Exercise Signal bench for cross-element reads, Station panel for three-view state, Sample monitor for background history and Gauge control for an independently installed module. Backend tests use temporary paths and databases.

With the dashboard running, execute `node --test frontend/tests/designer.test.mjs` from the project root in Windows PowerShell with Node.js and Microsoft Edge installed. The test builds an unsaved draft from the palette, changes the canvas height, creates a Python handler and checks rapid toggles and rejected input in preview. Configure the dashboard URL with `TERMINAL_UI_URL` and the installed browser channel with `PLAYWRIGHT_CHANNEL`.
