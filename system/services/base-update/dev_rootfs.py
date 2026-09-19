#!/usr/bin/env python3
"""Materialize Git-delivered development rootfs candidates for one-shot boot.

This module never downloads candidates. The development Base channel verifies
and stores an exact-commit candidate first; this module expands only that local
rootfs.tar into a version directory and arms a small pending pointer.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tarfile
import tempfile

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_ROOTFS_BYTES = 384 * 1024 * 1024
MAX_EXPANDED_BYTES = 320 * 1024 * 1024
MAX_FILES = 50000
MARKER = ".ordax-rootfs-source"
STATE_FILES = {"pending", "current", "previous", "booting", "healthy", "rejected"}
REQUIRED_EXECUTABLES = (
    "bin/sh",
    "usr/bin/git",
    "sbin/ordax-dev-init",
    "usr/local/bin/ordax-network",
    "usr/local/bin/ordax-pull",
    "usr/local/bin/ordax-rollback",
    "usr/local/bin/ordax-run",
)
REQUIRED_MOUNTPOINTS = ("state", "workspace", "home", "versions", "proc", "sys", "dev", "run")


class DevRootfsError(RuntimeError):
    pass


def _sha(value: str) -> str:
    if not isinstance(value, str) or SHA_RE.fullmatch(value) is None:
        raise DevRootfsError("development rootfs source commit is invalid")
    return value


def _safe_dir(path: Path, *, create: bool = False, mode: int = 0o700) -> Path:
    if create:
        path.mkdir(parents=True, exist_ok=True, mode=mode)
    try:
        metadata = path.lstat()
    except FileNotFoundError as exc:
        raise DevRootfsError(f"development rootfs directory is missing: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise DevRootfsError(f"development rootfs directory is unsafe: {path}")
    return path


def _read_manifest(candidate: Path, source_commit: str) -> dict:
    manifest_path = candidate / "dev-base.json"
    try:
        metadata = manifest_path.lstat()
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise DevRootfsError("development Base manifest is unsafe")
        value = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DevRootfsError("development Base manifest cannot be read") from exc

    if (
        not isinstance(value, dict)
        or value.get("$schema") != "prototype-ordax.dev-base-candidate/2"
        or value.get("source_commit") != source_commit
    ):
        raise DevRootfsError("development Base manifest identity is invalid")
    binding = value.get("rootfs")
    if (
        not isinstance(binding, dict)
        or binding.get("name") != "rootfs.tar"
        or not isinstance(binding.get("size"), int)
        or isinstance(binding.get("size"), bool)
        or binding["size"] <= 0
        or binding["size"] > MAX_ROOTFS_BYTES
        or not isinstance(binding.get("sha256"), str)
        or SHA256_RE.fullmatch(binding["sha256"]) is None
    ):
        raise DevRootfsError("development Base rootfs binding is invalid")
    return value


def _verify_tar_binding(candidate: Path, source_commit: str) -> tuple[Path, dict]:
    manifest = _read_manifest(candidate, source_commit)
    binding = manifest["rootfs"]
    archive = candidate / "rootfs.tar"
    try:
        metadata = archive.lstat()
    except FileNotFoundError as exc:
        raise DevRootfsError("development rootfs tar is missing") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise DevRootfsError("development rootfs tar is unsafe")
    if metadata.st_size != binding["size"] or metadata.st_size > MAX_ROOTFS_BYTES:
        raise DevRootfsError("development rootfs tar size differs from manifest")
    digest = hashlib.sha256()
    with archive.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != binding["sha256"]:
        raise DevRootfsError("development rootfs tar SHA-256 differs from manifest")
    return archive, manifest


def _safe_member_name(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if (
        not name
        or name.startswith("/")
        or "\" in name
        or "." in path.parts
        or ".." in path.parts
    ):
        raise DevRootfsError(f"unsafe development rootfs archive path: {name}")
    return path


def _write_member(destination: Path, member: tarfile.TarInfo, source) -> None:
    target = destination.joinpath(*PurePosixPath(member.name).parts)
    if member.isdir():
        target.mkdir(parents=True, exist_ok=True)
        os.chmod(target, member.mode & 0o7777)
        return
    if not member.isreg():
        raise DevRootfsError(f"development rootfs archive contains unsafe object: {member.name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    descriptor = os.open(target, flags, member.mode & 0o7777)
    try:
        remaining = member.size
        while remaining:
            chunk = source.read(min(1024 * 1024, remaining))
            if not chunk:
                raise DevRootfsError(f"development rootfs archive member is truncated: {member.name}")
            offset = 0
            while offset < len(chunk):
                wrote = os.write(descriptor, chunk[offset:])
                if wrote <= 0:
                    raise DevRootfsError("development rootfs extraction made no write progress")
                offset += wrote
            remaining -= len(chunk)
        os.fchmod(descriptor, member.mode & 0o7777)
    finally:
        os.close(descriptor)


def _extract_rootfs(archive: Path, destination: Path) -> None:
    total = 0
    count = 0
    seen: set[str] = set()
    try:
        with tarfile.open(archive, "r:") as handle:
            members = handle.getmembers()
            names = [member.name for member in members]
            if names != sorted(names):
                raise DevRootfsError("development rootfs archive order is not deterministic")
            for member in members:
                path = _safe_member_name(member.name)
                normalized = path.as_posix()
                if normalized in seen:
                    raise DevRootfsError("development rootfs archive contains duplicate paths")
                seen.add(normalized)
                if member.issym() or member.islnk() or member.isdev() or member.isfifo():
                    raise DevRootfsError(f"development rootfs archive contains unsafe object: {normalized}")
                if not (member.isdir() or member.isreg()):
                    raise DevRootfsError(f"development rootfs archive contains unsupported object: {normalized}")
                if member.uid != 0 or member.gid != 0 or member.uname or member.gname or member.mtime != 0:
                    raise DevRootfsError("development rootfs archive metadata is not deterministic")
                if member.isreg():
                    total += member.size
                    if total > MAX_EXPANDED_BYTES:
                        raise DevRootfsError("development rootfs expanded bytes exceed limit")
                count += 1
                if count > MAX_FILES:
                    raise DevRootfsError("development rootfs archive contains too many entries")
                source = handle.extractfile(member) if member.isreg() else None
                _write_member(destination, member, source)
    except tarfile.TarError as exc:
        raise DevRootfsError("development rootfs archive is invalid") from exc


def _validate_version_tree(path: Path, source_commit: str) -> None:
    _safe_dir(path)
    marker = path / MARKER
    try:
        metadata = marker.lstat()
        marker_value = marker.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError) as exc:
        raise DevRootfsError("development rootfs version marker is invalid") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode) or marker_value != source_commit:
        raise DevRootfsError("development rootfs version marker does not match source commit")

    for relative in REQUIRED_EXECUTABLES:
        target = path / relative
        try:
            metadata = target.lstat()
        except FileNotFoundError as exc:
            raise DevRootfsError(f"development rootfs required executable is missing: {relative}") from exc
        if (
            stat.S_ISLNK(metadata.st_mode)
            or not stat.S_ISREG(metadata.st_mode)
            or metadata.st_mode & 0o111 == 0
        ):
            raise DevRootfsError(f"development rootfs required executable is unsafe: {relative}")

    for relative in REQUIRED_MOUNTPOINTS:
        target = path / relative
        _safe_dir(target)


def _read_pointer(state_dir: Path, name: str) -> str | None:
    if name not in STATE_FILES:
        raise DevRootfsError("unknown development rootfs state pointer")
    path = state_dir / name
    try:
        metadata = path.lstat()
        value = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError) as exc:
        raise DevRootfsError(f"development rootfs state is unreadable: {name}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise DevRootfsError(f"development rootfs state is unsafe: {name}")
    if SHA_RE.fullmatch(value) is None:
        raise DevRootfsError(f"development rootfs state is malformed: {name}")
    return value


def _fsync_dir(path: Path) -> None:
    descriptor = os.open(
        path,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0),
    )
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_pointer(state_dir: Path, name: str, value: str) -> None:
    _sha(value)
    if name not in STATE_FILES:
        raise DevRootfsError("unknown development rootfs state pointer")
    temporary = state_dir / f".{name}.tmp.{os.getpid()}"
    target = state_dir / name
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    descriptor = os.open(temporary, flags, 0o600)
    try:
        payload = f"{value}\n".encode("ascii")
        offset = 0
        while offset < len(payload):
            wrote = os.write(descriptor, payload[offset:])
            if wrote <= 0:
                raise DevRootfsError("development rootfs pointer write made no progress")
            offset += wrote
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.replace(temporary, target)
    _fsync_dir(state_dir)


def _cleanup_staging(version_root: Path) -> None:
    for child in version_root.iterdir():
        if not child.name.startswith(".staging-"):
            continue
        metadata = child.lstat()
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
            raise DevRootfsError("unsafe development rootfs staging residue")
        shutil.rmtree(child)
    _fsync_dir(version_root)


def materialize_rootfs_candidate(
    candidate: Path,
    source_commit: str,
    *,
    version_root: Path = Path("/versions"),
    state_dir: Path = Path("/state/ordax/base-update/rootfs"),
) -> tuple[Path, bool]:
    source_commit = _sha(source_commit)
    candidate = _safe_dir(candidate)
    archive, _manifest = _verify_tar_binding(candidate, source_commit)

    version_root.mkdir(parents=True, exist_ok=True, mode=0o755)
    _safe_dir(version_root)
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    _safe_dir(state_dir)
    _cleanup_staging(version_root)

    target = version_root / source_commit
    reused = False
    if target.exists():
        _validate_version_tree(target, source_commit)
        reused = True
    else:
        temporary = Path(
            tempfile.mkdtemp(
                prefix=f".staging-{source_commit}-",
                dir=version_root,
            )
        )
        committed = False
        try:
            _extract_rootfs(archive, temporary)
            for relative in REQUIRED_MOUNTPOINTS:
                (temporary / relative).mkdir(parents=True, exist_ok=True)
            marker = temporary / MARKER
            marker.write_text(source_commit + "\n", encoding="ascii")
            marker.chmod(0o600)
            _validate_version_tree(temporary, source_commit)
            os.sync()
            os.rename(temporary, target)
            committed = True
            _fsync_dir(version_root)
        finally:
            if not committed and temporary.exists():
                shutil.rmtree(temporary)
        _validate_version_tree(target, source_commit)

    current = _read_pointer(state_dir, "current")
    pending = _read_pointer(state_dir, "pending")
    booting = _read_pointer(state_dir, "booting")

    if current == source_commit:
        return target, reused
    if booting is not None and booting != source_commit:
        raise DevRootfsError("another development rootfs is currently in its boot trial")
    if pending == source_commit:
        return target, reused
    if pending is not None and pending != source_commit:
        _write_pointer(state_dir, "rejected", pending)
    _write_pointer(state_dir, "pending", source_commit)
    return target, reused
