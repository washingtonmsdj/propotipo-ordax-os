#!/usr/bin/env python3
"""Build the symlink-free OrdaX development base used by the owner USB.

The base intentionally stops at hardware/network/Git. The OrdaX source tree is
cloned from main at runtime into /workspace/ordax and then updated with git pull.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
ALPINE_VERSION = "3.22.5"
ALPINE_BRANCH = "v3.22"
ARCH = "x86_64"
BASE_URL = f"https://dl-cdn.alpinelinux.org/alpine/{ALPINE_BRANCH}/releases/{ARCH}"
ARCHIVE_NAME = f"alpine-minirootfs-{ALPINE_VERSION}-{ARCH}.tar.gz"
ARCHIVE_URL = f"{BASE_URL}/{ARCHIVE_NAME}"
CHECKSUM_URL = ARCHIVE_URL + ".sha256"
PACKAGES = [
    "git",
    "ca-certificates",
    "kmod",
    "iproute2",
    "iw",
    "wpa_supplicant",
    "zstd",
    "linux-firmware-other",
    "linux-firmware-rtlwifi",
    "linux-firmware-rtl_nic",
    "linux-firmware-realtek",
    "linux-firmware-mediatek",
    "linux-firmware-ath9k_htc",
    "linux-firmware-brcm",
]
MAX_ROOTFS_BYTES = 220 * 1024 * 1024
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class BuildError(RuntimeError):
    pass


def stage(name: str) -> None:
    print(f"ORDAX_DEV_BASE_STAGE={name}", flush=True)


def run(argv: list[str], *, cwd: Path | None = None) -> None:
    command = " ".join(argv)
    print("+", command, flush=True)
    try:
        completed = subprocess.run(argv, cwd=cwd, check=False)
    except OSError as exc:
        print(f"ORDAX_DEV_BASE_COMMAND_ERROR={command}: {exc}", flush=True)
        raise BuildError(f"command failed: {command}") from exc
    print(f"ORDAX_DEV_BASE_COMMAND_RC={completed.returncode}", flush=True)
    if completed.returncode != 0:
        raise BuildError(f"command failed ({completed.returncode}): {command}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_text(url: str) -> str:
    try:
        with urllib.request.urlopen(url, timeout=120) as response:
            return response.read().decode("utf-8")
    except Exception as exc:
        raise BuildError(f"download failed: {url}: {exc}") from exc


def download_verified(cache: Path) -> tuple[Path, str]:
    cache.mkdir(parents=True, exist_ok=True)
    checksum_text = download_text(CHECKSUM_URL)
    match = re.search(r"\b([0-9a-fA-F]{64})\b", checksum_text)
    if not match:
        raise BuildError("Alpine checksum sidecar did not contain SHA-256")
    expected = match.group(1).lower()
    if not SHA256_RE.fullmatch(expected):
        raise BuildError("invalid Alpine SHA-256")

    archive = cache / ARCHIVE_NAME
    if archive.is_file() and sha256_file(archive) == expected:
        return archive, expected

    part = archive.with_suffix(archive.suffix + ".part")
    part.unlink(missing_ok=True)
    try:
        with urllib.request.urlopen(ARCHIVE_URL, timeout=120) as response, part.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
    except Exception as exc:
        part.unlink(missing_ok=True)
        raise BuildError(f"Alpine archive download failed: {exc}") from exc
    actual = sha256_file(part)
    if actual != expected:
        part.unlink(missing_ok=True)
        raise BuildError(f"Alpine archive digest mismatch: expected={expected} actual={actual}")
    part.replace(archive)
    return archive, expected


def safe_extract(archive: Path, rootfs: Path) -> None:
    with tarfile.open(archive, "r:gz") as tar:
        members = []
        for member in tar.getmembers():
            name = member.name
            while name.startswith("./"):
                name = name[2:]
            if not name or name.startswith("/") or ".." in Path(name).parts:
                raise BuildError(f"unsafe Alpine archive path: {member.name}")
            target = rootfs / name
            try:
                target.relative_to(rootfs)
            except ValueError as exc:
                raise BuildError(f"unsafe Alpine archive path: {member.name}") from exc
            if member.isdev() or member.isfifo():
                continue
            if member.issym() and os.path.isabs(member.linkname):
                parent = Path(name).parent.as_posix()
                member.linkname = os.path.relpath(member.linkname.lstrip("/"), start=parent or ".")
            elif member.islnk() and os.path.isabs(member.linkname):
                member.linkname = member.linkname.lstrip("/")
            members.append(member)
        tar.extractall(rootfs, members=members, filter="data")


def proot_rootfs(rootfs: Path, command: str) -> None:
    """Run commands before symlinks are flattened, without requiring CAP_MKNOD."""
    proot = shutil.which("proot")
    if not proot:
        raise BuildError("proot is required for pre-flatten rootfs commands")
    run([
        proot,
        "-S",
        str(rootfs),
        "-w",
        "/",
        "/bin/sh",
        "-ec",
        command,
    ])


def prune_firmware(rootfs: Path) -> None:
    firmware = rootfs / "lib" / "firmware"
    if not firmware.is_dir():
        raise BuildError("firmware directory is missing")

    def keep(relative: str) -> bool:
        low = relative.lower()
        base = Path(relative).name.lower()
        prefixes = (
            "iwlwifi-",
            "rtl",
            "rtlwifi/",
            "mediatek/",
            "mt",
            "ath9k_htc/",
            "htc_",
            "brcm/",
        )
        return low.startswith(prefixes) or base.startswith(("iwlwifi-", "rtl", "mt", "htc_"))

    for path in sorted(firmware.rglob("*"), reverse=True):
        relative = path.relative_to(firmware).as_posix()
        if path.is_symlink():
            continue
        if path.is_file() and not keep(relative):
            path.unlink()
        elif path.is_dir():
            try:
                path.rmdir()
            except OSError:
                pass

    proot_rootfs(
        rootfs,
        "find /lib/firmware -type f -name '*.zst' -print | "
        "while IFS= read -r f; do zstd -q -d --rm \"$f\" -o \"${f%.zst}\"; done",
    )


def resolve_rootfs_symlink(rootfs: Path, link: Path) -> Path | None:
    seen: set[Path] = set()
    current = link
    for _ in range(64):
        if current in seen:
            return None
        seen.add(current)
        if not current.is_symlink():
            return current
        value = os.readlink(current)
        if os.path.isabs(value):
            current = rootfs / value.lstrip("/")
        else:
            current = current.parent / value
        current = Path(os.path.normpath(current))
        try:
            current.relative_to(rootfs)
        except ValueError:
            return None
    return None


def flatten_symlinks(rootfs: Path) -> int:
    count = 0
    while True:
        links = [path for path in rootfs.rglob("*") if path.is_symlink()]
        if not links:
            break
        progress = False
        for link in sorted(links, key=lambda path: len(path.parts), reverse=True):
            if not link.is_symlink():
                continue
            final = resolve_rootfs_symlink(rootfs, link)
            if final is None or not final.exists() or final.is_symlink():
                continue
            mode = final.lstat().st_mode
            link.unlink()
            if stat.S_ISREG(mode):
                os.link(final, link)
            elif stat.S_ISDIR(mode):
                link.mkdir(mode=mode & 0o7777)
            else:
                link.touch(mode=0o644)
            count += 1
            progress = True
        if not progress:
            for link in links:
                if link.is_symlink():
                    link.unlink()
                    link.touch(mode=0o644)
                    count += 1
            break
    return count


def copy_script(source: Path, destination: Path) -> None:
    if not source.is_file() or source.is_symlink():
        raise BuildError(f"script is missing or unsafe: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    destination.chmod(0o755)


def install_runtime(rootfs: Path, kernel_modules: Path) -> None:
    if not kernel_modules.is_file() or kernel_modules.is_symlink():
        raise BuildError("kernel modules archive is missing or unsafe")
    with tarfile.open(kernel_modules, "r") as archive:
        for member in archive.getmembers():
            if member.isdev() or member.isfifo():
                raise BuildError(f"unsafe kernel-module archive entry: {member.name}")
        archive.extractall(rootfs, filter="data")

    copy_script(ROOT / "bootstrap/dev-base/ordax-dev-init", rootfs / "sbin/ordax-dev-init")
    for name in ("ordax-network", "ordax-pull", "ordax-rollback", "ordax-run"):
        copy_script(ROOT / f"bootstrap/dev-base/{name}", rootfs / f"usr/local/bin/{name}")
    copy_script(ROOT / "bootstrap/recovery/entrypoint", rootfs / "ordax/bootstrap/recovery/entrypoint")

    for directory in ("workspace", "state", "home", "run", "tmp", "proc", "sys", "dev", "root"):
        path = rootfs / directory
        path.mkdir(parents=True, exist_ok=True)
    (rootfs / "tmp").chmod(0o1777)

    for directory in (rootfs / "dev", rootfs / "proc", rootfs / "sys", rootfs / "run"):
        for child in list(directory.iterdir()):
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()


def unique_regular_bytes(rootfs: Path) -> int:
    seen: set[tuple[int, int]] = set()
    total = 0
    for path in rootfs.rglob("*"):
        info = path.lstat()
        if stat.S_ISREG(info.st_mode):
            key = (info.st_dev, info.st_ino)
            if key not in seen:
                seen.add(key)
                total += info.st_size
    return total


def verify_rootfs(rootfs: Path) -> None:
    stage("verify-rootfs-objects")
    bad = []
    for path in rootfs.rglob("*"):
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            bad.append(path.relative_to(rootfs).as_posix())
            if len(bad) >= 20:
                break
    if bad:
        raise BuildError(f"rootfs still contains unsafe objects: {bad}")

    stage("verify-rootfs-required-executables")
    required = [
        "bin/sh",
        "usr/bin/git",
        "sbin/ordax-dev-init",
        "usr/local/bin/ordax-network",
        "usr/local/bin/ordax-pull",
        "usr/local/bin/ordax-rollback",
        "usr/local/bin/ordax-run",
    ]
    for rel in required:
        path = rootfs / rel
        if not path.is_file() or not os.access(path, os.X_OK):
            raise BuildError(f"required executable missing: /{rel}")
    stage("verify-rootfs-native-chroot-git")
    run(["chroot", str(rootfs), "/usr/bin/git", "--version"])
    stage("verify-rootfs-complete")


def source_commit() -> str:
    value = os.environ.get("GITHUB_SHA", "")
    if re.fullmatch(r"[0-9a-fA-F]{40}", value):
        return value.lower()
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except Exception:
        return "unknown"


def build(kernel_modules: Path, out_dir: Path) -> None:
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "amd64"}:
        raise BuildError("development base build requires x86_64 Linux")
    if os.geteuid() != 0:
        raise BuildError("development base build must run as root (package ownership/chroot)")
    if not shutil.which("proot"):
        raise BuildError("development base build requires proot")

    out_dir = out_dir.resolve()
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True)
    work = Path(tempfile.mkdtemp(prefix="ordax-dev-base-"))
    try:
        stage("download-alpine")
        archive, archive_sha = download_verified(work / "cache")
        rootfs = out_dir / "rootfs"
        rootfs.mkdir()
        stage("extract-alpine")
        safe_extract(archive, rootfs)
        stage("extract-alpine-complete")
        (rootfs / "etc/apk").mkdir(parents=True, exist_ok=True)
        (rootfs / "etc/apk/repositories").write_text(
            f"https://dl-cdn.alpinelinux.org/alpine/{ALPINE_BRANCH}/main\n"
            f"https://dl-cdn.alpinelinux.org/alpine/{ALPINE_BRANCH}/community\n",
            encoding="utf-8",
        )
        host_resolv = Path("/etc/resolv.conf")
        if host_resolv.exists():
            shutil.copy2(host_resolv, rootfs / "etc/resolv.conf", follow_symlinks=True)
        (rootfs / "dev").mkdir(parents=True, exist_ok=True)

        stage("proot-apk-add")
        proot_rootfs(rootfs, "apk add --no-cache " + " ".join(PACKAGES))
        stage("proot-apk-add-complete")
        stage("prune-firmware")
        prune_firmware(rootfs)
        stage("prune-firmware-complete")
        stage("install-runtime")
        install_runtime(rootfs, kernel_modules.resolve())
        stage("install-runtime-complete")
        stage("flatten-symlinks")
        flattened = flatten_symlinks(rootfs)
        print(f"ORDAX_DEV_BASE_SYMLINKS_FLATTENED={flattened}", flush=True)
        stage("flatten-symlinks-complete")
        stage("verify-rootfs")
        verify_rootfs(rootfs)
        stage("measure-rootfs")
        size = unique_regular_bytes(rootfs)
        print(f"ORDAX_DEV_BASE_MEASURED_BYTES={size}", flush=True)
        if size > MAX_ROOTFS_BYTES:
            raise BuildError(f"development base too large: {size} > {MAX_ROOTFS_BYTES}")
        stage("measure-rootfs-complete")
        provenance = {
            "$schema": "prototype-ordax.dev-base/1",
            "source_commit": source_commit(),
            "alpine_version": ALPINE_VERSION,
            "alpine_archive_sha256": archive_sha,
            "kernel_modules_sha256": sha256_file(kernel_modules.resolve()),
            "packages": PACKAGES,
            "build_device_strategy": "proot-bind-host-dev",
            "symlinks_flattened": flattened,
            "unique_regular_bytes": size,
            "source_checkout_preseeded": False,
            "git_client_preseeded": True,
            "network_preseeded": True,
        }
        (out_dir / "provenance.json").write_text(
            json.dumps(provenance, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        stage("build-complete")
        print(f"ORDAX_DEV_BASE_BYTES={size}")
        print("ORDAX_DEV_BASE_GIT=YES")
        print("ORDAX_DEV_BASE_SOURCE_CHECKOUT=NO")
        print("ORDAX_DEV_BASE_STATIC_DEVICES=NO")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--kernel-modules",
        type=Path,
        default=ROOT / "out/kernel/kernel-modules-6.6.52.tar",
    )
    parser.add_argument("--out-dir", type=Path, default=ROOT / "out/dev-base")
    args = parser.parse_args()
    try:
        build(args.kernel_modules, args.out_dir)
    except BuildError as exc:
        print(f"ordax-dev-base: {exc}", file=os.sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
