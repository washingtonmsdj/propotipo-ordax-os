#!/usr/bin/env python3
"""Fail-closed discovery of the OrdaX ESP associated with the running root disk.

Discovery is intentionally read-only. It resolves the filesystem-label device,
verifies direct block-device and sysfs partition identities, and requires the
ESP and the running root partition to share the same parent disk.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import stat
import sys

SCHEMA = "prototype-ordax.esp-discovery/1"
DEFAULT_LABEL = "ORDAX-ESP"
DEFAULT_DEV_ROOT = Path("/dev")
DEFAULT_BY_LABEL_ROOT = Path("/dev/disk/by-label")
DEFAULT_SYS_CLASS_BLOCK = Path("/sys/class/block")


class EspDiscoveryError(RuntimeError):
    pass


def _is_block_device(path: Path) -> bool:
    try:
        return stat.S_ISBLK(path.stat().st_mode)
    except OSError:
        return False


def _direct_block_node(path: Path, dev_root: Path, label: str) -> Path:
    try:
        dev_root = dev_root.resolve(strict=True)
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise EspDiscoveryError(f"{label} device is unavailable") from exc
    if resolved.parent != dev_root:
        raise EspDiscoveryError(f"{label} must resolve to a direct /dev block node")
    if not _is_block_device(resolved):
        raise EspDiscoveryError(f"{label} is not a block device")
    return resolved


def _partition_parent(sys_class_block: Path, device_name: str, label: str) -> str:
    entry = sys_class_block / device_name
    if not entry.is_symlink():
        raise EspDiscoveryError(f"{label} sysfs class entry is unavailable or unsafe")
    try:
        resolved = entry.resolve(strict=True)
    except OSError as exc:
        raise EspDiscoveryError(f"{label} sysfs identity cannot be resolved") from exc
    partition = resolved / "partition"
    if partition.is_symlink() or not partition.is_file():
        raise EspDiscoveryError(f"{label} is not a partition")
    parent = resolved.parent.name
    if not parent or parent == device_name:
        raise EspDiscoveryError(f"{label} parent disk identity is invalid")
    parent_entry = sys_class_block / parent
    if not parent_entry.is_symlink():
        raise EspDiscoveryError(f"{label} parent disk is not present in sysfs")
    try:
        parent_resolved = parent_entry.resolve(strict=True)
    except OSError as exc:
        raise EspDiscoveryError(f"{label} parent disk cannot be resolved") from exc
    if (parent_resolved / "partition").exists():
        raise EspDiscoveryError(f"{label} parent identity unexpectedly resolves to a partition")
    return parent


def discover_esp(
    *,
    root_source: Path,
    filesystem_label: str = DEFAULT_LABEL,
    dev_root: Path = DEFAULT_DEV_ROOT,
    by_label_root: Path = DEFAULT_BY_LABEL_ROOT,
    sys_class_block: Path = DEFAULT_SYS_CLASS_BLOCK,
) -> dict:
    if filesystem_label != DEFAULT_LABEL:
        raise EspDiscoveryError("unexpected ESP filesystem label")

    root_device = _direct_block_node(root_source, dev_root, "root")
    root_parent = _partition_parent(
        sys_class_block,
        root_device.name,
        "root",
    )

    label_path = by_label_root / filesystem_label
    if not label_path.is_symlink():
        raise EspDiscoveryError("ORDAX-ESP label link is missing or unsafe")
    esp_device = _direct_block_node(label_path, dev_root, "ESP")
    if esp_device == root_device:
        raise EspDiscoveryError("ESP and root cannot be the same partition")
    esp_parent = _partition_parent(
        sys_class_block,
        esp_device.name,
        "ESP",
    )
    if esp_parent != root_parent:
        raise EspDiscoveryError("ORDAX-ESP is not on the running root disk")

    return {
        "$schema": SCHEMA,
        "status": "identified",
        "filesystem_label": filesystem_label,
        "root_device": os.fspath(root_device),
        "esp_device": os.fspath(esp_device),
        "parent_disk": root_parent,
        "same_parent_disk": True,
        "direct_partition_nodes": True,
        "mount_performed": False,
        "write_authorized": False,
        "activation_authorized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root-source", type=Path, required=True)
    parser.add_argument("--filesystem-label", default=DEFAULT_LABEL)
    parser.add_argument("--dev-root", type=Path, default=DEFAULT_DEV_ROOT)
    parser.add_argument("--by-label-root", type=Path, default=DEFAULT_BY_LABEL_ROOT)
    parser.add_argument(
        "--sys-class-block",
        type=Path,
        default=DEFAULT_SYS_CLASS_BLOCK,
    )
    args = parser.parse_args()
    try:
        result = discover_esp(
            root_source=args.root_source,
            filesystem_label=args.filesystem_label,
            dev_root=args.dev_root,
            by_label_root=args.by_label_root,
            sys_class_block=args.sys_class_block,
        )
    except EspDiscoveryError as exc:
        print(f"esp-discovery: ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
