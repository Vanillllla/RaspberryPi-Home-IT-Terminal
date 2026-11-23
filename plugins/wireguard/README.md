# WireGuard

## Русский

Виджет подключает к сети само устройство, на котором запущен сервер панели. Для переключения профилей один раз установите помощник в Debian, WSL2 или Raspberry Pi OS. Из корня проекта выполните команды под пользователем, от которого запускаете сервер.

```sh
sudo apt install wireguard-tools iproute2 iputils-ping sudo
sudo sh plugins/wireguard/install-helper.sh "$(id -un)"
```

1. Добавьте виджет **WireGuard** на рабочий стол. В **Подробнее** выберите один или несколько файлов клиента WireGuard с расширением `.conf`. Имя файла станет названием профиля.
2. Включите переключатель рядом с нужным профилем. Для адреса клиента `10.77.77.2` виджет каждые пять секунд проверяет пинг до `10.77.77.1` через этот туннель. «Нет ответа» означает, что интерфейс включён, но узел не ответил на ICMP. После выключения появится «Не подключено».
3. Удалить профиль можно в **Подробнее**. При удалении подключённого профиля, виджета или рабочего стола панель отключит соответствующие туннели.

Для каждого профиля создаётся отдельный временный интерфейс. Одновременно можно подключить сети с разными маршрутами. Для профилей одной и той же сети сначала выключите активный профиль. Виджет использует первый IPv4-адрес клиента и маршрутизирует пересечение `AllowedIPs` с его локальной сетью в пределах `x.x.x.0/24`. Для адреса клиента с маской `/32` локальной сетью считается `x.x.x.0/24`. Шлюз `x.x.x.1` должен входить в разрешённые маршруты. При импорте полнотуннельного файла основной маршрут и DNS устройства сохраняются. Директивы скриптов wg-quick (например, `PostUp`) не поддерживаются.

Ключи сохраняются на сервере в SQLite с правами `0600`. В API панели возвращаются название, адрес проверки и состояние. При переносе панели резервная копия базы также будет содержать ключи. После обновления помощника повторите команду установки. Для удаления помощника выключите профили и удалите `/etc/sudoers.d/raspberry-dashboard-wireguard` и `/usr/local/libexec/raspberry-dashboard-wireguard`.

## English

The widget connects the device running the dashboard backend. To enable switching, run the following once from the project root as the dashboard service user on Debian, WSL2 or Raspberry Pi OS.

```sh
sudo apt install wireguard-tools iproute2 iputils-ping sudo
sudo sh plugins/wireguard/install-helper.sh "$(id -un)"
```

Add **WireGuard** to a desktop. Open **Details** and select one or more WireGuard client `.conf` files. Each filename becomes a profile name. Use its switch to connect. For a client address of `10.77.77.2`, the widget pings `10.77.77.1` through the tunnel every five seconds. **No reply** means the interface is up but the gateway did not respond to ICMP. **Disconnected** means the interface is off. Remove profiles in **Details**. Removing a connected profile, widget, or desktop also disconnects its tunnels.

Each profile uses a temporary interface. Profiles with distinct routes can run together. Disconnect the current profile before switching to another with the same routes. The widget takes the first IPv4 client address and routes the intersection of its LAN and the peer's `AllowedIPs`, limited to `x.x.x.0/24`. A `/32` client uses `x.x.x.0/24` as its LAN. The allowed routes must include `x.x.x.1`. Importing a full-tunnel file preserves the device's default route and DNS. The widget rejects wg-quick script directives such as `PostUp`.

Keys stay in the server's SQLite database (mode `0600`). The dashboard API returns profile names, ping targets, and status. Database backups contain the keys. Rerun the installation command after helper updates. To uninstall, disconnect profiles and remove `/etc/sudoers.d/raspberry-dashboard-wireguard` and `/usr/local/libexec/raspberry-dashboard-wireguard`.
