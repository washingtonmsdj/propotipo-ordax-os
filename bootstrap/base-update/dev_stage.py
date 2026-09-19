#!/usr/bin/env python3
"""Stage an exact-commit development Base candidate into the existing A/B writer.

This is intentionally separate from the signed production stage CLI. Development
authority is the exact public Git commit plus the immutable dev-base descriptor.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import stat
import sys

HERE = Path(__file__).resolve().parent
STAGE_PATH = HERE / "stage.py"
SPEC = importlib.util.spec_from_file_location("ordax_base_stage_shared", STAGE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("base-update stage module could not be loaded")
_stage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(_stage)

SCHEMA = "prototype-ordax.dev-base-candidate/1"
REPOSITORY = "washingtonmsdj/prototipo-ordax-os"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_MANIFEST_BYTES = 64 * 1024
MAX_KERNEL_BYTES = 64 * 1024 * 1024
MAX_INITRAMFS_BYTES = 128 * 1024 * 1024


class DevStageError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _regular_file(path: Path, label: str, max_bytes: int) -> Path:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise DevStageError(f"{label} is unavailable") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise DevStageError(f"{label} must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > max_bytes:
        raise DevStageError(f"{label} size is outside allowed range")
    return path


def _strict_manifest(path: Path, expected_commit: str) -> dict:
    if SHA40_RE.fullmatch(expected_commit) is None:
        raise DevStageError("expected source commit is invalid")
    path = _regular_file(path, "development Base manifest", MAX_MANIFEST_BYTES)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DevStageError("development Base manifest is invalid JSON") from exc

    expected = {
        "$schema",
        "status",
        "source_repository",
        "source_commit",
        "tag",
        "activation",
        "manual_usb_rewrite_required",
        "kernel",
        "initramfs",
    }
    if not isinstance(value, dict) or set(value) != expected:
        raise DevStageError("development Base manifest fields are not canonical")
    if value["$schema"] != SCHEMA or value["status"] != "development-candidate":
        raise DevStageError("unsupported development Base manifest")
    if value["source_repository"] != REPOSITORY:
        raise DevStageError("development Base repository identity is invalid")
    if value["source_commit"] != expected_commit:
        raise DevStageError("development Base commit differs from requested checkout")
    if value["tag"] != f"ordax-dev-base-{expected_commit}":
        raise DevStageError("development Base tag differs from requested checkout")
    if value["activation"] != "inactive-slot-next-boot":
        raise DevStageError("development Base activation policy is invalid")
    if value["manual_usb_rewrite_required"] is not False:
        raise DevStageError("development Base unexpectedly requires USB rewrite")

    for key, name, max_bytes in (
        ("kernel", "vmlinuz", MAX_KERNEL_BYTES),
        ("initramfs", "initrd.gz", MAX_INITRAMFS_BYTES),
    ):
        binding = value[key]
        if not isinstance(binding, dict) or set(binding) != {"name", "url", "sha256", "size"}:
            raise DevStageError(f"development Base {key} binding is malformed")
        if binding["name"] != name:
            raise DevStageError(f"development Base {key} name is invalid")
        expected_url = (
            f"https://github.com/{REPOSITORY}/releases/download/"
            f"ordax-dev-base-{expected_commit}/{name}"
        )
        if binding["url"] != expected_url:
            raise DevStageError(f"development Base {key} URL is not canonical")
        if not isinstance(binding["sha256"], str) or SHA256_RE.fullmatch(binding["sha256"]) is None:
            raise DevStageError(f"development Base {key} hash is invalid")
        if (
            not isinstance(binding["size"], int)
            or isinstance(binding["size"], bool)
            or binding["size"] <= 0
            or binding["size"] > max_bytes
        ):
            raise DevStageError(f"development Base {key} size is invalid")
    return value


def _verify_asset(path: Path, binding: dict, label: str, max_bytes: int) -> Path:
    path = _regular_file(path, label, max_bytes)
    if path.stat().st_size != binding["size"]:
        raise DevStageError(f"{label} size differs from development Base manifest")
    if sha256_file(path) != binding["sha256"]:
        raise DevStageError(f"{label} hash differs from development Base manifest")
    return path


def stage_development_candidate(
    *,
    esp_root: Path,
    active_slot: str,
    manifest_path: Path,
    kernel_path: Path,
    initramfs_path: Path,
    expected_commit: str,
) -> dict:
    manifest = _strict_manifest(manifest_path, expected_commit)
    kernel = _verify_asset(
        kernel_path,
        manifest["kernel"],
        "development Base kernel",
        MAX_KERNEL_BYTES,
    )
    initramfs = _verify_asset(
        initramfs_path,
        manifest["initramfs"],
        "development Base initramfs",
        MAX_INITRAMFS_BYTES,
    )
    candidate = {
        "release_sha": expected_commit,
        "kernel_sha256": manifest["kernel"]["sha256"],
        "initramfs_sha256": manifest["initramfs"]["sha256"],
    }
    try:
        return _stage.ensure_stage(
            esp_root,
            active_slot,
            candidate,
            kernel,
            initramfs,
        )
    except (_stage.StageError, _stage._planner.PlanError) as exc:
        raise DevStageError(str(exc)) from exc


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--esp-root", type=Path, required=True)
    parser.add_argument("--active-slot", choices=("a", "b", "legacy"), required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--kernel", type=Path, required=True)
    parser.add_argument("--initramfs", type=Path, required=True)
    parser.add_argument("--expected-commit", required=True)
    args = parser.parse_args()
    try:
        result = stage_development_candidate(
            esp_root=args.esp_root,
            active_slot=args.active_slot,
            manifest_path=args.manifest,
            kernel_path=args.kernel,
            initramfs_path=args.initramfs,
            expected_commit=args.expected_commit,
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (DevStageError, OSError) as exc:
        print(f"dev-base-stage: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
