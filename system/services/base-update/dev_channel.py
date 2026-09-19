#!/usr/bin/env python3
"""Acquire an exact-commit OrdaX development Base candidate.

Development mode deliberately uses the public repository + exact commit as its
authority. Production release signing remains a separate path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import tarfile
import urllib.error
import urllib.request

SCHEMA = "prototype-ordax.dev-base-candidate/3"
REPOSITORY = "washingtonmsdj/prototipo-ordax-os"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_MANIFEST_BYTES = 64 * 1024
MAX_KERNEL_BYTES = 64 * 1024 * 1024
MAX_INITRAMFS_BYTES = 128 * 1024 * 1024
MAX_ROOTFS_BYTES = 384 * 1024 * 1024
MAX_ROOTFS_EXPANDED_BYTES = 320 * 1024 * 1024
MAX_ROOTFS_MEMBERS = 200_000
ROOTFS_MARKER = ".ordax-rootfs-commit"
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
REQUIRED_ROOTFS_DIRS = (
    "state",
    "workspace",
    "home",
    "proc",
    "sys",
    "dev",
    "run",
)
DOWNLOAD_TIMEOUT_SECONDS = 45
ROOTFS_DOWNLOAD_TIMEOUT_SECONDS = 180


class DevBaseChannelError(RuntimeError):
    pass


class DevBaseCandidateUnavailable(DevBaseChannelError):
    pass


def candidate_tag(source_commit: str) -> str:
    if SHA40_RE.fullmatch(source_commit) is None:
        raise DevBaseChannelError("development Base source commit is invalid")
    return f"ordax-dev-base-{source_commit}"


def manifest_url(source_commit: str) -> str:
    tag = candidate_tag(source_commit)
    return (
        f"https://github.com/{REPOSITORY}/releases/download/"
        f"{tag}/dev-base.json"
    )


def _validate_binding(value: object, name: str, source_commit: str) -> dict:
    if not isinstance(value, dict) or set(value) != {"name", "url", "sha256", "size"}:
        raise DevBaseChannelError(f"development Base {name} binding is malformed")
    if value["name"] != name:
        raise DevBaseChannelError(f"development Base {name} name is invalid")
    tag = candidate_tag(source_commit)
    expected_url = (
        f"https://github.com/{REPOSITORY}/releases/download/{tag}/{name}"
    )
    if value["url"] != expected_url:
        raise DevBaseChannelError(f"development Base {name} URL is not canonical")
    digest = value["sha256"]
    size = value["size"]
    if not isinstance(digest, str) or SHA256_RE.fullmatch(digest) is None:
        raise DevBaseChannelError(f"development Base {name} SHA-256 is invalid")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise DevBaseChannelError(f"development Base {name} size is invalid")
    return value


def validate_manifest(value: object, expected_commit: str) -> dict:
    candidate_tag(expected_commit)
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
        raise DevBaseChannelError("development Base manifest fields are not canonical")
    if value["$schema"] != SCHEMA or value["status"] != "development-candidate":
        raise DevBaseChannelError("unsupported development Base manifest")
    if value["source_repository"] != REPOSITORY:
        raise DevBaseChannelError("development Base repository identity is invalid")
    if value["source_commit"] != expected_commit:
        raise DevBaseChannelError("development Base commit does not match requested checkout")
    if value["tag"] != candidate_tag(expected_commit):
        raise DevBaseChannelError("development Base tag does not match requested checkout")
    if value["activation"] != "inactive-slot-next-boot":
        raise DevBaseChannelError("development Base activation policy is invalid")
    if value["rootfs_activation"] != "slot-coupled-one-shot-health-gated":
        raise DevBaseChannelError("development Base rootfs activation policy is invalid")
    if value["manual_usb_rewrite_required"] is not False:
        raise DevBaseChannelError("development Base unexpectedly requires USB rewrite")
    _validate_binding(value["kernel"], "vmlinuz", expected_commit)
    _validate_binding(value["initramfs"], "initrd.gz", expected_commit)
    _validate_binding(value["rootfs"], "rootfs.tar", expected_commit)
    if value["kernel"]["size"] > MAX_KERNEL_BYTES:
        raise DevBaseChannelError("development Base kernel exceeds size limit")
    if value["initramfs"]["size"] > MAX_INITRAMFS_BYTES:
        raise DevBaseChannelError("development Base initramfs exceeds size limit")
    if value["rootfs"]["size"] > MAX_ROOTFS_BYTES:
        raise DevBaseChannelError("development Base rootfs exceeds size limit")
    return value


def _fetch_bytes(
    url: str,
    max_bytes: int,
    *,
    opener=urllib.request.urlopen,
) -> bytes:
    try:
        response = opener(url, timeout=DOWNLOAD_TIMEOUT_SECONDS)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise DevBaseCandidateUnavailable("development Base candidate is not published yet") from exc
        raise DevBaseChannelError(f"development Base download returned HTTP {exc.code}") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise DevBaseCandidateUnavailable("development Base channel is temporarily unavailable") from exc

    try:
        status = getattr(response, "status", 200)
        final_url = response.geturl()
        if status != 200:
            if status == 404:
                raise DevBaseCandidateUnavailable("development Base candidate is not published yet")
            raise DevBaseChannelError(f"development Base download returned HTTP {status}")
        if not isinstance(final_url, str) or not final_url.startswith("https://"):
            raise DevBaseChannelError("development Base download left HTTPS")
        payload = response.read(max_bytes + 1)
        if len(payload) > max_bytes:
            raise DevBaseChannelError("development Base download exceeds size limit")
        return payload
    finally:
        try:
            response.close()
        except Exception:
            pass


def _verify_payload(payload: bytes, binding: dict, label: str) -> None:
    if len(payload) != binding["size"]:
        raise DevBaseChannelError(f"development Base {label} size mismatch")
    if hashlib.sha256(payload).hexdigest() != binding["sha256"]:
        raise DevBaseChannelError(f"development Base {label} SHA-256 mismatch")


def _download_binding_to_path(
    binding: dict,
    destination: Path,
    max_bytes: int,
    *,
    opener=urllib.request.urlopen,
    timeout_seconds: int,
) -> None:
    url = binding["url"]
    try:
        response = opener(url, timeout=timeout_seconds)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise DevBaseCandidateUnavailable("development Base candidate is not published yet") from exc
        raise DevBaseChannelError(f"development Base download returned HTTP {exc.code}") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise DevBaseCandidateUnavailable("development Base channel is temporarily unavailable") from exc

    descriptor = -1
    try:
        status = getattr(response, "status", 200)
        final_url = response.geturl()
        if status != 200:
            if status == 404:
                raise DevBaseCandidateUnavailable("development Base candidate is not published yet")
            raise DevBaseChannelError(f"development Base download returned HTTP {status}")
        if not isinstance(final_url, str) or not final_url.startswith("https://"):
            raise DevBaseChannelError("development Base download left HTTPS")

        descriptor = os.open(
            destination,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise DevBaseChannelError("development Base download exceeds size limit")
            offset = 0
            while offset < len(chunk):
                written = os.write(descriptor, chunk[offset:])
                if written <= 0:
                    raise DevBaseChannelError("development Base streamed write made no progress")
                offset += written
            digest.update(chunk)
        if total != binding["size"]:
            raise DevBaseChannelError("development Base rootfs size mismatch")
        if digest.hexdigest() != binding["sha256"]:
            raise DevBaseChannelError("development Base rootfs SHA-256 mismatch")
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
    except Exception:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            destination.unlink()
        except FileNotFoundError:
            pass
        raise
    finally:
        try:
            response.close()
        except Exception:
            pass

def _write_synced(path: Path, payload: bytes, mode: int = 0o600) -> None:
    descriptor = os.open(
        path,
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0),
        mode,
    )
    try:
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                raise DevBaseChannelError("development Base candidate write made no progress")
            offset += written
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


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


def _validate_rootfs_archive(path: Path) -> list[tarfile.TarInfo]:
    members: list[tarfile.TarInfo] = []
    seen: set[str] = set()
    expanded = 0
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
                    raise DevBaseChannelError(
                        "development rootfs archive contains unsafe or duplicate path"
                    )
                if member.issym() or member.islnk() or not (member.isdir() or member.isreg()):
                    raise DevBaseChannelError(
                        f"development rootfs archive contains unsafe member: {name}"
                    )
                seen.add(name)
                members.append(member)
                if len(members) > MAX_ROOTFS_MEMBERS:
                    raise DevBaseChannelError("development rootfs archive has too many members")
                if member.isreg():
                    expanded += member.size
                    if expanded > MAX_ROOTFS_EXPANDED_BYTES:
                        raise DevBaseChannelError(
                            "development rootfs expanded bytes exceed channel limit"
                        )
    except tarfile.TarError as exc:
        raise DevBaseChannelError("development rootfs archive is invalid") from exc

    missing = sorted(set(REQUIRED_ROOTFS_PATHS) - seen)
    if missing:
        raise DevBaseChannelError(
            f"development rootfs archive is missing required files: {missing}"
        )
    directories = {member.name for member in members if member.isdir()}
    missing_dirs = sorted(set(REQUIRED_ROOTFS_DIRS) - directories)
    if missing_dirs:
        raise DevBaseChannelError(
            f"development rootfs archive is missing required directories: {missing_dirs}"
        )
    return members


def verify_versioned_rootfs(
    path: Path,
    source_commit: str,
) -> None:
    candidate_tag(source_commit)
    if path.is_symlink() or not path.is_dir():
        raise DevBaseChannelError("versioned development rootfs is unsafe")
    marker = path / ROOTFS_MARKER
    if marker.is_symlink() or not marker.is_file():
        raise DevBaseChannelError("versioned development rootfs marker is missing")
    try:
        marker_value = marker.read_text(encoding="ascii").strip()
    except (OSError, UnicodeError) as exc:
        raise DevBaseChannelError("versioned development rootfs marker is unreadable") from exc
    if marker_value != source_commit:
        raise DevBaseChannelError("versioned development rootfs marker does not match commit")

    for relative in REQUIRED_ROOTFS_PATHS:
        target = path / relative
        try:
            metadata = target.lstat()
        except OSError as exc:
            raise DevBaseChannelError(
                f"versioned development rootfs required file is missing: {relative}"
            ) from exc
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise DevBaseChannelError(
                f"versioned development rootfs required file is unsafe: {relative}"
            )
        if metadata.st_mode & 0o111 == 0:
            raise DevBaseChannelError(
                f"versioned development rootfs required file is not executable: {relative}"
            )

    for relative in (*REQUIRED_ROOTFS_DIRS, ".ordax-base"):
        target = path / relative
        if target.is_symlink() or not target.is_dir():
            raise DevBaseChannelError(
                f"versioned development rootfs mountpoint is unsafe: {relative}"
            )


def materialize_versioned_rootfs(
    candidate_path: Path,
    source_commit: str,
    version_root: Path,
) -> tuple[Path, bool]:
    manifest = verify_materialized(candidate_path, source_commit)
    archive_path = candidate_path / manifest["rootfs"]["name"]
    _validate_rootfs_archive(archive_path)

    version_root.mkdir(parents=True, exist_ok=True)
    if version_root.is_symlink() or not version_root.is_dir():
        raise DevBaseChannelError("development rootfs version store is unsafe")
    target = version_root / source_commit
    if target.exists():
        verify_versioned_rootfs(target, source_commit)
        return target, True

    temporary = Path(
        tempfile.mkdtemp(prefix=f".rootfs-{source_commit}-", dir=version_root)
    )
    committed = False
    try:
        with tarfile.open(archive_path, "r:") as archive:
            members = _validate_rootfs_archive(archive_path)
            archive.extractall(temporary, members=members, filter="data")

        (temporary / ".ordax-base").mkdir(mode=0o700, exist_ok=False)
        _write_synced(
            temporary / ROOTFS_MARKER,
            (source_commit + "\n").encode("ascii"),
            0o600,
        )
        verify_versioned_rootfs(temporary, source_commit)
        _fsync_dir(temporary)
        if hasattr(os, "sync"):
            os.sync()
        os.rename(temporary, target)
        committed = True
        _fsync_dir(version_root)
    except FileExistsError:
        pass
    finally:
        if not committed and temporary.exists():
            shutil.rmtree(temporary)

    verify_versioned_rootfs(target, source_commit)
    return target, False


def verify_materialized(path: Path, expected_commit: str) -> dict:
    if path.is_symlink() or not path.is_dir():
        raise DevBaseChannelError("materialized development Base directory is unsafe")
    manifest_path = path / "dev-base.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise DevBaseChannelError("materialized development Base manifest is missing")
    try:
        manifest = validate_manifest(
            json.loads(manifest_path.read_text(encoding="utf-8")),
            expected_commit,
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DevBaseChannelError("materialized development Base manifest is invalid") from exc

    expected_names = {"dev-base.json", "vmlinuz", "initrd.gz", "rootfs.tar"}
    actual_names = {child.name for child in path.iterdir()}
    if actual_names != expected_names:
        raise DevBaseChannelError("materialized development Base contains unexpected files")

    for key, max_bytes in (
        ("kernel", MAX_KERNEL_BYTES),
        ("initramfs", MAX_INITRAMFS_BYTES),
        ("rootfs", MAX_ROOTFS_BYTES),
    ):
        binding = manifest[key]
        asset = path / binding["name"]
        metadata = asset.lstat()
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise DevBaseChannelError(f"materialized development Base {key} is unsafe")
        if metadata.st_size <= 0 or metadata.st_size > max_bytes:
            raise DevBaseChannelError(f"materialized development Base {key} size is invalid")
        digest = hashlib.sha256()
        with asset.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        if metadata.st_size != binding["size"] or digest.hexdigest() != binding["sha256"]:
            raise DevBaseChannelError(f"materialized development Base {key} differs from manifest")
    return manifest


def acquire(
    source_commit: str,
    destination_root: Path,
    *,
    opener=urllib.request.urlopen,
) -> tuple[Path, bool]:
    candidate_tag(source_commit)
    destination_root.mkdir(parents=True, exist_ok=True)
    if destination_root.is_symlink() or not destination_root.is_dir():
        raise DevBaseChannelError("development Base candidate root is unsafe")

    target = destination_root / source_commit
    if target.exists():
        verify_materialized(target, source_commit)
        return target, True

    manifest_bytes = _fetch_bytes(
        manifest_url(source_commit),
        MAX_MANIFEST_BYTES,
        opener=opener,
    )
    try:
        manifest = validate_manifest(
            json.loads(manifest_bytes.decode("utf-8")),
            source_commit,
        )
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise DevBaseChannelError("development Base manifest is invalid JSON") from exc

    kernel = _fetch_bytes(
        manifest["kernel"]["url"],
        MAX_KERNEL_BYTES,
        opener=opener,
    )
    initramfs = _fetch_bytes(
        manifest["initramfs"]["url"],
        MAX_INITRAMFS_BYTES,
        opener=opener,
    )
    _verify_payload(kernel, manifest["kernel"], "kernel")
    _verify_payload(initramfs, manifest["initramfs"], "initramfs")

    temporary = Path(
        tempfile.mkdtemp(
            prefix=f".staging-{source_commit}-",
            dir=destination_root,
        )
    )
    committed = False
    try:
        _write_synced(temporary / "vmlinuz", kernel)
        _write_synced(temporary / "initrd.gz", initramfs)
        _download_binding_to_path(
            manifest["rootfs"],
            temporary / "rootfs.tar",
            MAX_ROOTFS_BYTES,
            opener=opener,
            timeout_seconds=ROOTFS_DOWNLOAD_TIMEOUT_SECONDS,
        )
        _write_synced(temporary / "dev-base.json", manifest_bytes)
        _fsync_dir(temporary)
        os.rename(temporary, target)
        committed = True
        _fsync_dir(destination_root)
    except FileExistsError:
        # A concurrent owner won the race. Its bytes still have to validate.
        pass
    finally:
        if not committed and temporary.exists():
            shutil.rmtree(temporary)

    verify_materialized(target, source_commit)
    return target, False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-commit", required=True)
    parser.add_argument(
        "--destination-root",
        type=Path,
        default=Path("/state/ordax/base-update/dev-candidates"),
    )
    parser.add_argument("--version-root", type=Path)
    args = parser.parse_args()
    try:
        path, reused = acquire(args.source_commit, args.destination_root)
        if args.version_root is not None:
            version_root = args.version_root
        elif Path("/.ordax-base/versions").is_dir():
            version_root = Path("/.ordax-base/versions")
        else:
            version_root = Path("/versions")
        rootfs_path, rootfs_reused = materialize_versioned_rootfs(
            path,
            args.source_commit,
            version_root,
        )
        print(json.dumps({
            "status": "ready",
            "source_commit": args.source_commit,
            "path": str(path),
            "reused": reused,
            "rootfs_path": str(rootfs_path),
            "rootfs_reused": rootfs_reused,
        }, sort_keys=True))
        return 0
    except DevBaseCandidateUnavailable as exc:
        print(f"dev-base-channel: WAIT: {exc}", file=sys.stderr)
        return 2
    except (DevBaseChannelError, OSError) as exc:
        print(f"dev-base-channel: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
