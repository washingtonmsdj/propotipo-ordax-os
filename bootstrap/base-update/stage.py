#!/usr/bin/env python3
"""Stage a verified OrdaX base candidate into an already-mounted disposable ESP.

This owner deliberately does not mount block devices, set EFI variables or reboot.
Those privileged activation steps remain separate gates.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile

HERE = Path(__file__).resolve().parent
_PLAN_SPEC = importlib.util.spec_from_file_location("ordax_base_update_plan", HERE / "plan.py")
_planner = importlib.util.module_from_spec(_PLAN_SPEC)
assert _PLAN_SPEC.loader is not None
_PLAN_SPEC.loader.exec_module(_planner)

ENTRY_MODE = 0o644
COPY_CHUNK = 1024 * 1024
RELEASE_ENVELOPE_SCHEMA = "prototype-ordax.release-envelope/1"
RELEASE_MANIFEST_SCHEMA = "prototype-ordax.release-manifest/1"
BASE_CANDIDATE_SCHEMA = "prototype-ordax.base-update-candidate/1"
BASE_CANDIDATE_MEMBER = "system/base-update/candidate.json"
DEFAULT_RELEASE_AGENT = Path("/ordax/bootstrap/release-acquisition/ordax-release-agent")
DEFAULT_TRUST = Path("/ordax/bootstrap/trust/release-ed25519.json")
DEFAULT_RELEASES_ROOT = Path("/ordax/releases")
MAX_ENVELOPE_BYTES = 1 << 20
MAX_MANIFEST_BYTES = 512 << 10
MAX_DESCRIPTOR_BYTES = 16 << 10
LEGACY_KERNEL = Path("ordax/vmlinuz")
LEGACY_INITRAMFS = Path("ordax/initrd.gz")
CURRENT_ENTRY = Path("loader/entries/ordax.conf")
RECOVERY_ENTRY = Path("loader/entries/ordax-recovery.conf")


class StageError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(COPY_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_regular_source(path: Path, expected_sha256: str) -> Path:
    try:
        original_metadata = path.lstat()
    except OSError as exc:
        raise StageError(f"candidate source unavailable: {path.name}") from exc
    if stat.S_ISLNK(original_metadata.st_mode):
        raise StageError(f"candidate source must not be a symlink: {path.name}")
    path = path.resolve()
    try:
        metadata = path.stat()
    except OSError as exc:
        raise StageError(f"candidate source unavailable: {path.name}") from exc
    if not stat.S_ISREG(metadata.st_mode):
        raise StageError(f"candidate source is not a regular file: {path.name}")
    actual = sha256_file(path)
    if actual != expected_sha256:
        raise StageError(f"candidate source digest mismatch: {path.name}")
    return path


def target_path(esp_root: Path, absolute_contract_path: str) -> Path:
    if not isinstance(absolute_contract_path, str) or not absolute_contract_path.startswith("/"):
        raise StageError("contract target must be absolute")
    relative = absolute_contract_path.lstrip("/")
    if not relative or ".." in Path(relative).parts:
        raise StageError("unsafe contract target")
    root = esp_root.resolve()
    target = root / relative
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise StageError("contract target escapes ESP root") from exc
    return target


def fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0)
    descriptor = os.open(path, flags)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def ensure_private_parent(root: Path, target: Path) -> None:
    root = root.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    current = target.parent
    while True:
        if current.is_symlink():
            raise StageError("ESP staging path contains a symlink")
        if current == root:
            break
        if root not in current.parents:
            raise StageError("ESP staging parent escapes root")
        current = current.parent


def atomic_copy(source: Path, target: Path, expected_sha256: str) -> None:
    ensure_private_parent(target.parents[len(target.parts) - len(target.parts)], target)


def _atomic_copy(esp_root: Path, source: Path, target: Path, expected_sha256: str) -> None:
    ensure_private_parent(esp_root, target)
    temporary = target.with_name(f".{target.name}.ordax-stage-{os.getpid()}")
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        source_fd = os.open(
            source,
            os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            source_meta_before = os.fstat(source_fd)
            if not stat.S_ISREG(source_meta_before.st_mode):
                raise StageError("candidate source changed type")
            output_fd = os.open(temporary, flags, ENTRY_MODE)
            try:
                digest = hashlib.sha256()
                while True:
                    chunk = os.read(source_fd, COPY_CHUNK)
                    if not chunk:
                        break
                    digest.update(chunk)
                    offset = 0
                    while offset < len(chunk):
                        written = os.write(output_fd, chunk[offset:])
                        if written <= 0:
                            raise StageError("short write while staging base artifact")
                        offset += written
                os.fsync(output_fd)
            finally:
                os.close(output_fd)
            source_meta_after = os.fstat(source_fd)
            if (
                source_meta_before.st_dev != source_meta_after.st_dev
                or source_meta_before.st_ino != source_meta_after.st_ino
                or source_meta_before.st_size != source_meta_after.st_size
                or source_meta_before.st_mtime_ns != source_meta_after.st_mtime_ns
                or source_meta_before.st_ctime_ns != source_meta_after.st_ctime_ns
            ):
                raise StageError("candidate source changed while staging")
            if digest.hexdigest() != expected_sha256:
                raise StageError("candidate source digest changed while staging")
        finally:
            os.close(source_fd)
        os.replace(temporary, target)
        fsync_directory(target.parent)
    except Exception:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise


def candidate_entry_payload(plan: dict) -> bytes:
    kernel = plan["stage"]["kernel"]["target_path"]
    initramfs = plan["stage"]["initramfs"]["target_path"]
    options = " ".join(plan["stage"]["kernel_options"])
    return (
        "title OrdaX Candidate\n"
        f"linux {kernel}\n"
        f"initrd {initramfs}\n"
        f"options console=tty0 {options}\n"
    ).encode("utf-8")


def write_candidate_entry(esp_root: Path, target: Path, plan: dict) -> None:
    ensure_private_parent(esp_root, target)
    payload = candidate_entry_payload(plan)
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        descriptor = os.open(target, flags, ENTRY_MODE)
    except FileExistsError as exc:
        raise StageError("candidate boot entry already exists") from exc
    try:
        try:
            offset = 0
            while offset < len(payload):
                written = os.write(descriptor, payload[offset:])
                if written <= 0:
                    raise StageError("short write while staging candidate entry")
                offset += written
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        fsync_directory(target.parent)
    except Exception:
        # A partial candidate marker is never promoted or selected automatically;
        # remove it best-effort and leave the known-good current entry untouched.
        try:
            target.unlink()
            fsync_directory(target.parent)
        except OSError:
            pass
        raise


def _read_boot_entry(path: Path, label: str) -> dict[str, list[str]]:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise StageError(f"{label} is missing") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise StageError(f"{label} must be a regular non-symlink file")
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise StageError(f"{label} cannot be read") from exc
    if not raw or len(raw) > 16 * 1024:
        raise StageError(f"{label} size is outside the allowed range")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise StageError(f"{label} is not UTF-8") from exc

    values: dict[str, list[str]] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition(" ")
        if not separator or not key or not value.strip():
            raise StageError(f"{label} contains a malformed line")
        values.setdefault(key, []).append(value.strip())
    return values


def _single_entry_value(values: dict[str, list[str]], key: str, label: str) -> str:
    matches = values.get(key, [])
    if len(matches) != 1:
        raise StageError(f"{label} must contain exactly one {key}")
    return matches[0]


def _validate_legacy_entry(path: Path, mode: str, label: str) -> None:
    values = _read_boot_entry(path, label)
    if _single_entry_value(values, "linux", label) != "/ordax/vmlinuz":
        raise StageError(f"{label} does not target the legacy kernel")
    if _single_entry_value(values, "initrd", label) != "/ordax/initrd.gz":
        raise StageError(f"{label} does not target the legacy initramfs")
    options = _single_entry_value(values, "options", label).split()
    if f"ordax.mode={mode}" not in options:
        raise StageError(f"{label} has the wrong OrdaX mode")
    for option in options:
        if option.startswith("ordax.base_slot=") or option.startswith("ordax.base_candidate="):
            raise StageError(f"{label} is already A/B-managed and cannot enter legacy enrollment")


def _legacy_source_snapshot(esp_root: Path) -> dict[str, str]:
    _validate_legacy_entry(esp_root / CURRENT_ENTRY, "normal", "legacy current entry")
    _validate_legacy_entry(esp_root / RECOVERY_ENTRY, "recovery", "legacy recovery entry")

    snapshot: dict[str, str] = {}
    for relative, label in (
        (LEGACY_KERNEL, "legacy kernel"),
        (LEGACY_INITRAMFS, "legacy initramfs"),
    ):
        source = esp_root / relative
        try:
            metadata = source.lstat()
        except OSError as exc:
            raise StageError(f"{label} is missing") from exc
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise StageError(f"{label} must be a regular non-symlink file")
        if metadata.st_size <= 0:
            raise StageError(f"{label} must not be empty")
        snapshot[relative.as_posix()] = sha256_file(source)
    return snapshot


def _legacy_baseline_target_state(
    target: Path,
    expected_sha256: str,
) -> str:
    try:
        existing = target.lstat()
    except FileNotFoundError:
        return "absent"
    except OSError as exc:
        raise StageError(f"cannot inspect legacy A/B baseline: {target.name}") from exc

    if stat.S_ISLNK(existing.st_mode) or not stat.S_ISREG(existing.st_mode):
        raise StageError(f"legacy A/B baseline is unsafe: {target.name}")
    if sha256_file(target) != expected_sha256:
        raise StageError(f"legacy A/B baseline conflicts with known-good bytes: {target.name}")
    return "matching"


def _preserve_legacy_file(
    esp_root: Path,
    source: Path,
    target: Path,
    expected_sha256: str,
    target_state: str,
) -> bool:
    if target_state == "matching":
        return True
    if target_state != "absent":
        raise StageError("legacy A/B baseline target state is invalid")
    _atomic_copy(esp_root, source, target, expected_sha256)
    return False


def snapshot_protected_files(esp_root: Path) -> dict[str, str | None]:
    result = {}
    for relative in (
        "loader/entries/ordax.conf",
        "loader/entries/ordax-recovery.conf",
    ):
        path = esp_root / relative
        result[relative] = sha256_file(path) if path.is_file() and not path.is_symlink() else None
    return result


def _require_regular_local_file(path: Path, label: str, executable: bool = False) -> Path:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise StageError(f"{label} is unavailable") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise StageError(f"{label} must be a regular non-symlink file")
    if executable and metadata.st_mode & 0o111 == 0:
        raise StageError(f"{label} is not executable")
    return path


def _strict_json_document(raw: bytes | str, label: str, max_bytes: int) -> dict:
    if isinstance(raw, str):
        encoded = raw.encode("utf-8")
    else:
        encoded = raw
    if not encoded or len(encoded) > max_bytes:
        raise StageError(f"{label} size is outside the allowed range")

    def no_duplicates(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise StageError(f"{label} contains duplicate JSON keys")
            value[key] = item
        return value

    try:
        value = json.loads(encoded.decode("utf-8"), object_pairs_hook=no_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise StageError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict):
        raise StageError(f"{label} must be a JSON object")
    return value


def _read_regular_bytes(path: Path, label: str, max_bytes: int) -> bytes:
    path = _require_regular_local_file(path, label)
    try:
        metadata = path.stat()
    except OSError as exc:
        raise StageError(f"{label} is unavailable") from exc
    if metadata.st_size <= 0 or metadata.st_size > max_bytes:
        raise StageError(f"{label} size is outside the allowed range")
    try:
        return path.read_bytes()
    except OSError as exc:
        raise StageError(f"{label} could not be read") from exc


def _verified_release_commit(
    envelope_path: Path,
    trust_path: Path,
    release_agent: Path,
) -> str:
    envelope_path = _require_regular_local_file(envelope_path, "release envelope")
    trust_path = _require_regular_local_file(trust_path, "release trust anchor")
    release_agent = _require_regular_local_file(
        release_agent, "release verification agent", executable=True
    )
    try:
        completed = subprocess.run(
            [
                str(release_agent),
                "verify-envelope",
                "--envelope",
                str(envelope_path),
                "--trust",
                str(trust_path),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise StageError("signed release verification could not run") from exc

    if completed.returncode != 0:
        raise StageError("signed release verification failed")
    verified = _strict_json_document(
        completed.stdout, "release verification result", 16 * 1024
    )
    if set(verified) != {"status", "source_commit", "artifact_count"}:
        raise StageError("release verification result has unexpected fields")
    if verified.get("status") != "verified" or verified.get("artifact_count") != 1:
        raise StageError("release verification did not prove canonical manifest")
    source_commit = verified.get("source_commit")
    if not isinstance(source_commit, str) or not _planner.SHA40_RE.fullmatch(source_commit):
        raise StageError("release verification source identity is invalid")
    return source_commit


def _signed_manifest_from_envelope(envelope_path: Path, verified_commit: str) -> tuple[bytes, dict]:
    envelope = _strict_json_document(
        _read_regular_bytes(envelope_path, "release envelope", MAX_ENVELOPE_BYTES),
        "release envelope",
        MAX_ENVELOPE_BYTES,
    )
    if set(envelope) != {"$schema", "payload", "signature", "key_id"}:
        raise StageError("release envelope has unexpected fields")
    if envelope.get("$schema") != RELEASE_ENVELOPE_SCHEMA:
        raise StageError("release envelope schema is unsupported")
    payload_text = envelope.get("payload")
    if not isinstance(payload_text, str):
        raise StageError("release envelope payload is invalid")
    try:
        payload = base64.b64decode(payload_text, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise StageError("release envelope payload is invalid base64") from exc
    manifest = _strict_json_document(payload, "signed release manifest", MAX_MANIFEST_BYTES)
    expected_manifest_fields = {
        "$schema",
        "source_repository",
        "source_commit",
        "release_id",
        "created_from_ci_recipe",
        "artifacts",
    }
    if set(manifest) != expected_manifest_fields:
        raise StageError("signed release manifest has unexpected fields")
    if manifest.get("$schema") != RELEASE_MANIFEST_SCHEMA:
        raise StageError("signed release manifest schema is unsupported")
    if manifest.get("source_repository") != "washingtonmsdj/prototipo-ordax-os":
        raise StageError("signed release manifest repository mismatch")
    if manifest.get("source_commit") != verified_commit or manifest.get("release_id") != verified_commit:
        raise StageError("signed release manifest identity mismatch")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != 1 or not isinstance(artifacts[0], dict):
        raise StageError("signed release manifest artifact set is invalid")
    artifact = artifacts[0]
    if set(artifact) != {"name", "role", "url", "sha256", "size"}:
        raise StageError("signed release artifact has unexpected fields")
    if artifact.get("name") != "system.tar" or artifact.get("role") != "system":
        raise StageError("signed release artifact is not canonical system.tar")
    digest = artifact.get("sha256")
    if not isinstance(digest, str) or not _planner.SHA256_RE.fullmatch(digest):
        raise StageError("signed system.tar digest is invalid")
    size = artifact.get("size")
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
        raise StageError("signed system.tar size is invalid")
    return payload, manifest


def _candidate_descriptor_from_signed_archive(
    archive_path: Path,
    expected_sha256: str,
    expected_size: int,
) -> dict:
    archive_path = _require_regular_local_file(archive_path, "verified system.tar")
    try:
        metadata = archive_path.stat()
    except OSError as exc:
        raise StageError("verified system.tar is unavailable") from exc
    if metadata.st_size != expected_size:
        raise StageError("verified system.tar size differs from signed manifest")
    if sha256_file(archive_path) != expected_sha256:
        raise StageError("verified system.tar digest differs from signed manifest")

    matches = []
    try:
        with tarfile.open(archive_path, mode="r:*") as archive:
            for member in archive:
                if member.name != BASE_CANDIDATE_MEMBER:
                    continue
                matches.append(member)
                if len(matches) > 1:
                    raise StageError("signed system.tar contains duplicate base candidate descriptors")
            if len(matches) != 1:
                raise StageError("signed system.tar does not contain a base candidate descriptor")
            member = matches[0]
            if not member.isfile() or member.size <= 0 or member.size > MAX_DESCRIPTOR_BYTES:
                raise StageError("signed base candidate descriptor is not a bounded regular file")
            handle = archive.extractfile(member)
            if handle is None:
                raise StageError("signed base candidate descriptor could not be read")
            descriptor_bytes = handle.read(MAX_DESCRIPTOR_BYTES + 1)
    except (OSError, tarfile.TarError) as exc:
        raise StageError("verified system.tar could not be inspected") from exc
    if len(descriptor_bytes) > MAX_DESCRIPTOR_BYTES:
        raise StageError("signed base candidate descriptor is oversized")

    descriptor = _strict_json_document(
        descriptor_bytes, "signed base candidate descriptor", MAX_DESCRIPTOR_BYTES
    )
    if set(descriptor) != {"$schema", "kernel_sha256", "initramfs_sha256"}:
        raise StageError("signed base candidate descriptor has unexpected fields")
    if descriptor.get("$schema") != BASE_CANDIDATE_SCHEMA:
        raise StageError("signed base candidate descriptor schema is unsupported")
    for field in ("kernel_sha256", "initramfs_sha256"):
        value = descriptor.get(field)
        if not isinstance(value, str) or not _planner.SHA256_RE.fullmatch(value):
            raise StageError(f"signed base candidate descriptor {field} is invalid")
    return descriptor


def verified_candidate_from_release(
    envelope_path: Path,
    trust_path: Path,
    release_agent: Path,
    releases_root: Path,
) -> dict:
    verified_commit = _verified_release_commit(envelope_path, trust_path, release_agent)
    payload, manifest = _signed_manifest_from_envelope(envelope_path, verified_commit)

    release_root = releases_root / verified_commit
    if release_root.is_symlink() or not release_root.is_dir():
        raise StageError("verified release root is unavailable")
    stored_manifest = _read_regular_bytes(
        release_root / "release-manifest.json",
        "stored verified release manifest",
        MAX_MANIFEST_BYTES,
    )
    if stored_manifest != payload:
        raise StageError("stored release manifest differs from signed envelope payload")

    artifact = manifest["artifacts"][0]
    descriptor = _candidate_descriptor_from_signed_archive(
        release_root / "artifacts" / "system.tar",
        artifact["sha256"],
        artifact["size"],
    )
    return {
        "release_sha": verified_commit,
        "kernel_sha256": descriptor["kernel_sha256"],
        "initramfs_sha256": descriptor["initramfs_sha256"],
    }


def stage(
    esp_root: Path,
    active_slot: str,
    candidate: dict,
    kernel_source: Path,
    initramfs_source: Path,
) -> dict:
    esp_root = esp_root.resolve()
    if not esp_root.is_dir() or esp_root.is_symlink():
        raise StageError("ESP root must be an existing directory")

    legacy_enrollment = active_slot == "legacy"
    planner_active_slot = "a" if legacy_enrollment else active_slot
    plan = _planner.plan(planner_active_slot, candidate)
    protected_before = snapshot_protected_files(esp_root)
    if any(value is None for value in protected_before.values()):
        raise StageError("known-good current/recovery entries must exist before staging")

    legacy_before = _legacy_source_snapshot(esp_root) if legacy_enrollment else None

    kernel_source = require_regular_source(
        kernel_source, plan["stage"]["kernel"]["sha256"]
    )
    initramfs_source = require_regular_source(
        initramfs_source, plan["stage"]["initramfs"]["sha256"]
    )
    kernel_target = target_path(esp_root, plan["stage"]["kernel"]["target_path"])
    initramfs_target = target_path(esp_root, plan["stage"]["initramfs"]["target_path"])
    entry_target = target_path(esp_root, plan["stage"]["candidate_entry"])

    # The candidate entry is the activation marker. Refuse to touch either the
    # inactive candidate slot or the legacy baseline when an old marker exists.
    if entry_target.exists() or entry_target.is_symlink():
        raise StageError("candidate boot entry already exists")

    legacy_baseline_reused = False
    if legacy_enrollment:
        baseline_kernel = target_path(esp_root, "/ordax/base/a/vmlinuz")
        baseline_initramfs = target_path(esp_root, "/ordax/base/a/initrd.gz")
        kernel_state = _legacy_baseline_target_state(
            baseline_kernel,
            legacy_before[LEGACY_KERNEL.as_posix()],
        )
        initramfs_state = _legacy_baseline_target_state(
            baseline_initramfs,
            legacy_before[LEGACY_INITRAMFS.as_posix()],
        )
        kernel_reused = _preserve_legacy_file(
            esp_root,
            esp_root / LEGACY_KERNEL,
            baseline_kernel,
            legacy_before[LEGACY_KERNEL.as_posix()],
            kernel_state,
        )
        initramfs_reused = _preserve_legacy_file(
            esp_root,
            esp_root / LEGACY_INITRAMFS,
            baseline_initramfs,
            legacy_before[LEGACY_INITRAMFS.as_posix()],
            initramfs_state,
        )
        legacy_baseline_reused = kernel_reused and initramfs_reused
        if _legacy_source_snapshot(esp_root) != legacy_before:
            raise StageError("legacy known-good source changed during A/B enrollment")
        if snapshot_protected_files(esp_root) != protected_before:
            raise StageError("legacy boot entries changed during A/B enrollment")

    _atomic_copy(
        esp_root,
        kernel_source,
        kernel_target,
        plan["stage"]["kernel"]["sha256"],
    )
    _atomic_copy(
        esp_root,
        initramfs_source,
        initramfs_target,
        plan["stage"]["initramfs"]["sha256"],
    )

    if sha256_file(kernel_target) != plan["stage"]["kernel"]["sha256"]:
        raise StageError("staged kernel verification failed")
    if sha256_file(initramfs_target) != plan["stage"]["initramfs"]["sha256"]:
        raise StageError("staged initramfs verification failed")

    protected_after_artifacts = snapshot_protected_files(esp_root)
    if protected_after_artifacts != protected_before:
        raise StageError("protected boot entries changed during candidate staging")

    write_candidate_entry(esp_root, entry_target, plan)
    fsync_directory(esp_root)

    if snapshot_protected_files(esp_root) != protected_before:
        raise StageError("protected boot entries changed while writing candidate marker")

    if legacy_enrollment and _legacy_source_snapshot(esp_root) != legacy_before:
        raise StageError("legacy known-good source changed while staging candidate")

    return {
        "$schema": "prototype-ordax.base-update-stage-result/1",
        "release_sha": plan["release_sha"],
        "active_slot": active_slot,
        "previous_slot": plan["active_slot"],
        "candidate_slot": plan["candidate_slot"],
        "legacy_enrollment": legacy_enrollment,
        "legacy_current_entry_unchanged": legacy_enrollment,
        "legacy_baseline_reused": legacy_baseline_reused if legacy_enrollment else False,
        "kernel_target": plan["stage"]["kernel"]["target_path"],
        "initramfs_target": plan["stage"]["initramfs"]["target_path"],
        "candidate_entry": plan["stage"]["candidate_entry"],
        "activation_ready": True,
        "efi_variable_written": False,
        "reboot_requested": False,
    }


def verify_existing_stage(
    esp_root: Path,
    active_slot: str,
    candidate: dict,
    kernel_source: Path,
    initramfs_source: Path,
) -> dict:
    esp_root = esp_root.resolve()
    if not esp_root.is_dir() or esp_root.is_symlink():
        raise StageError("ESP root must be an existing directory")

    legacy_enrollment = active_slot == "legacy"
    planner_active_slot = "a" if legacy_enrollment else active_slot
    plan = _planner.plan(planner_active_slot, candidate)

    protected = snapshot_protected_files(esp_root)
    if any(value is None for value in protected.values()):
        raise StageError("known-good current/recovery entries must exist before verifying stage")

    kernel_source = require_regular_source(
        kernel_source, plan["stage"]["kernel"]["sha256"]
    )
    initramfs_source = require_regular_source(
        initramfs_source, plan["stage"]["initramfs"]["sha256"]
    )
    kernel_target = target_path(esp_root, plan["stage"]["kernel"]["target_path"])
    initramfs_target = target_path(esp_root, plan["stage"]["initramfs"]["target_path"])
    entry_target = target_path(esp_root, plan["stage"]["candidate_entry"])

    try:
        entry_meta = entry_target.lstat()
    except OSError as exc:
        raise StageError("candidate boot entry is unavailable for verification") from exc
    if stat.S_ISLNK(entry_meta.st_mode) or not stat.S_ISREG(entry_meta.st_mode):
        raise StageError("candidate boot entry is unsafe")
    try:
        entry_bytes = entry_target.read_bytes()
    except OSError as exc:
        raise StageError("candidate boot entry could not be read") from exc
    if entry_bytes != candidate_entry_payload(plan):
        raise StageError("candidate boot entry differs from the verified release plan")

    for target, expected, label in (
        (kernel_target, plan["stage"]["kernel"]["sha256"], "staged kernel"),
        (initramfs_target, plan["stage"]["initramfs"]["sha256"], "staged initramfs"),
    ):
        try:
            metadata = target.lstat()
        except OSError as exc:
            raise StageError(f"{label} is unavailable") from exc
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise StageError(f"{label} is unsafe")
        if sha256_file(target) != expected:
            raise StageError(f"{label} digest differs from verified release plan")

    if legacy_enrollment:
        legacy = _legacy_source_snapshot(esp_root)
        baseline_kernel = target_path(esp_root, "/ordax/base/a/vmlinuz")
        baseline_initramfs = target_path(esp_root, "/ordax/base/a/initrd.gz")
        if _legacy_baseline_target_state(
            baseline_kernel,
            legacy[LEGACY_KERNEL.as_posix()],
        ) != "matching":
            raise StageError("legacy kernel baseline is not enrolled")
        if _legacy_baseline_target_state(
            baseline_initramfs,
            legacy[LEGACY_INITRAMFS.as_posix()],
        ) != "matching":
            raise StageError("legacy initramfs baseline is not enrolled")

    return {
        "$schema": "prototype-ordax.base-update-stage-result/1",
        "release_sha": plan["release_sha"],
        "active_slot": active_slot,
        "previous_slot": plan["active_slot"],
        "candidate_slot": plan["candidate_slot"],
        "legacy_enrollment": legacy_enrollment,
        "legacy_current_entry_unchanged": legacy_enrollment,
        "legacy_baseline_reused": legacy_enrollment,
        "kernel_target": plan["stage"]["kernel"]["target_path"],
        "initramfs_target": plan["stage"]["initramfs"]["target_path"],
        "candidate_entry": plan["stage"]["candidate_entry"],
        "activation_ready": True,
        "efi_variable_written": False,
        "reboot_requested": False,
        "idempotent": True,
    }


def ensure_stage(
    esp_root: Path,
    active_slot: str,
    candidate: dict,
    kernel_source: Path,
    initramfs_source: Path,
) -> dict:
    planner_active_slot = "a" if active_slot == "legacy" else active_slot
    plan = _planner.plan(planner_active_slot, candidate)
    entry_target = target_path(esp_root.resolve(), plan["stage"]["candidate_entry"])
    if entry_target.exists() or entry_target.is_symlink():
        return verify_existing_stage(
            esp_root,
            active_slot,
            candidate,
            kernel_source,
            initramfs_source,
        )
    result = stage(
        esp_root,
        active_slot,
        candidate,
        kernel_source,
        initramfs_source,
    )
    result["idempotent"] = False
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--esp-root", type=Path, required=True)
    parser.add_argument("--active-slot", choices=("a", "b", "legacy"), required=True)
    parser.add_argument("--envelope", type=Path, required=True)
    parser.add_argument("--kernel", type=Path, required=True)
    parser.add_argument("--initramfs", type=Path, required=True)
    parser.add_argument("--ensure-existing", action="store_true")
    args = parser.parse_args()
    try:
        candidate = verified_candidate_from_release(
            args.envelope,
            DEFAULT_TRUST,
            DEFAULT_RELEASE_AGENT,
            DEFAULT_RELEASES_ROOT,
        )
        owner = ensure_stage if args.ensure_existing else stage
        result = owner(
            args.esp_root,
            args.active_slot,
            candidate,
            args.kernel,
            args.initramfs,
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (OSError, _planner.PlanError, StageError) as exc:
        print(f"base-update-stage: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
