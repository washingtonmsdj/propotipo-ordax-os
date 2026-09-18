#!/usr/bin/env python3
"""Pure planner for transactional OrdaX base updates.

This module never mounts or writes the ESP. It only validates bounded input and
derives the inactive-slot staging and post-health promotion plan.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = ROOT / "docs" / "contracts" / "base-update.json"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SLOTS = ("a", "b")


class PlanError(RuntimeError):
    pass


def load_contract() -> dict:
    try:
        value = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PlanError(f"cannot read base update contract: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.base-update/1":
        raise PlanError("unexpected base update contract schema")
    return value


def validate_release(candidate: dict) -> dict:
    if not isinstance(candidate, dict):
        raise PlanError("candidate must be an object")
    if set(candidate) != {"release_sha", "kernel_sha256", "initramfs_sha256"}:
        raise PlanError("candidate has unexpected fields")
    release_sha = candidate["release_sha"]
    kernel_sha = candidate["kernel_sha256"]
    initramfs_sha = candidate["initramfs_sha256"]
    if not isinstance(release_sha, str) or not SHA40_RE.fullmatch(release_sha):
        raise PlanError("invalid release SHA")
    for name, value in (
        ("kernel_sha256", kernel_sha),
        ("initramfs_sha256", initramfs_sha),
    ):
        if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
            raise PlanError(f"invalid {name}")
    return {
        "release_sha": release_sha,
        "kernel_sha256": kernel_sha,
        "initramfs_sha256": initramfs_sha,
    }


def plan(active_slot: str, candidate: dict) -> dict:
    contract = load_contract()
    if active_slot not in SLOTS:
        raise PlanError("active slot must be a or b")
    release = validate_release(candidate)
    inactive_slot = "b" if active_slot == "a" else "a"
    kernel_path = contract["slots"]["paths"]["kernel"].format(slot=inactive_slot)
    initramfs_path = contract["slots"]["paths"]["initramfs"].format(slot=inactive_slot)
    options = [
        value.format(slot=inactive_slot, release_sha=release["release_sha"])
        for value in contract["entries"]["candidate_kernel_options"]
    ]
    return {
        "$schema": "prototype-ordax.base-update-plan/1",
        "active_slot": active_slot,
        "candidate_slot": inactive_slot,
        "release_sha": release["release_sha"],
        "stage": {
            "kernel": {
                "target_path": kernel_path,
                "sha256": release["kernel_sha256"],
            },
            "initramfs": {
                "target_path": initramfs_path,
                "sha256": release["initramfs_sha256"],
            },
            "candidate_entry": contract["entries"]["candidate_template"],
            "kernel_options": options,
        },
        "activation": {
            "selector": contract["activation"]["selector"],
            "entry_id": "ordax-candidate.conf",
            "tries": contract["activation"]["candidate_tries_left"],
            "default_entry_changes_before_health": False,
        },
        "promotion": {
            "current_slot_after_health": inactive_slot,
            "recovery_slot_after_health": active_slot,
            "remove_candidate_entry": True,
        },
        "failure": {
            "current_slot": active_slot,
            "candidate_never_promoted": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--active-slot", choices=SLOTS, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    args = parser.parse_args()
    try:
        candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
        print(json.dumps(plan(args.active_slot, candidate), indent=2, sort_keys=True))
        return 0
    except (OSError, json.JSONDecodeError, PlanError) as exc:
        print(f"base-update-plan: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
