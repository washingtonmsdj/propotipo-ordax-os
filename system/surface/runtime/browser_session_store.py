#!/usr/bin/env python3
"""Durable, engine-independent tab-session storage for OrdaX Internet."""

from __future__ import annotations

import json
import os
import stat
import tempfile
from dataclasses import dataclass
from typing import Callable, Iterable

SESSION_VERSION = 1
DEFAULT_MAX_TABS = 16
MAX_SESSION_BYTES = 128 * 1024


@dataclass(frozen=True)
class StoredBrowserSession:
    urls: tuple[str, ...]
    active_index: int | None


def empty_session() -> StoredBrowserSession:
    return StoredBrowserSession(urls=(), active_index=None)


def _bounded_active_index(value: object, size: int) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if value < 0 or value >= size:
        return None
    return value


def normalize_session(
    payload: object,
    *,
    allow_url: Callable[[str], bool],
    max_tabs: int = DEFAULT_MAX_TABS,
) -> StoredBrowserSession:
    if not isinstance(max_tabs, int) or isinstance(max_tabs, bool) or max_tabs < 1:
        raise ValueError("max_tabs must be a positive integer")
    if not isinstance(payload, dict) or payload.get("version") != SESSION_VERSION:
        return empty_session()

    raw_urls = payload.get("urls")
    if not isinstance(raw_urls, list):
        return empty_session()

    raw_active = _bounded_active_index(payload.get("activeIndex"), len(raw_urls))
    urls: list[str] = []
    active_index: int | None = None
    for source_index, value in enumerate(raw_urls):
        if len(urls) >= max_tabs:
            break
        if not isinstance(value, str) or not allow_url(value):
            continue
        urls.append(value)
        if source_index == raw_active:
            active_index = len(urls) - 1

    if not urls:
        return empty_session()
    if active_index is None:
        active_index = len(urls) - 1
    return StoredBrowserSession(urls=tuple(urls), active_index=active_index)


def load_browser_session(
    path: str,
    *,
    allow_url: Callable[[str], bool],
    max_tabs: int = DEFAULT_MAX_TABS,
) -> StoredBrowserSession:
    try:
        descriptor = os.open(
            path,
            os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
    except OSError:
        return empty_session()

    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            return empty_session()
        if metadata.st_size < 0 or metadata.st_size > MAX_SESSION_BYTES:
            return empty_session()
        with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as handle:
            payload = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
        return empty_session()
    finally:
        os.close(descriptor)

    return normalize_session(payload, allow_url=allow_url, max_tabs=max_tabs)


def _session_payload(urls: Iterable[str], active_index: int | None) -> dict:
    return {
        "version": SESSION_VERSION,
        "urls": list(urls),
        "activeIndex": active_index,
    }


def save_browser_session(
    path: str,
    urls: Iterable[str],
    active_index: int | None,
    *,
    allow_url: Callable[[str], bool],
    max_tabs: int = DEFAULT_MAX_TABS,
) -> StoredBrowserSession:
    session = normalize_session(
        _session_payload(urls, active_index),
        allow_url=allow_url,
        max_tabs=max_tabs,
    )
    payload = {
        "version": SESSION_VERSION,
        "urls": list(session.urls),
        "activeIndex": session.active_index,
    }

    directory = os.path.abspath(os.path.dirname(path) or ".")
    os.makedirs(directory, mode=0o700, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".browser-session-", dir=directory)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", closefd=False) as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, path)
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass

    return session
