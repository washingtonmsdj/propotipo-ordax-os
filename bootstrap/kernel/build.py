#!/usr/bin/env python3
"""Repository-owned OrdaX kernel build entrypoint.

This script deliberately has no dependency on Codex or the developer workstation.
`check` validates the source/config contract without network or compilation.
`build` downloads the pinned kernel.org archive, verifies it, builds in an isolated
workspace, packages modules deterministically, and emits provenance + SHA-256.

The current CI build environment is still a candidate environment until its
container/toolchain identity is pinned by immutable digest. Artifacts produced
before that gate are useful test candidates but are not physical-release authority.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
KERNEL_DIR = ROOT / "bootstrap" / "kernel"
SOURCE_CONTRACT = KERNEL_DIR / "source.json"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_SYMBOL_ASSIGNMENT = re.compile(r"^(CONFIG_[A-Za-z0-9_]+)=(.*)$")
_SYMBOL_UNSET = re.compile(r"^# (CONFIG_[A-Za-z0-9_]+) is not set$")
_SAFE_RELEASE = re.compile(r"^[A-Za-z0-9._+-]+$")
REQUIRED_MODULE_BASENAMES = {
    "iwlwifi.ko",
    "iwlmvm.ko",
    "rtl8xxxu.ko",
    "mt76.ko",
    "ath9k_htc.ko",
}
REQUIRED_PROGRAMS = (
    "make",
    "bc",
    "perl",
    "bison",
    "flex",
    "openssl",
    "depmod",
    "xz",
    "pkg-config",
)
FIXED_ENV = {
    "SOURCE_DATE_EPOCH": "0",
    "KBUILD_BUILD_TIMESTAMP": "1970-01-01 00:00:00 UTC",
    "KBUILD_BUILD_USER": "ordax",
    "KBUILD_BUILD_HOST": "build",
    "KBUILD_BUILD_VERSION": "1",
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
        value = json.loads(SOURCE_CONTRACT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildError(f"cannot read kernel source contract: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.kernel-source/1":
        raise BuildError("unexpected kernel source contract schema")
    version = value.get("version")
    digest = value.get("archive_sha256")
    if not isinstance(version, str) or not _SAFE_RELEASE.fullmatch(version):
        raise BuildError("invalid kernel version")
    if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
        raise BuildError("invalid kernel archive SHA-256")
    return value


def fragment_path(contract: dict) -> Path:
    relative = contract.get("configuration", {}).get("fragment")
    if not isinstance(relative, str):
        raise BuildError("kernel fragment path is missing")
    path = (ROOT / relative).resolve()
    if ROOT.resolve() not in path.parents or not path.is_file():
        raise BuildError(f"kernel fragment is missing or unsafe: {relative}")
    return path


def parse_fragment(path: Path) -> dict[str, str]:
    assignments: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        match = _SYMBOL_ASSIGNMENT.fullmatch(line)
        if match:
            assignments[match.group(1)] = line
            continue
        match = _SYMBOL_UNSET.fullmatch(line)
        if match:
            assignments[match.group(1)] = line
    if not assignments:
        raise BuildError("kernel fragment contains no Kconfig assignments")
    return assignments


def check_contract() -> dict:
    contract = load_contract()
    fragment = fragment_path(contract)
    text = fragment.read_text(encoding="utf-8")
    forbidden = (
        "ORDAX-PLATFORM",
        "ORDAX-HOME",
        "MISSION-",
        "Milestone",
        "Forge",
        "CONFIG_MT76=m",
    )
    found = [item for item in forbidden if item in text]
    if found:
        raise BuildError(f"legacy/invalid kernel fragment content: {found}")
    assignments = parse_fragment(fragment)
    for required in (
        "CONFIG_EFI_STUB",
        "CONFIG_EXT4_FS",
        "CONFIG_VFAT_FS",
        "CONFIG_IWLWIFI",
        "CONFIG_WLAN_VENDOR_MEDIATEK",
        "CONFIG_MT76x2U",
        "CONFIG_BLK_DEV_INITRD",
    ):
        if required not in assignments:
            raise BuildError(f"required kernel selector missing from fragment: {required}")
    result = {
        "version": contract["version"],
        "archive_sha256": contract["archive_sha256"],
        "fragment": str(fragment.relative_to(ROOT)),
        "fragment_sha256": sha256_file(fragment),
        "assignment_count": len(assignments),
        "pinned_environment_resolved": bool(contract["build"]["pinned_environment_resolved"]),
    }
    return result


def resolve_program(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise BuildError(f"required build program not found: {name}")
    return path


def compiler_identity() -> tuple[str, str]:
    compiler = resolve_program("gcc-13")
    version = subprocess.run(
        [compiler, "-dumpfullversion"], check=True, capture_output=True, text=True
    ).stdout.strip()
    if not version:
        version = subprocess.run(
            [compiler, "-dumpversion"], check=True, capture_output=True, text=True
        ).stdout.strip()
    if version.split(".", 1)[0] != "13":
        raise BuildError(f"kernel build requires GCC 13, got {version!r}")
    target = subprocess.run(
        [compiler, "-dumpmachine"], check=True, capture_output=True, text=True
    ).stdout.strip()
    if not target.startswith("x86_64-"):
        raise BuildError(f"kernel compiler target must be x86_64, got {target!r}")
    return compiler, version


def build_environment(compiler: str, temp_root: Path) -> dict[str, str]:
    env = dict(os.environ)
    env.update(FIXED_ENV)
    env.update(
        {
            "ARCH": "x86_64",
            "CC": compiler,
            "HOSTCC": compiler,
            "HOME": str(temp_root / "home"),
            "TMPDIR": str(temp_root / "tmp"),
        }
    )
    Path(env["HOME"]).mkdir(parents=True, exist_ok=True)
    Path(env["TMPDIR"]).mkdir(parents=True, exist_ok=True)
    return env


def run(argv: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    print("+", " ".join(argv), flush=True)
    try:
        subprocess.run(argv, cwd=cwd, env=env, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"command failed: {' '.join(argv)}") from exc


def download_archive(contract: dict, cache_dir: Path) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    destination = cache_dir / f"linux-{contract['version']}.tar.xz"
    expected = contract["archive_sha256"]
    if destination.is_file() and sha256_file(destination) == expected:
        return destination
    destination.unlink(missing_ok=True)
    temp = destination.with_suffix(destination.suffix + ".part")
    temp.unlink(missing_ok=True)
    print(f"Downloading {contract['archive_url']}", flush=True)
    try:
        with urllib.request.urlopen(contract["archive_url"], timeout=120) as response, temp.open("wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
    except Exception as exc:  # urllib surfaces multiple network exception types
        temp.unlink(missing_ok=True)
        raise BuildError(f"kernel source download failed: {exc}") from exc
    actual = sha256_file(temp)
    if actual != expected:
        temp.unlink(missing_ok=True)
        raise BuildError(f"kernel source digest mismatch: expected={expected} actual={actual}")
    temp.replace(destination)
    return destination


def safe_member(member: tarfile.TarInfo, expected_top: str) -> None:
    path = PurePosixPath(member.name)
    if path.is_absolute() or not path.parts or path.parts[0] != expected_top or ".." in path.parts:
        raise BuildError(f"unsafe kernel archive member: {member.name}")
    if member.isdev() or member.isfifo():
        raise BuildError(f"unsafe special kernel archive member: {member.name}")
    if member.issym() and PurePosixPath(member.linkname).is_absolute():
        raise BuildError(f"absolute symlink in kernel archive: {member.name}")


def extract_archive(archive: Path, destination: Path, version: str) -> Path:
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    expected_top = f"linux-{version}"
    try:
        with tarfile.open(archive, "r:xz") as handle:
            for member in handle.getmembers():
                safe_member(member, expected_top)
            handle.extractall(destination, filter="data")
    except (tarfile.TarError, OSError) as exc:
        raise BuildError(f"cannot extract kernel source: {exc}") from exc
    source = destination / expected_top
    if not source.is_dir():
        raise BuildError("kernel archive did not produce expected source directory")
    return source


def symbol_for_line(line: str) -> str | None:
    match = _SYMBOL_ASSIGNMENT.fullmatch(line.strip())
    if match:
        return match.group(1)
    match = _SYMBOL_UNSET.fullmatch(line.strip())
    if match:
        return match.group(1)
    return None


def merge_fragment(config: Path, fragment: Path) -> dict[str, str]:
    requested = parse_fragment(fragment)
    lines = config.read_text(encoding="utf-8").splitlines()
    emitted: set[str] = set()
    merged: list[str] = []
    for line in lines:
        symbol = symbol_for_line(line)
        if symbol in requested:
            if symbol not in emitted:
                merged.append(requested[symbol])
                emitted.add(symbol)
            continue
        merged.append(line)
    for symbol, line in requested.items():
        if symbol not in emitted:
            merged.append(line)
    config.write_text("\n".join(merged) + "\n", encoding="utf-8")
    return requested


def verify_resolved_config(config: Path, requested: dict[str, str]) -> None:
    resolved: dict[str, str] = {}
    for line in config.read_text(encoding="utf-8").splitlines():
        symbol = symbol_for_line(line)
        if symbol:
            resolved[symbol] = line.strip()
    mismatches = {
        symbol: {"requested": line, "resolved": resolved.get(symbol)}
        for symbol, line in requested.items()
        if resolved.get(symbol) != line
    }
    if mismatches:
        preview = json.dumps(dict(list(mismatches.items())[:20]), indent=2, sort_keys=True)
        raise BuildError(f"Kconfig rejected requested OrdaX selectors:\n{preview}")


def package_modules(stage: Path, destination: Path) -> set[str]:
    root = stage / "lib" / "modules"
    if not root.is_dir():
        raise BuildError("modules_install did not create lib/modules")
    release_dirs = [path for path in root.iterdir() if path.is_dir()]
    if len(release_dirs) != 1:
        raise BuildError(f"expected one kernel release directory, found {len(release_dirs)}")
    release_root = release_dirs[0]
    module_basenames: set[str] = set()
    with tarfile.open(destination, "w", format=tarfile.USTAR_FORMAT) as archive:
        for path in sorted(stage.rglob("*"), key=lambda p: p.as_posix()):
            if path.parent == release_root and path.name in {"build", "source"}:
                continue
            relative = path.relative_to(stage)
            if path.is_file() and path.name.endswith(".ko"):
                module_basenames.add(path.name)
            info = archive.gettarinfo(str(path), arcname=relative.as_posix())
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            info.mtime = 0
            if info.isfile():
                with path.open("rb") as handle:
                    archive.addfile(info, handle)
            else:
                archive.addfile(info)
    missing = sorted(REQUIRED_MODULE_BASENAMES - module_basenames)
    if missing:
        raise BuildError(f"required Wi-Fi modules missing from build: {missing}")
    return module_basenames


def git_head() -> str:
    env_sha = os.environ.get("GITHUB_SHA")
    if env_sha and re.fullmatch(r"[0-9a-fA-F]{40}", env_sha):
        return env_sha.lower()
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True
        ).stdout.strip()
    except Exception:
        return "unknown"


def command_version(argv: list[str]) -> str:
    try:
        output = subprocess.run(argv, check=True, capture_output=True, text=True).stdout.strip()
    except Exception:
        return "unknown"
    return output.splitlines()[0] if output else "unknown"


def build(work_dir: Path, out_dir: Path, jobs: int) -> dict:
    contract = load_contract()
    fragment = fragment_path(contract)
    check_contract()
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "amd64"}:
        raise BuildError("kernel candidate build currently requires an x86_64 Linux CI execution environment")
    for program in REQUIRED_PROGRAMS:
        resolve_program(program)
    compiler, gcc_version = compiler_identity()

    work_dir = work_dir.resolve()
    out_dir = out_dir.resolve()
    if work_dir.exists():
        shutil.rmtree(work_dir)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    work_dir.mkdir(parents=True)
    out_dir.mkdir(parents=True)

    cache_dir = work_dir / "cache"
    archive = download_archive(contract, cache_dir)
    source = extract_archive(archive, work_dir / "source", contract["version"])
    build_dir = work_dir / "build"
    module_stage = work_dir / "module-stage"
    temp_root = work_dir / "tmp-env"
    env = build_environment(compiler, temp_root)

    run(["make", "-C", str(source), f"O={build_dir}", "defconfig"], cwd=ROOT, env=env)
    requested = merge_fragment(build_dir / ".config", fragment)
    run(["make", "-C", str(source), f"O={build_dir}", "olddefconfig"], cwd=ROOT, env=env)
    verify_resolved_config(build_dir / ".config", requested)

    run(
        ["make", "-C", str(source), f"O={build_dir}", f"-j{max(1, jobs)}", "bzImage", "modules"],
        cwd=ROOT,
        env=env,
    )
    run(
        [
            "make",
            "-C",
            str(source),
            f"O={build_dir}",
            f"INSTALL_MOD_PATH={module_stage}",
            "modules_install",
        ],
        cwd=ROOT,
        env=env,
    )

    bzimage = build_dir / "arch" / "x86" / "boot" / "bzImage"
    if not bzimage.is_file() or bzimage.stat().st_size < 512 * 1024:
        raise BuildError("kernel bzImage is missing or implausibly small")
    vmlinuz = out_dir / f"vmlinuz-{contract['version']}"
    shutil.copy2(bzimage, vmlinuz)
    modules_tar = out_dir / f"kernel-modules-{contract['version']}.tar"
    modules = package_modules(module_stage, modules_tar)
    final_config = out_dir / f"kernel-{contract['version']}.config"
    shutil.copy2(build_dir / ".config", final_config)

    provenance = {
        "$schema": "prototype-ordax.kernel-provenance/1",
        "status": "candidate-unpinned-build-environment"
        if not contract["build"]["pinned_environment_resolved"]
        else "verified-build-environment",
        "promotable_to_physical": bool(contract["build"]["pinned_environment_resolved"]),
        "source_commit": git_head(),
        "kernel_version": contract["version"],
        "upstream_archive_url": contract["archive_url"],
        "upstream_archive_sha256": sha256_file(archive),
        "source_contract_sha256": sha256_file(SOURCE_CONTRACT),
        "fragment_sha256": sha256_file(fragment),
        "resolved_config_sha256": sha256_file(final_config),
        "build_environment": {
            "system": platform.system(),
            "machine": platform.machine(),
            "python": platform.python_version(),
            "gcc": gcc_version,
            "gcc_target": subprocess.run(
                [compiler, "-dumpmachine"], check=True, capture_output=True, text=True
            ).stdout.strip(),
            "make": command_version([resolve_program("make"), "--version"]),
            "fixed_environment": FIXED_ENV,
            "immutable_environment_pinned": bool(contract["build"]["pinned_environment_resolved"]),
        },
        "artifacts": {
            vmlinuz.name: sha256_file(vmlinuz),
            modules_tar.name: sha256_file(modules_tar),
            final_config.name: sha256_file(final_config),
        },
        "required_module_basenames": sorted(REQUIRED_MODULE_BASENAMES),
        "observed_module_basenames": sorted(modules),
    }
    provenance_path = out_dir / "kernel-provenance.json"
    provenance_path.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    sums = out_dir / "SHA256SUMS"
    artifact_paths = [vmlinuz, modules_tar, final_config, provenance_path]
    sums.write_text(
        "".join(f"{sha256_file(path)}  {path.name}\n" for path in artifact_paths),
        encoding="utf-8",
    )
    return provenance


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check", help="validate source/config contract only")
    build_parser = sub.add_parser("build", help="build kernel candidate and provenance")
    build_parser.add_argument("--work-dir", type=Path, default=ROOT / "out" / "kernel-work")
    build_parser.add_argument("--out-dir", type=Path, default=ROOT / "out" / "kernel")
    build_parser.add_argument("--jobs", type=int, default=max(1, os.cpu_count() or 1))
    args = parser.parse_args()
    try:
        if args.command == "check":
            print(json.dumps(check_contract(), indent=2, sort_keys=True))
        else:
            print(json.dumps(build(args.work_dir, args.out_dir, args.jobs), indent=2, sort_keys=True))
        return 0
    except (BuildError, subprocess.CalledProcessError, OSError) as exc:
        print(f"kernel-build: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
