import ipaddress
import re
import socket
import subprocess
import time
from typing import Iterable, Optional, Set

# Cached snapshot of the IPs that belong to the host running this Pulse client.
# Network interfaces and routing rarely change while the process is up, but they
# can (VPN flaps, docker bridge bouncing, USB tether). Re-collecting the list on
# every /health hit would mean a getaddrinfo + UDP probe per request, so we
# memoize and refresh periodically.
_CACHE_TTL_SECONDS = 30.0
_cache: dict = {"expires_at": 0.0, "ips": frozenset()}


def _try_add(ip_str: str, bucket: Set[str]) -> None:
    if not ip_str:
        return
    ip_str = str(ip_str).strip().split("/", 1)[0].split("%", 1)[0]
    try:
        normalized = str(ipaddress.ip_address(ip_str))
    except ValueError:
        return
    bucket.add(normalized)


def _collect_via_ip_addr(bucket: Set[str]) -> None:
    try:
        result = subprocess.run(
            ["ip", "-o", "addr", "show"],
            capture_output=True,
            text=True,
            timeout=1.0,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return
    if result.returncode != 0:
        return
    for line in result.stdout.splitlines():
        parts = line.split()
        for idx, part in enumerate(parts):
            if part in ("inet", "inet6") and idx + 1 < len(parts):
                _try_add(parts[idx + 1], bucket)


_IFCONFIG_INET_RE = re.compile(r"\binet6?\s+(?:addr:)?([0-9A-Fa-f:.%]+)")


def _collect_via_ifconfig(bucket: Set[str]) -> None:
    try:
        result = subprocess.run(
            ["ifconfig"],
            capture_output=True,
            text=True,
            timeout=1.0,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return
    if result.returncode != 0:
        return
    for match in _IFCONFIG_INET_RE.finditer(result.stdout):
        _try_add(match.group(1), bucket)


def _collect_via_default_route(bucket: Set[str]) -> None:
    # The classic "open a UDP socket to a public IP and read getsockname"
    # trick: it does not actually send anything because UDP connect just sets
    # the default destination, but the kernel resolves the source IP it would
    # use for that route. This catches the LAN IP that NAT would expose, even
    # when the host has multiple interfaces, without parsing /proc/net/route.
    for family, target in (
        (socket.AF_INET, ("8.8.8.8", 80)),
        (socket.AF_INET6, ("2001:4860:4860::8888", 80)),
    ):
        sock = None
        try:
            sock = socket.socket(family, socket.SOCK_DGRAM)
            sock.connect(target)
            _try_add(sock.getsockname()[0], bucket)
        except OSError:
            pass
        finally:
            if sock is not None:
                sock.close()


def _collect_via_hostname(bucket: Set[str]) -> None:
    try:
        host = socket.gethostname()
    except OSError:
        return
    try:
        for info in socket.getaddrinfo(host, None):
            sockaddr = info[4]
            if sockaddr:
                _try_add(sockaddr[0], bucket)
    except socket.gaierror:
        pass


def _collect_local_ips() -> frozenset:
    bucket: Set[str] = set()
    # Loopback always counts as same-machine — covers `localhost`, `127.0.0.1`,
    # `::1` and the entire 127.0.0.0/8 range.
    bucket.add("127.0.0.1")
    bucket.add("::1")
    _collect_via_ip_addr(bucket)
    _collect_via_ifconfig(bucket)
    _collect_via_default_route(bucket)
    _collect_via_hostname(bucket)
    return frozenset(bucket)


def _local_ips_cached() -> frozenset:
    now = time.monotonic()
    if now >= _cache["expires_at"]:
        _cache["ips"] = _collect_local_ips()
        _cache["expires_at"] = now + _CACHE_TTL_SECONDS
    return _cache["ips"]


def _is_loopback(ip_obj: ipaddress._BaseAddress) -> bool:
    if ip_obj.is_loopback:
        return True
    # IPv4-mapped IPv6 addresses (::ffff:127.0.0.1) report is_loopback=False on
    # the wrapper but their embedded v4 is loopback. FastAPI/uvicorn surface
    # these when the client is on loopback over a v6-enabled stack.
    if isinstance(ip_obj, ipaddress.IPv6Address) and ip_obj.ipv4_mapped is not None:
        return ip_obj.ipv4_mapped.is_loopback
    return False


def is_same_server_peer(peer_ip: Optional[str], local_ips: Optional[Iterable[str]] = None) -> bool:
    """Return True when the request peer is on the same machine as the client.

    `peer_ip` must come from the direct TCP connection (FastAPI's
    `request.client.host`) — never from `X-Forwarded-For` or `Forwarded`, which
    are spoofable by any client that knows the header name. The caller decides
    whether to trust proxies; this helper does not.
    """
    if not peer_ip:
        return False
    try:
        ip_obj = ipaddress.ip_address(peer_ip)
    except ValueError:
        return False
    if _is_loopback(ip_obj):
        return True
    if local_ips is None:
        candidates = _local_ips_cached()
    else:
        normalized_candidates: Set[str] = set()
        for item in local_ips:
            _try_add(str(item), normalized_candidates)
        candidates = normalized_candidates
    normalized_peer = str(ip_obj)
    if isinstance(ip_obj, ipaddress.IPv6Address) and ip_obj.ipv4_mapped is not None:
        # Compare both the v6 form and the embedded v4 form so a peer hitting
        # the v6 socket but matching a v4 interface still resolves to True.
        v4 = str(ip_obj.ipv4_mapped)
        return normalized_peer in candidates or v4 in candidates
    return normalized_peer in candidates


def reset_local_ip_cache() -> None:
    """Force the next is_same_server_peer call to re-enumerate. Used by tests."""
    _cache["expires_at"] = 0.0
    _cache["ips"] = frozenset()
