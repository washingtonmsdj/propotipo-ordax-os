#!/usr/bin/env python3
"""Pure request-boundary policy for the native OrdaX loopback HTTP surface.

This module contains no server lifecycle or product-domain state.  It exists so
Host/origin policy can be proven independently before it is wired into the
canonical native host request parser.
"""

from __future__ import annotations

import hmac
from urllib.parse import urlsplit

NATIVE_API_PREFIX = "/__ordax/native/"
TRUSTED_BIND_HOST = "127.0.0.1"
_ALLOWED_FETCH_SITES = frozenset({"same-origin", "none"})


def _ascii_equal(left: object, right: str) -> bool:
    if not isinstance(left, str):
        return False
    try:
        left_bytes = left.encode("ascii", errors="strict")
        right_bytes = right.encode("ascii", errors="strict")
    except UnicodeEncodeError:
        return False
    return hmac.compare_digest(left_bytes, right_bytes)


def _header_values(headers, name: str) -> tuple[str, ...]:
    get_all = getattr(headers, "get_all", None)
    if not callable(get_all):
        return ()
    values = get_all(name, [])
    if not values:
        return ()
    if any(not isinstance(value, str) for value in values):
        return ()
    return tuple(values)


def expected_surface_authority(server_address) -> str:
    """Return the only Host authority accepted by a bound native server."""

    try:
        host, port = server_address[:2]
    except (TypeError, ValueError):
        raise ValueError("native host requires a concrete IPv4 socket address") from None

    if host != TRUSTED_BIND_HOST:
        raise ValueError("native host must bind exactly to IPv4 loopback")
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError("native host requires a concrete TCP port")
    return f"{TRUSTED_BIND_HOST}:{port}"


def expected_surface_origin(server_address) -> str:
    return f"http://{expected_surface_authority(server_address)}"


def host_header_is_trusted(headers, trusted_authority: str) -> bool:
    """Require one exact Host header; duplicates and aliases fail closed."""

    values = _header_values(headers, "Host")
    return len(values) == 1 and _ascii_equal(values[0], trusted_authority)


def browser_context_is_trusted(headers, trusted_origin: str) -> bool:
    """Reject explicit foreign browser provenance on privileged API requests.

    Origin/Referer/Sec-Fetch-Site are defense-in-depth signals.  They may be
    absent on legitimate same-origin requests, so absence is accepted; any
    signal that is present must be unique and match the canonical Surface
    origin/context exactly.
    """

    origins = _header_values(headers, "Origin")
    if len(origins) > 1:
        return False
    if origins and not _ascii_equal(origins[0], trusted_origin):
        return False

    referers = _header_values(headers, "Referer")
    if len(referers) > 1:
        return False
    if referers:
        try:
            parsed = urlsplit(referers[0])
            referer_origin = f"{parsed.scheme}://{parsed.netloc}"
        except (TypeError, ValueError):
            return False
        if not _ascii_equal(referer_origin, trusted_origin):
            return False

    fetch_sites = _header_values(headers, "Sec-Fetch-Site")
    if len(fetch_sites) > 1:
        return False
    if fetch_sites and fetch_sites[0] not in _ALLOWED_FETCH_SITES:
        return False

    return True


def request_is_trusted(headers, server_address, request_target: str) -> bool:
    """Apply authority pinning to every request and provenance checks to APIs."""

    try:
        authority = expected_surface_authority(server_address)
        origin = expected_surface_origin(server_address)
        path = urlsplit(request_target).path
    except (TypeError, ValueError):
        return False

    if not host_header_is_trusted(headers, authority):
        return False
    if path.startswith(NATIVE_API_PREFIX):
        return browser_context_is_trusted(headers, origin)
    return True
