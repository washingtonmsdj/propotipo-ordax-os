#!/usr/bin/env python3
"""Promote a healthy Git-development Base candidate without weakening production rules."""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "ordax_base_promote_shared",
    HERE / "promote.py",
)
_promote = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(_promote)

SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SLOTS = ("a", "b")


class DevPromotionError(RuntimeError):
    pass


def evaluate_development_health(
    *,
    cmdline: str,
    boot_id: str,
    source_sha: str,
    healthy_sha: str,
    base_heartbeat: dict,
    surface_heartbeat: dict,
    expected_release_sha: str,
    expected_candidate_slot: str,
    previous_slot: str,
) -> dict:
    if not isinstance(source_sha, str) or SHA40_RE.fullmatch(source_sha) is None:
        raise DevPromotionError("current checkout SHA is invalid")
    if not isinstance(healthy_sha, str) or SHA40_RE.fullmatch(healthy_sha) is None:
        raise DevPromotionError("Surface healthy SHA is invalid")
    if not isinstance(expected_release_sha, str) or SHA40_RE.fullmatch(expected_release_sha) is None:
        raise DevPromotionError("expected development Base SHA is invalid")
    if (
        expected_candidate_slot not in SLOTS
        or previous_slot not in SLOTS
        or expected_candidate_slot == previous_slot
    ):
        raise DevPromotionError("development Base slot expectation is invalid")

    try:
        identity = _promote.parse_cmdline(cmdline)
        current_boot_id = _promote.validate_boot_id(boot_id)
        base = _promote.validate_base_heartbeat(base_heartbeat)
        surface = _promote.validate_surface_heartbeat(surface_heartbeat)
    except _promote.PromotionError as exc:
        raise DevPromotionError(str(exc)) from exc

    checks = {
        "cmdline_release": identity["release_sha"] == expected_release_sha,
        "cmdline_slot": identity["slot"] == expected_candidate_slot,
        "base_candidate_release": base["candidateSha"] == expected_release_sha,
        "base_checkout_release": base["sourceSha"] == source_sha,
        "base_slot": base["slot"] == expected_candidate_slot,
        "base_current_boot": base["bootId"] == current_boot_id,
        "surface_health_release": healthy_sha == source_sha,
        "surface_heartbeat_release": surface["sourceSha"] == source_sha,
        "surface_current_boot": surface["bootId"] == current_boot_id,
    }
    failed = sorted(name for name, passed in checks.items() if not passed)
    if failed:
        raise DevPromotionError(
            "development candidate health mismatch: " + ",".join(failed)
        )

    return {
        "$schema": "prototype-ordax.base-update-health/1",
        "release_sha": expected_release_sha,
        "candidate_slot": expected_candidate_slot,
        "previous_slot": previous_slot,
        "boot_id": current_boot_id,
        "checks": checks,
        "healthy": True,
    }


def promote_development_candidate(
    *,
    esp_root: Path,
    state_root: Path,
    cmdline_path: Path,
    boot_id_path: Path,
    base_heartbeat_path: Path,
    surface_heartbeat_path: Path,
    healthy_sha_path: Path,
    source_sha: str,
    expected_release_sha: str,
    candidate_slot: str,
    previous_slot: str,
) -> dict:
    try:
        health = evaluate_development_health(
            cmdline=cmdline_path.read_text(encoding="utf-8"),
            boot_id=boot_id_path.read_text(encoding="utf-8").strip(),
            source_sha=source_sha,
            healthy_sha=healthy_sha_path.read_text(encoding="utf-8").strip(),
            base_heartbeat=_promote.load_json(base_heartbeat_path),
            surface_heartbeat=_promote.load_json(surface_heartbeat_path),
            expected_release_sha=expected_release_sha,
            expected_candidate_slot=candidate_slot,
            previous_slot=previous_slot,
        )
        return _promote.promote(
            esp_root=esp_root,
            state_root=state_root,
            health=health,
        )
    except (OSError, UnicodeError, _promote.PromotionError) as exc:
        raise DevPromotionError(str(exc)) from exc


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--esp-root", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--cmdline", type=Path, default=Path("/proc/cmdline"))
    parser.add_argument(
        "--boot-id",
        type=Path,
        default=Path("/run/ordax-update/base-boot-id"),
    )
    parser.add_argument("--base-heartbeat", type=Path, required=True)
    parser.add_argument("--surface-heartbeat", type=Path, required=True)
    parser.add_argument("--healthy-sha", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--expected-release-sha", required=True)
    parser.add_argument("--candidate-slot", choices=SLOTS, required=True)
    parser.add_argument("--previous-slot", choices=SLOTS, required=True)
    args = parser.parse_args()

    try:
        result = promote_development_candidate(
            esp_root=args.esp_root,
            state_root=args.state_root,
            cmdline_path=args.cmdline,
            boot_id_path=args.boot_id,
            base_heartbeat_path=args.base_heartbeat,
            surface_heartbeat_path=args.surface_heartbeat,
            healthy_sha_path=args.healthy_sha,
            source_sha=args.source_sha,
            expected_release_sha=args.expected_release_sha,
            candidate_slot=args.candidate_slot,
            previous_slot=args.previous_slot,
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except DevPromotionError as exc:
        print(f"dev-base-promote: WAIT: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
