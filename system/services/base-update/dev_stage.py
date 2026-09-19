#!/usr/bin/env python3
"""Stage an exact-commit development Base candidate through the shared A/B stager.

This is a development-channel adapter only. It revalidates the immutable
candidate and its already-materialized versioned rootfs, then delegates all ESP
writes to bootstrap/base-update/stage.py. It never arms LoaderEntryOneShot and
never requests a reboot.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
SOURCE_ROOT = HERE.parents[2]


class DevStageError(RuntimeError):
    pass


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise DevStageError(f"cannot load staging dependency: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_channel = _load(HERE / "dev_channel.py", "ordax_dev_stage_channel")


def stage_ready_candidate(
    *,
    repo_root: Path,
    esp_root: Path,
    active_slot: str,
    candidate_root: Path,
    version_root: Path,
    source_commit: str,
) -> dict:
    try:
        _channel.candidate_tag(source_commit)
    except _channel.DevBaseChannelError as exc:
        raise DevStageError(str(exc)) from exc

    repo_root = repo_root.resolve()
    if repo_root.is_symlink() or not repo_root.is_dir():
        raise DevStageError("repository root is unavailable")

    stage_path = repo_root / "bootstrap/base-update/stage.py"
    if stage_path.is_symlink() or not stage_path.is_file():
        raise DevStageError("shared A/B stager is unavailable")
    stager = _load(stage_path, "ordax_dev_stage_shared_stager")

    candidate_path = candidate_root / source_commit
    version_path = version_root / source_commit
    try:
        manifest = _channel.verify_materialized(candidate_path, source_commit)
        _channel.verify_versioned_rootfs(version_path, source_commit)
        candidate = {
            "release_sha": source_commit,
            "kernel_sha256": manifest["kernel"]["sha256"],
            "initramfs_sha256": manifest["initramfs"]["sha256"],
        }
        result = stager.stage(
            esp_root,
            active_slot,
            candidate,
            candidate_path / manifest["kernel"]["name"],
            candidate_path / manifest["initramfs"]["name"],
        )
    except (
        _channel.DevBaseChannelError,
        stager.StageError,
        stager._planner.PlanError,
        OSError,
    ) as exc:
        raise DevStageError(str(exc)) from exc

    if result.get("release_sha") != source_commit:
        raise DevStageError("shared stager returned a different source identity")
    if result.get("efi_variable_written") is not False:
        raise DevStageError("development stage unexpectedly touched EFI variables")
    if result.get("reboot_requested") is not False:
        raise DevStageError("development stage unexpectedly requested a reboot")
    if result.get("activation_ready") is not True:
        raise DevStageError("development stage did not produce an activation-ready candidate")

    return {
        "$schema": "prototype-ordax.dev-base-stage-result/1",
        "source_commit": source_commit,
        "candidate_manifest_verified": True,
        "versioned_rootfs_verified": True,
        "active_slot": result["active_slot"],
        "candidate_slot": result["candidate_slot"],
        "candidate_entry": result["candidate_entry"],
        "kernel_target": result["kernel_target"],
        "initramfs_target": result["initramfs_target"],
        "activation_ready": True,
        "activation_performed": False,
        "efi_variable_written": False,
        "reboot_requested": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=SOURCE_ROOT)
    parser.add_argument("--esp-root", type=Path, required=True)
    parser.add_argument("--active-slot", choices=("a", "b", "legacy"), required=True)
    parser.add_argument("--candidate-root", type=Path, required=True)
    parser.add_argument("--version-root", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    args = parser.parse_args()

    try:
        result = stage_ready_candidate(
            repo_root=args.repo_root,
            esp_root=args.esp_root,
            active_slot=args.active_slot,
            candidate_root=args.candidate_root,
            version_root=args.version_root,
            source_commit=args.source_commit,
        )
    except DevStageError as exc:
        print(f"dev-base-stage: ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
