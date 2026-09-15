#!/usr/bin/env python3
"""Build the pinned systemd-boot EFI candidate for the minimal OrdaX ESP."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / "boot" / "esp"
CONTRACT = HERE / "source.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


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
        raise BuildError(f"cannot read ESP source contract: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.esp-source/1":
        raise BuildError("unexpected ESP source contract schema")
    bootloader = value.get("bootloader", {})
    if bootloader.get("project") != "systemd-boot":
        raise BuildError("unexpected ESP bootloader project")
    if not COMMIT_RE.fullmatch(str(bootloader.get("source_commit", ""))):
        raise BuildError("invalid pinned systemd source commit")
    if bootloader.get("upstream_tag_signature_verified") is not True:
        raise BuildError("upstream bootloader tag must be signature-verified")
    return value


def check_contract() -> dict:
    value = load_contract()
    config = value.get("configuration", {})
    checked = {}
    for path_key, hash_key in (
        ("loader_conf", "loader_conf_sha256"),
        ("normal_entry", "normal_entry_sha256"),
        ("recovery_entry", "recovery_entry_sha256"),
    ):
        relative = config.get(path_key)
        expected = config.get(hash_key)
        if not isinstance(relative, str) or not SHA256_RE.fullmatch(str(expected or "")):
            raise BuildError(f"missing ESP config source/hash: {path_key}")
        path = (ROOT / relative).resolve()
        if ROOT.resolve() not in path.parents or not path.is_file() or path.is_symlink():
            raise BuildError(f"unsafe ESP config path: {relative}")
        actual = sha256_file(path)
        if actual != expected:
            raise BuildError(f"ESP config digest mismatch: {relative}")
        checked[path_key] = {"path": relative, "sha256": actual}
    expected_layout = [
        "EFI/BOOT/BOOTX64.EFI",
        "loader/loader.conf",
        "loader/entries/ordax.conf",
        "loader/entries/ordax-recovery.conf",
        "ordax/vmlinuz",
        "ordax/initrd.gz",
    ]
    if value.get("target_layout") != expected_layout:
        raise BuildError("ESP target layout is no longer minimal/canonical")
    return {
        "systemd_version": value["bootloader"]["version"],
        "systemd_source_commit": value["bootloader"]["source_commit"],
        "configuration": checked,
        "target_layout": expected_layout,
    }


def resolve(name: str) -> str:
    value = shutil.which(name)
    if not value:
        raise BuildError(f"required build program not found: {name}")
    return value


def run(argv: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    print("+", " ".join(argv), flush=True)
    try:
        subprocess.run(argv, cwd=cwd, env=env, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"command failed: {' '.join(argv)}") from exc


def capture(argv: list[str], *, cwd: Path | None = None) -> str:
    try:
        return subprocess.run(argv, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"command failed: {' '.join(argv)}") from exc


def acquire_source(contract: dict, source: Path) -> None:
    source_commit = contract["bootloader"]["source_commit"]
    repository = contract["bootloader"]["upstream_repository"]
    shutil.rmtree(source, ignore_errors=True)
    source.mkdir(parents=True)
    run([resolve("git"), "init", "-q"], cwd=source)
    run([resolve("git"), "remote", "add", "origin", repository], cwd=source)
    run([resolve("git"), "fetch", "--depth=1", "origin", source_commit], cwd=source)
    run([resolve("git"), "checkout", "--detach", "-q", "FETCH_HEAD"], cwd=source)
    actual = capture([resolve("git"), "rev-parse", "HEAD"], cwd=source)
    if actual != source_commit:
        raise BuildError(f"systemd source commit mismatch: expected={source_commit} actual={actual}")


def build(work_dir: Path, out_dir: Path) -> dict:
    contract = load_contract()
    check_contract()
    for program in ("git", "meson", "ninja", "objdump"):
        resolve(program)

    work_dir = work_dir.resolve()
    out_dir = out_dir.resolve()
    source = work_dir / "systemd-source"
    build_dir = work_dir / "systemd-build"
    shutil.rmtree(work_dir, ignore_errors=True)
    shutil.rmtree(out_dir, ignore_errors=True)
    work_dir.mkdir(parents=True)
    out_dir.mkdir(parents=True)

    acquire_source(contract, source)

    env = dict(os.environ)
    env.update({
        "SOURCE_DATE_EPOCH": "0",
        "TZ": "UTC",
        "LC_ALL": "C.UTF-8",
        "LANG": "C.UTF-8",
    })
    meson_args = [
        resolve("meson"), "setup", str(build_dir), str(source),
        "--buildtype=release",
        "-Dauto_features=disabled",
        "-Dbootloader=enabled",
        "-Defi=true",
        "-Dtests=false",
        "-Dman=disabled",
        "-Dhtml=disabled",
        "-Dtranslations=false",
        "-Dukify=disabled",
        "-Dtpm=false",
        "-Dsbat-distro=ordax",
        "-Dsbat-distro-generation=1",
        "-Dsbat-distro-summary=OrdaX",
        "-Dsbat-distro-pkgname=ordax-boot",
        f"-Dsbat-distro-version={contract['bootloader']['version']}",
        "-Dsbat-distro-url=https://github.com/washingtonmsdj/prototipo-ordax-os",
    ]
    run(meson_args, env=env)
    target = "src/boot/efi/systemd-bootx64.efi"
    run([resolve("ninja"), "-C", str(build_dir), target], env=env)
    built = build_dir / target
    if not built.is_file():
        raise BuildError("systemd-boot build did not produce expected x64 EFI binary")
    objdump = capture([resolve("objdump"), "-f", str(built)])
    if "pei-x86-64" not in objdump and "pei-x86-64" not in capture([resolve("objdump"), "-p", str(built)]):
        raise BuildError("systemd-boot output is not an x86_64 PE/EFI image")

    output = out_dir / "systemd-bootx64.efi"
    shutil.copy2(built, output)
    provenance = {
        "$schema": "prototype-ordax.esp-bootloader-provenance/1",
        "status": "candidate",
        "physical_artifact_authorized": False,
        "upstream_project": "systemd",
        "upstream_version": contract["bootloader"]["version"],
        "upstream_tag": contract["bootloader"]["tag"],
        "upstream_tag_object_sha": contract["bootloader"]["tag_object_sha"],
        "upstream_source_commit": contract["bootloader"]["source_commit"],
        "upstream_tag_signature_verified": True,
        "artifact": {
            "name": output.name,
            "sha256": sha256_file(output),
            "size": output.stat().st_size,
        },
    }
    prov_path = out_dir / "bootloader-provenance.json"
    prov_path.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (out_dir / "SHA256SUMS").write_text(
        f"{sha256_file(output)}  {output.name}\n{sha256_file(prov_path)}  {prov_path.name}\n",
        encoding="utf-8",
    )
    return provenance


def verify(out_dir: Path) -> dict:
    out_dir = out_dir.resolve()
    sums = out_dir / "SHA256SUMS"
    prov = out_dir / "bootloader-provenance.json"
    if not sums.is_file() or sums.is_symlink() or not prov.is_file() or prov.is_symlink():
        raise BuildError("ESP candidate checksum/provenance missing or unsafe")
    provenance = json.loads(prov.read_text(encoding="utf-8"))
    if provenance.get("$schema") != "prototype-ordax.esp-bootloader-provenance/1":
        raise BuildError("unexpected ESP bootloader provenance schema")
    entries = {}
    for line in sums.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._+-]*)", line)
        if not match or match.group(2) in entries:
            raise BuildError("malformed ESP checksum manifest")
        entries[match.group(2)] = match.group(1)
    expected = {"systemd-bootx64.efi", "bootloader-provenance.json"}
    if set(entries) != expected:
        raise BuildError("ESP checksum manifest has unexpected files")
    for name, digest in entries.items():
        path = out_dir / name
        if path.is_symlink() or not path.is_file() or sha256_file(path) != digest:
            raise BuildError(f"ESP artifact verification failed: {name}")
    if provenance["artifact"]["sha256"] != entries["systemd-bootx64.efi"]:
        raise BuildError("ESP provenance disagrees with bootloader digest")
    return {"status": "verified", "artifact_count": len(entries), "source_commit": provenance["upstream_source_commit"]}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    b = sub.add_parser("build")
    b.add_argument("--work-dir", type=Path, default=ROOT / "out" / "esp-work")
    b.add_argument("--out-dir", type=Path, default=ROOT / "out" / "esp")
    v = sub.add_parser("verify")
    v.add_argument("--out-dir", type=Path, default=ROOT / "out" / "esp")
    args = parser.parse_args()
    try:
        if args.command == "check":
            result = check_contract()
        elif args.command == "build":
            result = build(args.work_dir, args.out_dir)
        else:
            result = verify(args.out_dir)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (BuildError, OSError, json.JSONDecodeError, KeyError) as exc:
        print(f"esp-build: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
