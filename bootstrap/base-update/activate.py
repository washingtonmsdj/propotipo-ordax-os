#!/usr/bin/env python3
"""Arm one staged OrdaX base candidate for a single systemd-boot attempt.

This owner validates the staged candidate entry and writes only LoaderEntryOneShot.
It never changes the default/current/recovery entries and never reboots.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys

LOADER_GUID = "4a67b082-0a4c-41cf-b6c7-440b29bb8c4f"
VARIABLE_NAME = f"LoaderEntryOneShot-{LOADER_GUID}"
EFI_VARIABLE_ATTRIBUTES = 0x00000007  # NV | BS | RT
ENTRY_ID = "ordax-candidate.conf"
CANDIDATE_ENTRY = Path("loader/entries/ordax-candidate+01-00.conf")
CURRENT_ENTRY = Path("loader/entries/ordax.conf")
RECOVERY_ENTRY = Path("loader/entries/ordax-recovery.conf")
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SLOT_RE = re.compile(r"^[ab]$")


class ActivateError(RuntimeError):
    pass


def read_entry(path: Path) -> dict[str, list[str]]:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise ActivateError(f"boot entry unavailable: {path.name}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise ActivateError(f"boot entry must be a regular file: {path.name}")
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise ActivateError(f"cannot read boot entry: {path.name}") from exc
    if len(text.encode("utf-8")) > 16 * 1024:
        raise ActivateError("boot entry is unexpectedly large")

    values: dict[str, list[str]] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition(" ")
        if not separator or not key or not value.strip():
            raise ActivateError("malformed boot entry")
        values.setdefault(key, []).append(value.strip())
    return values


def single(values: dict[str, list[str]], key: str) -> str:
    candidates = values.get(key, [])
    if len(candidates) != 1:
        raise ActivateError(f"boot entry must contain exactly one {key}")
    return candidates[0]


def validate_candidate_entry(esp_root: Path, release_sha: str, candidate_slot: str) -> dict:
    if not SHA40_RE.fullmatch(release_sha):
        raise ActivateError("invalid release SHA")
    if not SLOT_RE.fullmatch(candidate_slot):
        raise ActivateError("invalid candidate slot")
    root = esp_root.resolve()
    if not root.is_dir() or root.is_symlink():
        raise ActivateError("ESP root must be an existing directory")

    for protected in (CURRENT_ENTRY, RECOVERY_ENTRY):
        path = root / protected
        try:
            metadata = path.lstat()
        except OSError as exc:
            raise ActivateError(f"known-good boot entry missing: {protected.name}") from exc
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise ActivateError(f"known-good boot entry is unsafe: {protected.name}")

    candidate = root / CANDIDATE_ENTRY
    values = read_entry(candidate)
    linux = single(values, "linux")
    initrd = single(values, "initrd")
    options = single(values, "options").split()

    expected_kernel = f"/ordax/base/{candidate_slot}/vmlinuz"
    expected_initrd = f"/ordax/base/{candidate_slot}/initrd.gz"
    if linux != expected_kernel or initrd != expected_initrd:
        raise ActivateError("candidate entry does not target the expected inactive slot")
    required_options = {
        "ordax.mode=normal",
        f"ordax.base_slot={candidate_slot}",
        f"ordax.base_candidate={release_sha}",
    }
    if not required_options.issubset(set(options)):
        raise ActivateError("candidate entry identity/options do not match staged release")

    for relative in (
        Path(expected_kernel.lstrip("/")),
        Path(expected_initrd.lstrip("/")),
    ):
        target = root / relative
        try:
            metadata = target.lstat()
        except OSError as exc:
            raise ActivateError(f"staged candidate artifact missing: {relative.name}") from exc
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise ActivateError(f"staged candidate artifact is unsafe: {relative.name}")

    return {
        "entry_id": ENTRY_ID,
        "entry_path": "/" + CANDIDATE_ENTRY.as_posix(),
        "candidate_slot": candidate_slot,
        "release_sha": release_sha,
    }


def efivar_payload(entry_id: str = ENTRY_ID) -> bytes:
    if entry_id != ENTRY_ID:
        raise ActivateError("unexpected one-shot entry id")
    encoded = (entry_id + "\x00").encode("utf-16-le")
    return struct.pack("<I", EFI_VARIABLE_ATTRIBUTES) + encoded


def write_oneshot_variable(efivarfs_root: Path, payload: bytes) -> Path:
    root = efivarfs_root.resolve()
    if not root.is_dir() or root.is_symlink():
        raise ActivateError("efivarfs root must be an existing directory")
    target = root / VARIABLE_NAME

    # In production efivarfs provides special files; in proof fixtures we permit
    # a normal directory. Never follow a pre-existing symlink.
    try:
        existing = target.lstat()
    except FileNotFoundError:
        existing = None
    except OSError as exc:
        raise ActivateError("cannot inspect LoaderEntryOneShot variable") from exc
    if existing is not None and stat.S_ISLNK(existing.st_mode):
        raise ActivateError("LoaderEntryOneShot variable path must not be a symlink")

    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_TRUNC
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        descriptor = os.open(target, flags, 0o600)
    except OSError as exc:
        raise ActivateError("cannot write LoaderEntryOneShot") from exc
    try:
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                raise ActivateError("short write to LoaderEntryOneShot")
            offset += written
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return target


def arm(esp_root: Path, efivarfs_root: Path, release_sha: str, candidate_slot: str) -> dict:
    identity = validate_candidate_entry(esp_root, release_sha, candidate_slot)
    target = write_oneshot_variable(efivarfs_root, efivar_payload())
    return {
        "$schema": "prototype-ordax.base-update-activation-result/1",
        **identity,
        "selector": "LoaderEntryOneShot",
        "variable": target.name,
        "default_entry_changed": False,
        "reboot_requested": False,
        "armed": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--esp-root", type=Path, required=True)
    parser.add_argument("--efivarfs-root", type=Path, default=Path("/sys/firmware/efi/efivars"))
    parser.add_argument("--release-sha", required=True)
    parser.add_argument("--candidate-slot", choices=("a", "b"), required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(
            arm(args.esp_root, args.efivarfs_root, args.release_sha, args.candidate_slot),
            indent=2,
            sort_keys=True,
        ))
        return 0
    except (OSError, ActivateError) as exc:
        print(f"base-update-activate: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
