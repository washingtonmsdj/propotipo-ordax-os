#!/usr/bin/env python3
"""Stage a verified OrdaX base candidate into an already-mounted disposable ESP.

This owner deliberately does not mount block devices, set EFI variables or reboot.
Those privileged activation steps remain separate gates.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

HERE = Path(__file__).resolve().parent
_PLAN_SPEC = importlib.util.spec_from_file_location("ordax_base_update_plan", HERE / "plan.py")
_planner = importlib.util.module_from_spec(_PLAN_SPEC)
assert _PLAN_SPEC.loader is not None
_PLAN_SPEC.loader.exec_module(_planner)

ENTRY_MODE = 0o644
COPY_CHUNK = 1024 * 1024


class StageError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(COPY_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_regular_source(path: Path, expected_sha256: str) -> Path:
    try:
        original_metadata = path.lstat()
    except OSError as exc:
        raise StageError(f"candidate source unavailable: {path.name}") from exc
    if stat.S_ISLNK(original_metadata.st_mode):
        raise StageError(f"candidate source must not be a symlink: {path.name}")
    path = path.resolve()
    try:
        metadata = path.stat()
    except OSError as exc:
        raise StageError(f"candidate source unavailable: {path.name}") from exc
    if not stat.S_ISREG(metadata.st_mode):
        raise StageError(f"candidate source is not a regular file: {path.name}")
    actual = sha256_file(path)
    if actual != expected_sha256:
        raise StageError(f"candidate source digest mismatch: {path.name}")
    return path


def target_path(esp_root: Path, absolute_contract_path: str) -> Path:
    if not isinstance(absolute_contract_path, str) or not absolute_contract_path.startswith("/"):
        raise StageError("contract target must be absolute")
    relative = absolute_contract_path.lstrip("/")
    if not relative or ".." in Path(relative).parts:
        raise StageError("unsafe contract target")
    root = esp_root.resolve()
    target = root / relative
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise StageError("contract target escapes ESP root") from exc
    return target


def fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0)
    descriptor = os.open(path, flags)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def ensure_private_parent(root: Path, target: Path) -> None:
    root = root.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    current = target.parent
    while True:
        if current.is_symlink():
            raise StageError("ESP staging path contains a symlink")
        if current == root:
            break
        if root not in current.parents:
            raise StageError("ESP staging parent escapes root")
        current = current.parent


def atomic_copy(source: Path, target: Path, expected_sha256: str) -> None:
    ensure_private_parent(target.parents[len(target.parts) - len(target.parts)], target)


def _atomic_copy(esp_root: Path, source: Path, target: Path, expected_sha256: str) -> None:
    ensure_private_parent(esp_root, target)
    temporary = target.with_name(f".{target.name}.ordax-stage-{os.getpid()}")
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        source_fd = os.open(
            source,
            os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            source_meta_before = os.fstat(source_fd)
            if not stat.S_ISREG(source_meta_before.st_mode):
                raise StageError("candidate source changed type")
            output_fd = os.open(temporary, flags, ENTRY_MODE)
            try:
                digest = hashlib.sha256()
                while True:
                    chunk = os.read(source_fd, COPY_CHUNK)
                    if not chunk:
                        break
                    digest.update(chunk)
                    offset = 0
                    while offset < len(chunk):
                        written = os.write(output_fd, chunk[offset:])
                        if written <= 0:
                            raise StageError("short write while staging base artifact")
                        offset += written
                os.fsync(output_fd)
            finally:
                os.close(output_fd)
            source_meta_after = os.fstat(source_fd)
            if (
                source_meta_before.st_dev != source_meta_after.st_dev
                or source_meta_before.st_ino != source_meta_after.st_ino
                or source_meta_before.st_size != source_meta_after.st_size
                or source_meta_before.st_mtime_ns != source_meta_after.st_mtime_ns
                or source_meta_before.st_ctime_ns != source_meta_after.st_ctime_ns
            ):
                raise StageError("candidate source changed while staging")
            if digest.hexdigest() != expected_sha256:
                raise StageError("candidate source digest changed while staging")
        finally:
            os.close(source_fd)
        os.replace(temporary, target)
        fsync_directory(target.parent)
    except Exception:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise


def write_candidate_entry(esp_root: Path, target: Path, plan: dict) -> None:
    ensure_private_parent(esp_root, target)
    kernel = plan["stage"]["kernel"]["target_path"]
    initramfs = plan["stage"]["initramfs"]["target_path"]
    options = " ".join(plan["stage"]["kernel_options"])
    payload = (
        "title OrdaX Candidate\n"
        f"linux {kernel}\n"
        f"initrd {initramfs}\n"
        f"options console=tty0 {options}\n"
    ).encode("utf-8")
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        descriptor = os.open(target, flags, ENTRY_MODE)
    except FileExistsError as exc:
        raise StageError("candidate boot entry already exists") from exc
    try:
        try:
            offset = 0
            while offset < len(payload):
                written = os.write(descriptor, payload[offset:])
                if written <= 0:
                    raise StageError("short write while staging candidate entry")
                offset += written
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        fsync_directory(target.parent)
    except Exception:
        # A partial candidate marker is never promoted or selected automatically;
        # remove it best-effort and leave the known-good current entry untouched.
        try:
            target.unlink()
            fsync_directory(target.parent)
        except OSError:
            pass
        raise


def snapshot_protected_files(esp_root: Path) -> dict[str, str | None]:
    result = {}
    for relative in (
        "loader/entries/ordax.conf",
        "loader/entries/ordax-recovery.conf",
    ):
        path = esp_root / relative
        result[relative] = sha256_file(path) if path.is_file() and not path.is_symlink() else None
    return result


def stage(
    esp_root: Path,
    active_slot: str,
    candidate: dict,
    kernel_source: Path,
    initramfs_source: Path,
) -> dict:
    esp_root = esp_root.resolve()
    if not esp_root.is_dir() or esp_root.is_symlink():
        raise StageError("ESP root must be an existing directory")
    plan = _planner.plan(active_slot, candidate)
    protected_before = snapshot_protected_files(esp_root)
    if any(value is None for value in protected_before.values()):
        raise StageError("known-good current/recovery entries must exist before staging")

    kernel_source = require_regular_source(
        kernel_source, plan["stage"]["kernel"]["sha256"]
    )
    initramfs_source = require_regular_source(
        initramfs_source, plan["stage"]["initramfs"]["sha256"]
    )
    kernel_target = target_path(esp_root, plan["stage"]["kernel"]["target_path"])
    initramfs_target = target_path(esp_root, plan["stage"]["initramfs"]["target_path"])
    entry_target = target_path(esp_root, plan["stage"]["candidate_entry"])

    # The candidate entry is the activation marker. Refuse to touch candidate
    # bytes when an old marker is present; cleanup requires a separate owner.
    if entry_target.exists() or entry_target.is_symlink():
        raise StageError("candidate boot entry already exists")

    _atomic_copy(
        esp_root,
        kernel_source,
        kernel_target,
        plan["stage"]["kernel"]["sha256"],
    )
    _atomic_copy(
        esp_root,
        initramfs_source,
        initramfs_target,
        plan["stage"]["initramfs"]["sha256"],
    )

    if sha256_file(kernel_target) != plan["stage"]["kernel"]["sha256"]:
        raise StageError("staged kernel verification failed")
    if sha256_file(initramfs_target) != plan["stage"]["initramfs"]["sha256"]:
        raise StageError("staged initramfs verification failed")

    protected_after_artifacts = snapshot_protected_files(esp_root)
    if protected_after_artifacts != protected_before:
        raise StageError("protected boot entries changed during candidate staging")

    write_candidate_entry(esp_root, entry_target, plan)
    fsync_directory(esp_root)

    if snapshot_protected_files(esp_root) != protected_before:
        raise StageError("protected boot entries changed while writing candidate marker")

    return {
        "$schema": "prototype-ordax.base-update-stage-result/1",
        "release_sha": plan["release_sha"],
        "active_slot": plan["active_slot"],
        "candidate_slot": plan["candidate_slot"],
        "kernel_target": plan["stage"]["kernel"]["target_path"],
        "initramfs_target": plan["stage"]["initramfs"]["target_path"],
        "candidate_entry": plan["stage"]["candidate_entry"],
        "activation_ready": True,
        "efi_variable_written": False,
        "reboot_requested": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--esp-root", type=Path, required=True)
    parser.add_argument("--active-slot", choices=("a", "b"), required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--kernel", type=Path, required=True)
    parser.add_argument("--initramfs", type=Path, required=True)
    args = parser.parse_args()
    try:
        candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
        result = stage(
            args.esp_root,
            args.active_slot,
            candidate,
            args.kernel,
            args.initramfs,
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (OSError, json.JSONDecodeError, _planner.PlanError, StageError) as exc:
        print(f"base-update-stage: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
