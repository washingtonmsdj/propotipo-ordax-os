#!/usr/bin/env python3
"""Read-only physical ESP preflight for the OrdaX base-update owner.

This helper discovers the ORDAX-ESP on the same parent disk as the running
root partition, mounts it read-only with restrictive mount options, inspects
its boot layout, revalidates device identity, and unmounts it before returning.
It never stages bytes and never touches EFI variables.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
SCHEMA = "prototype-ordax.esp-readonly-preflight/1"
REQUIRED_MOUNT_OPTIONS = {"ro", "nosuid", "nodev", "noexec"}


class EspReadonlyPreflightError(RuntimeError):
    pass


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise EspReadonlyPreflightError(f"cannot load dependency: {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_discovery = _load(HERE / "esp_discovery.py", "ordax_esp_readonly_discovery")
_layout = _load(HERE / "esp_layout.py", "ordax_esp_readonly_layout")


def _mount_record(mountinfo: Path, mountpoint: Path) -> dict | None:
    try:
        lines = mountinfo.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        raise EspReadonlyPreflightError("mountinfo is unavailable") from exc

    target = str(mountpoint)
    matches = []
    for line in lines:
        fields = line.split()
        if len(fields) < 10 or fields[4] != target:
            continue
        try:
            separator = fields.index("-")
        except ValueError as exc:
            raise EspReadonlyPreflightError("mountinfo record is malformed") from exc
        if separator + 2 >= len(fields):
            raise EspReadonlyPreflightError("mountinfo record is incomplete")
        matches.append(
            {
                "root": fields[3],
                "mountpoint": fields[4],
                "options": set(fields[5].split(",")),
                "filesystem": fields[separator + 1],
                "source": fields[separator + 2],
            }
        )
    if len(matches) > 1:
        raise EspReadonlyPreflightError("mountpoint appears more than once in mountinfo")
    return matches[0] if matches else None


def _run_mount_command(argv: list[str], label: str) -> None:
    try:
        completed = subprocess.run(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise EspReadonlyPreflightError(f"{label} command could not run") from exc
    if completed.returncode != 0:
        raise EspReadonlyPreflightError(f"{label} command failed")


def readonly_preflight(
    *,
    root_source: Path,
    mount_root: Path,
    dev_root: Path = Path("/dev"),
    by_label_root: Path = Path("/dev/disk/by-label"),
    sys_class_block: Path = Path("/sys/class/block"),
    mountinfo: Path = Path("/proc/self/mountinfo"),
    mount_command: Path = Path("/bin/mount"),
    umount_command: Path = Path("/bin/umount"),
) -> dict:
    try:
        discovered = _discovery.discover_esp(
            root_source=root_source,
            dev_root=dev_root,
            by_label_root=by_label_root,
            sys_class_block=sys_class_block,
        )
    except _discovery.EspDiscoveryError as exc:
        raise EspReadonlyPreflightError(str(exc)) from exc

    if mount_root.is_symlink():
        raise EspReadonlyPreflightError("read-only ESP mountpoint must not be a symlink")
    try:
        mount_root.mkdir(parents=True, exist_ok=True)
        mount_root = mount_root.resolve(strict=True)
    except OSError as exc:
        raise EspReadonlyPreflightError("read-only ESP mountpoint is unavailable") from exc
    if not mount_root.is_dir():
        raise EspReadonlyPreflightError("read-only ESP mountpoint must be a directory")
    try:
        if any(mount_root.iterdir()):
            raise EspReadonlyPreflightError("read-only ESP mountpoint must be empty")
    except OSError as exc:
        raise EspReadonlyPreflightError("read-only ESP mountpoint cannot be inspected") from exc
    if _mount_record(mountinfo, mount_root) is not None:
        raise EspReadonlyPreflightError("read-only ESP mountpoint is already occupied")

    esp_device = Path(discovered["esp_device"])
    mounted = False
    try:
        _run_mount_command(
            [
                str(mount_command),
                "-t",
                "vfat",
                "-o",
                "ro,nosuid,nodev,noexec",
                str(esp_device),
                str(mount_root),
            ],
            "read-only ESP mount",
        )
        mounted = True

        record = _mount_record(mountinfo, mount_root)
        if record is None:
            raise EspReadonlyPreflightError("read-only ESP mount is not observable")
        if record["root"] != "/":
            raise EspReadonlyPreflightError("read-only ESP mount exposes a non-root subpath")
        if record["filesystem"] != "vfat":
            raise EspReadonlyPreflightError("read-only ESP mount filesystem is not vfat")
        if record["source"] != str(esp_device):
            raise EspReadonlyPreflightError("read-only ESP mount source changed")
        if not REQUIRED_MOUNT_OPTIONS.issubset(record["options"]):
            raise EspReadonlyPreflightError("read-only ESP mount options are insufficient")

        try:
            revalidated = _discovery.discover_esp(
                root_source=root_source,
                dev_root=dev_root,
                by_label_root=by_label_root,
                sys_class_block=sys_class_block,
            )
        except _discovery.EspDiscoveryError as exc:
            raise EspReadonlyPreflightError(str(exc)) from exc
        if revalidated["esp_device"] != discovered["esp_device"]:
            raise EspReadonlyPreflightError("ORDAX-ESP identity changed during preflight")

        try:
            layout = _layout.inspect_layout(mount_root)
        except _layout.EspLayoutError as exc:
            raise EspReadonlyPreflightError(str(exc)) from exc

        result = {
            "$schema": SCHEMA,
            "status": "valid",
            "filesystem_label": discovered["filesystem_label"],
            "root_device": discovered["root_device"],
            "esp_device": discovered["esp_device"],
            "parent_disk": discovered["parent_disk"],
            "same_parent_disk": True,
            "mount_mode": "read-only",
            "mount_options": sorted(REQUIRED_MOUNT_OPTIONS),
            "layout": layout,
            "write_authorized": False,
            "activation_authorized": False,
            "staging_performed": False,
        }
    except Exception:
        if mounted:
            try:
                _run_mount_command([str(umount_command), str(mount_root)], "ESP unmount")
            except EspReadonlyPreflightError:
                pass
        raise

    _run_mount_command([str(umount_command), str(mount_root)], "ESP unmount")
    mounted = False
    if _mount_record(mountinfo, mount_root) is not None:
        raise EspReadonlyPreflightError("read-only ESP mount remained active after unmount")
    result["mount_released"] = True
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root-source", type=Path, required=True)
    parser.add_argument(
        "--mount-root",
        type=Path,
        default=Path("/run/ordax-base-owner/esp-readonly"),
    )
    parser.add_argument("--dev-root", type=Path, default=Path("/dev"))
    parser.add_argument(
        "--by-label-root",
        type=Path,
        default=Path("/dev/disk/by-label"),
    )
    parser.add_argument(
        "--sys-class-block",
        type=Path,
        default=Path("/sys/class/block"),
    )
    parser.add_argument(
        "--mountinfo",
        type=Path,
        default=Path("/proc/self/mountinfo"),
    )
    args = parser.parse_args()

    try:
        value = readonly_preflight(
            root_source=args.root_source,
            mount_root=args.mount_root,
            dev_root=args.dev_root,
            by_label_root=args.by_label_root,
            sys_class_block=args.sys_class_block,
            mountinfo=args.mountinfo,
        )
    except EspReadonlyPreflightError as exc:
        print(f"esp-readonly-preflight: ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(value, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
