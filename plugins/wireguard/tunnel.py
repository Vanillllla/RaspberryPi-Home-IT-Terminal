#!/usr/bin/python3 -I
"""Small privileged WireGuard client. The dashboard supplies one request on stdin."""
import base64
import ipaddress
import json
import os
import re
import socket
import subprocess
import sys

IP = "/usr/sbin/ip"
WG = "/usr/bin/wg"
LIMIT = 65536
ENV = {"PATH": "/usr/sbin:/usr/bin", "LC_ALL": "C", "WG_ENDPOINT_RESOLUTION_RETRIES": "0"}


class TunnelError(ValueError):
    pass


def require(condition, code="invalid"):
    if not condition:
        raise TunnelError(code)


def key(value):
    require(re.fullmatch(r"[A-Za-z0-9+/]{43}=", value) and any(base64.b64decode(value)))
    return value


def number(value, low, high):
    require(value.isascii() and value.isdecimal() and low <= int(value) <= high)
    return int(value)


def read_config(text):
    require(isinstance(text, str) and len(text.encode()) <= LIMIT)
    interface = {}
    peers = []
    section = None
    for raw in text.splitlines():
        line = raw.partition("#")[0].strip()
        if not line:
            continue
        if line == "[Interface]":
            require(section is None)
            section = interface
        elif line == "[Peer]":
            require(section is not None)
            section = {}
            peers.append(section)
        else:
            require(section is not None and "=" in line)
            name, value = (s.strip() for s in line.split("=", 1))
            allowed = ({"PrivateKey", "Address", "MTU", "DNS", "ListenPort"} if section is interface else
                       {"PublicKey", "PresharedKey", "Endpoint", "AllowedIPs", "PersistentKeepalive"})
            require(name in allowed, "directive")
            if name in section and name in {"Address", "AllowedIPs", "DNS"}:
                section[name] += "," + value
            else:
                require(name not in section)
                section[name] = value
    try:
        addresses = [ipaddress.ip_interface(a.strip()) for a in interface["Address"].split(",")]
        address = next(a for a in addresses if a.version == 4)
        # A /32 client address is common. Only route its x.x.x.* LAN, even for full-tunnel files.
        lan = ipaddress.ip_network((address.ip, max(24, address.network.prefixlen)
                                    if address.network.prefixlen != 32 else 24), strict=False)
        target = ipaddress.IPv4Address((int(address.ip) & ~255) + 1)
        require(target in lan and target != address.ip and not any(
            address.ip in ipaddress.ip_network(block) for block in
            ("0.0.0.0/8", "127.0.0.0/8", "224.0.0.0/4", "240.0.0.0/4")), "subnet")
        native = ["[Interface]", "PrivateKey = " + key(interface["PrivateKey"])]
        if "ListenPort" in interface:
            native.append(f"ListenPort = {number(interface['ListenPort'], 0, 65535)}")
        mtu = number(interface.get("MTU", "1420"), 576, 65535)
        routes = set()
        for peer in peers:
            networks = [ipaddress.ip_network(s.strip(), strict=False) for s in peer["AllowedIPs"].split(",")]
            local = {net if net.subnet_of(lan) else lan for net in networks if net.version == 4 and net.overlaps(lan)}
            if not local:
                continue
            native += ["[Peer]", "PublicKey = " + key(peer["PublicKey"]),
                       "AllowedIPs = " + ", ".join(map(str, sorted(local)))]
            routes.update(local)
            if "PresharedKey" in peer:
                native.append("PresharedKey = " + key(peer["PresharedKey"]))
            if "Endpoint" in peer:
                host, sep, port = peer["Endpoint"].rpartition(":")
                require(sep and (re.fullmatch(r"[A-Za-z0-9.-]+", host) or
                                 (host.startswith("[") and host.endswith("]") and
                                  ipaddress.IPv6Address(host[1:-1]))))
                native.append(f"Endpoint = {host}:{number(port, 1, 65535)}")
            if "PersistentKeepalive" in peer:
                keepalive = peer["PersistentKeepalive"]
                native.append(f"PersistentKeepalive = {0 if keepalive == 'off' else number(keepalive, 0, 65535)}")
        require(any(target in route for route in routes), "subnet")
        return str(address.ip), str(target), mtu, list(ipaddress.collapse_addresses(routes)), "\n".join(native) + "\n"
    except TunnelError:
        raise
    except (ValueError, KeyError, StopIteration):
        raise TunnelError("invalid") from None


def device(profile):
    require(isinstance(profile, str) and re.fullmatch(r"[0-9a-f]{10}", profile))
    return "rdwg" + profile


def interface_state(profile):
    iface = device(profile)
    if iface not in dict(socket.if_nameindex()).values():
        return None
    output = subprocess.check_output([IP, "-j", "link", "show", "dev", iface],
                                     stderr=subprocess.DEVNULL, env=ENV, timeout=3)
    link = json.loads(output)[0]
    require(link.get("ifalias") == "raspberry-dashboard:" + profile, "conflict")
    return "UP" in link["flags"]


def check_routes(routes):
    # More-specific routes can silently steal traffic from an existing tunnel.
    output = subprocess.check_output([IP, "-j", "-4", "route", "show", "table", "all"],
                                     stderr=subprocess.DEVNULL, env=ENV, timeout=3)
    for entry in json.loads(output):
        destination = entry.get("dst", "default")
        if destination != "default":
            network = ipaddress.ip_network(destination, strict=False)
            require(not any(route.overlaps(network) for route in routes), "conflict")


def run(*args, data=None):
    subprocess.run(args, input=data, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                   env=ENV, timeout=5, check=True)


def apply(action, profile, config=None):
    iface = device(profile)
    state = interface_state(profile)
    if action == "down":
        if state is not None:
            run(IP, "link", "del", "dev", iface)
        return
    require(action == "up")
    address, _, mtu, routes, native = read_config(config)
    if state is not None:
        if not state:
            run(IP, "link", "set", "dev", iface, "up")
        return
    check_routes([*routes, ipaddress.ip_network(address)])
    run(IP, "link", "add", "dev", iface, "type", "wireguard")
    try:
        run(IP, "link", "set", "dev", iface, "alias", "raspberry-dashboard:" + profile)
        run(WG, "setconf", iface, "/dev/stdin", data=native)
        run(IP, "-4", "addr", "add", address + "/32", "dev", iface)
        run(IP, "link", "set", "dev", iface, "mtu", str(mtu), "up")
        for route in routes:
            run(IP, "-4", "route", "add", str(route), "dev", iface, "src", address)
    except BaseException:
        run(IP, "link", "del", "dev", iface)
        raise


if __name__ == "__main__":
    try:
        require(len(sys.argv) == 1 and os.geteuid() == 0)
        raw = sys.stdin.buffer.read(2 * LIMIT + 1)
        require(len(raw) <= 2 * LIMIT)
        request = json.loads(raw)
        apply(request["action"], request["id"], request.get("config"))
    except TunnelError as exc:
        sys.exit(3 if str(exc) == "conflict" else 1)
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError):
        sys.exit(1)
