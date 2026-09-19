#!/usr/bin/env python3
"""Physically stage a development Base into the inactive OrdaX ESP slot.

This helper is deliberately stage-only. It performs a fresh read-only ESP
preflight, revalidates the device immediately before a restrictive read-write
mount, delegates filesystem writes to the shared development A/B stager, checks
the resulting layout, and unmounts before returning. It never arms a one-shot
boot entry, touches EFI variables, changes the default entry, or requests a
reboot.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
SOURCE_ROOT = HERE.parents[2]
SCHEMA = "prototype-ordax.dev-base-physical-stage/1"
RW_MOUNT_OPTIONS = {"rw", "nosuid", "nodev", "noexec"}


class PhysicalDevStageError(RuntimeError):
    pass


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise PhysicalDevStageError(f"cannot load dependency: {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_discovery = _load(HERE / "esp_discovery.py", "ordax_physical_stage_discovery")
_layout = _load(HERE / "esp_layout.py", "ordax_physical_stage_layout")
_readonly = _load(HERE / "esp_readonly.py", "ordax_physical_stage_readonly")
_dev_stage = _load(HERE / "dev_stage.py", "ordax_physical_stage_dev_stage")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise PhysicalDevStageError(f"cannot hash staged artifact: {path.name}") from exc
    return digest.hexdigest()


def _expected_candidate_slot(active_slot: str) -> str:
    if active_slot in {"legacy", "a"}:
        return "b"
    if active_slot == "b":
        return "a"
    raise PhysicalDevStageError("active slot from ESP layout is invalid")


def _verified_candidate_manifest(
    candidate_root: Path,
    version_root: Path,
    source_commit: str,
) -> dict:
    try:
        manifest = _dev_stage._channel.verify_materialized(
            candidate_root / source_commit,
            source_commit,
        )
        _dev_stage._channel.verify_versioned_rootfs(
            version_root / source_commit,
            source_commit,
        )
    except _dev_stage._channel.DevBaseChannelError as exc:
        raise PhysicalDevStageError(str(exc)) from exc
    return manifest


def _verify_existing_stage(
    esp_root: Path,
    layout: dict,
    manifest: dict,
    source_commit: str,
) -> dict | None:
    if not layout["candidate_entry_present"]:
        return None
    if layout["candidate_release_sha"] != source_commit:
        raise PhysicalDevStageError("ESP already contains a different staged candidate")

    expected_slot = _expected_candidate_slot(layout["stage_active_slot"])
    if layout["candidate_slot"] != expected_slot:
        raise PhysicalDevStageError("existing candidate is not in the inactive slot")

    kernel = esp_root / f"ordax/base/{expected_slot}/vmlinuz"
    initramfs = esp_root / f"ordax/base/{expected_slot}/initrd.gz"
    if _sha256(kernel) != manifest["kernel"]["sha256"]:
        raise PhysicalDevStageError("existing staged kernel differs from development candidate")
    if _sha256(initramfs) != manifest["initramfs"]["sha256"]:
        raise PhysicalDevStageError("existing staged initramfs differs from development candidate")

    return {
        "$schema": SCHEMA,
        "status": "already-staged",
        "source_commit": source_commit,
        "active_slot": layout["stage_active_slot"],
        "candidate_slot": expected_slot,
        "candidate_entry_present": True,
        "candidate_manifest_verified": True,
        "versioned_rootfs_verified": True,
        "stage_performed": False,
        "idempotent": True,
        "activation_ready": True,
        "activation_performed": False,
        "efi_variable_written": False,
        "reboot_requested": False,
        "write_authorized_beyond_stage": False,
    }


def physical_stage(
    *,
    repo_root: Path,
    root_source: Path,
    candidate_root: Path,
    version_root: Path,
    source_commit: str,
    mount_root: Path,
    dev_root: Path = Path("/dev"),
    by_label_root: Path = Path("/dev/disk/by-label"),
    sys_class_block: Path = Path("/sys/class/block"),
    mountinfo: Path = Path("/proc/self/mountinfo"),
    mount_command: Path = Path("/bin/mount"),
    umount_command: Path = Path("/bin/umount"),
) -> dict:
    manifest = _verified_candidate_manifest(
        candidate_root,
        version_root,
        source_commit,
    )

    try:
        read_only = _readonly.readonly_preflight(
            root_source=root_source,
            mount_root=mount_root,
            dev_root=dev_root,
            by_label_root=by_label_root,
            sys_class_block=sys_class_block,
            mountinfo=mountinfo,
            mount_command=mount_command,
            umount_command=umount_command,
        )
    except _readonly.EspReadonlyPreflightError as exc:
        raise PhysicalDevStageError(str(exc)) from exc

    preflight_layout = read_only["layout"]
    if preflight_layout["candidate_entry_present"]:
        # Reopen read-only once more so the already-staged hashes are verified
        # against the exact candidate without ever transitioning to rw.
        try:
            discovered = _discovery.discover_esp(
                root_source=root_source,
                dev_root=dev_root,
                by_label_root=by_label_root,
                sys_class_block=sys_class_block,
            )
        except _discovery.EspDiscoveryError as exc:
            raise PhysicalDevStageError(str(exc)) from exc

        esp_device = Path(discovered["esp_device"])
        _readonly._run_mount_command(
            [
                str(mount_command),
                "-t",
                "vfat",
                "-o",
                "ro,nosuid,nodev,noexec",
                str(esp_device),
                str(mount_root),
            ],
            "read-only ESP idempotence mount",
        )
        try:
            current = _layout.inspect_layout(mount_root)
            result = _verify_existing_stage(
                mount_root,
                current,
                manifest,
                source_commit,
            )
            if result is None:
                raise PhysicalDevStageError("candidate disappeared during idempotence check")
        finally:
            _readonly._run_mount_command(
                [str(umount_command), str(mount_root)],
                "ESP unmount",
            )
        if _readonly._mount_record(mountinfo, mount_root) is not None:
            raise PhysicalDevStageError("ESP remained mounted after idempotence check")
        result["mount_released"] = True
        return result

    try:
        discovered = _discovery.discover_esp(
            root_source=root_source,
            dev_root=dev_root,
            by_label_root=by_label_root,
            sys_class_block=sys_class_block,
        )
    except _discovery.EspDiscoveryError as exc:
        raise PhysicalDevStageError(str(exc)) from exc

    if discovered["esp_device"] != read_only["esp_device"]:
        raise PhysicalDevStageError("ORDAX-ESP identity changed after read-only preflight")

    esp_device = Path(discovered["esp_device"])
    mounted = False
    stage_result = None
    try:
        _readonly._run_mount_command(
            [
                str(mount_command),
                "-t",
                "vfat",
                "-o",
                "rw,nosuid,nodev,noexec,umask=0022",
                str(esp_device),
                str(mount_root),
            ],
            "ESP staging mount",
        )
        mounted = True

        record = _readonly._mount_record(mountinfo, mount_root)
        if record is None:
            raise PhysicalDevStageError("ESP staging mount is not observable")
        if record["root"] != "/" or record["filesystem"] != "vfat":
            raise PhysicalDevStageError("ESP staging mount identity is invalid")
        if record["source"] != str(esp_device):
            raise PhysicalDevStageError("ESP staging mount source changed")
        if not RW_MOUNT_OPTIONS.issubset(record["options"]):
            raise PhysicalDevStageError("ESP staging mount options are insufficient")

        try:
            revalidated = _discovery.discover_esp(
                root_source=root_source,
                dev_root=dev_root,
                by_label_root=by_label_root,
                sys_class_block=sys_class_block,
            )
        except _discovery.EspDiscoveryError as exc:
            raise PhysicalDevStageError(str(exc)) from exc
        if revalidated["esp_device"] != str(esp_device):
            raise PhysicalDevStageError("ORDAX-ESP identity changed during staging mount")

        current_layout = _layout.inspect_layout(mount_root)
        for key in (
            "layout",
            "stage_active_slot",
            "active_slot",
            "recovery_slot",
            "candidate_entry_present",
        ):
            if current_layout[key] != preflight_layout[key]:
                raise PhysicalDevStageError("ESP layout changed after read-only preflight")
        if current_layout["candidate_entry_present"]:
            raise PhysicalDevStageError("candidate appeared before staging")

        try:
            stage_result = _dev_stage.stage_ready_candidate(
                repo_root=repo_root,
                esp_root=mount_root,
                active_slot=current_layout["stage_active_slot"],
                candidate_root=candidate_root,
                version_root=version_root,
                source_commit=source_commit,
            )
        except _dev_stage.DevStageError as exc:
            raise PhysicalDevStageError(str(exc)) from exc

        after = _layout.inspect_layout(mount_root)
        expected_slot = _expected_candidate_slot(current_layout["stage_active_slot"])
        if not after["candidate_entry_present"]:
            raise PhysicalDevStageError("shared stager did not create a candidate entry")
        if after["candidate_release_sha"] != source_commit:
            raise PhysicalDevStageError("staged candidate commit identity is wrong")
        if after["candidate_slot"] != expected_slot:
            raise PhysicalDevStageError("staged candidate is not in the inactive slot")
        if after["active_slot"] != current_layout["active_slot"]:
            raise PhysicalDevStageError("staging changed the known-good current slot")
        if after["recovery_slot"] != current_layout["recovery_slot"]:
            raise PhysicalDevStageError("staging changed the known-good recovery slot")

        if hasattr(os, "sync"):
            os.sync()

        result = {
            "$schema": SCHEMA,
            "status": "staged",
            "source_commit": source_commit,
            "active_slot": current_layout["stage_active_slot"],
            "candidate_slot": expected_slot,
            "candidate_entry_present": True,
            "candidate_manifest_verified": True,
            "versioned_rootfs_verified": True,
            "stage_performed": True,
            "idempotent": False,
            "activation_ready": bool(stage_result["activation_ready"]),
            "activation_performed": False,
            "efi_variable_written": False,
            "reboot_requested": False,
            "write_authorized_beyond_stage": False,
        }
    except Exception:
        if mounted:
            try:
                _readonly._run_mount_command(
                    [str(umount_command), str(mount_root)],
                    "ESP unmount",
                )
            except _readonly.EspReadonlyPreflightError:
                pass
        raise

    _readonly._run_mount_command(
        [str(umount_command), str(mount_root)],
        "ESP unmount",
    )
    mounted = False
    if _readonly._mount_record(mountinfo, mount_root) is not None:
        raise PhysicalDevStageError("ESP remained mounted after staging")
    result["mount_released"] = True
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=SOURCE_ROOT)
    parser.add_argument("--root-source", type=Path, required=True)
    parser.add_argument("--candidate-root", type=Path, required=True)
    parser.add_argument("--version-root", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument(
        "--mount-root",
        type=Path,
        default=Path("/run/ordax-base-owner/esp-stage"),
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
        value = physical_stage(
            repo_root=args.repo_root,
            root_source=args.root_source,
            candidate_root=args.candidate_root,
            version_root=args.version_root,
            source_commit=args.source_commit,
            mount_root=args.mount_root,
            dev_root=args.dev_root,
            by_label_root=args.by_label_root,
            sys_class_block=args.sys_class_block,
            mountinfo=args.mountinfo,
        )
    except PhysicalDevStageError as exc:
        print(f"dev-base-physical-stage: ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(value, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
