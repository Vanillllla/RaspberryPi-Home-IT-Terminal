# RaspberryPi-Home-IT-Terminal

English | [Русский](#русский)

## Project description

RaspberryPi-Home-IT-Terminal is an open-source modular dashboard for a Raspberry Pi 5 touchscreen. It provides multiple desktops with draggable, resizable widgets, a visual widget/template builder, and independent plugins (including a clock and developer demo). Functional settings, layout, and template data are stored in SQLite. The backend uses Python/FastAPI; the frontend uses React/TypeScript with Vite.

The current repository supports local development on Debian/WSL2 and Linux, including Raspberry Pi OS on a Raspberry Pi 5. It is **not yet a finished, automatically booting Raspberry Pi kiosk**: systemd and Chromium kiosk startup must be configured separately. The dashboard has **no authentication** and should only be used on the device or on a trusted LAN/VPN, never directly exposed to the public internet.

Technical documentation: [plugins](docs/eng/PLUGINS.md) · [template authoring](docs/eng/WIDGET_AUTHORING.md) · [project vision](docs/eng/PROJECT_VISION.md) · [roadmap](docs/eng/ROADMAP.md).

Optional widgets: [WireGuard](plugins/wireguard/README.md#english) and [sing-box latency](plugins/sing-box-latency/README.md#english).

## First launch

### 1. Prepare the system

Use **Debian under WSL2**, Debian Linux, or **64-bit Raspberry Pi OS** on Raspberry Pi 5. You need Python **3.11+**, `python3-venv`, `git`, and Node.js **22.12+** (Node 22 LTS) with npm. Vite 7 also supports Node.js 20.19+, but Node 22 is recommended. Install Node **inside Linux**, not from the Windows installation mounted in WSL.

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip curl ca-certificates iputils-ping
python3 --version
node --version
npm --version
node -p process.platform
```

If Node.js/npm are missing or too old, install a supported Node.js release with [nvm](https://github.com/nvm-sh/nvm#installing-and-updating) in the Linux shell, then run `nvm install 22` and `nvm use 22`. In WSL the last command above must print `linux`, not `win32`. Node 22.12 or newer is required within the 22.x series.

Clone the project (or go to your existing checkout):

```bash
git clone https://github.com/Vanillllla/RaspberryPi-Home-IT-Terminal.git
cd RaspberryPi-Home-IT-Terminal
```

### 2. Install and start the backend — terminal 1

From the **repository root**:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Keep this terminal open. Initial startup creates the SQLite database at `backend/data/terminal.sqlite3` (override with `TERMINAL_DB` if needed). The backend API is available at `http://127.0.0.1:8000/docs`. The isolated Python action runner uses Linux features and `libseccomp2`; install it on Debian/Raspberry Pi OS if needed (`sudo apt install -y libseccomp2`). Untrusted Python code must not be run on this development-oriented system.

### 3. Install and start the frontend — terminal 2

From the **same repository root** in a second Linux terminal:

```bash
npm --prefix ./frontend ci
npm --prefix ./frontend run dev
```

Open `http://localhost:5173` in a browser **on the same device**, or from a Windows browser with WSL2 localhost forwarding. Check `http://localhost:5173/api/state` to verify the Vite proxy can reach FastAPI. Both services are bound to loopback by default, so other LAN devices cannot connect without an explicitly configured trusted-network proxy or forwarding. On Raspberry Pi OS open the URL in Chromium; **kiosk autostart is not configured by this repository**.

Stop either running process with Ctrl+C.

## Synchronization between devices

Open the same dashboard server on each device. Changes to desktops, widgets, templates, integrations, and supported plugin profiles appear automatically. Each browser keeps its own active desktop, theme, language, and open dialogs. When two clients edit the same field, the editor keeps the draft and offers to load the current value.

The Vite development proxy forwards both REST and `/api/events` (WebSocket) to FastAPI. Use a single FastAPI process. A trusted-network reverse proxy must also forward WebSocket upgrades for `/api/events`. The browser reconnects automatically and refreshes saved state after a connection loss. Browser timers and transient plugin state remain local.

For automated backend tests, install `.venv/bin/python -m pip install -r backend/requirements-test.txt` before running the test suite.

## Subsequent launches

Open two Linux terminals in the existing repository checkout. No reinstall is necessary unless dependencies have changed.

**Terminal 1 (backend):**

```bash
cd RaspberryPi-Home-IT-Terminal
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

**Terminal 2 (frontend):**

```bash
cd RaspberryPi-Home-IT-Terminal
npm --prefix ./frontend run dev
```

Then open `http://localhost:5173`. Run `npm --prefix ./frontend ci` after changes to frontend dependencies, and `.venv/bin/python -m pip install -r backend/requirements.txt` when Python dependencies change. To check the source without launching the UI, run `npm --prefix ./frontend run build` and `.venv/bin/python -m unittest discover -s backend/tests` from the root.

---

# Русский

## Описание проекта

**RaspberryPi-Home-IT-Terminal** — открытая модульная информационная панель для Raspberry Pi 5 с сенсорным экраном. Приложение поддерживает несколько рабочих столов, перемещение и изменение размера виджетов, визуальный конструктор шаблонов и независимые плагины (в том числе часы и демонстрационный виджет). Расположение, настройки и шаблоны сохраняются в SQLite. Серверная часть написана на Python/FastAPI, интерфейс — на React/TypeScript с Vite.

Текущий проект можно запускать локально в Debian/WSL2 и Linux, в том числе на Raspberry Pi OS для Raspberry Pi 5. **Автоматический запуск в режиме киоска пока не реализован**: systemd и запуск Chromium в kiosk mode требуется настроить отдельно. **Авторизации нет** — не публикуйте интерфейс в интернет, используйте его только локально или в доверенной LAN/VPN.

Техническая документация: [плагины](docs/ru/PLUGINS.md) · [создание шаблонов](docs/ru/WIDGET_AUTHORING.md) · [концепция](docs/ru/PROJECT_VISION.md) · [план развития](docs/ru/ROADMAP.md).

Дополнительные виджеты: [WireGuard](plugins/wireguard/README.md#русский) и [проверка задержки sing-box](plugins/sing-box-latency/README.md#русский).

## Первый запуск

### 1. Подготовка системы

Подойдут **Debian в WSL2**, Debian Linux или **64-битная Raspberry Pi OS** на Raspberry Pi 5. Нужны Python **3.11+**, `python3-venv`, `git`, Node.js **22.12+** (ветка Node 22 LTS) и npm. Vite 7 также допускает Node.js 20.19+, но рекомендуется Node 22. В WSL устанавливайте Node **в Linux**, а не используйте Windows-версию из подключённого диска.

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip curl ca-certificates iputils-ping
python3 --version
node --version
npm --version
node -p process.platform
```

Если Node.js/npm отсутствуют или слишком старые, установите актуальную поддерживаемую версию Node через [nvm](https://github.com/nvm-sh/nvm#installing-and-updating) в терминале Linux, затем выполните `nvm install 22` и `nvm use 22`. В WSL последняя проверка должна вывести `linux`, а не `win32`. Для ветки 22 необходима версия не ниже 22.12.

Клонируйте проект (или откройте уже существующую копию):

```bash
git clone https://github.com/Vanillllla/RaspberryPi-Home-IT-Terminal.git
cd RaspberryPi-Home-IT-Terminal
```

### 2. Установка и запуск backend — терминал 1

Из **корня репозитория**:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Оставьте терминал открытым. При первом запуске создаётся база SQLite `backend/data/terminal.sqlite3` (путь можно изменить переменной `TERMINAL_DB`). Документация API доступна по адресу `http://127.0.0.1:8000/docs`. Изолированный обработчик Python использует механизмы Linux и `libseccomp2`; при необходимости установите библиотеку (`sudo apt install -y libseccomp2`). Не запускайте в этой системе Python-код от недоверенных авторов.

### 3. Установка и запуск frontend — терминал 2

Из **того же корня репозитория**, во втором терминале Linux:

```bash
npm --prefix ./frontend ci
npm --prefix ./frontend run dev
```

Откройте `http://localhost:5173` в браузере **на том же устройстве** либо в браузере Windows при стандартном пробросе localhost из WSL2. Проверьте `http://localhost:5173/api/state`: запрос должен пройти через прокси Vite в FastAPI. По умолчанию оба сервиса слушают только loopback — для доступа из LAN нужна отдельная настройка безопасного проброса или прокси в доверенной сети. На Raspberry Pi OS откройте страницу в Chromium; **автозапуск киоска в репозитории пока не настроен**.

Для остановки каждого процесса нажмите Ctrl+C.

## Синхронизация между устройствами

Откройте панель одного и того же сервера на каждом устройстве. Рабочие столы, виджеты, шаблоны, интеграции и профили поддерживаемых плагинов обновляются автоматически. Активный стол, тема, язык и открытые окна остаются локальными. Если два клиента правят одно и то же поле, редактор сохраняет черновик и предлагает загрузить актуальные данные.

Vite проксирует REST-запросы и WebSocket `/api/events` в FastAPI. Запускайте один процесс FastAPI. Обратный прокси в доверенной сети также должен поддерживать обновление соединения до WebSocket на `/api/events`. При разрыве браузер автоматически переподключается и запрашивает сохранённое состояние. Таймеры в браузере и временное состояние плагинов остаются локальными.

Перед запуском автоматических тестов backend установите зависимости командой `.venv/bin/python -m pip install -r backend/requirements-test.txt`.

## Последующие запуски

Откройте два терминала Linux в уже скачанном проекте. Повторно устанавливать зависимости не нужно, если они не менялись.

**Терминал 1 (backend):**

```bash
cd RaspberryPi-Home-IT-Terminal
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

**Терминал 2 (frontend):**

```bash
cd RaspberryPi-Home-IT-Terminal
npm --prefix ./frontend run dev
```

Откройте `http://localhost:5173`. После обновления frontend-зависимостей выполните `npm --prefix ./frontend ci`, а после изменения Python-зависимостей — `.venv/bin/python -m pip install -r backend/requirements.txt`. Для проверки исходников без запуска интерфейса из корня репозитория выполните `npm --prefix ./frontend run build` и `.venv/bin/python -m unittest discover -s backend/tests`.
