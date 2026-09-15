#!/usr/bin/env python3
"""Fail-closed verifier for repository-built OrdaX kernel artifacts.

The checksum manifest is interpreted relative to the output directory, never the
caller's working directory. Only flat, safe filenames are accepted. The
provenance artifact map must agree with both SHA256SUMS and the bytes on disk.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]*$")
_MANIFEST_LINE = re.compile(r"^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._+-]*)$")
PROVENANCE_NAME = "kernel-provenance.json"
MANIFEST_NAME = "SHA256SUMS"


class VerificationError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(output_dir: Path) -> dict[str, str]:
    manifest_path = output_dir / MANIFEST_NAME
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise VerificationError(f"missing regular checksum manifest: {MANIFEST_NAME}")

    entries: dict[str, str] = {}
    try:
        lines = manifest_path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        raise VerificationError(f"cannot read checksum manifest: {exc}") from exc
    if not lines:
        raise VerificationError("checksum manifest is empty")

    for number, line in enumerate(lines, start=1):
        match = _MANIFEST_LINE.fullmatch(line)
        if not match:
            raise VerificationError(f"unsafe or malformed checksum entry at line {number}")
        digest, name = match.groups()
        if name == MANIFEST_NAME:
            raise VerificationError("checksum manifest must not reference itself")
        if name in entries:
            raise VerificationError(f"duplicate checksum entry: {name}")
        entries[name] = digest
    return entries


def load_provenance(output_dir: Path) -> dict:
    path = output_dir / PROVENANCE_NAME
    if not path.is_file() or path.is_symlink():
        raise VerificationError(f"missing regular provenance file: {PROVENANCE_NAME}")
    try:
        provenance = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise VerificationError(f"invalid kernel provenance: {exc}") from exc
    if provenance.get("$schema") != "prototype-ordax.kernel-provenance/1":
        raise VerificationError("unexpected kernel provenance schema")
    artifacts = provenance.get("artifacts")
    if not isinstance(artifacts, dict) or not artifacts:
        raise VerificationError("kernel provenance artifact map is missing or empty")
    return provenance


def verify_output(output_dir: Path) -> dict:
    output_dir = output_dir.resolve()
    if not output_dir.is_dir():
        raise VerificationError(f"kernel output directory does not exist: {output_dir}")

    manifest = load_manifest(output_dir)
    provenance = load_provenance(output_dir)
    provenance_artifacts = provenance["artifacts"]

    expected_manifest_names = set(provenance_artifacts) | {PROVENANCE_NAME}
    if set(manifest) != expected_manifest_names:
        missing = sorted(expected_manifest_names - set(manifest))
        extra = sorted(set(manifest) - expected_manifest_names)
        raise VerificationError(f"checksum manifest/provenance disagreement: missing={missing} extra={extra}")

    verified: dict[str, str] = {}
    for name, expected in manifest.items():
        if not _SAFE_NAME.fullmatch(name):
            raise VerificationError(f"unsafe artifact filename: {name}")
        path = output_dir / name
        if path.is_symlink() or not path.is_file():
            raise VerificationError(f"artifact is missing or not a regular file: {name}")
        actual = sha256_file(path)
        if actual != expected:
            raise VerificationError(f"artifact digest mismatch: {name}")
        verified[name] = actual

    for name, expected in provenance_artifacts.items():
        if not isinstance(name, str) or not _SAFE_NAME.fullmatch(name):
            raise VerificationError("provenance contains an unsafe artifact filename")
        if not isinstance(expected, str) or not _SHA256.fullmatch(expected):
            raise VerificationError(f"provenance contains an invalid digest for {name}")
        if manifest.get(name) != expected:
            raise VerificationError(f"provenance digest disagrees with checksum manifest: {name}")

    return {
        "status": "verified",
        "schema": provenance["$schema"],
        "source_commit": provenance.get("source_commit"),
        "kernel_version": provenance.get("kernel_version"),
        "artifact_count": len(verified),
        "artifacts": verified,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_dir", type=Path, nargs="?", default=Path("out/kernel"))
    args = parser.parse_args()
    try:
        print(json.dumps(verify_output(args.output_dir), indent=2, sort_keys=True))
        return 0
    except VerificationError as exc:
        print(f"kernel-verify: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
