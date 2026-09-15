#!/usr/bin/env python3
"""Verify the installed kernel build toolchain against the pinned contract."""

from __future__ import annotations

import argparse
import json
import platform
from pathlib import Path
import shutil
import subprocess
import sys

SCHEMA = "prototype-ordax.kernel-build-environment/1"
OBSERVATION_SCHEMA = "prototype-ordax.kernel-build-environment-verification/1"


def fail(message: str) -> "None":
    raise SystemExit(f"KERNEL_BUILD_ENVIRONMENT=FAIL\nREASON={message}")


def package_version(name: str) -> str:
    result = subprocess.run(
        ["dpkg-query", "-W", "-f=${Version}", name],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        fail(f"package not installed: {name}")
    return result.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("contract", type=Path)
    parser.add_argument("--base-image", required=True)
    parser.add_argument("--snapshot-id", required=True)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    contract = json.loads(args.contract.read_text(encoding="utf-8"))
    if contract.get("$schema") != SCHEMA:
        fail("unexpected contract schema")
    if contract.get("architecture") != "linux/amd64":
        fail("unsupported contract architecture")
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "amd64"}:
        fail(f"unexpected runtime architecture: {platform.system()}/{platform.machine()}")
    if shutil.which("dpkg-query") is None:
        fail("dpkg-query is unavailable")

    expected_image = (
        contract["base_image"]["repository"]
        + "@"
        + contract["base_image"]["manifest_digest"]
    )
    if args.base_image != expected_image:
        fail("base image does not match contract")
    if args.snapshot_id != contract["apt"]["snapshot_id"]:
        fail("APT snapshot does not match contract")

    packages = contract["apt"]["packages"]
    expected = contract["apt"].get("expected_versions", {})
    observed = {name: package_version(name) for name in packages}

    if contract["proof"].get("package_versions_pinned"):
        if set(expected) != set(packages):
            fail("expected package versions do not cover the exact package set")
        mismatches = {
            name: {"expected": expected[name], "observed": observed[name]}
            for name in packages
            if expected[name] != observed[name]
        }
        if mismatches:
            fail("package version mismatch: " + json.dumps(mismatches, sort_keys=True))

    gcc = subprocess.run(
        ["gcc-13", "-dumpfullversion"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if not gcc.startswith("13."):
        fail(f"unexpected gcc-13 compiler version: {gcc}")

    result = {
        "$schema": OBSERVATION_SCHEMA,
        "status": "pass",
        "architecture": "linux/amd64",
        "base_image": expected_image,
        "apt_snapshot_id": args.snapshot_id,
        "package_versions": dict(sorted(observed.items())),
        "gcc_13": gcc,
        "package_versions_pinned": bool(contract["proof"].get("package_versions_pinned")),
    }

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print("KERNEL_BUILD_ENVIRONMENT=PASS")
    print(f"PACKAGE_COUNT={len(packages)}")
    print(f"GCC_13={gcc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
