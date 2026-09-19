#!/usr/bin/env python3
"""Build/verify an immutable development Base descriptor from CI-built bytes."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tarfile
import sys

SCHEMA = "prototype-ordax.dev-base-candidate/3"
REPOSITORY = "washingtonmsdj/prototipo-ordax-os"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_KERNEL_BYTES = 64 * 1024 * 1024
MAX_INITRAMFS_BYTES = 128 * 1024 * 1024
MAX_ROOTFS_BYTES = 384 * 1024 * 1024
MAX_ROOTFS_EXPANDED_BYTES = 320 * 1024 * 1024
ROOTFS_PROVENANCE_SCHEMA = "prototype-ordax.dev-base/1"
REQUIRED_ROOTFS_PATHS = (
    "bin/busybox",
    "bin/sh",
    "usr/bin/git",
    "sbin/ordax-dev-init",
    "usr/local/bin/ordax-network",
    "usr/local/bin/ordax-pull",
    "usr/local/bin/ordax-rollback",
    "usr/local/bin/ordax-run",
)


class CandidateError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def regular_file(path: Path, label: str, max_bytes: int) -> Path:
    if path.is_symlink() or not path.is_file():
        raise CandidateError(f"{label} is missing or unsafe")
    size = path.stat().st_size
    if size <= 0 or size > max_bytes:
        raise CandidateError(f"{label} size is outside allowed range")
    return path


def read_json(path: Path, label: str) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise CandidateError(f"{label} is missing or unsafe")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CandidateError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict):
        raise CandidateError(f"{label} must be an object")
    return value


def artifact_from_provenance(
    provenance: dict,
    directory: Path,
    *,
    source_commit: str,
    artifact_name: str | None = None,
    artifact_prefix: str | None = None,
    max_bytes: int,
) -> Path:
    if provenance.get("source_commit") != source_commit:
        raise CandidateError("build provenance source commit does not match candidate")
    artifacts = provenance.get("artifacts")
    if not isinstance(artifacts, dict) or not artifacts:
        raise CandidateError("build provenance artifact map is invalid")
    if artifact_name is not None:
        names = [artifact_name] if artifact_name in artifacts else []
    else:
        names = [name for name in artifacts if name.startswith(artifact_prefix or "")]
    if len(names) != 1:
        raise CandidateError("build provenance does not bind exactly one requested artifact")
    name = names[0]
    expected = artifacts.get(name)
    if not isinstance(expected, str) or SHA256_RE.fullmatch(expected) is None:
        raise CandidateError("build provenance artifact hash is invalid")
    path = regular_file(directory / name, f"candidate artifact {name}", max_bytes)
    if sha256_file(path) != expected:
        raise CandidateError(f"candidate artifact {name} differs from provenance")
    return path


def validate_rootfs_source(rootfs_dir: Path, source_commit: str) -> Path:
    provenance = read_json(rootfs_dir / "provenance.json", "development rootfs provenance")
    if provenance.get("$schema") != ROOTFS_PROVENANCE_SCHEMA:
        raise CandidateError("development rootfs provenance schema is invalid")
    if provenance.get("source_commit") != source_commit:
        raise CandidateError("development rootfs provenance source commit does not match candidate")
    measured = provenance.get("unique_regular_bytes")
    if not isinstance(measured, int) or isinstance(measured, bool) or measured <= 0:
        raise CandidateError("development rootfs provenance size is invalid")
    if measured > 220 * 1024 * 1024:
        raise CandidateError("development rootfs provenance exceeds builder size policy")
    if provenance.get("git_client_preseeded") is not True:
        raise CandidateError("development rootfs must contain the Git acquisition client")
    if provenance.get("network_preseeded") is not True:
        raise CandidateError("development rootfs must contain the network substrate")

    rootfs = rootfs_dir / "rootfs"
    if rootfs.is_symlink() or not rootfs.is_dir():
        raise CandidateError("development rootfs tree is missing or unsafe")
    total = 0
    for path in sorted(rootfs.rglob("*"), key=lambda item: item.relative_to(rootfs).as_posix()):
        metadata = path.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            raise CandidateError(f"development rootfs contains symlink: {path.relative_to(rootfs)}")
        if stat.S_ISDIR(metadata.st_mode):
            continue
        if not stat.S_ISREG(metadata.st_mode):
            raise CandidateError(f"development rootfs contains unsafe object: {path.relative_to(rootfs)}")
        total += metadata.st_size
        if total > MAX_ROOTFS_EXPANDED_BYTES:
            raise CandidateError("development rootfs expanded bytes exceed channel limit")
    for relative in REQUIRED_ROOTFS_PATHS:
        path = rootfs / relative
        if path.is_symlink() or not path.is_file():
            raise CandidateError(f"development rootfs required file is missing: {relative}")
        if path.stat().st_mode & 0o111 == 0:
            raise CandidateError(f"development rootfs required file is not executable: {relative}")
    return rootfs


def build_rootfs_tar(rootfs: Path, destination: Path) -> None:
    with tarfile.open(destination, "w", format=tarfile.GNU_FORMAT) as archive:
        for path in sorted(rootfs.rglob("*"), key=lambda item: item.relative_to(rootfs).as_posix()):
            relative = path.relative_to(rootfs).as_posix()
            metadata = path.lstat()
            if stat.S_ISLNK(metadata.st_mode):
                raise CandidateError(f"development rootfs contains symlink: {relative}")
            info = tarfile.TarInfo(relative)
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            info.mtime = 0
            info.mode = stat.S_IMODE(metadata.st_mode)
            if stat.S_ISDIR(metadata.st_mode):
                info.type = tarfile.DIRTYPE
                info.size = 0
                archive.addfile(info)
            elif stat.S_ISREG(metadata.st_mode):
                info.type = tarfile.REGTYPE
                info.size = metadata.st_size
                with path.open("rb") as handle:
                    archive.addfile(info, handle)
            else:
                raise CandidateError(f"development rootfs contains unsafe object: {relative}")
    regular_file(destination, "development rootfs tar", MAX_ROOTFS_BYTES)


def verify_rootfs_tar(path: Path) -> None:
    regular_file(path, "development rootfs tar", MAX_ROOTFS_BYTES)
    names: list[str] = []
    total = 0
    required = set(REQUIRED_ROOTFS_PATHS)
    seen: set[str] = set()
    try:
        with tarfile.open(path, "r:") as archive:
            for member in archive.getmembers():
                name = member.name
                relative = Path(name)
                if (
                    not name
                    or relative.is_absolute()
                    or ".." in relative.parts
                    or name in seen
                ):
                    raise CandidateError("development rootfs tar contains unsafe or duplicate path")
                seen.add(name)
                names.append(name)
                if member.uid != 0 or member.gid != 0 or member.uname or member.gname or member.mtime != 0:
                    raise CandidateError("development rootfs tar metadata is not deterministic")
                if member.isdir():
                    continue
                if not member.isreg():
                    raise CandidateError(f"development rootfs tar contains unsafe member: {name}")
                total += member.size
                if total > MAX_ROOTFS_EXPANDED_BYTES:
                    raise CandidateError("development rootfs tar expanded bytes exceed channel limit")
    except tarfile.TarError as exc:
        raise CandidateError("development rootfs tar is invalid") from exc
    if names != sorted(names):
        raise CandidateError("development rootfs tar entries are not deterministic")
    missing = sorted(required - seen)
    if missing:
        raise CandidateError(f"development rootfs tar is missing required files: {missing}")

def binding(name: str, path: Path, source_commit: str) -> dict:
    tag = f"ordax-dev-base-{source_commit}"
    return {
        "name": name,
        "url": (
            f"https://github.com/{REPOSITORY}/releases/download/"
            f"{tag}/{name}"
        ),
        "sha256": sha256_file(path),
        "size": path.stat().st_size,
    }


def build(
    *,
    source_commit: str,
    kernel_dir: Path,
    initramfs_dir: Path,
    rootfs_dir: Path,
    out_dir: Path,
) -> dict:
    if SHA40_RE.fullmatch(source_commit) is None:
        raise CandidateError("source commit must be lowercase 40-hex")

    kernel_provenance = read_json(
        kernel_dir / "kernel-provenance.json",
        "kernel provenance",
    )
    initramfs_provenance = read_json(
        initramfs_dir / "initramfs-provenance.json",
        "initramfs provenance",
    )
    kernel = artifact_from_provenance(
        kernel_provenance,
        kernel_dir,
        source_commit=source_commit,
        artifact_prefix="vmlinuz-",
        max_bytes=MAX_KERNEL_BYTES,
    )
    initramfs = artifact_from_provenance(
        initramfs_provenance,
        initramfs_dir,
        source_commit=source_commit,
        artifact_name="initramfs.cpio.gz",
        max_bytes=MAX_INITRAMFS_BYTES,
    )
    rootfs = validate_rootfs_source(rootfs_dir, source_commit)

    out_dir.mkdir(parents=True, exist_ok=True)
    for child in out_dir.iterdir():
        raise CandidateError(f"output directory must be empty: {child.name}")

    kernel_out = out_dir / "vmlinuz"
    initramfs_out = out_dir / "initrd.gz"
    rootfs_out = out_dir / "rootfs.tar"
    shutil.copyfile(kernel, kernel_out)
    shutil.copyfile(initramfs, initramfs_out)
    build_rootfs_tar(rootfs, rootfs_out)

    tag = f"ordax-dev-base-{source_commit}"
    descriptor = {
        "$schema": SCHEMA,
        "status": "development-candidate",
        "source_repository": REPOSITORY,
        "source_commit": source_commit,
        "tag": tag,
        "activation": "inactive-slot-next-boot",
        "rootfs_activation": "slot-coupled-one-shot-health-gated",
        "manual_usb_rewrite_required": False,
        "kernel": binding("vmlinuz", kernel_out, source_commit),
        "initramfs": binding("initrd.gz", initramfs_out, source_commit),
        "rootfs": binding("rootfs.tar", rootfs_out, source_commit),
    }
    (out_dir / "dev-base.json").write_text(
        json.dumps(descriptor, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    verify(out_dir)
    return descriptor


def validate_binding(value: object, expected_name: str, source_commit: str) -> dict:
    if not isinstance(value, dict) or set(value) != {"name", "url", "sha256", "size"}:
        raise CandidateError(f"{expected_name} binding is malformed")
    if value["name"] != expected_name:
        raise CandidateError(f"{expected_name} binding name is invalid")
    tag = f"ordax-dev-base-{source_commit}"
    expected_url = (
        f"https://github.com/{REPOSITORY}/releases/download/{tag}/{expected_name}"
    )
    if value["url"] != expected_url:
        raise CandidateError(f"{expected_name} binding URL is not canonical")
    if not isinstance(value["sha256"], str) or SHA256_RE.fullmatch(value["sha256"]) is None:
        raise CandidateError(f"{expected_name} binding hash is invalid")
    if not isinstance(value["size"], int) or isinstance(value["size"], bool) or value["size"] <= 0:
        raise CandidateError(f"{expected_name} binding size is invalid")
    return value


def validate_descriptor(value: object) -> dict:
    expected = {
        "$schema",
        "status",
        "source_repository",
        "source_commit",
        "tag",
        "activation",
        "rootfs_activation",
        "manual_usb_rewrite_required",
        "kernel",
        "initramfs",
        "rootfs",
    }
    if not isinstance(value, dict) or set(value) != expected:
        raise CandidateError("development Base descriptor fields are not canonical")
    if value["$schema"] != SCHEMA or value["status"] != "development-candidate":
        raise CandidateError("unsupported development Base descriptor")
    if value["source_repository"] != REPOSITORY:
        raise CandidateError("development Base source repository is invalid")
    source_commit = value["source_commit"]
    if not isinstance(source_commit, str) or SHA40_RE.fullmatch(source_commit) is None:
        raise CandidateError("development Base source commit is invalid")
    if value["tag"] != f"ordax-dev-base-{source_commit}":
        raise CandidateError("development Base tag is invalid")
    if value["activation"] != "inactive-slot-next-boot":
        raise CandidateError("development Base activation policy is invalid")
    if value["rootfs_activation"] != "slot-coupled-one-shot-health-gated":
        raise CandidateError("development Base rootfs activation policy is invalid")
    if value["manual_usb_rewrite_required"] is not False:
        raise CandidateError("development Base unexpectedly requires USB rewrite")
    validate_binding(value["kernel"], "vmlinuz", source_commit)
    validate_binding(value["initramfs"], "initrd.gz", source_commit)
    validate_binding(value["rootfs"], "rootfs.tar", source_commit)
    return value


def verify(out_dir: Path) -> dict:
    descriptor = validate_descriptor(
        read_json(out_dir / "dev-base.json", "development Base descriptor")
    )
    for key, max_bytes in (
        ("kernel", MAX_KERNEL_BYTES),
        ("initramfs", MAX_INITRAMFS_BYTES),
        ("rootfs", MAX_ROOTFS_BYTES),
    ):
        item = descriptor[key]
        path = regular_file(
            out_dir / item["name"],
            f"development Base {key}",
            max_bytes,
        )
        if path.stat().st_size != item["size"] or sha256_file(path) != item["sha256"]:
            raise CandidateError(f"development Base {key} differs from descriptor")
        if key == "rootfs":
            verify_rootfs_tar(path)
    return descriptor


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--source-commit", required=True)
    build_parser.add_argument("--kernel-dir", type=Path, default=Path("out/kernel"))
    build_parser.add_argument("--initramfs-dir", type=Path, default=Path("out/initramfs"))
    build_parser.add_argument("--rootfs-dir", type=Path, default=Path("out/dev-rootfs"))
    build_parser.add_argument("--out-dir", type=Path, default=Path("out/dev-base"))
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--out-dir", type=Path, default=Path("out/dev-base"))
    args = parser.parse_args()
    try:
        if args.command == "check":
            print("DEV_BASE_CHANNEL_CONTRACT=PASS")
            return 0
        if args.command == "build":
            result = build(
                source_commit=args.source_commit,
                kernel_dir=args.kernel_dir,
                initramfs_dir=args.initramfs_dir,
                rootfs_dir=args.rootfs_dir,
                out_dir=args.out_dir,
            )
        else:
            result = verify(args.out_dir)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (CandidateError, OSError) as exc:
        print(f"dev-base-candidate: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
