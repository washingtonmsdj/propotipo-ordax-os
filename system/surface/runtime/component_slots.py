"""Native authority for signed OrdaX runtime-component slots.

This module never downloads or signs components. It only accepts versions that
the canonical release agent can re-verify from an immutable staged directory,
keeps the small current/previous/pending pointer state atomic, and serves only
manifest-bound bytes whose SHA-256 still matches the verified package.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import PurePosixPath
import re
import stat
import subprocess
import threading
from typing import Any

SLOT_SCHEMA = "ordax.native-component-slot/1"
COMPONENT_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
VERSION_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$"
)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_STATE_BYTES = 16 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_COMPONENT_FILE_BYTES = 2 * 1024 * 1024
MAX_COMPONENT_FILES = 256
VERIFY_TIMEOUT_SECONDS = 15.0

MIME_TYPES = {
    ".mjs": "text/javascript; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
}


class ComponentSlotError(RuntimeError):
    pass


class ComponentSlotConflict(ComponentSlotError):
    pass


class ComponentSlotNotFound(ComponentSlotError):
    pass


def _validate_component_id(value: object) -> str:
    if not isinstance(value, str) or COMPONENT_ID_RE.fullmatch(value) is None:
        raise ComponentSlotError("invalid component id")
    return value


def _validate_version(value: object, *, optional: bool = False) -> str | None:
    if optional and value is None:
        return None
    if not isinstance(value, str) or VERSION_RE.fullmatch(value) is None:
        raise ComponentSlotError("invalid component version")
    return value


def _safe_relative_path(value: object) -> str:
    if not isinstance(value, str) or not value or "\x00" in value or "\\" in value:
        raise ComponentSlotError("invalid component asset path")
    path = PurePosixPath(value)
    if path.is_absolute() or "." in path.parts or ".." in path.parts:
        raise ComponentSlotError("unsafe component asset path")
    normalized = path.as_posix()
    if not normalized.startswith("system/"):
        raise ComponentSlotError("component asset must remain under system/")
    if path.suffix.lower() not in MIME_TYPES:
        raise ComponentSlotError("unsupported component asset type")
    return normalized


def _state_default(component_id: str) -> dict[str, Any]:
    return {
        "$schema": SLOT_SCHEMA,
        "componentId": component_id,
        "revision": 0,
        "currentVersion": None,
        "previousVersion": None,
        "pendingVersion": None,
        "rejectedVersion": None,
    }


def _validate_state(value: object, component_id: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ComponentSlotError("component slot state must be an object")
    expected = {
        "$schema",
        "componentId",
        "revision",
        "currentVersion",
        "previousVersion",
        "pendingVersion",
        "rejectedVersion",
    }
    if set(value) != expected:
        raise ComponentSlotError("component slot state fields are not canonical")
    if value["$schema"] != SLOT_SCHEMA or value["componentId"] != component_id:
        raise ComponentSlotError("component slot state identity is invalid")
    revision = value["revision"]
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
        raise ComponentSlotError("component slot revision is invalid")

    state = dict(value)
    for key in (
        "currentVersion",
        "previousVersion",
        "pendingVersion",
        "rejectedVersion",
    ):
        state[key] = _validate_version(value[key], optional=True)

    active = [
        state["currentVersion"],
        state["previousVersion"],
        state["pendingVersion"],
    ]
    active = [item for item in active if item is not None]
    if len(active) != len(set(active)):
        raise ComponentSlotError("current, previous and pending slots must be distinct")
    return state


def _regular_file_bytes(path: str, max_bytes: int, label: str) -> bytes:
    flags = (
        os.O_RDONLY
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ComponentSlotError(f"{label} is unavailable") from exc
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ComponentSlotError(f"{label} is not a regular file")
        if metadata.st_size <= 0 or metadata.st_size > max_bytes:
            raise ComponentSlotError(f"{label} size is outside allowed range")
        payload = bytearray()
        while len(payload) <= max_bytes:
            chunk = os.read(descriptor, min(65536, max_bytes + 1 - len(payload)))
            if not chunk:
                break
            payload.extend(chunk)
        if len(payload) != metadata.st_size or len(payload) > max_bytes:
            raise ComponentSlotError(f"{label} changed or exceeded its limit")
        return bytes(payload)
    finally:
        os.close(descriptor)


def _fsync_directory(path: str) -> None:
    descriptor = os.open(
        path,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0),
    )
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_json(path: str, value: dict[str, Any]) -> None:
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    metadata = os.lstat(directory)
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise ComponentSlotError("component slot state directory is unsafe")

    payload = (
        json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n"
    ).encode("utf-8")
    temporary = f"{path}.tmp.{os.getpid()}.{threading.get_ident()}"
    descriptor = -1
    try:
        descriptor = os.open(
            temporary,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        view = memoryview(payload)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise OSError("component slot state write made no progress")
            view = view[written:]
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, path)
        _fsync_directory(directory)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def _read_asset_no_symlink(stage_root: str, relative: str) -> bytes:
    parts = PurePosixPath(relative).parts
    if not parts:
        raise ComponentSlotError("empty component asset path")

    descriptor = os.open(
        stage_root,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0),
    )
    try:
        for part in parts[:-1]:
            next_descriptor = os.open(
                part,
                os.O_RDONLY
                | getattr(os, "O_DIRECTORY", 0)
                | getattr(os, "O_CLOEXEC", 0)
                | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=descriptor,
            )
            os.close(descriptor)
            descriptor = next_descriptor

        file_descriptor = os.open(
            parts[-1],
            os.O_RDONLY
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=descriptor,
        )
        try:
            metadata = os.fstat(file_descriptor)
            if (
                not stat.S_ISREG(metadata.st_mode)
                or metadata.st_size <= 0
                or metadata.st_size > MAX_COMPONENT_FILE_BYTES
            ):
                raise ComponentSlotError("component asset is not a bounded regular file")
            payload = bytearray()
            while len(payload) <= MAX_COMPONENT_FILE_BYTES:
                chunk = os.read(
                    file_descriptor,
                    min(65536, MAX_COMPONENT_FILE_BYTES + 1 - len(payload)),
                )
                if not chunk:
                    break
                payload.extend(chunk)
            if (
                len(payload) != metadata.st_size
                or len(payload) > MAX_COMPONENT_FILE_BYTES
            ):
                raise ComponentSlotError("component asset changed while reading")
            return bytes(payload)
        finally:
            os.close(file_descriptor)
    finally:
        os.close(descriptor)


class ComponentSlotBroker:
    def __init__(
        self,
        *,
        root: str = "/var/lib/ordax/components",
        release_agent: str = "/ordax/bootstrap/release-acquisition/ordax-release-agent",
        trust_path: str = "/ordax/bootstrap/trust/release-ed25519.json",
        repository: str = "washingtonmsdj/prototipo-ordax-os",
    ):
        self.root = os.path.abspath(root)
        self.release_agent = os.path.abspath(release_agent)
        self.trust_path = os.path.abspath(trust_path)
        self.repository = repository
        self._lock = threading.RLock()
        self._verified: dict[tuple[str, str], dict[str, Any]] = {}

    def _component_root(self, component_id: str) -> str:
        return os.path.join(self.root, component_id)

    def _state_path(self, component_id: str) -> str:
        return os.path.join(self._component_root(component_id), "slot-state.json")

    def _stage_path(self, component_id: str, version: str) -> str:
        return os.path.join(
            self._component_root(component_id),
            "versions",
            version,
        )

    def _read_state(self, component_id: str) -> dict[str, Any]:
        component_id = _validate_component_id(component_id)
        path = self._state_path(component_id)
        try:
            raw = _regular_file_bytes(path, MAX_STATE_BYTES, "component slot state")
        except ComponentSlotError as exc:
            if not os.path.exists(path):
                return _state_default(component_id)
            raise exc
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise ComponentSlotError("component slot state is invalid JSON") from exc
        return _validate_state(value, component_id)

    def _write_state(
        self,
        component_id: str,
        current: dict[str, Any],
        **changes: Any,
    ) -> dict[str, Any]:
        next_state = dict(current)
        next_state.update(changes)
        next_state["revision"] = current["revision"] + 1
        next_state = _validate_state(next_state, component_id)
        _atomic_json(self._state_path(component_id), next_state)
        return next_state

    def _verified_package_manifest(
        self,
        component_id: str,
        version: str,
    ) -> dict[str, Any]:
        component_id = _validate_component_id(component_id)
        version = _validate_version(version)
        key = (component_id, version)
        cached = self._verified.get(key)
        if cached is not None:
            return cached

        for path, label in (
            (self.release_agent, "release agent"),
            (self.trust_path, "release trust"),
        ):
            info = os.lstat(path)
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                raise ComponentSlotError(f"{label} path is unsafe")

        command = [
            self.release_agent,
            "verify-staged-component",
            "--root",
            self.root,
            "--trust",
            self.trust_path,
            "--repository",
            self.repository,
            "--component",
            component_id,
            "--version",
            version,
        ]
        try:
            result = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=VERIFY_TIMEOUT_SECONDS,
                env={"PATH": "/usr/bin:/bin"},
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise ComponentSlotError("staged component verifier could not run") from exc
        if result.returncode != 0:
            raise ComponentSlotError("staged component failed signature/integrity verification")
        try:
            receipt = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise ComponentSlotError("staged component verifier returned invalid JSON") from exc

        expected_receipt = {
            "status",
            "component_id",
            "version",
            "source_commit",
            "release_sequence",
            "entrypoint",
            "stage_path",
        }
        if not isinstance(receipt, dict) or set(receipt) != expected_receipt:
            raise ComponentSlotError("staged component verifier receipt is not canonical")
        expected_stage = self._stage_path(component_id, version)
        if (
            receipt["status"] != "verified-staged"
            or receipt["component_id"] != component_id
            or receipt["version"] != version
            or receipt["stage_path"] != expected_stage
        ):
            raise ComponentSlotError("staged component verifier identity mismatch")

        manifest_path = os.path.join(expected_stage, "component-package.json")
        raw = _regular_file_bytes(
            manifest_path,
            MAX_MANIFEST_BYTES,
            "verified component package manifest",
        )
        try:
            manifest = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise ComponentSlotError("verified component package manifest is invalid") from exc
        if not isinstance(manifest, dict):
            raise ComponentSlotError("verified component package manifest is not an object")
        if (
            manifest.get("$schema") != "prototype-ordax.runtime-component-package/1"
            or manifest.get("entrypoint") != receipt["entrypoint"]
            or manifest.get("component", {}).get("id") != component_id
            or manifest.get("component", {}).get("version") != version
        ):
            raise ComponentSlotError("verified component package manifest identity mismatch")
        records = manifest.get("files")
        if not isinstance(records, list) or not records or len(records) > MAX_COMPONENT_FILES:
            raise ComponentSlotError("verified component package file list is invalid")

        files: dict[str, dict[str, Any]] = {}
        for record in records:
            if not isinstance(record, dict) or set(record) != {"path", "sha256", "size"}:
                raise ComponentSlotError("verified component file record is invalid")
            path = _safe_relative_path(record["path"])
            digest = record["sha256"]
            size = record["size"]
            if (
                path in files
                or not isinstance(digest, str)
                or SHA256_RE.fullmatch(digest) is None
                or not isinstance(size, int)
                or isinstance(size, bool)
                or size <= 0
                or size > MAX_COMPONENT_FILE_BYTES
            ):
                raise ComponentSlotError("verified component file binding is invalid")
            files[path] = {"sha256": digest, "size": size}

        entrypoint = _safe_relative_path(receipt["entrypoint"])
        if entrypoint not in files:
            raise ComponentSlotError("verified component entrypoint is not package-bound")

        verified = {
            "componentId": component_id,
            "version": version,
            "entrypoint": entrypoint,
            "sourceCommit": receipt["source_commit"],
            "releaseSequence": receipt["release_sequence"],
            "stagePath": expected_stage,
            "files": files,
        }
        self._verified[key] = verified
        return verified

    def _role_record(
        self,
        component_id: str,
        version: str | None,
    ) -> dict[str, Any] | None:
        if version is None:
            return None
        try:
            verified = self._verified_package_manifest(component_id, version)
        except (ComponentSlotError, OSError):
            return {
                "version": version,
                "verified": False,
                "entrypointUrl": None,
            }
        return {
            "version": version,
            "verified": True,
            "entrypointUrl": self.entrypoint_url(
                component_id,
                version,
                verified["entrypoint"],
            ),
            "sourceCommit": verified["sourceCommit"],
            "releaseSequence": verified["releaseSequence"],
        }

    def snapshot(self, component_id: str) -> dict[str, Any]:
        component_id = _validate_component_id(component_id)
        with self._lock:
            state = self._read_state(component_id)
            return {
                "$schema": SLOT_SCHEMA,
                "componentId": component_id,
                "revision": state["revision"],
                "current": self._role_record(
                    component_id,
                    state["currentVersion"],
                ),
                "previous": self._role_record(
                    component_id,
                    state["previousVersion"],
                ),
                "pending": self._role_record(
                    component_id,
                    state["pendingVersion"],
                ),
                "rejectedVersion": state["rejectedVersion"],
            }

    def prepare(self, component_id: str, version: str) -> dict[str, Any]:
        component_id = _validate_component_id(component_id)
        version = _validate_version(version)
        with self._lock:
            self._verified.pop((component_id, version), None)
            self._verified_package_manifest(component_id, version)
            state = self._read_state(component_id)
            if state["currentVersion"] == version:
                raise ComponentSlotConflict("candidate already matches current slot")
            if state["pendingVersion"] == version:
                return self.snapshot(component_id)
            if state["pendingVersion"] is not None:
                raise ComponentSlotConflict("another component version is already pending")
            self._write_state(
                component_id,
                state,
                pendingVersion=version,
                rejectedVersion=None,
            )
            return self.snapshot(component_id)

    def promote(self, component_id: str, version: str) -> dict[str, Any]:
        component_id = _validate_component_id(component_id)
        version = _validate_version(version)
        with self._lock:
            state = self._read_state(component_id)
            if state["pendingVersion"] != version:
                raise ComponentSlotConflict("promotion requires the exact pending version")
            self._verified.pop((component_id, version), None)
            self._verified_package_manifest(component_id, version)
            previous = state["currentVersion"]
            self._write_state(
                component_id,
                state,
                currentVersion=version,
                previousVersion=previous,
                pendingVersion=None,
                rejectedVersion=None,
            )
            return self.snapshot(component_id)

    def reject(self, component_id: str, version: str) -> dict[str, Any]:
        component_id = _validate_component_id(component_id)
        version = _validate_version(version)
        with self._lock:
            state = self._read_state(component_id)
            if state["pendingVersion"] != version:
                raise ComponentSlotConflict("rejection requires the exact pending version")
            self._write_state(
                component_id,
                state,
                pendingVersion=None,
                rejectedVersion=version,
            )
            return self.snapshot(component_id)

    def rollback(self, component_id: str) -> dict[str, Any]:
        component_id = _validate_component_id(component_id)
        with self._lock:
            state = self._read_state(component_id)
            previous = state["previousVersion"]
            if previous is None:
                raise ComponentSlotConflict("component has no previous slot")
            self._verified.pop((component_id, previous), None)
            self._verified_package_manifest(component_id, previous)
            rejected = state["currentVersion"]
            self._write_state(
                component_id,
                state,
                currentVersion=previous,
                previousVersion=None,
                pendingVersion=None,
                rejectedVersion=rejected,
            )
            return self.snapshot(component_id)

    def entrypoint_url(
        self,
        component_id: str,
        version: str,
        entrypoint: str,
    ) -> str:
        component_id = _validate_component_id(component_id)
        version = _validate_version(version)
        entrypoint = _safe_relative_path(entrypoint)
        return f"/__ordax/component/{component_id}/{version}/{entrypoint}"

    def read_asset(
        self,
        component_id: str,
        version: str,
        relative_path: str,
    ) -> tuple[str, bytes]:
        component_id = _validate_component_id(component_id)
        version = _validate_version(version)
        relative_path = _safe_relative_path(relative_path)
        with self._lock:
            state = self._read_state(component_id)
            allowed = {
                state["currentVersion"],
                state["previousVersion"],
                state["pendingVersion"],
            }
            if version not in allowed:
                raise ComponentSlotNotFound("component version is not in an active slot role")
            verified = self._verified_package_manifest(component_id, version)
            binding = verified["files"].get(relative_path)
            if binding is None:
                raise ComponentSlotNotFound("component asset is not package-bound")
            payload = _read_asset_no_symlink(
                verified["stagePath"],
                relative_path,
            )
            if (
                len(payload) != binding["size"]
                or hashlib.sha256(payload).hexdigest() != binding["sha256"]
            ):
                self._verified.pop((component_id, version), None)
                raise ComponentSlotError("component asset integrity changed after verification")
            return MIME_TYPES[PurePosixPath(relative_path).suffix.lower()], payload
