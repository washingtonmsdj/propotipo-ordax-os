#!/usr/bin/env python3
"""Fail-closed runtime owner for OrdaX base-update prerequisites.

This initial owner performs only one-time canonical PUBLIC trust enrollment and
writes local status. It does not stage a kernel, set EFI variables, request a
reboot, or authorize a physical-media write.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from typing import Any
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

TRUST_SCHEMA = "prototype-ordax.release-trust/1"
POLICY_SCHEMA = "prototype-ordax.release-trust-policy/1"
MINIMAL_SCHEMA = "prototype-ordax.minimal-bootstrap/4"
STATUS_SCHEMA = "ordax.base-update-owner-status/1"
REFRESH_SCHEMA = "prototype-ordax.release-agent-refresh/1"
KEY_ID = "ordax-prototype-release-v1"
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
MAX_JSON = 512 * 1024
MAX_CHANNEL_BYTES = 4096
MAX_RECEIPT_BYTES = 64 * 1024
MAX_RELEASE_AGENT_BYTES = 32 * 1024 * 1024
REFRESH_DOWNLOAD_TIMEOUT_SECONDS = 45
MATERIALIZE_TIMEOUT_SECONDS = 660
TRUST_RELATIVE = Path("bootstrap/trust/release-ed25519.json")
PHYSICAL_TRUST_RELATIVE = Path("bootstrap/trust/release-ed25519.json")
RELEASE_CHANNEL_RELATIVE = Path("bootstrap/config/release-envelope-url")
RELEASE_AGENT_RELATIVE = Path("bootstrap/release-acquisition/ordax-release-agent")
REFRESH_DESCRIPTOR_RELATIVE = Path("system/services/base-update/release-agent-refresh.json")
POLICY_RELATIVE = Path("docs/contracts/release-trust-policy.json")
MINIMAL_RELATIVE = Path("docs/contracts/minimal-bootstrap.json")
BOOT_REFRESH_RELATIVE = Path("boot-refresh-required")
STATUS_RELATIVE = Path("base-update/owner-status.json")


class OwnerError(RuntimeError):
    pass


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise OwnerError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _regular_bytes(path: Path, label: str, max_bytes: int = MAX_JSON) -> bytes:
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        raise OwnerError(f"{label} is missing")
    except OSError as exc:
        raise OwnerError(f"cannot inspect {label}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise OwnerError(f"{label} must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > max_bytes:
        raise OwnerError(f"{label} size is outside the allowed range")
    try:
        return path.read_bytes()
    except OSError as exc:
        raise OwnerError(f"cannot read {label}") from exc


def _strict_json(path: Path, label: str) -> tuple[bytes, dict[str, Any]]:
    payload = _regular_bytes(path, label)
    try:
        value = json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=_no_duplicates,
        )
    except (UnicodeError, json.JSONDecodeError, OwnerError) as exc:
        raise OwnerError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict):
        raise OwnerError(f"{label} must contain one JSON object")
    return payload, value


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _validate_trust(payload: bytes, trust: dict[str, Any]) -> str:
    if set(trust) != {"$schema", "key_id", "public_key_base64"}:
        raise OwnerError("canonical public trust has unexpected fields")
    if trust.get("$schema") != TRUST_SCHEMA or trust.get("key_id") != KEY_ID:
        raise OwnerError("canonical public trust identity is invalid")
    encoded = trust.get("public_key_base64")
    if not isinstance(encoded, str):
        raise OwnerError("canonical public trust key is missing")
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise OwnerError("canonical public trust key is not strict base64") from exc
    if len(decoded) != 32:
        raise OwnerError("canonical public trust key is not 32-byte Ed25519")
    return _sha256(payload)


def _validate_repository_authority(
    repo_root: Path,
) -> tuple[bytes, str]:
    trust_bytes, trust = _strict_json(
        repo_root / TRUST_RELATIVE,
        "canonical repository public trust",
    )
    trust_sha = _validate_trust(trust_bytes, trust)

    _policy_bytes, policy = _strict_json(
        repo_root / POLICY_RELATIVE,
        "release trust policy",
    )
    if policy.get("$schema") != POLICY_SCHEMA:
        raise OwnerError("release trust policy schema is invalid")
    if policy.get("status") != "canonical-public-trust-pinned":
        raise OwnerError("release trust policy is not promoted")
    if policy.get("canonical_key_id") != KEY_ID:
        raise OwnerError("release trust policy key id is invalid")
    gates = policy.get("gates")
    if gates != {
        "key_material_generated": True,
        "public_anchor_pinned": True,
        "minimal_bootstrap_resolved": True,
        "physical_authorization_eligible": True,
    }:
        raise OwnerError("release trust policy gates are not canonical")
    anchor = policy.get("public_anchor")
    if not isinstance(anchor, dict) or anchor.get("sha256") != trust_sha:
        raise OwnerError("release trust policy does not pin canonical trust hash")

    for path_key, hash_key in (
        ("ceremony_evidence_repository_path", "ceremony_evidence_sha256"),
        ("proof_manifest_repository_path", "proof_manifest_sha256"),
        ("recovery_envelope_repository_path", "recovery_envelope_sha256"),
    ):
        relative = anchor.get(path_key)
        expected = anchor.get(hash_key)
        relative_path = Path(relative) if isinstance(relative, str) else Path()
        if (
            not isinstance(relative, str)
            or not relative
            or relative_path.is_absolute()
            or ".." in relative_path.parts
        ):
            raise OwnerError(f"release trust policy {path_key} is invalid")
        if not isinstance(expected, str) or HEX64.fullmatch(expected) is None:
            raise OwnerError(f"release trust policy {hash_key} is invalid")
        evidence = _regular_bytes(
            repo_root / relative,
            f"release trust public evidence {relative}",
            max_bytes=2 * 1024 * 1024,
        )
        if _sha256(evidence) != expected:
            raise OwnerError(f"release trust public evidence hash mismatch: {relative}")

    _minimal_bytes, minimal = _strict_json(
        repo_root / MINIMAL_RELATIVE,
        "minimal bootstrap contract",
    )
    if minimal.get("$schema") != MINIMAL_SCHEMA:
        raise OwnerError("minimal bootstrap schema is invalid")
    if minimal.get("status") != "canonical-bytes-resolved":
        raise OwnerError("minimal bootstrap is not in canonical resolved state")
    if minimal.get("all_artifacts_resolved") is not True:
        raise OwnerError("minimal bootstrap still has unresolved artifacts")
    if minimal.get("physical_write_allowed") is not False:
        raise OwnerError("minimal bootstrap must remain non-destructive")
    groups = minimal.get("artifact_groups")
    if not isinstance(groups, list) or not groups:
        raise OwnerError("minimal bootstrap artifact groups are invalid")
    for candidate_group in groups:
        if (
            not isinstance(candidate_group, dict)
            or candidate_group.get("resolved") is not True
            or not isinstance(candidate_group.get("artifacts"), list)
            or not candidate_group["artifacts"]
        ):
            raise OwnerError("minimal bootstrap contains an unresolved artifact group")
    trust_groups = [
        group
        for group in groups
        if isinstance(group, dict) and group.get("id") == "bootstrap-release-trust"
    ]
    if len(trust_groups) != 1:
        raise OwnerError("minimal bootstrap release-trust group is invalid")
    group = trust_groups[0]
    artifacts = group.get("artifacts")
    if group.get("resolved") is not True or not isinstance(artifacts, list) or len(artifacts) != 1:
        raise OwnerError("minimal bootstrap release-trust group is unresolved")
    artifact = artifacts[0]
    if (
        artifact.get("source_path") != TRUST_RELATIVE.as_posix()
        or artifact.get("target_path") != "/ordax/bootstrap/trust/release-ed25519.json"
        or artifact.get("sha256") != trust_sha
        or artifact.get("mode") != "0644"
    ):
        raise OwnerError("minimal bootstrap canonical trust binding is invalid")

    return trust_bytes, trust_sha


def _require_real_directory(path: Path, label: str) -> Path:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise OwnerError(f"{label} is unavailable") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise OwnerError(f"{label} must be a real directory")
    return path


def _ensure_real_directory_tree(root: Path, relative: Path, mode: int = 0o755) -> Path:
    current = _require_real_directory(root, "physical root")
    for part in relative.parts:
        current = current / part
        try:
            metadata = current.lstat()
        except FileNotFoundError:
            current.mkdir(mode=mode)
            metadata = current.lstat()
        except OSError as exc:
            raise OwnerError(f"cannot inspect physical trust directory: {current}") from exc
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
            raise OwnerError(f"physical trust path component is unsafe: {current.name}")
    return current


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(
        path,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _install_public_trust(
    physical_root: Path,
    trust_bytes: bytes,
    trust_sha: str,
) -> str:
    trust_dir = _ensure_real_directory_tree(
        physical_root,
        Path("bootstrap/trust"),
    )
    target = trust_dir / "release-ed25519.json"
    try:
        existing = target.lstat()
    except FileNotFoundError:
        existing = None
    except OSError as exc:
        raise OwnerError("cannot inspect physical public trust") from exc

    if existing is not None:
        if stat.S_ISLNK(existing.st_mode) or not stat.S_ISREG(existing.st_mode):
            raise OwnerError("physical public trust is unsafe")
        actual = _sha256(_regular_bytes(target, "physical public trust", 16 * 1024))
        if actual != trust_sha:
            raise OwnerError("physical public trust conflicts with canonical repository trust")
        return "already-enrolled"

    temporary = target.with_name(f".{target.name}.ordax-enroll-{os.getpid()}")
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    descriptor = -1
    try:
        descriptor = os.open(temporary, flags, 0o644)
        offset = 0
        while offset < len(trust_bytes):
            written = os.write(descriptor, trust_bytes[offset:])
            if written <= 0:
                raise OwnerError("short write while enrolling canonical public trust")
            offset += written
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        if _sha256(_regular_bytes(temporary, "temporary public trust", 16 * 1024)) != trust_sha:
            raise OwnerError("temporary public trust hash changed during enrollment")
        os.replace(temporary, target)
        _fsync_directory(trust_dir)
        return "enrolled"
    except Exception:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        try:
            temporary.unlink()
        except OSError:
            pass
        raise


def _hash_regular_file(
    path: Path,
    label: str,
    max_bytes: int = MAX_RELEASE_AGENT_BYTES,
) -> tuple[str, int]:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise OwnerError(f"cannot open {label}") from exc
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise OwnerError(f"{label} must be a regular non-symlink file")
        if metadata.st_size <= 0 or metadata.st_size > max_bytes:
            raise OwnerError(f"{label} size is outside the allowed range")
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise OwnerError(f"{label} exceeded the allowed size while hashing")
            digest.update(chunk)
        if total != metadata.st_size:
            raise OwnerError(f"{label} changed while hashing")
        return digest.hexdigest(), total
    finally:
        os.close(descriptor)


def _validate_release_agent_refresh(
    repo_root: Path,
) -> dict[str, Any]:
    _payload, descriptor = _strict_json(
        repo_root / REFRESH_DESCRIPTOR_RELATIVE,
        "release-agent refresh descriptor",
    )
    expected_fields = {
        "$schema",
        "status",
        "component",
        "artifact",
        "allow_absent_enrollment",
        "allowed_from_sha256",
        "target_sha256",
        "target_size",
        "download_url",
        "target_path",
        "mode",
        "physical_media_rewrite_required",
        "raw_device_write_allowed",
        "unknown_installed_hash_policy",
        "replacement",
    }
    if set(descriptor) != expected_fields:
        raise OwnerError("release-agent refresh descriptor has unexpected fields")
    if descriptor.get("$schema") != REFRESH_SCHEMA:
        raise OwnerError("release-agent refresh schema is invalid")
    if descriptor.get("status") != "development-git-migration":
        raise OwnerError("release-agent refresh status is invalid")
    if descriptor.get("component") != "bootstrap-release-acquisition":
        raise OwnerError("release-agent refresh component is invalid")
    if descriptor.get("artifact") != "ordax-release-agent":
        raise OwnerError("release-agent refresh artifact name is invalid")
    if descriptor.get("allow_absent_enrollment") is not True:
        raise OwnerError("release-agent refresh must explicitly authorize absent enrollment")
    if descriptor.get("target_path") != "/ordax/bootstrap/release-acquisition/ordax-release-agent":
        raise OwnerError("release-agent refresh target path is invalid")
    if descriptor.get("mode") != "0755":
        raise OwnerError("release-agent refresh mode is invalid")
    if descriptor.get("physical_media_rewrite_required") is not False:
        raise OwnerError("release-agent refresh cannot require physical media rewrite")
    if descriptor.get("raw_device_write_allowed") is not False:
        raise OwnerError("release-agent refresh cannot authorize raw device writes")
    if descriptor.get("unknown_installed_hash_policy") != "block":
        raise OwnerError("release-agent refresh must block unknown installed hashes")
    if descriptor.get("replacement") != "same-directory-temp-fsync-atomic-replace":
        raise OwnerError("release-agent refresh replacement policy is invalid")

    allowed = descriptor.get("allowed_from_sha256")
    if (
        not isinstance(allowed, list)
        or not allowed
        or len(set(allowed)) != len(allowed)
        or any(not isinstance(value, str) or HEX64.fullmatch(value) is None for value in allowed)
    ):
        raise OwnerError("release-agent refresh allowed-from hashes are invalid")

    target_sha = descriptor.get("target_sha256")
    target_size = descriptor.get("target_size")
    if not isinstance(target_sha, str) or HEX64.fullmatch(target_sha) is None:
        raise OwnerError("release-agent refresh target hash is invalid")
    if target_sha in allowed:
        raise OwnerError("release-agent refresh target must not be an allowed-from legacy hash")
    if (
        isinstance(target_size, bool)
        or not isinstance(target_size, int)
        or target_size <= 0
        or target_size > MAX_RELEASE_AGENT_BYTES
    ):
        raise OwnerError("release-agent refresh target size is invalid")

    url = descriptor.get("download_url")
    if not isinstance(url, str):
        raise OwnerError("release-agent refresh URL is invalid")
    parsed = urlsplit(url)
    expected_path = (
        "/washingtonmsdj/prototipo-ordax-os/releases/download/"
        f"ordax-release-agent-{target_sha}/ordax-release-agent"
    )
    if (
        parsed.scheme != "https"
        or parsed.hostname != "github.com"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
        or parsed.path != expected_path
        or parsed.query
        or parsed.fragment
    ):
        raise OwnerError("release-agent refresh URL is outside the hash-addressed OrdaX channel")
    return descriptor


def _download_release_agent(
    url: str,
    target: Path,
    expected_sha: str,
    expected_size: int,
) -> None:
    parent = _require_real_directory(target.parent, "release-agent directory")
    temporary = target.with_name(f".{target.name}.ordax-refresh-{os.getpid()}")
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    descriptor = -1
    response = None
    try:
        request = Request(
            url,
            headers={
                "User-Agent": "OrdaX-Release-Agent-Refresh/1",
                "Cache-Control": "no-cache",
            },
        )
        try:
            response = urlopen(request, timeout=REFRESH_DOWNLOAD_TIMEOUT_SECONDS)
        except OSError as exc:
            raise OwnerError("release-agent refresh download is unavailable") from exc
        status_code = getattr(response, "status", 200)
        if status_code != 200:
            raise OwnerError(f"release-agent refresh download returned HTTP {status_code}")
        final_url = urlsplit(response.geturl())
        if final_url.scheme != "https":
            raise OwnerError("release-agent refresh redirect left HTTPS")
        content_length = response.headers.get("Content-Length")
        if content_length:
            try:
                announced = int(content_length)
            except ValueError as exc:
                raise OwnerError("release-agent refresh Content-Length is invalid") from exc
            if announced != expected_size:
                raise OwnerError("release-agent refresh Content-Length does not match pinned size")

        descriptor = os.open(temporary, flags, 0o755)
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > expected_size or total > MAX_RELEASE_AGENT_BYTES:
                raise OwnerError("release-agent refresh download exceeded pinned size")
            digest.update(chunk)
            offset = 0
            while offset < len(chunk):
                written = os.write(descriptor, chunk[offset:])
                if written <= 0:
                    raise OwnerError("short write while refreshing release agent")
                offset += written
        if total != expected_size:
            raise OwnerError("release-agent refresh download size mismatch")
        if digest.hexdigest() != expected_sha:
            raise OwnerError("release-agent refresh download hash mismatch")
        os.fchmod(descriptor, 0o755)
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1

        verified_sha, verified_size = _hash_regular_file(
            temporary,
            "temporary refreshed release agent",
        )
        if verified_sha != expected_sha or verified_size != expected_size:
            raise OwnerError("temporary refreshed release agent changed before commit")
        os.replace(temporary, target)
        _fsync_directory(parent)
    finally:
        if response is not None:
            try:
                response.close()
            except Exception:
                pass
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        try:
            temporary.unlink()
        except OSError:
            pass


def _refresh_release_agent_if_needed(
    repo_root: Path,
    physical_root: Path,
) -> tuple[str, str]:
    refresh = _validate_release_agent_refresh(repo_root)
    agent_directory = _ensure_real_directory_tree(
        physical_root,
        RELEASE_AGENT_RELATIVE.parent,
    )
    target = agent_directory / RELEASE_AGENT_RELATIVE.name
    target_sha = refresh["target_sha256"]
    target_size = refresh["target_size"]

    try:
        metadata = target.lstat()
    except FileNotFoundError:
        metadata = None
    except OSError as exc:
        raise OwnerError("cannot inspect physical release acquisition agent") from exc

    if metadata is None:
        if refresh.get("allow_absent_enrollment") is not True:
            raise OwnerError("physical release acquisition agent is absent and enrollment is not authorized")
        _download_release_agent(
            refresh["download_url"],
            target,
            target_sha,
            target_size,
        )
        installed_sha, installed_size = _hash_regular_file(
            target,
            "enrolled physical release acquisition agent",
        )
        if installed_sha != target_sha or installed_size != target_size:
            raise OwnerError("enrolled release agent does not match pinned target")
        return "enrolled", target_sha

    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise OwnerError("physical release acquisition agent must be a regular non-symlink file")

    actual_sha, actual_size = _hash_regular_file(
        target,
        "physical release acquisition agent",
    )
    if actual_sha == target_sha:
        if actual_size != target_size:
            raise OwnerError("current release agent hash matched but size binding did not")
        return "already-current", target_sha

    if actual_sha not in refresh["allowed_from_sha256"]:
        raise OwnerError(
            "physical release acquisition agent has an unrecognized installed hash"
        )

    _download_release_agent(
        refresh["download_url"],
        target,
        target_sha,
        target_size,
    )
    installed_sha, installed_size = _hash_regular_file(
        target,
        "refreshed physical release acquisition agent",
    )
    if installed_sha != target_sha or installed_size != target_size:
        raise OwnerError("refreshed release agent does not match pinned target")
    return "refreshed", target_sha


def _read_release_channel(physical_root: Path) -> str:
    payload = _regular_bytes(
        physical_root / RELEASE_CHANNEL_RELATIVE,
        "physical release channel",
        MAX_CHANNEL_BYTES,
    )
    try:
        value = payload.decode("ascii")
    except UnicodeError as exc:
        raise OwnerError("physical release channel is not ASCII") from exc
    lines = value.splitlines()
    if len(lines) != 1 or not lines[0] or lines[0] != lines[0].strip():
        raise OwnerError("physical release channel must contain exactly one URL")
    url = lines[0]
    if not url.startswith("https://") or any(character.isspace() for character in url):
        raise OwnerError("physical release channel must be one absolute HTTPS URL")
    return url


def _require_release_agent(physical_root: Path) -> Path:
    path = physical_root / RELEASE_AGENT_RELATIVE
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise OwnerError("physical release acquisition agent is unavailable") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise OwnerError("physical release acquisition agent must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > 128 * 1024 * 1024:
        raise OwnerError("physical release acquisition agent size is outside the allowed range")
    if metadata.st_mode & 0o111 == 0:
        raise OwnerError("physical release acquisition agent is not executable")
    return path


def _materialize_signed_release(
    physical_root: Path,
    source_sha: str,
) -> tuple[str, bool]:
    if HEX40.fullmatch(source_sha) is None:
        raise OwnerError("source SHA is unavailable for signed release materialization")

    agent = _require_release_agent(physical_root)
    channel = _read_release_channel(physical_root)
    trust = physical_root / PHYSICAL_TRUST_RELATIVE
    expected_release = physical_root / "releases" / source_sha

    command = [
        str(agent),
        "materialize",
        "--envelope-url",
        channel,
        "--trust",
        str(trust),
        "--root",
        str(physical_root),
        "--repository",
        "washingtonmsdj/prototipo-ordax-os",
        "--expected-commit",
        source_sha,
    ]
    try:
        completed = subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=MATERIALIZE_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise OwnerError("signed release materialization timed out") from exc
    except OSError as exc:
        raise OwnerError("signed release materialization could not start") from exc

    if len(completed.stdout) > MAX_RECEIPT_BYTES or len(completed.stderr) > MAX_RECEIPT_BYTES:
        raise OwnerError("release acquisition output exceeded the allowed size")
    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="replace").strip()
        if "usage: ordax-release-agent" in stderr and "materialize" not in stderr:
            raise OwnerError("physical release acquisition agent lacks materialize support")
        raise OwnerError(
            "signed release materialization failed"
            + (f": {stderr[:256]}" if stderr else "")
        )

    try:
        receipt = json.loads(
            completed.stdout.decode("utf-8"),
            object_pairs_hook=_no_duplicates,
        )
    except (UnicodeError, json.JSONDecodeError, OwnerError) as exc:
        raise OwnerError("release acquisition receipt is invalid JSON") from exc
    if not isinstance(receipt, dict) or set(receipt) != {
        "status",
        "source_commit",
        "release_path",
        "artifacts",
        "idempotent",
    }:
        raise OwnerError("release acquisition receipt has unexpected fields")
    if receipt.get("status") != "materialized" or receipt.get("source_commit") != source_sha:
        raise OwnerError("release acquisition receipt identity is invalid")
    if receipt.get("release_path") != str(expected_release):
        raise OwnerError("release acquisition receipt path is not canonical")
    if receipt.get("artifacts") != ["system.tar"]:
        raise OwnerError("release acquisition receipt artifact set is invalid")
    idempotent = receipt.get("idempotent")
    if not isinstance(idempotent, bool):
        raise OwnerError("release acquisition receipt idempotency flag is invalid")
    _require_real_directory(expected_release, "materialized signed release")
    return source_sha, idempotent


def _read_pending_sha(state_root: Path) -> str | None:
    path = state_root / BOOT_REFRESH_RELATIVE
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return None
    except OSError:
        return None
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        return None
    try:
        value = path.read_text(encoding="ascii").strip()
    except (OSError, UnicodeError):
        return None
    return value if HEX40.fullmatch(value) else None


def _atomic_status(state_root: Path, value: dict[str, Any]) -> None:
    directory = state_root / STATUS_RELATIVE.parent
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    _require_real_directory(directory, "base-update state directory")
    target = state_root / STATUS_RELATIVE
    payload = (json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
    temporary = target.with_name(f".{target.name}.tmp-{os.getpid()}")
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    descriptor = os.open(temporary, flags, 0o600)
    try:
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                raise OwnerError("short write while recording base-update owner status")
            offset += written
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.replace(temporary, target)
    _fsync_directory(directory)


def run_once(repo_root: Path, state_root: Path, physical_root: Path, source_sha: str | None) -> dict[str, Any]:
    repo_root = _require_real_directory(repo_root, "repository root")
    state_root = _require_real_directory(state_root, "state root")
    physical_root = _require_real_directory(physical_root, "physical OrdaX root")
    source = source_sha if source_sha and HEX40.fullmatch(source_sha) else None
    pending = _read_pending_sha(state_root)

    status: dict[str, Any] = {
        "$schema": STATUS_SCHEMA,
        "status": "blocked",
        "phase": "trust-enrollment",
        "sourceSha": source,
        "pendingBootRefreshSha": pending,
        "releaseAgentRefreshState": "blocked",
        "releaseAgentSha256": None,
        "canonicalTrustPinned": False,
        "physicalTrustEnrolled": False,
        "trustEnrollmentState": "blocked",
        "signedReleaseMaterialized": False,
        "materializedReleaseSha": None,
        "releaseMaterializationState": "blocked",
        "kernelStaged": False,
        "candidateArmed": False,
        "rebootRequested": False,
        "promotionAttempted": False,
    }

    try:
        refresh_state, refresh_sha = _refresh_release_agent_if_needed(
            repo_root,
            physical_root,
        )
        status["releaseAgentRefreshState"] = refresh_state
        status["releaseAgentSha256"] = refresh_sha
        status["phase"] = "trust-enrollment"
    except OwnerError as exc:
        message = str(exc)
        status["phase"] = "bootstrap-component-refresh"
        if "unrecognized installed hash" in message:
            status["blocker"] = "release-agent-installed-hash-unrecognized"
        elif (
            "download is unavailable" in message
            or "download returned HTTP" in message
        ):
            status["blocker"] = "release-agent-refresh-unavailable"
        else:
            status["blocker"] = "release-agent-refresh-validation-failed"
        status["detail"] = message[:512]
        _atomic_status(state_root, status)
        return status

    try:
        trust_bytes, trust_sha = _validate_repository_authority(repo_root)
        status["canonicalTrustPinned"] = True
        status["canonicalTrustSha256"] = trust_sha
        enrollment = _install_public_trust(physical_root, trust_bytes, trust_sha)
        status["physicalTrustEnrolled"] = True
        status["trustEnrollmentState"] = enrollment

        if pending is None:
            status["status"] = "idle"
            status["phase"] = "no-base-update-pending"
            status["releaseMaterializationState"] = "not-required"
            status["blocker"] = None
        elif source is None:
            status["blocker"] = "source-sha-unavailable"
            status["detail"] = "current checkout SHA is unavailable"
        else:
            materialized_sha, idempotent = _materialize_signed_release(
                physical_root,
                source,
            )
            status["signedReleaseMaterialized"] = True
            status["materializedReleaseSha"] = materialized_sha
            status["releaseMaterializationState"] = (
                "already-materialized" if idempotent else "materialized"
            )
            status["status"] = "idle"
            status["phase"] = "waiting-for-base-staging-owner"
            status["blocker"] = None
    except OwnerError as exc:
        message = str(exc)
        if "canonical repository public trust is missing" in message:
            status["blocker"] = "canonical-trust-not-pinned"
        elif "conflicts with canonical repository trust" in message:
            status["blocker"] = "physical-trust-conflict"
        elif "lacks materialize support" in message:
            status["blocker"] = "release-agent-materialize-unsupported"
        elif (
            "signed release materialization" in message
            or "release acquisition" in message
            or "physical release channel" in message
            or "physical release acquisition agent" in message
        ):
            status["blocker"] = "signed-release-materialization-failed"
        else:
            status["blocker"] = "trust-enrollment-validation-failed"
        status["detail"] = message[:512]

    _atomic_status(state_root, status)
    return status


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--physical-root", type=Path, required=True)
    args = parser.parse_args()
    source_sha = os.environ.get("ORDAX_BASE_SOURCE_SHA", "")
    try:
        result = run_once(
            args.repo_root,
            args.state_root,
            args.physical_root,
            source_sha,
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except OwnerError as exc:
        print(f"ordax-base-update-owner: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
