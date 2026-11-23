# sing-box latency

## Русский

Установите `sing-box` и `curl` на устройстве, где запущен сервер панели. Если бинарник sing-box находится вне `PATH` и `~/.local/bin`, укажите путь к нему в переменной окружения `SING_BOX_BIN`.

Добавьте виджет **Задержка sing-box**. В **Подробнее** задайте имя профиля и загрузите JSON-конфиг или вставьте ссылку Hysteria 2. Там же настраивается интервал автоматической проверки. Кнопка **Проверить** запускает проверку вручную.

Сервер сохраняет профили в отдельной базе `backend/data/secrets/terminal.sqlite3` и переносит туда существующие профили при первом запуске после обновления. Папка `secrets/` исключена из Git. Если задана переменная `TERMINAL_DB`, папка `secrets/` создаётся рядом с указанной базой. Для резервной копии профилей сохраните обе базы.

## English

Install `sing-box` and `curl` on the device running the dashboard backend. If the sing-box binary is outside `PATH` and `~/.local/bin`, set `SING_BOX_BIN` to its path.

Add the **sing-box latency** widget. In **Details**, name each profile and upload a JSON configuration or paste a Hysteria 2 link. Set the interval there for automatic checks. Use **Check** to run a check on demand.

The backend stores profiles in `backend/data/secrets/terminal.sqlite3` and moves existing profiles there on the first startup after the update. Git ignores the `secrets/` directory. If `TERMINAL_DB` is set, the backend creates `secrets/` next to that database. Back up both databases to preserve profiles.
