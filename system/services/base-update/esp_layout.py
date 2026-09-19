#!/usr/bin/env python3
"""Read-only inspection of an already-mounted OrdaX ESP.

The inspector validates current/recovery boot entries, their referenced
known-good artifacts, and an optional staged candidate entry. It never writes
the ESP and never touches EFI variables.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import stat
import sys

SCHEMA = "prototype-ordax.esp-layout/1"
MAX_ENTRY_BYTES = 16 * 1024
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SLOT_RE = re.compile(r"^[ab]$")
CURRENT_ENTRY = Path("loader/entries/ordax.conf")
RECOVERY_ENTRY = Path("loader/entries/ordax-recovery.conf")
CANDIDATE_ENTRY = Path("loader/entries/ordax-candidate+01-00.conf")
LEGACY_KERNEL = "/ordax/vmlinuz"
LEGACY_INITRAMFS = "/ordax/initrd.gz"


class EspLayoutError(RuntimeError):
    pass


def _root(path: Path) -> Path:
    if path.is_symlink():
        raise EspLayoutError("ESP root must not be a symlink")
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise EspLayoutError("ESP root is unavailable") from exc
    if not resolved.is_dir():
        raise EspLayoutError("ESP root must be a directory")
    return resolved


def _read_entry(root: Path, relative: Path, label: str) -> dict[str, list[str]]:
    path = root / relative
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise EspLayoutError(f"{label} is missing") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise EspLayoutError(f"{label} must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > MAX_ENTRY_BYTES:
        raise EspLayoutError(f"{label} size is outside the allowed range")
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise EspLayoutError(f"{label} cannot be read") from exc

    values: dict[str, list[str]] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition(" ")
        if not separator or not key or not value.strip():
            raise EspLayoutError(f"{label} contains a malformed line")
        values.setdefault(key, []).append(value.strip())
    return values


def _single(values: dict[str, list[str]], key: str, label: str) -> str:
    matches = values.get(key, [])
    if len(matches) != 1:
        raise EspLayoutError(f"{label} must contain exactly one {key}")
    return matches[0]


def _option_values(options: list[str], prefix: str) -> list[str]:
    return [value[len(prefix):] for value in options if value.startswith(prefix)]


def _regular_nonempty(root: Path, absolute_path: str, label: str) -> None:
    if not absolute_path.startswith("/"):
        raise EspLayoutError(f"{label} path is not absolute")
    relative = Path(absolute_path.lstrip("/"))
    if not relative.parts or ".." in relative.parts:
        raise EspLayoutError(f"{label} path is unsafe")
    path = root / relative
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise EspLayoutError(f"{label} is missing") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise EspLayoutError(f"{label} must be a regular non-symlink file")
    if metadata.st_size <= 0:
        raise EspLayoutError(f"{label} must not be empty")


def _known_good_identity(
    values: dict[str, list[str]],
    expected_mode: str,
    label: str,
) -> dict:
    linux = _single(values, "linux", label)
    initrd = _single(values, "initrd", label)
    options = _single(values, "options", label).split()

    modes = _option_values(options, "ordax.mode=")
    if modes != [expected_mode]:
        raise EspLayoutError(f"{label} has the wrong OrdaX mode")
    if _option_values(options, "ordax.base_candidate="):
        raise EspLayoutError(f"{label} must not carry candidate identity")

    slots = _option_values(options, "ordax.base_slot=")
    if linux == LEGACY_KERNEL and initrd == LEGACY_INITRAMFS:
        if slots:
            raise EspLayoutError(f"{label} mixes legacy paths with A/B slot identity")
        return {
            "layout": "legacy",
            "slot": None,
            "kernel": linux,
            "initramfs": initrd,
        }

    kernel_match = re.fullmatch(r"/ordax/base/([ab])/vmlinuz", linux)
    initramfs_match = re.fullmatch(r"/ordax/base/([ab])/initrd\.gz", initrd)
    if kernel_match is None or initramfs_match is None:
        raise EspLayoutError(f"{label} uses unsupported boot artifact paths")
    slot = kernel_match.group(1)
    if initramfs_match.group(1) != slot or slots != [slot]:
        raise EspLayoutError(f"{label} A/B slot identity is inconsistent")
    return {
        "layout": "ab",
        "slot": slot,
        "kernel": linux,
        "initramfs": initrd,
    }


def _candidate_identity(root: Path) -> dict | None:
    path = root / CANDIDATE_ENTRY
    if not path.exists() and not path.is_symlink():
        return None

    values = _read_entry(root, CANDIDATE_ENTRY, "candidate entry")
    linux = _single(values, "linux", "candidate entry")
    initrd = _single(values, "initrd", "candidate entry")
    options = _single(values, "options", "candidate entry").split()

    modes = _option_values(options, "ordax.mode=")
    slots = _option_values(options, "ordax.base_slot=")
    commits = _option_values(options, "ordax.base_candidate=")
    if modes != ["normal"]:
        raise EspLayoutError("candidate entry has the wrong OrdaX mode")
    if len(slots) != 1 or SLOT_RE.fullmatch(slots[0]) is None:
        raise EspLayoutError("candidate entry slot identity is invalid")
    if len(commits) != 1 or SHA40_RE.fullmatch(commits[0]) is None:
        raise EspLayoutError("candidate entry commit identity is invalid")

    slot = slots[0]
    expected_kernel = f"/ordax/base/{slot}/vmlinuz"
    expected_initramfs = f"/ordax/base/{slot}/initrd.gz"
    if linux != expected_kernel or initrd != expected_initramfs:
        raise EspLayoutError("candidate entry artifact paths do not match its slot")

    _regular_nonempty(root, linux, "candidate kernel")
    _regular_nonempty(root, initrd, "candidate initramfs")
    return {
        "slot": slot,
        "release_sha": commits[0],
        "kernel": linux,
        "initramfs": initrd,
    }


def inspect_layout(esp_root: Path) -> dict:
    root = _root(esp_root)
    current = _known_good_identity(
        _read_entry(root, CURRENT_ENTRY, "current entry"),
        "normal",
        "current entry",
    )
    recovery = _known_good_identity(
        _read_entry(root, RECOVERY_ENTRY, "recovery entry"),
        "recovery",
        "recovery entry",
    )
    if current["layout"] != recovery["layout"]:
        raise EspLayoutError("current and recovery entries use different layouts")

    for identity, prefix in ((current, "current"), (recovery, "recovery")):
        _regular_nonempty(root, identity["kernel"], f"{prefix} kernel")
        _regular_nonempty(root, identity["initramfs"], f"{prefix} initramfs")

    candidate = _candidate_identity(root)
    active_slot = "legacy" if current["layout"] == "legacy" else current["slot"]
    recovery_slot = "legacy" if recovery["layout"] == "legacy" else recovery["slot"]

    return {
        "$schema": SCHEMA,
        "status": "valid",
        "layout": current["layout"],
        "stage_active_slot": active_slot,
        "active_slot": active_slot,
        "recovery_slot": recovery_slot,
        "candidate_entry_present": candidate is not None,
        "candidate_slot": None if candidate is None else candidate["slot"],
        "candidate_release_sha": None if candidate is None else candidate["release_sha"],
        "known_good_entries_valid": True,
        "known_good_artifacts_valid": True,
        "write_authorized": False,
        "activation_authorized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--esp-root", type=Path, required=True)
    args = parser.parse_args()
    try:
        value = inspect_layout(args.esp_root)
    except EspLayoutError as exc:
        print(f"esp-layout: ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(value, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
