#!/usr/bin/env python3
"""Validate and promote recovered public OrdaX release trust into the repository.

The promoter consumes only public ceremony outputs, re-verifies the recovered
Ed25519 signing proof, pins the public trust anchor, resolves the minimal
bootstrap trust group and computes physical-authorization bindings. It never
accepts a private key and never enables physical writes.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
from typing import Any
import zipfile

TRUST_SCHEMA = "prototype-ordax.release-trust/1"
EVIDENCE_SCHEMA = "prototype-ordax.release-trust-ceremony-evidence/1"
ENVELOPE_SCHEMA = "prototype-ordax.release-envelope/1"
POLICY_SCHEMA = "prototype-ordax.release-trust-policy/1"
MINIMAL_SCHEMA = "prototype-ordax.minimal-bootstrap/4"
AUTH_SCHEMA = "prototype-ordax.physical-write-authorization/1"
MEDIA_SCHEMA = "prototype-ordax.physical-media/1"
RESULT_SCHEMA = "prototype-ordax.release-trust-public-promotion/1"
KEY_ID = "ordax-prototype-release-v1"
HEX64 = re.compile(r"^[0-9a-f]{64}$")

PROMOTION_FILES = {
    "release-ed25519.json",
    "ceremony-public-evidence.json",
    "trust-proof-manifest.json",
    "trust-proof-recovery-envelope.json",
}
TRUST_REPOSITORY_PATH = Path("bootstrap/trust/release-ed25519.json")
EVIDENCE_REPOSITORY_PATH = Path("docs/evidence/release-trust-ceremony.json")
PROOF_MANIFEST_REPOSITORY_PATH = Path("docs/evidence/release-trust-proof-manifest.json")
RECOVERY_ENVELOPE_REPOSITORY_PATH = Path(
    "docs/evidence/release-trust-recovery-envelope.json"
)
MINIMAL_PATH = Path("docs/contracts/minimal-bootstrap.json")
POLICY_PATH = Path("docs/contracts/release-trust-policy.json")
AUTH_PATH = Path("docs/contracts/physical-write-authorization.json")
MEDIA_PATH = Path("docs/contracts/physical-media.json")

TRUST_KEYS = {"$schema", "key_id", "public_key_base64"}
EVIDENCE_KEYS = {
    "$schema",
    "status",
    "key_id",
    "public_trust_sha256",
    "proof_manifest_sha256",
    "recovery_envelope_sha256",
    "primary_public_derivation_match",
    "recovered_public_derivation_match",
    "recovered_private_path_distinct",
    "recovered_signing_proof",
    "offline_encrypted_backup_recovery_verified",
    "private_key_in_public_evidence",
    "ready_to_pin_public_anchor",
}
ENVELOPE_KEYS = {"$schema", "payload", "signature", "key_id"}


class PromotionError(RuntimeError):
    pass


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise PromotionError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def _require_regular(
    path: Path, label: str, max_bytes: int = 512 * 1024
) -> bytes:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise PromotionError(f"{label} is missing: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise PromotionError(
            f"{label} must be a regular non-symlink file: {path}"
        )
    if metadata.st_size <= 0 or metadata.st_size > max_bytes:
        raise PromotionError(
            f"{label} size is outside the allowed range: {metadata.st_size}"
        )
    try:
        return path.read_bytes()
    except OSError as exc:
        raise PromotionError(f"cannot read {label}: {path}") from exc


def _require_real_directory(path: Path, label: str) -> Path:
    absolute = path.expanduser().absolute()
    try:
        metadata = absolute.lstat()
    except OSError as exc:
        raise PromotionError(f"{label} is missing: {absolute}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise PromotionError(f"{label} must be a real non-symlink directory")
    return absolute


def _load_json_bytes(payload: bytes, label: str) -> dict[str, Any]:
    try:
        text = payload.decode("utf-8")
        value = json.loads(text, object_pairs_hook=_no_duplicates)
    except (UnicodeError, json.JSONDecodeError, PromotionError) as exc:
        raise PromotionError(f"invalid {label} JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise PromotionError(f"{label} must contain one JSON object")
    return value


def load_json(path: Path, label: str) -> dict[str, Any]:
    return _load_json_bytes(_require_regular(path, label), label)


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(
        _require_regular(path, str(path), max_bytes=64 * 1024 * 1024)
    )


def json_bytes(value: dict[str, Any]) -> bytes:
    return (
        json.dumps(value, indent=2, ensure_ascii=False) + "\n"
    ).encode("utf-8")


def _fsync_directory(path: Path) -> None:
    flags = (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_CLOEXEC", 0)
    )
    descriptor = os.open(path, flags)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _assert_real_parent(path: Path) -> None:
    parent = path.parent
    try:
        metadata = parent.lstat()
    except OSError as exc:
        raise PromotionError(f"output parent is missing: {parent}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise PromotionError(
            f"output parent must be a real directory: {parent}"
        )


def _atomic_write(path: Path, payload: bytes, mode: int = 0o644) -> None:
    _assert_real_parent(path)
    try:
        existing = path.lstat()
    except FileNotFoundError:
        existing = None
    except OSError as exc:
        raise PromotionError(f"cannot inspect output path: {path}") from exc
    if existing is not None and (
        stat.S_ISLNK(existing.st_mode)
        or not stat.S_ISREG(existing.st_mode)
    ):
        raise PromotionError(f"refusing unsafe output path: {path}")

    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        descriptor = os.open(temporary, flags, mode)
        try:
            offset = 0
            while offset < len(payload):
                written = os.write(descriptor, payload[offset:])
                if written <= 0:
                    raise PromotionError(
                        f"short write while creating {path}"
                    )
                offset += written
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    except Exception:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise


def _validate_verifier(verifier: Path) -> Path:
    absolute = verifier.expanduser().absolute()
    _require_regular(
        absolute,
        "release envelope verifier",
        max_bytes=128 * 1024 * 1024,
    )
    if os.name != "nt":
        metadata = absolute.stat()
        if metadata.st_mode & 0o111 == 0:
            raise PromotionError(
                "release envelope verifier is not executable"
            )
    return absolute


def _verify_envelope(
    verifier: Path,
    envelope_path: Path,
    trust_path: Path,
) -> None:
    try:
        completed = subprocess.run(
            [
                str(verifier),
                "verify-envelope",
                "--envelope",
                str(envelope_path),
                "--trust",
                str(trust_path),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise PromotionError(
            f"release envelope verifier could not run: {exc}"
        ) from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise PromotionError(
            "recovered signing proof did not verify"
            + (f": {detail}" if detail else "")
        )
    if (
        "RELEASE_ENVELOPE_VERIFIED=YES" not in completed.stdout
        or "SIGNATURE_VERIFIED=YES" not in completed.stdout
    ):
        raise PromotionError(
            "release envelope verifier did not emit verification markers"
        )


def validate_public_bundle(
    *,
    trust_path: Path,
    evidence_path: Path,
    proof_manifest_path: Path,
    recovery_envelope_path: Path,
    verifier: Path,
) -> dict[str, Any]:
    trust_bytes = _require_regular(
        trust_path, "public release trust", max_bytes=16 * 1024
    )
    evidence_bytes = _require_regular(
        evidence_path, "public ceremony evidence", max_bytes=32 * 1024
    )
    proof_manifest_bytes = _require_regular(
        proof_manifest_path,
        "public trust proof manifest",
        max_bytes=512 * 1024,
    )
    recovery_envelope_bytes = _require_regular(
        recovery_envelope_path,
        "public recovery proof envelope",
        max_bytes=2 * 1024 * 1024,
    )

    trust = _load_json_bytes(trust_bytes, "release trust")
    evidence = _load_json_bytes(evidence_bytes, "ceremony evidence")
    envelope = _load_json_bytes(
        recovery_envelope_bytes, "recovery proof envelope"
    )

    if set(trust) != TRUST_KEYS:
        raise PromotionError("release trust has unexpected fields")
    if (
        trust.get("$schema") != TRUST_SCHEMA
        or trust.get("key_id") != KEY_ID
    ):
        raise PromotionError("release trust schema or key_id is invalid")
    encoded = trust.get("public_key_base64")
    if not isinstance(encoded, str):
        raise PromotionError("release trust public key is missing")
    try:
        public_key = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise PromotionError(
            "release trust public key is not strict base64"
        ) from exc
    if len(public_key) != 32:
        raise PromotionError(
            "release trust public key must contain exactly 32 Ed25519 bytes"
        )

    if set(evidence) != EVIDENCE_KEYS:
        raise PromotionError(
            "ceremony evidence has unexpected or missing fields"
        )
    if evidence.get("$schema") != EVIDENCE_SCHEMA:
        raise PromotionError("ceremony evidence schema is invalid")
    if (
        evidence.get("status") != "pass"
        or evidence.get("key_id") != KEY_ID
    ):
        raise PromotionError(
            "ceremony evidence status or key_id is invalid"
        )
    for field in (
        "public_trust_sha256",
        "proof_manifest_sha256",
        "recovery_envelope_sha256",
    ):
        value = evidence.get(field)
        if (
            not isinstance(value, str)
            or HEX64.fullmatch(value) is None
        ):
            raise PromotionError(
                f"ceremony evidence {field} is invalid"
            )

    required_true = (
        "primary_public_derivation_match",
        "recovered_public_derivation_match",
        "recovered_private_path_distinct",
        "recovered_signing_proof",
        "offline_encrypted_backup_recovery_verified",
        "ready_to_pin_public_anchor",
    )
    for field in required_true:
        if evidence.get(field) is not True:
            raise PromotionError(
                f"ceremony evidence does not prove {field}"
            )
    if evidence.get("private_key_in_public_evidence") is not False:
        raise PromotionError(
            "ceremony evidence must state that private key material is absent"
        )

    trust_sha = sha256_bytes(trust_bytes)
    proof_manifest_sha = sha256_bytes(proof_manifest_bytes)
    recovery_envelope_sha = sha256_bytes(recovery_envelope_bytes)
    if evidence.get("public_trust_sha256") != trust_sha:
        raise PromotionError(
            "ceremony evidence public trust hash does not match"
        )
    if evidence.get("proof_manifest_sha256") != proof_manifest_sha:
        raise PromotionError(
            "ceremony evidence proof manifest hash does not match"
        )
    if (
        evidence.get("recovery_envelope_sha256")
        != recovery_envelope_sha
    ):
        raise PromotionError(
            "ceremony evidence recovery envelope hash does not match"
        )

    if set(envelope) != ENVELOPE_KEYS:
        raise PromotionError(
            "recovery proof envelope has unexpected fields"
        )
    if (
        envelope.get("$schema") != ENVELOPE_SCHEMA
        or envelope.get("key_id") != KEY_ID
    ):
        raise PromotionError(
            "recovery proof envelope schema or key_id is invalid"
        )
    payload_b64 = envelope.get("payload")
    signature_b64 = envelope.get("signature")
    if not isinstance(payload_b64, str) or not isinstance(
        signature_b64, str
    ):
        raise PromotionError(
            "recovery proof envelope payload/signature is invalid"
        )
    try:
        embedded_manifest = base64.b64decode(
            payload_b64, validate=True
        )
        signature = base64.b64decode(
            signature_b64, validate=True
        )
    except (ValueError, binascii.Error) as exc:
        raise PromotionError(
            "recovery proof envelope contains invalid base64"
        ) from exc
    if embedded_manifest != proof_manifest_bytes:
        raise PromotionError(
            "recovery proof envelope payload differs from proof manifest"
        )
    if len(signature) != 64:
        raise PromotionError(
            "recovery proof envelope signature length is invalid"
        )

    _verify_envelope(
        verifier,
        recovery_envelope_path,
        trust_path,
    )

    return {
        "trust_bytes": trust_bytes,
        "evidence_bytes": evidence_bytes,
        "proof_manifest_bytes": proof_manifest_bytes,
        "recovery_envelope_bytes": recovery_envelope_bytes,
        "trust_sha256": trust_sha,
        "evidence_sha256": sha256_bytes(evidence_bytes),
        "proof_manifest_sha256": proof_manifest_sha,
        "recovery_envelope_sha256": recovery_envelope_sha,
    }


def validate_public_promotion_directory(
    promotion_dir: Path,
    verifier: Path,
) -> dict[str, Any]:
    directory = _require_real_directory(
        promotion_dir, "public promotion directory"
    )
    try:
        children = list(directory.iterdir())
    except OSError as exc:
        raise PromotionError(
            "cannot inspect public promotion directory"
        ) from exc
    names = {child.name for child in children}
    if names != PROMOTION_FILES or len(children) != len(
        PROMOTION_FILES
    ):
        raise PromotionError(
            "public promotion directory must contain exactly "
            "release-ed25519.json, ceremony-public-evidence.json, "
            "trust-proof-manifest.json and "
            "trust-proof-recovery-envelope.json"
        )

    return validate_public_bundle(
        trust_path=directory / "release-ed25519.json",
        evidence_path=directory / "ceremony-public-evidence.json",
        proof_manifest_path=directory / "trust-proof-manifest.json",
        recovery_envelope_path=directory
        / "trust-proof-recovery-envelope.json",
        verifier=verifier,
    )


def _materialize_public_promotion_zip(
    promotion_zip: Path,
    output_dir: Path,
) -> Path:
    zip_bytes = _require_regular(
        promotion_zip,
        "public trust handoff zip",
        max_bytes=8 * 1024 * 1024,
    )
    try:
        archive = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
    except (OSError, zipfile.BadZipFile) as exc:
        raise PromotionError(
            "public trust handoff is not a valid ZIP archive"
        ) from exc

    with archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        if (
            len(infos) != len(PROMOTION_FILES)
            or len(set(names)) != len(names)
            or set(names) != PROMOTION_FILES
        ):
            raise PromotionError(
                "public trust handoff ZIP must contain exactly the "
                "four canonical public promotion files"
            )

        total_size = 0
        for info in infos:
            name = info.filename
            if (
                info.is_dir()
                or "/" in name
                or "\\" in name
                or Path(name).name != name
            ):
                raise PromotionError(
                    "public trust handoff ZIP contains an unsafe path"
                )
            if info.flag_bits & 0x1:
                raise PromotionError(
                    "encrypted ZIP entries are forbidden"
                )
            unix_mode = (info.external_attr >> 16) & 0xFFFF
            if unix_mode and stat.S_ISLNK(unix_mode):
                raise PromotionError(
                    "symlink ZIP entries are forbidden"
                )
            if info.file_size <= 0 or info.file_size > 2 * 1024 * 1024:
                raise PromotionError(
                    f"public handoff entry size is invalid: {name}"
                )
            total_size += info.file_size
            if total_size > 4 * 1024 * 1024:
                raise PromotionError(
                    "public trust handoff expands beyond the allowed size"
                )
            try:
                payload = archive.read(info)
            except (RuntimeError, zipfile.BadZipFile) as exc:
                raise PromotionError(
                    f"cannot read public handoff entry: {name}"
                ) from exc
            if len(payload) != info.file_size:
                raise PromotionError(
                    f"public handoff entry size changed while reading: {name}"
                )
            destination = output_dir / name
            destination.write_bytes(payload)

    return output_dir


def prepare_repository_promotion_zip(
    repo_root: Path,
    promotion_zip: Path,
    verifier: Path,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(
        prefix="ordax-public-trust-"
    ) as temporary:
        promotion_dir = Path(temporary)
        _materialize_public_promotion_zip(
            promotion_zip,
            promotion_dir,
        )
        return prepare_repository_promotion(
            repo_root,
            promotion_dir,
            verifier,
        )


def apply_repository_promotion_zip(
    repo_root: Path,
    promotion_zip: Path,
    verifier: Path,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(
        prefix="ordax-public-trust-"
    ) as temporary:
        promotion_dir = Path(temporary)
        _materialize_public_promotion_zip(
            promotion_zip,
            promotion_dir,
        )
        return apply_repository_promotion(
            repo_root,
            promotion_dir,
            verifier,
        )


def _load_repository_contracts(
    root: Path,
) -> tuple[
    dict[str, Any],
    dict[str, Any],
    dict[str, Any],
    dict[str, Any],
]:
    minimal = load_json(
        root / MINIMAL_PATH, "minimal bootstrap contract"
    )
    policy = load_json(
        root / POLICY_PATH, "release trust policy"
    )
    authorization = load_json(
        root / AUTH_PATH, "physical write authorization"
    )
    media = load_json(
        root / MEDIA_PATH, "physical media contract"
    )

    if minimal.get("$schema") != MINIMAL_SCHEMA:
        raise PromotionError("minimal bootstrap schema is invalid")
    if policy.get("$schema") != POLICY_SCHEMA:
        raise PromotionError("release trust policy schema is invalid")
    if authorization.get("$schema") != AUTH_SCHEMA:
        raise PromotionError(
            "physical write authorization schema is invalid"
        )
    if media.get("$schema") != MEDIA_SCHEMA:
        raise PromotionError("physical media schema is invalid")
    if minimal.get("physical_write_allowed") is not False:
        raise PromotionError(
            "minimal bootstrap must remain non-destructive"
        )
    if authorization.get("physical_write_allowed") is not False:
        raise PromotionError(
            "public trust promotion refuses an already-authorized "
            "physical write"
        )
    if policy.get("canonical_key_id") != KEY_ID:
        raise PromotionError(
            "release trust policy canonical key_id is invalid"
        )
    return minimal, policy, authorization, media


def prepare_repository_promotion(
    repo_root: Path,
    promotion_dir: Path,
    verifier: Path,
) -> dict[str, Any]:
    root = _require_real_directory(repo_root, "repository root")
    verifier_path = _validate_verifier(verifier)
    public = validate_public_promotion_directory(
        promotion_dir, verifier_path
    )
    trust_sha = public["trust_sha256"]
    evidence_sha = public["evidence_sha256"]
    proof_manifest_sha = public["proof_manifest_sha256"]
    recovery_envelope_sha = public["recovery_envelope_sha256"]

    minimal, policy, authorization, _media = (
        _load_repository_contracts(root)
    )

    groups = minimal.get("artifact_groups")
    if not isinstance(groups, list) or not groups:
        raise PromotionError(
            "minimal bootstrap artifact_groups are invalid"
        )
    trust_groups = [
        group
        for group in groups
        if isinstance(group, dict)
        and group.get("id") == "bootstrap-release-trust"
    ]
    if len(trust_groups) != 1:
        raise PromotionError(
            "minimal bootstrap must contain exactly one "
            "release-trust artifact group"
        )
    for group in groups:
        if group is trust_groups[0]:
            continue
        if (
            not isinstance(group, dict)
            or group.get("resolved") is not True
            or not isinstance(group.get("artifacts"), list)
            or not group["artifacts"]
        ):
            raise PromotionError(
                "public trust is not the only unresolved "
                "minimal-bootstrap artifact group"
            )

    promoted_minimal = copy.deepcopy(minimal)
    promoted_trust_group = next(
        group
        for group in promoted_minimal["artifact_groups"]
        if group.get("id") == "bootstrap-release-trust"
    )
    promoted_trust_group["resolved"] = True
    promoted_trust_group["artifacts"] = [
        {
            "source_path": TRUST_REPOSITORY_PATH.as_posix(),
            "target_path": (
                "/ordax/bootstrap/trust/release-ed25519.json"
            ),
            "sha256": trust_sha,
            "mode": "0644",
            "logical_owner": "bootstrap-release-trust",
            "reason": (
                "Canonical public Ed25519 release trust anchor "
                "verified by offline-recovery ceremony"
            ),
        }
    ]
    promoted_minimal["status"] = "canonical-bytes-resolved"
    promoted_minimal["all_artifacts_resolved"] = True
    promoted_minimal["physical_write_allowed"] = False
    minimal_bytes = json_bytes(promoted_minimal)
    minimal_sha = sha256_bytes(minimal_bytes)

    promoted_policy = copy.deepcopy(policy)
    promoted_policy["status"] = "canonical-public-trust-pinned"
    public_anchor = promoted_policy.get("public_anchor")
    if not isinstance(public_anchor, dict):
        raise PromotionError(
            "release trust policy public_anchor block is invalid"
        )
    public_anchor["sha256"] = trust_sha
    public_anchor[
        "ceremony_evidence_repository_path"
    ] = EVIDENCE_REPOSITORY_PATH.as_posix()
    public_anchor["ceremony_evidence_sha256"] = evidence_sha
    public_anchor[
        "proof_manifest_repository_path"
    ] = PROOF_MANIFEST_REPOSITORY_PATH.as_posix()
    public_anchor["proof_manifest_sha256"] = proof_manifest_sha
    public_anchor[
        "recovery_envelope_repository_path"
    ] = RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix()
    public_anchor[
        "recovery_envelope_sha256"
    ] = recovery_envelope_sha

    gates = promoted_policy.get("gates")
    if not isinstance(gates, dict):
        raise PromotionError(
            "release trust policy gates are invalid"
        )
    if "physical_write_allowed" in gates:
        raise PromotionError(
            "release trust policy must not carry a physical-write gate"
        )
    if gates.get("physical_authorization_eligible") not in (False, True):
        raise PromotionError(
            "release trust policy eligibility gate is invalid"
        )
    gates["key_material_generated"] = True
    gates["public_anchor_pinned"] = True
    gates["minimal_bootstrap_resolved"] = True
    gates["physical_authorization_eligible"] = True
    policy_bytes = json_bytes(promoted_policy)

    promoted_authorization = copy.deepcopy(authorization)
    promoted_authorization[
        "status"
    ] = "blocked-explicit-physical-authorization-pending"
    promoted_authorization["physical_write_allowed"] = False
    bindings = promoted_authorization.get("bindings")
    if not isinstance(bindings, dict):
        raise PromotionError(
            "physical authorization bindings are invalid"
        )
    media_sha = sha256_file(root / MEDIA_PATH)
    bindings["minimal_bootstrap_sha256"] = minimal_sha
    bindings["release_trust_sha256"] = trust_sha
    bindings["physical_media_sha256"] = media_sha
    auth_bytes = json_bytes(promoted_authorization)

    return {
        "$schema": RESULT_SCHEMA,
        "status": "ready",
        "ready": True,
        "trust_sha256": trust_sha,
        "ceremony_evidence_sha256": evidence_sha,
        "proof_manifest_sha256": proof_manifest_sha,
        "recovery_envelope_sha256": recovery_envelope_sha,
        "minimal_bootstrap_sha256": minimal_sha,
        "physical_media_sha256": media_sha,
        "physical_write_allowed": False,
        "physical_authorization_eligible": True,
        "outputs": {
            TRUST_REPOSITORY_PATH.as_posix(): public[
                "trust_bytes"
            ],
            EVIDENCE_REPOSITORY_PATH.as_posix(): public[
                "evidence_bytes"
            ],
            PROOF_MANIFEST_REPOSITORY_PATH.as_posix(): public[
                "proof_manifest_bytes"
            ],
            RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix(): public[
                "recovery_envelope_bytes"
            ],
            MINIMAL_PATH.as_posix(): minimal_bytes,
            POLICY_PATH.as_posix(): policy_bytes,
            AUTH_PATH.as_posix(): auth_bytes,
        },
    }


def validate_promoted_repository(
    repo_root: Path,
    verifier: Path,
) -> dict[str, Any]:
    root = _require_real_directory(repo_root, "repository root")
    verifier_path = _validate_verifier(verifier)

    public = validate_public_bundle(
        trust_path=root / TRUST_REPOSITORY_PATH,
        evidence_path=root / EVIDENCE_REPOSITORY_PATH,
        proof_manifest_path=root
        / PROOF_MANIFEST_REPOSITORY_PATH,
        recovery_envelope_path=root
        / RECOVERY_ENVELOPE_REPOSITORY_PATH,
        verifier=verifier_path,
    )
    trust_sha = public["trust_sha256"]
    evidence_sha = public["evidence_sha256"]
    proof_manifest_sha = public["proof_manifest_sha256"]
    recovery_envelope_sha = public["recovery_envelope_sha256"]

    minimal, policy, authorization, _media = (
        _load_repository_contracts(root)
    )
    if minimal.get("all_artifacts_resolved") is not True:
        raise PromotionError(
            "minimal bootstrap is not fully resolved after "
            "trust promotion"
        )
    if minimal.get("status") != "canonical-bytes-resolved":
        raise PromotionError(
            "minimal bootstrap status is not canonical-bytes-resolved"
        )
    if minimal.get("physical_write_allowed") is not False:
        raise PromotionError(
            "minimal bootstrap became destructive"
        )

    trust_groups = [
        group
        for group in minimal.get("artifact_groups", [])
        if isinstance(group, dict)
        and group.get("id") == "bootstrap-release-trust"
    ]
    if (
        len(trust_groups) != 1
        or trust_groups[0].get("resolved") is not True
    ):
        raise PromotionError(
            "minimal bootstrap release-trust group is not resolved"
        )
    artifacts = trust_groups[0].get("artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != 1:
        raise PromotionError(
            "minimal bootstrap release-trust group must "
            "contain one artifact"
        )
    artifact = artifacts[0]
    if (
        artifact.get("source_path")
        != TRUST_REPOSITORY_PATH.as_posix()
        or artifact.get("target_path")
        != "/ordax/bootstrap/trust/release-ed25519.json"
        or artifact.get("sha256") != trust_sha
    ):
        raise PromotionError(
            "minimal bootstrap release-trust binding is invalid"
        )

    gates = policy.get("gates")
    expected_gates = {
        "key_material_generated": True,
        "public_anchor_pinned": True,
        "minimal_bootstrap_resolved": True,
        "physical_authorization_eligible": True,
    }
    if gates != expected_gates:
        raise PromotionError(
            "release trust policy gates are not in the promoted state"
        )
    if policy.get("status") != "canonical-public-trust-pinned":
        raise PromotionError(
            "release trust policy status is not promoted"
        )
    anchor = policy.get("public_anchor")
    if not isinstance(anchor, dict):
        raise PromotionError(
            "release trust policy public anchor is invalid"
        )
    expected_anchor_bindings = {
        "sha256": trust_sha,
        "ceremony_evidence_repository_path": (
            EVIDENCE_REPOSITORY_PATH.as_posix()
        ),
        "ceremony_evidence_sha256": evidence_sha,
        "proof_manifest_repository_path": (
            PROOF_MANIFEST_REPOSITORY_PATH.as_posix()
        ),
        "proof_manifest_sha256": proof_manifest_sha,
        "recovery_envelope_repository_path": (
            RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix()
        ),
        "recovery_envelope_sha256": recovery_envelope_sha,
    }
    for key, value in expected_anchor_bindings.items():
        if anchor.get(key) != value:
            raise PromotionError(
                f"release trust policy public binding is invalid: {key}"
            )

    if authorization.get("physical_write_allowed") is not False:
        raise PromotionError(
            "physical write authorization was unexpectedly enabled"
        )
    if (
        authorization.get("status")
        != "blocked-explicit-physical-authorization-pending"
    ):
        raise PromotionError(
            "physical write authorization status is unexpected "
            "after trust promotion"
        )
    bindings = authorization.get("bindings")
    minimal_sha = sha256_file(root / MINIMAL_PATH)
    media_sha = sha256_file(root / MEDIA_PATH)
    if bindings != {
        "minimal_bootstrap_sha256": minimal_sha,
        "release_trust_sha256": trust_sha,
        "physical_media_sha256": media_sha,
    }:
        raise PromotionError(
            "physical write authorization public bindings are invalid"
        )

    return {
        "$schema": RESULT_SCHEMA,
        "status": "promoted",
        "ready": True,
        "trust_sha256": trust_sha,
        "ceremony_evidence_sha256": evidence_sha,
        "proof_manifest_sha256": proof_manifest_sha,
        "recovery_envelope_sha256": recovery_envelope_sha,
        "minimal_bootstrap_sha256": minimal_sha,
        "physical_media_sha256": media_sha,
        "physical_write_allowed": False,
        "physical_authorization_eligible": True,
    }


def apply_repository_promotion(
    repo_root: Path,
    promotion_dir: Path,
    verifier: Path,
) -> dict[str, Any]:
    plan = prepare_repository_promotion(
        repo_root, promotion_dir, verifier
    )
    root = _require_real_directory(repo_root, "repository root")

    immutable_public_paths = {
        TRUST_REPOSITORY_PATH.as_posix(),
        EVIDENCE_REPOSITORY_PATH.as_posix(),
        PROOF_MANIFEST_REPOSITORY_PATH.as_posix(),
        RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix(),
    }
    for relative, payload in plan["outputs"].items():
        destination = root / relative
        if destination.exists():
            existing = _require_regular(
                destination,
                f"existing {relative}",
                64 * 1024 * 1024,
            )
            if (
                relative in immutable_public_paths
                and existing != payload
            ):
                raise PromotionError(
                    "refusing to replace different canonical "
                    f"public material: {relative}"
                )
        _atomic_write(destination, payload)

    return validate_promoted_repository(root, verifier)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("check", "apply"))
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
    )
    promotion_source = parser.add_mutually_exclusive_group(
        required=True
    )
    promotion_source.add_argument(
        "--promotion-dir",
        type=Path,
    )
    promotion_source.add_argument(
        "--promotion-zip",
        type=Path,
    )
    parser.add_argument(
        "--verifier",
        type=Path,
        required=True,
        help=(
            "ordax-release-signing executable with verify-envelope "
            "support"
        ),
    )
    args = parser.parse_args()

    try:
        if args.promotion_zip is not None:
            if args.mode == "check":
                result = prepare_repository_promotion_zip(
                    args.repo_root,
                    args.promotion_zip,
                    args.verifier,
                )
                public_result = {
                    key: value
                    for key, value in result.items()
                    if key != "outputs"
                }
            else:
                public_result = apply_repository_promotion_zip(
                    args.repo_root,
                    args.promotion_zip,
                    args.verifier,
                )
        elif args.mode == "check":
            result = prepare_repository_promotion(
                args.repo_root,
                args.promotion_dir,
                args.verifier,
            )
            public_result = {
                key: value
                for key, value in result.items()
                if key != "outputs"
            }
        else:
            public_result = apply_repository_promotion(
                args.repo_root,
                args.promotion_dir,
                args.verifier,
            )
        print(
            json.dumps(
                public_result,
                indent=2,
                sort_keys=True,
            )
        )
        return 0
    except PromotionError as exc:
        print(
            f"release-trust-public-promotion: ERROR: {exc}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
