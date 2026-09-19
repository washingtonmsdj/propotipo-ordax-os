#!/usr/bin/env python3
"""Repository-owned deterministic OrdaX initramfs builder.

No legacy initramfs is imported. The fixed capsule contains a static BusyBox,
a minimal repository-owned ext4 growth helper, and the small PID 1 script owned
by this repository. Network/release acquisition lives on the ORDAX partition
and is intentionally outside this fixed archive.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / "bootstrap" / "initramfs"
CONTRACT = HERE / "source.json"
GROW_HELPER_SOURCE = HERE / "grow_ext4.c"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_SAFE_VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
REQUIRED_APPLETS = {
    "blkid", "cat", "echo", "findfs", "mkdir", "mount", "poweroff",
    "reboot", "sh", "sleep", "switch_root", "sync", "umount",
}
REQUESTED_CONFIG = {
    "CONFIG_BUSYBOX": "y",
    "CONFIG_STATIC": "y",
    "CONFIG_ASH": "y",
    "CONFIG_SH_IS_ASH": "y",
    "CONFIG_BLKID": "y",
    "CONFIG_CAT": "y",
    "CONFIG_ECHO": "y",
    "CONFIG_FINDFS": "y",
    "CONFIG_MKDIR": "y",
    "CONFIG_MOUNT": "y",
    "CONFIG_POWEROFF": "y",
    "CONFIG_REBOOT": "y",
    "CONFIG_SLEEP": "y",
    "CONFIG_SWITCH_ROOT": "y",
    "CONFIG_SYNC": "y",
    "CONFIG_UMOUNT": "y",
    "CONFIG_FEATURE_VOLUMEID_EXT": "y",
}
FIXED_ENV = {
    "SOURCE_DATE_EPOCH": "0",
    "KBUILD_BUILD_TIMESTAMP": "1970-01-01 00:00:00 UTC",
    "KBUILD_BUILD_USER": "ordax",
    "KBUILD_BUILD_HOST": "build",
    "TZ": "UTC",
    "LC_ALL": "C",
    "LANG": "C",
}


class BuildError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_contract() -> dict:
    try:
        value = json.loads(CONTRACT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildError(f"cannot read initramfs source contract: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.initramfs-source/1":
        raise BuildError("unexpected initramfs source contract schema")
    busybox = value.get("busybox", {})
    if not _SAFE_VERSION.fullmatch(str(busybox.get("version", ""))):
        raise BuildError("invalid BusyBox version")
    if not _SHA256.fullmatch(str(busybox.get("archive_sha256", ""))):
        raise BuildError("invalid BusyBox archive SHA-256")
    return value


def init_path(contract: dict) -> Path:
    relative = contract.get("root_init")
    if not isinstance(relative, str):
        raise BuildError("root_init is missing")
    path = (ROOT / relative).resolve()
    if ROOT.resolve() not in path.parents or not path.is_file() or path.is_symlink():
        raise BuildError("root_init is missing or unsafe")
    return path


def growth_helper_source_path() -> Path:
    path = GROW_HELPER_SOURCE.resolve()
    if ROOT.resolve() not in path.parents or not path.is_file() or path.is_symlink():
        raise BuildError("ext4 growth helper source is missing or unsafe")
    return path


def check_contract() -> dict:
    contract = load_contract()
    init = init_path(contract)
    helper_source = growth_helper_source_path()
    text = init.read_text(encoding="utf-8")
    forbidden = ("ORDAX-HOME", "ORDAX-PLATFORM", "sshd", "remote-core", "control-plane", "codex")
    found = [value for value in forbidden if value.lower() in text.lower()]
    if found:
        raise BuildError(f"legacy/high-level responsibility leaked into fixed initramfs: {found}")
    if "findfs LABEL=ORDAX" not in text or "/ordax/bootstrap/entrypoint" not in text:
        raise BuildError("init must hand off through the canonical ORDAX bootstrap path")
    rw_mount = 'mount -t ext4 -o rw,errors=remount-ro "$ORDAX_DEVICE" /ordax'
    health_call = '/sbin/ordax-grow-ext4 --check "$ORDAX_DEVICE"'
    grow_call = '/sbin/ordax-grow-ext4 "$ORDAX_DEVICE" /ordax'
    recovery_mount = 'mount -t ext4 -o ro "$ORDAX_DEVICE" /ordax'
    if rw_mount not in text or health_call not in text or grow_call not in text:
        raise BuildError("normal boot must health-check ORDAX before writable mount and growth")
    if text.index(health_call) > text.index(rw_mount):
        raise BuildError("ext4 health check must run before the rw ORDAX mount")
    if text.index(grow_call) < text.index(rw_mount):
        raise BuildError("ext4 growth helper may run only after the rw ORDAX mount")
    if recovery_mount not in text or text.index(recovery_mount) > text.index(rw_mount):
        raise BuildError("recovery must remain a separate read-only path before normal rw boot")
    recovery_section = text[text.index(recovery_mount):text.index(rw_mount)]
    if grow_call in recovery_section:
        raise BuildError("recovery mode may never invoke online ext4 growth")
    if contract.get("network_inside_fixed_initramfs") is not False:
        raise BuildError("network must remain outside the fixed initramfs")
    return {
        "busybox_version": contract["busybox"]["version"],
        "busybox_archive_sha256": contract["busybox"]["archive_sha256"],
        "root_init": str(init.relative_to(ROOT)),
        "root_init_sha256": sha256_file(init),
        "ext4_growth_helper_source": str(helper_source.relative_to(ROOT)),
        "ext4_growth_helper_source_sha256": sha256_file(helper_source),
        "main_partition_label": contract["main_partition_label"],
    }


def resolve_program(name: str) -> str:
    value = shutil.which(name)
    if not value:
        raise BuildError(f"required build program not found: {name}")
    return value


def capture(argv: list[str], *, cwd: Path | None = None) -> str:
    try:
        return subprocess.run(
            argv,
            cwd=cwd,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"command failed: {' '.join(argv)}") from exc


def musl_identity(musl_cc: str) -> dict:
    wrapper = Path(musl_cc).resolve()
    try:
        wrapper_text = wrapper.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise BuildError(f"musl-gcc wrapper is not inspectable: {wrapper}") from exc
    match = re.search(r'-specs(?:=|\s+)["\']([^"\']*musl-gcc\.specs)["\']', wrapper_text)
    if not match:
        raise BuildError("musl-gcc wrapper does not reference musl-gcc.specs")
    specs = Path(match.group(1))
    if not specs.is_absolute():
        specs = (wrapper.parent / specs).resolve()
    if not specs.is_file() or specs.is_symlink():
        raise BuildError(f"musl-gcc specs are missing or unsafe: {specs}")
    specs_text = specs.read_text(encoding="utf-8")
    if "linux-musl" not in specs_text or "ld-musl-" not in specs_text:
        raise BuildError("musl-gcc specs do not identify musl include/linker paths")
    return {
        "compiler": wrapper.name,
        "target": capture([musl_cc, "-dumpmachine"]),
        "wrapper_sha256": sha256_file(wrapper),
        "specs_sha256": sha256_file(specs),
        "musl_specs_verified": True,
    }


def download(contract: dict, destination: Path) -> Path:
    busybox = contract["busybox"]
    archive = destination / f"busybox-{busybox['version']}.tar.bz2"
    if archive.is_file() and sha256_file(archive) == busybox["archive_sha256"]:
        return archive
    destination.mkdir(parents=True, exist_ok=True)
    part = archive.with_suffix(archive.suffix + ".part")
    part.unlink(missing_ok=True)
    try:
        with urllib.request.urlopen(busybox["archive_url"], timeout=120) as response, part.open("wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
    except Exception as exc:
        part.unlink(missing_ok=True)
        raise BuildError(f"BusyBox download failed: {exc}") from exc
    actual = sha256_file(part)
    if actual != busybox["archive_sha256"]:
        part.unlink(missing_ok=True)
        raise BuildError(f"BusyBox digest mismatch: expected={busybox['archive_sha256']} actual={actual}")
    part.replace(archive)
    return archive


def safe_member(member: tarfile.TarInfo, top: str) -> None:
    path = PurePosixPath(member.name)
    if path.is_absolute() or not path.parts or path.parts[0] != top or ".." in path.parts:
        raise BuildError(f"unsafe BusyBox archive member: {member.name}")
    if member.isdev() or member.isfifo():
        raise BuildError(f"unsafe special BusyBox archive member: {member.name}")


def extract(archive: Path, destination: Path, version: str) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    top = f"busybox-{version}"
    try:
        with tarfile.open(archive, "r:bz2") as handle:
            for member in handle.getmembers():
                safe_member(member, top)
            handle.extractall(destination, filter="data")
    except (OSError, tarfile.TarError) as exc:
        raise BuildError(f"cannot extract BusyBox source: {exc}") from exc
    source = destination / top
    if not source.is_dir():
        raise BuildError("BusyBox archive did not produce expected source directory")
    return source


def run(argv: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    print("+", " ".join(argv), flush=True)
    try:
        subprocess.run(argv, cwd=cwd, env=env, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"command failed: {' '.join(argv)}") from exc


def set_config(config: Path, requested: dict[str, str]) -> None:
    lines = config.read_text(encoding="utf-8").splitlines()
    remaining = dict(requested)
    output: list[str] = []
    assignment = re.compile(r"^(CONFIG_[A-Za-z0-9_]+)=.*$")
    unset = re.compile(r"^# (CONFIG_[A-Za-z0-9_]+) is not set$")
    for line in lines:
        match = assignment.fullmatch(line) or unset.fullmatch(line)
        symbol = match.group(1) if match else None
        if symbol in remaining:
            output.append(f"{symbol}={remaining.pop(symbol)}")
        else:
            output.append(line)
    output.extend(f"{symbol}={value}" for symbol, value in remaining.items())
    config.write_text("\n".join(output) + "\n", encoding="utf-8")


def verify_config(config: Path) -> None:
    text = config.read_text(encoding="utf-8")
    for symbol, value in REQUESTED_CONFIG.items():
        if f"{symbol}={value}\n" not in text:
            raise BuildError(f"BusyBox Kconfig rejected required selector: {symbol}={value}")
    if "CONFIG_TC=y\n" in text or "CONFIG_TELNETD=y\n" in text or "CONFIG_HTTPD=y\n" in text:
        raise BuildError("unrelated network server/traffic-control applet leaked into fixed initramfs")


def cpio_pad(handle: io.BufferedWriter | gzip.GzipFile, length: int) -> None:
    padding = (-length) % 4
    if padding:
        handle.write(b"\0" * padding)


def write_newc_entry(handle, *, inode: int, name: str, mode: int, data: bytes, nlink: int) -> None:
    name_bytes = name.encode("utf-8") + b"\0"
    fields = [inode, mode, 0, 0, nlink, 0, len(data), 0, 0, 0, 0, len(name_bytes), 0]
    header = ("070701" + "".join(f"{value:08x}" for value in fields)).encode("ascii")
    handle.write(header)
    handle.write(name_bytes)
    cpio_pad(handle, len(header) + len(name_bytes))
    handle.write(data)
    cpio_pad(handle, len(data))


def build_cpio(root: Path, destination: Path) -> None:
    entries = [root] + sorted(root.rglob("*"), key=lambda p: p.relative_to(root).as_posix())
    raw = io.BytesIO()
    inode = 1
    for path in entries:
        name = "." if path == root else path.relative_to(root).as_posix()
        st = path.lstat()
        if path.is_symlink():
            mode = stat.S_IFLNK | 0o777
            data = os.readlink(path).encode("utf-8")
            nlink = 1
        elif path.is_dir():
            mode = stat.S_IFDIR | (st.st_mode & 0o7777)
            data = b""
            nlink = 2
        elif path.is_file():
            mode = stat.S_IFREG | (st.st_mode & 0o7777)
            data = path.read_bytes()
            nlink = 1
        else:
            raise BuildError(f"unsupported initramfs filesystem object: {name}")
        write_newc_entry(raw, inode=inode, name=name, mode=mode, data=data, nlink=nlink)
        inode += 1
    write_newc_entry(raw, inode=inode, name="TRAILER!!!", mode=0, data=b"", nlink=1)
    raw.write(b"\0" * ((512 - (raw.tell() % 512)) % 512))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0, compresslevel=9) as compressed:
            compressed.write(raw.getvalue())


def git_head() -> str:
    value = os.environ.get("GITHUB_SHA", "")
    if re.fullmatch(r"[0-9a-fA-F]{40}", value):
        return value.lower()
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    except Exception:
        return "unknown"


def build_growth_helper(musl_cc: str, readelf: str, source: Path, destination: Path, env: dict[str, str]) -> None:
    command = [
        musl_cc,
        "-static",
        "-Os",
        "-s",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-Wl,--build-id=none",
        f"-ffile-prefix-map={ROOT}=.",
        "-o",
        str(destination),
        str(source),
    ]
    run(command, cwd=ROOT, env=env)
    elf = capture([readelf, "-l", str(destination)])
    if "Requesting program interpreter" in elf:
        raise BuildError("ext4 growth helper is dynamically linked; fixed initramfs requires static userspace")
    if not destination.is_file() or destination.is_symlink():
        raise BuildError("ext4 growth helper build did not produce a safe regular binary")


def build(work_dir: Path, out_dir: Path, jobs: int) -> dict:
    contract = load_contract()
    init = init_path(contract)
    grow_source = growth_helper_source_path()
    check_contract()
    for name in ("make", "musl-gcc", "readelf"):
        resolve_program(name)
    work_dir = work_dir.resolve()
    out_dir = out_dir.resolve()
    shutil.rmtree(work_dir, ignore_errors=True)
    shutil.rmtree(out_dir, ignore_errors=True)
    work_dir.mkdir(parents=True)
    out_dir.mkdir(parents=True)
    archive = download(contract, work_dir / "cache")
    source = extract(archive, work_dir / "source", contract["busybox"]["version"])
    env = dict(os.environ)
    env.update(FIXED_ENV)
    musl_cc = resolve_program("musl-gcc")
    readelf = resolve_program("readelf")
    toolchain = musl_identity(musl_cc)
    make = ["make", f"CC={musl_cc}"]
    run(make + ["allnoconfig"], cwd=source, env=env)
    set_config(source / ".config", REQUESTED_CONFIG)
    run(make + ["oldconfig"], cwd=source, env=env)
    verify_config(source / ".config")
    run(make + [f"-j{max(1, jobs)}"], cwd=source, env=env)
    busybox = source / "busybox"
    if not busybox.is_file():
        raise BuildError("BusyBox build did not produce busybox")
    elf = capture([readelf, "-l", str(busybox)])
    if "Requesting program interpreter" in elf:
        raise BuildError("BusyBox is dynamically linked; fixed initramfs requires static userspace")
    try:
        applet_result = subprocess.run(
            [str(busybox), "--list"],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        raise BuildError(f"built BusyBox cannot enumerate applets (exit={exc.returncode}): {stderr}") from exc
    applets = set(applet_result.stdout.splitlines())
    missing = sorted(REQUIRED_APPLETS - applets)
    if missing:
        raise BuildError(f"required BusyBox applets are missing: {missing}")
    rootfs = work_dir / "rootfs"
    run(make + [f"CONFIG_PREFIX={rootfs}", "install"], cwd=source, env=env)
    for directory in ("dev", "proc", "sys", "run", "ordax", "tmp"):
        (rootfs / directory).mkdir(parents=True, exist_ok=True)
    shutil.copy2(init, rootfs / "init")
    os.chmod(rootfs / "init", 0o755)
    grow_binary = work_dir / "ordax-grow-ext4"
    build_growth_helper(musl_cc, readelf, grow_source, grow_binary, env)
    grow_install = rootfs / "sbin" / "ordax-grow-ext4"
    grow_install.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(grow_binary, grow_install)
    os.chmod(grow_install, 0o755)
    final_config = out_dir / "busybox.config"
    shutil.copy2(source / ".config", final_config)
    archive_path = out_dir / "initramfs.cpio.gz"
    build_cpio(rootfs, archive_path)
    provenance = {
        "$schema": "prototype-ordax.initramfs-provenance/1",
        "status": "candidate",
        "promotable_to_physical": bool(contract["build"]["physical_artifact_authorized"]),
        "source_commit": git_head(),
        "busybox_version": contract["busybox"]["version"],
        "busybox_archive_sha256": sha256_file(archive),
        "busybox_applet_count": len(applets),
        "busybox_sha256": sha256_file(busybox),
        "toolchain": toolchain,
        "root_init_sha256": sha256_file(init),
        "filesystem_health": {
            "pre_mount_check": True,
            "error_flag_policy": "read-only-recovery",
            "rw_mount_errors_policy": "remount-ro",
            "helper_path": "/sbin/ordax-grow-ext4",
        },
        "filesystem_growth": {
            "mode": "online-ext4-kernel-ioctl",
            "helper_path": "/sbin/ordax-grow-ext4",
            "source_sha256": sha256_file(grow_source),
            "binary_sha256": sha256_file(grow_binary),
            "normal_boot_best_effort": True,
            "recovery_mode_allowed": False,
        },
        "static_userspace": True,
        "network_inside_fixed_initramfs": False,
        "artifacts": {
            archive_path.name: sha256_file(archive_path),
            final_config.name: sha256_file(final_config),
        },
    }
    provenance_path = out_dir / "initramfs-provenance.json"
    provenance_path.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    artifacts = [archive_path, final_config, provenance_path]
    (out_dir / "SHA256SUMS").write_text(
        "".join(f"{sha256_file(path)}  {path.name}\n" for path in artifacts), encoding="utf-8"
    )
    return provenance


def verify(out_dir: Path) -> dict:
    out_dir = out_dir.resolve()
    manifest = out_dir / "SHA256SUMS"
    provenance_path = out_dir / "initramfs-provenance.json"
    if not manifest.is_file() or manifest.is_symlink() or not provenance_path.is_file() or provenance_path.is_symlink():
        raise BuildError("initramfs output manifest/provenance is missing or unsafe")
    try:
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildError(f"invalid initramfs provenance: {exc}") from exc
    if provenance.get("$schema") != "prototype-ordax.initramfs-provenance/1":
        raise BuildError("unexpected initramfs provenance schema")
    health = provenance.get("filesystem_health", {})
    if (
        health.get("pre_mount_check") is not True
        or health.get("error_flag_policy") != "read-only-recovery"
        or health.get("rw_mount_errors_policy") != "remount-ro"
        or health.get("helper_path") != "/sbin/ordax-grow-ext4"
    ):
        raise BuildError("initramfs provenance is missing the canonical ext4 health policy")
    growth = provenance.get("filesystem_growth", {})
    if growth.get("mode") != "online-ext4-kernel-ioctl" or growth.get("helper_path") != "/sbin/ordax-grow-ext4":
        raise BuildError("initramfs provenance is missing the canonical ext4 growth helper")
    if growth.get("normal_boot_best_effort") is not True or growth.get("recovery_mode_allowed") is not False:
        raise BuildError("initramfs filesystem-growth safety policy is invalid")
    if not _SHA256.fullmatch(str(growth.get("source_sha256", ""))) or not _SHA256.fullmatch(str(growth.get("binary_sha256", ""))):
        raise BuildError("initramfs filesystem-growth provenance hashes are invalid")
    entries: dict[str, str] = {}
    for line in manifest.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._+-]*)", line)
        if not match or match.group(2) in entries or match.group(2) == "SHA256SUMS":
            raise BuildError("unsafe, duplicate, or malformed initramfs checksum entry")
        entries[match.group(2)] = match.group(1)
    expected_names = set(provenance.get("artifacts", {})) | {"initramfs-provenance.json"}
    if set(entries) != expected_names:
        raise BuildError("initramfs checksum manifest disagrees with provenance")
    for name, expected in entries.items():
        path = out_dir / name
        if path.is_symlink() or not path.is_file() or sha256_file(path) != expected:
            raise BuildError(f"initramfs artifact verification failed: {name}")
    for name, expected in provenance["artifacts"].items():
        if entries.get(name) != expected:
            raise BuildError(f"initramfs provenance digest disagreement: {name}")
    return {"status": "verified", "artifact_count": len(entries), "source_commit": provenance.get("source_commit")}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--work-dir", type=Path, default=ROOT / "out" / "initramfs-work")
    build_parser.add_argument("--out-dir", type=Path, default=ROOT / "out" / "initramfs")
    build_parser.add_argument("--jobs", type=int, default=max(1, os.cpu_count() or 1))
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--out-dir", type=Path, default=ROOT / "out" / "initramfs")
    args = parser.parse_args()
    try:
        if args.command == "check":
            result = check_contract()
        elif args.command == "build":
            result = build(args.work_dir, args.out_dir, args.jobs)
        else:
            result = verify(args.out_dir)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (BuildError, OSError, subprocess.CalledProcessError) as exc:
        print(f"initramfs-build: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
