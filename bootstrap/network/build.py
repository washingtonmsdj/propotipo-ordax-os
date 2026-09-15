#!/usr/bin/env python3
"""Build the clean-room static networking BusyBox used before first release."""

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
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_SAFE_VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
REQUIRED_APPLETS = {"busybox", "ifconfig", "ip", "route", "udhcpc"}
REQUESTED_CONFIG = {
    "CONFIG_BUSYBOX": "y",
    "CONFIG_STATIC": "y",
    "CONFIG_IFCONFIG": "y",
    "CONFIG_IP": "y",
    "CONFIG_ROUTE": "y",
    "CONFIG_UDHCPC": "y",
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
    if not _SAFE_VERSION.fullmatch(str(busybox.get("version", ""))):
        raise BuildError("invalid BusyBox version")
    if not _SHA256.fullmatch(str(busybox.get("archive_sha256", ""))):
        raise BuildError("invalid BusyBox archive SHA-256")
    if set(busybox.get("required_applets", [])) != REQUIRED_APPLETS:
        raise BuildError("network BusyBox applet contract changed unexpectedly")
    if value.get("wifi_in_bootstrap") is not False:
        raise BuildError("Wi-Fi must remain outside the prototype minimal network bootstrap")
    return value


def check_contract() -> dict:
    contract = load_contract()
    runtime = contract.get("runtime", {})
    checked = {}
    for key in ("bring_up", "dhcp_script"):
        relative = runtime.get(key)
        expected = runtime.get(f"{key}_sha256")
        if not isinstance(relative, str) or not _SHA256.fullmatch(str(expected or "")):
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
        "runtime": checked,
        "required_applets": sorted(REQUIRED_APPLETS),
    }


def resolve_program(name: str) -> str:
    value = shutil.which(name)
    if not value:
        raise BuildError(f"required build program not found: {name}")
    return value


def capture(argv: list[str], *, cwd: Path | None = None) -> str:
    try:
        return subprocess.run(argv, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"command failed: {' '.join(argv)}") from exc


