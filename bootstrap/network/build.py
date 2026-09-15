#!/usr/bin/env python3
"""Build the clean-room static network userspace used before first release."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / "bootstrap" / "network"
CONTRACT = HERE / "source.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MULTICALL_BINARY = "busybox"
REQUIRED_APPLETS = {"ifconfig", "route", "udhcpc"}
REQUESTED_CONFIG = {
    "CONFIG_BUSYBOX": "y",
    "CONFIG_STATIC": "y",
    "CONFIG_IFCONFIG": "y",
    "CONFIG_FEATURE_IFCONFIG_STATUS": "y",
    "CONFIG_ROUTE": "y",
    "CONFIG_UDHCPC": "y",
    "CONFIG_SH_IS_NONE": "y",
    "CONFIG_BASH_IS_NONE": "y",
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
        raise BuildError(f"cannot read network source contract: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.network-bootstrap-source/1":
        raise BuildError("unexpected network source contract schema")
    busybox = value.get("busybox", {})
    if not SHA256_RE.fullmatch(str(busybox.get("archive_sha256", ""))):
        raise BuildError("invalid BusyBox archive SHA-256")
    if busybox.get("multicall_binary") != MULTICALL_BINARY:
        raise BuildError("unexpected network multicall binary")
    if set(busybox.get("required_applets", [])) != REQUIRED_APPLETS:
        raise BuildError("network applet contract changed unexpectedly")
    if value.get("wifi_in_bootstrap") is not False:
        raise BuildError("Wi-Fi must remain outside the prototype bootstrap")
    return value


def check_contract() -> dict:
    contract = load_contract()
    checked = {}
    runtime = contract.get("runtime", {})
    for key in ("bring_up", "dhcp_script"):
        relative = runtime.get(key)
        expected = runtime.get(f"{key}_sha256")
        if not isinstance(relative, str) or not SHA256_RE.fullmatch(str(expected or "")):
            raise BuildError(f"missing runtime source/hash contract: {key}")
        path = (ROOT / relative).resolve()
        if ROOT.resolve() not in path.parents or not path.is_file() or path.is_symlink():
            raise BuildError(f"unsafe runtime source: {relative}")
        actual = sha256_file(path)
        if actual != expected:
            raise BuildError(f"runtime source digest mismatch: {relative}")
        text = path.read_text(encoding="utf-8").lower()
        for forbidden in ("wpa_supplicant", "sshd", "dropbear", "remote-core", "control-plane", "codex"):
            if forbidden in text:
                raise BuildError(f"forbidden responsibility leaked into {relative}: {forbidden}")
        checked[key] = {"path": relative, "sha256": actual}
    return {
        "busybox_version": contract["busybox"]["version"],
        "busybox_archive_sha256": contract["busybox"]["archive_sha256"],
        "multicall_binary": MULTICALL_BINARY,
        "required_applets": sorted(REQUIRED_APPLETS),
        "runtime": checked,
    }


def resolve(name: str) -> str:
    value = shutil.which(name)
    if not value:
        raise BuildError(f"required program not found: {name}")
    return value


def capture(argv: list[str]) -> str:
    try:
        return subprocess.run(argv, check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"command failed: {' '.join(argv)}") from exc


def run(argv: list[str], cwd: Path, env: dict[str, str]) -> None:
    print("+", " ".join(argv), flush=True)
    try:
        subprocess.run(argv, cwd=cwd, env=env, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"command failed: {' '.join(argv)}") from exc


def download(contract: dict, directory: Path) -> Path:
    bb = contract["busybox"]
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / f"busybox-{bb['version']}.tar.bz2"
    if archive.is_file() and sha256_file(archive) == bb["archive_sha256"]:
        return archive
    partial = archive.with_suffix(archive.suffix + ".part")
    partial.unlink(missing_ok=True)
    try:
        with urllib.request.urlopen(bb["archive_url"], timeout=120) as response, partial.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
    except Exception as exc:
        partial.unlink(missing_ok=True)
        raise BuildError(f"BusyBox download failed: {exc}") from exc
    actual = sha256_file(partial)
    if actual != bb["archive_sha256"]:
        partial.unlink(missing_ok=True)
        raise BuildError(f"BusyBox digest mismatch: {actual}")
    partial.replace(archive)
    return archive


def extract(archive: Path, directory: Path, version: str) -> Path:
    top = f"busybox-{version}"
    directory.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(archive, "r:bz2") as tf:
            for member in tf.getmembers():
                path = PurePosixPath(member.name)
                if path.is_absolute() or not path.parts or path.parts[0] != top or ".." in path.parts or member.isdev() or member.isfifo():
                    raise BuildError(f"unsafe archive member: {member.name}")
            tf.extractall(directory, filter="data")
    except (OSError, tarfile.TarError) as exc:
        raise BuildError(f"cannot extract BusyBox: {exc}") from exc
    source = directory / top
    if not source.is_dir():
        raise BuildError("BusyBox source directory missing after extraction")
    return source


def patch_config(config: Path) -> None:
    values = dict(REQUESTED_CONFIG)
    out = []
    assignment = re.compile(r"^(CONFIG_[A-Za-z0-9_]+)=.*$")
    unset = re.compile(r"^# (CONFIG_[A-Za-z0-9_]+) is not set$")
    for line in config.read_text(encoding="utf-8").splitlines():
        match = assignment.fullmatch(line) or unset.fullmatch(line)
        symbol = match.group(1) if match else None
        if symbol in values:
            out.append(f"{symbol}={values.pop(symbol)}")
        else:
            out.append(line)
    out.extend(f"{key}={value}" for key, value in values.items())
    config.write_text("\n".join(out) + "\n", encoding="utf-8")


def verify_config(config: Path) -> None:
    text = config.read_text(encoding="utf-8")
    for key, value in REQUESTED_CONFIG.items():
        if f"{key}={value}\n" not in text:
            raise BuildError(f"Kconfig rejected {key}={value}")
    forbidden_enabled = (
        "CONFIG_IP=y\n",
        "CONFIG_HTTPD=y\n",
        "CONFIG_TELNETD=y\n",
        "CONFIG_NC=y\n",
        "CONFIG_SH_IS_ASH=y\n",
        "CONFIG_SH_IS_HUSH=y\n",
        "CONFIG_BASH_IS_ASH=y\n",
        "CONFIG_BASH_IS_HUSH=y\n",
    )
    for forbidden in forbidden_enabled:
        if forbidden in text:
            raise BuildError(f"unneeded applet/alias leaked into netbox: {forbidden.strip()}")


def source_commit() -> str:
    value = os.environ.get("GITHUB_SHA", "")
    if re.fullmatch(r"[0-9a-fA-F]{40}", value):
        return value.lower()
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    except Exception:
        return "unknown"


def kernel_uapi_cflags() -> str:
    """Return host kernel-UAPI include fallbacks without replacing musl headers.

    BusyBox DHCP includes linux/filter.h. musl-dev intentionally does not ship
    the Linux UAPI tree, while the CI host does. `-idirafter` keeps musl's libc
    headers authoritative and consults the host only for missing kernel/asm
    UAPI headers. These are build-time inputs only; the resulting netbox remains
    statically linked and carries no host runtime dependency.
    """
    candidates = [Path("/usr/include"), Path("/usr/include/x86_64-linux-gnu")]
    required = [Path("/usr/include/linux/filter.h")]
    if not all(path.is_file() for path in required):
        raise BuildError("Linux UAPI headers missing: /usr/include/linux/filter.h")
    return " ".join(f"-idirafter {path}" for path in candidates if path.is_dir())


def build(work_dir: Path, out_dir: Path, jobs: int) -> dict:
    contract = load_contract()
    check_contract()
    for program in ("make", "musl-gcc", "readelf"):
        resolve(program)
    work_dir, out_dir = work_dir.resolve(), out_dir.resolve()
    shutil.rmtree(work_dir, ignore_errors=True)
    shutil.rmtree(out_dir, ignore_errors=True)
    work_dir.mkdir(parents=True)
    out_dir.mkdir(parents=True)

    archive = download(contract, work_dir / "cache")
    source = extract(archive, work_dir / "source", contract["busybox"]["version"])
    env = dict(os.environ)
    env.update(FIXED_ENV)
    compiler = resolve("musl-gcc")
    make = ["make", f"CC={compiler}", f"EXTRA_CFLAGS={kernel_uapi_cflags()}"]
    run(make + ["allnoconfig"], source, env)
    patch_config(source / ".config")
    run(make + ["oldconfig"], source, env)
    verify_config(source / ".config")
    run(make + [f"-j{max(1, jobs)}"], source, env)

    built = source / MULTICALL_BINARY
    if not built.is_file():
        raise BuildError("BusyBox did not produce its multicall binary")
    if "Requesting program interpreter" in capture([resolve("readelf"), "-l", str(built)]):
        raise BuildError("netbox is dynamically linked")
    try:
        listed = {
            line.strip()
            for line in subprocess.run(
                [str(built), "--list"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.splitlines()
            if line.strip()
        }
    except subprocess.CalledProcessError as exc:
        raise BuildError("netbox cannot enumerate applets") from exc
    missing = REQUIRED_APPLETS - listed
    if missing:
        raise BuildError(f"missing applets: {sorted(missing)}")
    unexpected = listed - REQUIRED_APPLETS
    if unexpected:
        raise BuildError(f"unexpected applets expanded netbox surface: {sorted(unexpected)}")

    netbox = out_dir / "netbox"
    shutil.copy2(built, netbox)
    os.chmod(netbox, 0o755)
    config_copy = out_dir / "busybox-network.config"
    shutil.copy2(source / ".config", config_copy)
    provenance = {
        "$schema": "prototype-ordax.network-bootstrap-provenance/1",
        "status": "candidate",
        "physical_artifact_authorized": False,
        "source_commit": source_commit(),
        "busybox_version": contract["busybox"]["version"],
        "busybox_archive_sha256": sha256_file(archive),
        "compiler_target": capture([compiler, "-dumpmachine"]),
        "static_userspace": True,
        "multicall_binary": MULTICALL_BINARY,
        "required_applets": sorted(REQUIRED_APPLETS),
        "artifacts": {
            "netbox": sha256_file(netbox),
            "busybox-network.config": sha256_file(config_copy),
        },
    }
    provenance_path = out_dir / "network-bootstrap-provenance.json"
    provenance_path.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    files = [netbox, config_copy, provenance_path]
    (out_dir / "SHA256SUMS").write_text("".join(f"{sha256_file(p)}  {p.name}\n" for p in files), encoding="utf-8")
    return provenance


def verify(out_dir: Path) -> dict:
    out_dir = out_dir.resolve()
    checksum_file = out_dir / "SHA256SUMS"
    provenance_path = out_dir / "network-bootstrap-provenance.json"
    if not checksum_file.is_file() or checksum_file.is_symlink() or not provenance_path.is_file() or provenance_path.is_symlink():
        raise BuildError("missing or unsafe checksum/provenance")
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    if provenance.get("$schema") != "prototype-ordax.network-bootstrap-provenance/1":
        raise BuildError("unexpected provenance schema")
    if provenance.get("physical_artifact_authorized") is not False:
        raise BuildError("network candidate must not authorize physical media")
    if provenance.get("multicall_binary") != MULTICALL_BINARY:
        raise BuildError("network provenance has unexpected multicall binary")
    if set(provenance.get("required_applets", [])) != REQUIRED_APPLETS:
        raise BuildError("network provenance applet surface changed")
    entries = {}
    for line in checksum_file.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._+-]*)", line)
        if not match or match.group(2) in entries:
            raise BuildError("malformed checksum manifest")
        entries[match.group(2)] = match.group(1)
    expected = set(provenance.get("artifacts", {})) | {"network-bootstrap-provenance.json"}
    if set(entries) != expected:
        raise BuildError("checksum manifest disagrees with provenance")
    for name, expected_digest in entries.items():
        path = out_dir / name
        if path.is_symlink() or not path.is_file() or sha256_file(path) != expected_digest:
            raise BuildError(f"artifact verification failed: {name}")
    for name, digest in provenance["artifacts"].items():
        if entries.get(name) != digest:
            raise BuildError(f"provenance digest mismatch: {name}")
    return {"status": "verified", "artifact_count": len(entries), "source_commit": provenance.get("source_commit")}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    b = sub.add_parser("build")
    b.add_argument("--work-dir", type=Path, default=ROOT / "out" / "network-work")
    b.add_argument("--out-dir", type=Path, default=ROOT / "out" / "network-bootstrap")
    b.add_argument("--jobs", type=int, default=max(1, os.cpu_count() or 1))
    v = sub.add_parser("verify")
    v.add_argument("--out-dir", type=Path, default=ROOT / "out" / "network-bootstrap")
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
    except (BuildError, OSError, json.JSONDecodeError) as exc:
        print(f"network-build: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
