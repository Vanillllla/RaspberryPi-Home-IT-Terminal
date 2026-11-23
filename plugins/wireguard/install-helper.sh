#!/bin/sh
set -eu
if [ "$(id -u)" != 0 ] || [ "$#" != 1 ]; then
    echo 'Usage: sudo sh install-helper.sh DASHBOARD_USER' >&2
    exit 1
fi
account=$1
case "$account" in ''|*[!a-zA-Z0-9_-]*|-*) exit 1;; esac
id "$account" >/dev/null
for tool in /usr/bin/python3 /usr/sbin/ip /usr/bin/wg /usr/bin/ping /usr/bin/sudo /usr/sbin/visudo; do
    test -x "$tool" || { echo "Missing $tool" >&2; exit 1; }
done
helper=/usr/local/libexec/raspberry-dashboard-wireguard
rule=$(mktemp)
trap 'rm -f "$rule"' EXIT
printf '%s ALL=(root) NOPASSWD: %s ""\n' "$account" "$helper" > "$rule"
/usr/sbin/visudo -cf "$rule"
install -D -o root -g root -m 0755 "$(dirname "$0")/tunnel.py" "$helper"
install -o root -g root -m 0440 "$rule" /etc/sudoers.d/raspberry-dashboard-wireguard
