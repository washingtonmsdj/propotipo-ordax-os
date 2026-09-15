#!/usr/bin/env python3
"""Evaluate the canonical gates required before a destructive Creator payload may exist."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
from typing import Any

AUTH_SCHEMA = "prototype-ordax.physical-write-authorization/1"
MINIMAL_SCHEMA = "prototype-ordax.minimal-bootstrap/4"
TRUST_POLICY_SCHEMA = "prototype-ordax.release-trust-policy/1"
TRUST_SCHEMA = "prototype-ordax.release-trust/1"
MEDIA_SCHEMA = "prototype-ordax.physical-media/1"
KEY_ID = "ordax-prototype-release-v1"
REPOSITORY = "washingtonmsdj/prototipo-ordax-os"
HEX64 = re.compile(r"^[0-9a-f]{64}$")


class PromotionError(RuntimeError):
    pass


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise PromotionError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_no_duplicates)
    except (OSError, json.JSONDecodeError, UnicodeError, PromotionError) as exc:
        raise PromotionError(f"cannot load {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise PromotionError(f"{path} must contain one JSON object")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _add(blockers: list[str], condition: bool, label: str) -> None:
    if not condition:
        blockers.append(label)


def evaluate(repo_root: Path) -> dict[str, Any]:
    root = repo_root.resolve()
    auth_path = root / "docs/contracts/physical-write-authorization.json"
    minimal_path = root / "docs/contracts/minimal-bootstrap.json"
    policy_path = root / "docs/contracts/release-trust-policy.json"
    media_path = root / "docs/contracts/physical-media.json"
    trust_path = root / "bootstrap/trust/release-ed25519.json"

    auth = load_json(auth_path)
    minimal = load_json(minimal_path)
    policy = load_json(policy_path)
    media = load_json(media_path)
    blockers: list[str] = []

    _add(blockers, auth.get("$schema") == AUTH_SCHEMA, "authorization-schema-invalid")
    _add(blockers, auth.get("source_repository") == REPOSITORY, "authorization-repository-mismatch")
    _add(blockers, minimal.get("$schema") == MINIMAL_SCHEMA, "minimal-bootstrap-schema-invalid")
    _add(blockers, policy.get("$schema") == TRUST_POLICY_SCHEMA, "release-trust-policy-schema-invalid")
    _add(blockers, media.get("$schema") == MEDIA_SCHEMA, "physical-media-schema-invalid")

    partitions = media.get("partitions")
    geometry_ok = (
        isinstance(partitions, list)
        and len(partitions) == 2
        and partitions[0].get("name") == "ORDAX-ESP"
        and partitions[0].get("filesystem") == "fat32"
        and partitions[1].get("name") == "ORDAX"
        and partitions[1].get("filesystem") == "ext4"
        and media.get("partition_table") == "gpt"
        and media.get("physical_write_allowed") is False
    )
    _add(blockers, geometry_ok, "physical-media-proof-contract-weakened")

    consumer = policy.get("consumer_creator")
    consumer_ok = isinstance(consumer, dict) and all(
        [
            consumer.get("generates_publisher_private_keys") is False,
            consumer.get("stores_publisher_private_keys") is False,
            consumer.get("requests_private_key_backup_from_end_user") is False,
            consumer.get("runs_release_trust_ceremony") is False,
            consumer.get("signature_verification_is_automatic") is True,
        ]
    )
    _add(blockers, consumer_ok, "consumer-publisher-boundary-invalid")

    gates = policy.get("gates")
    gates_ok = isinstance(gates, dict) and all(
        gates.get(name) is True
        for name in (
            "key_material_generated",
            "public_anchor_pinned",
            "minimal_bootstrap_resolved",
            "physical_write_allowed",
        )
    )
    _add(blockers, gates_ok, "release-trust-policy-gates-not-authorized")

    groups = minimal.get("artifact_groups")
    groups_ok = isinstance(groups, list) and len(groups) > 0 and all(
        isinstance(group, dict) and group.get("resolved") is True and bool(group.get("artifacts"))
        for group in groups
    )
    _add(blockers, minimal.get("all_artifacts_resolved") is True, "minimal-bootstrap-not-fully-resolved")
    _add(blockers, minimal.get("physical_write_allowed") is True, "minimal-bootstrap-write-not-authorized")
    _add(blockers, groups_ok, "minimal-bootstrap-has-unresolved-group")

    trust_sha: str | None = None
    trust_valid = False
    if trust_path.is_file() and not trust_path.is_symlink():
        try:
            trust = load_json(trust_path)
            encoded = trust.get("public_key_base64")
            decoded = base64.b64decode(encoded, validate=True) if isinstance(encoded, str) else b""
            trust_valid = (
                trust.get("$schema") == TRUST_SCHEMA
                and trust.get("key_id") == KEY_ID
                and len(decoded) == 32
            )
            if trust_valid:
                trust_sha = sha256_file(trust_path)
        except (PromotionError, ValueError):
            trust_valid = False
    _add(blockers, trust_valid, "canonical-public-trust-missing-or-invalid")

    if isinstance(groups, list) and trust_valid:
        trust_groups = [group for group in groups if isinstance(group, dict) and group.get("id") == "bootstrap-release-trust"]
        trust_group_ok = False
        if len(trust_groups) == 1:
            artifacts = trust_groups[0].get("artifacts")
            if trust_groups[0].get("resolved") is True and isinstance(artifacts, list) and len(artifacts) == 1:
                artifact = artifacts[0]
                trust_group_ok = (
                    artifact.get("source_path") == "bootstrap/trust/release-ed25519.json"
                    and artifact.get("target_path") == "/ordax/bootstrap/trust/release-ed25519.json"
                    and artifact.get("sha256") == trust_sha
                )
        _add(blockers, trust_group_ok, "minimal-bootstrap-trust-binding-invalid")

    minimal_sha = sha256_file(minimal_path)
    media_sha = sha256_file(media_path)
    authorization_enabled = (
        auth.get("status") == "authorized"
        and auth.get("physical_write_allowed") is True
        and auth.get("explicit_owner_authorization") is True
    )
    _add(blockers, authorization_enabled, "explicit-physical-write-authorization-missing")

    bindings = auth.get("bindings")
    bindings_ok = False
    if isinstance(bindings, dict) and authorization_enabled and trust_sha is not None:
        bindings_ok = (
            HEX64.fullmatch(str(bindings.get("minimal_bootstrap_sha256", ""))) is not None
            and bindings.get("minimal_bootstrap_sha256") == minimal_sha
            and HEX64.fullmatch(str(bindings.get("release_trust_sha256", ""))) is not None
            and bindings.get("release_trust_sha256") == trust_sha
            and HEX64.fullmatch(str(bindings.get("physical_media_sha256", ""))) is not None
            and bindings.get("physical_media_sha256") == media_sha
        )
    _add(blockers, bindings_ok, "physical-authorization-bindings-unresolved")

    blockers = sorted(set(blockers))
    return {
        "$schema": "prototype-ordax.physical-promotion-status/1",
        "status": "ready" if not blockers else "blocked",
        "ready": not blockers,
        "blockers": blockers,
        "computed_bindings": {
            "minimal_bootstrap_sha256": minimal_sha,
            "release_trust_sha256": trust_sha,
            "physical_media_sha256": media_sha,
        },
        "consumer_key_setup_required": False,
        "development_channel_can_authorize_write": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--require-ready", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        status = evaluate(args.repo_root)
    except PromotionError as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, sort_keys=True))
        return 1
    payload = json.dumps(status, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
    print(payload, end="")
    if args.require_ready and not status["ready"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