def run(argv: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    print("+", " ".join(argv), flush=True)
    try:
        subprocess.run(argv, cwd=cwd, env=env, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"command failed: {' '.join(argv)}") from exc


def download(contract: dict, destination: Path) -> Path:
    busybox = contract["busybox"]
    archive = destination / f"busybox-{busybox['version']}.tar.bz2"
    destination.mkdir(parents=True, exist_ok=True)
    if archive.is_file() and sha256_file(archive) == busybox["archive_sha256"]:
        return archive
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


def extract(archive: Path, destination: Path, version: str) -> Path:
    top = f"busybox-{version}"
    destination.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(archive, "r:bz2") as handle:
            for member in handle.getmembers():
                path = PurePosixPath(member.name)
                if path.is_absolute() or not path.parts or path.parts[0] != top or ".." in path.parts or member.isdev() or member.isfifo():
                    raise BuildError(f"unsafe BusyBox archive member: {member.name}")
            handle.extractall(destination, filter="data")
    except (OSError, tarfile.TarError) as exc:
        raise BuildError(f"cannot extract BusyBox source: {exc}") from exc
    source = destination / top
    if not source.is_dir():
        raise BuildError("BusyBox archive did not produce expected source directory")
    return source


def set_config(config: Path) -> None:
    lines = config.read_text(encoding="utf-8").splitlines()
    remaining = dict(REQUESTED_CONFIG)
    assignment = re.compile(r"^(CONFIG_[A-Za-z0-9_]+)=.*$")
    unset = re.compile(r"^# (CONFIG_[A-Za-z0-9_]+) is not set$")
    output = []
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
    for forbidden in ("CONFIG_HTTPD=y\n", "CONFIG_TELNETD=y\n", "CONFIG_NC_SERVER=y\n"):
        if forbidden in text:
            raise BuildError(f"unrelated network server leaked into netbox: {forbidden.strip()}")


def git_head() -> str:
    value = os.environ.get("GITHUB_SHA", "")
    if re.fullmatch(r"[0-9a-fA-F]{40}", value):
        return value.lower()
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    except Exception:
        return "unknown"


def build(work_dir: Path, out_dir: Path, jobs: int) -> dict:
    contract = load_contract()
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
    make = ["make", f"CC={musl_cc}"]
    run(make + ["allnoconfig"], cwd=source, env=env)
    set_config(source / ".config")
    run(make + ["oldconfig"], cwd=source, env=env)
    verify_config(source / ".config")
    run(make + [f"-j{max(1, jobs)}"], cwd=source, env=env)

    busybox = source / "busybox"
    if not busybox.is_file():
        raise BuildError("BusyBox build did not produce busybox")
    if "Requesting program interpreter" in capture([resolve_program("readelf"), "-l", str(busybox)]):
        raise BuildError("netbox is dynamically linked")
    try:
        result = subprocess.run([str(busybox), "--list"], check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        raise BuildError(f"netbox cannot enumerate applets: exit={exc.returncode}") from exc
    applets = set(result.stdout.splitlines())
    missing = sorted(REQUIRED_APPLETS - applets)
    if missing:
        raise BuildError(f"required network applets are missing: {missing}")

    netbox = out_dir / "netbox"
    shutil.copy2(busybox, netbox)
    os.chmod(netbox, 0o755)
    config_out = out_dir / "busybox-network.config"
    shutil.copy2(source / ".config", config_out)
    provenance = {
        "$schema": "prototype-ordax.network-bootstrap-provenance/1",
        "status": "candidate",
        "physical_artifact_authorized": bool(contract["build"]["physical_artifact_authorized"]),
        "source_commit": git_head(),
        "busybox_version": contract["busybox"]["version"],
        "busybox_archive_sha256": sha256_file(archive),
        "compiler_target": capture([musl_cc, "-dumpmachine"]),
        "static_userspace": True,
        "required_applets": sorted(REQUIRED_APPLETS),
        "artifacts": {
            "netbox": sha256_file(netbox),
            "busybox-network.config": sha256_file(config_out),
        },
    }
    provenance_path = out_dir / "network-bootstrap-provenance.json"
    provenance_path.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    artifacts = [netbox, config_out, provenance_path]
    (out_dir / "SHA256SUMS").write_text(
        "".join(f"{sha256_file(path)}  {path.name}\n" for path in artifacts), encoding="utf-8"
    )
    return provenance


def verify(out_dir: Path) -> dict:
    out_dir = out_dir.resolve()
    manifest = out_dir / "SHA256SUMS"
    provenance_path = out_dir / "network-bootstrap-provenance.json"
    if not manifest.is_file() or manifest.is_symlink() or not provenance_path.is_file() or provenance_path.is_symlink():
        raise BuildError("network output manifest/provenance is missing or unsafe")
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    if provenance.get("$schema") != "prototype-ordax.network-bootstrap-provenance/1":
        raise BuildError("unexpected network provenance schema")
    entries = {}
    for line in manifest.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._+-]*)", line)
        if not match or match.group(2) in entries or match.group(2) == "SHA256SUMS":
            raise BuildError("malformed or duplicate network checksum entry")
        entries[match.group(2)] = match.group(1)
    expected = set(provenance.get("artifacts", {})) | {"network-bootstrap-provenance.json"}
    if set(entries) != expected:
        raise BuildError("network checksum manifest disagrees with provenance")
    for name, digest in entries.items():
        path = out_dir / name
        if path.is_symlink() or not path.is_file() or sha256_file(path) != digest:
            raise BuildError(f"network artifact verification failed: {name}")
    for name, digest in provenance["artifacts"].items():
        if entries.get(name) != digest:
            raise BuildError(f"network provenance digest disagreement: {name}")
    return {"status": "verified", "artifact_count": len(entries), "source_commit": provenance.get("source_commit")}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--work-dir", type=Path, default=ROOT / "out" / "network-work")
    build_parser.add_argument("--out-dir", type=Path, default=ROOT / "out" / "network-bootstrap")
    build_parser.add_argument("--jobs", type=int, default=max(1, os.cpu_count() or 1))
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--out-dir", type=Path, default=ROOT / "out" / "network-bootstrap")
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
