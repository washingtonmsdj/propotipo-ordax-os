#!/usr/bin/env python3
"""Evaluate candidate-boot health and promote an OrdaX A/B base slot safely.

Promotion is fail-closed. The known-good current entry remains untouched unless
cmdline identity, base heartbeat, Git release identity, Surface health and
current boot identity all agree.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

HERE = Path(__file__).resolve().parent
_ACTIVATE_SPEC = importlib.util.spec_from_file_location(
    "ordax_base_update_activate", HERE / "activate.py"
)
_activate = importlib.util.module_from_spec(_ACTIVATE_SPEC)
assert _ACTIVATE_SPEC.loader is not None
_ACTIVATE_SPEC.loader.exec_module(_activate)

SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
BOOT_ID_RE = re.compile(r"^[0-9a-f]{32}$")
SLOTS = ("a", "b")
CURRENT_ENTRY = Path("loader/entries/ordax.conf")
RECOVERY_ENTRY = Path("loader/entries/ordax-recovery.conf")
ACTIVE_RECORD_RELATIVE = Path("base/active-slot.json")
BOOT_REFRESH_RELATIVE = Path("boot-refresh-required")


class PromotionError(RuntimeError):
    pass


def load_json(path: Path, max_bytes: int = 16 * 1024) -> dict:
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise PromotionError(f"cannot read {path.name}") from exc
    if len(payload) > max_bytes:
        raise PromotionError(f"{path.name} is unexpectedly large")
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise PromotionError(f"invalid JSON in {path.name}") from exc
    if not isinstance(value, dict):
        raise PromotionError(f"{path.name} must contain an object")
    return value


def parse_cmdline(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for token in text.split():
        key, separator, value = token.partition("=")
        if not separator or key not in {"ordax.base_slot", "ordax.base_candidate"}:
            continue
        if key in values:
            raise PromotionError(f"duplicate kernel option: {key}")
        values[key] = value
    slot = values.get("ordax.base_slot", "")
    release_sha = values.get("ordax.base_candidate", "")
    if slot not in SLOTS:
        raise PromotionError("candidate boot slot is missing or invalid")
    if not SHA40_RE.fullmatch(release_sha):
        raise PromotionError("candidate boot release identity is missing or invalid")
    return {"slot": slot, "release_sha": release_sha}


def validate_boot_id(value: str) -> str:
    if not isinstance(value, str) or BOOT_ID_RE.fullmatch(value) is None:
        raise PromotionError("boot id is invalid")
    return value


def validate_base_heartbeat(value: dict) -> dict:
    expected = {"$schema", "candidateSha", "sourceSha", "slot", "bootId"}
    if set(value) != expected:
        raise PromotionError("base heartbeat shape is invalid")
    if value.get("$schema") != "prototype-ordax.base-heartbeat/1":
        raise PromotionError("base heartbeat schema is invalid")
    for key in ("candidateSha", "sourceSha"):
        if not isinstance(value.get(key), str) or not SHA40_RE.fullmatch(value[key]):
            raise PromotionError(f"base heartbeat {key} is invalid")
    if value.get("slot") not in SLOTS:
        raise PromotionError("base heartbeat slot is invalid")
    validate_boot_id(value.get("bootId"))
    return value


def validate_surface_heartbeat(value: dict) -> dict:
    expected = {"sourceSha", "bootId", "observedEpoch"}
    if set(value) != expected:
        raise PromotionError("Surface heartbeat shape is invalid")
    if not isinstance(value.get("sourceSha"), str) or not SHA40_RE.fullmatch(value["sourceSha"]):
        raise PromotionError("Surface heartbeat release identity is invalid")
    validate_boot_id(value.get("bootId"))
    observed = value.get("observedEpoch")
    if isinstance(observed, bool) or not isinstance(observed, int) or observed < 0:
        raise PromotionError("Surface heartbeat observation is invalid")
    return value


def evaluate_health(
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
    if not SHA40_RE.fullmatch(expected_release_sha):
        raise PromotionError("expected release SHA is invalid")
    if expected_candidate_slot not in SLOTS or previous_slot not in SLOTS:
        raise PromotionError("slot expectation is invalid")
    if expected_candidate_slot == previous_slot:
        raise PromotionError("candidate and previous slots must differ")
    if not SHA40_RE.fullmatch(source_sha):
        raise PromotionError("current checkout SHA is invalid")
    if not SHA40_RE.fullmatch(healthy_sha):
        raise PromotionError("Surface health SHA is invalid")

    current_boot_id = validate_boot_id(boot_id)
    identity = parse_cmdline(cmdline)
    base = validate_base_heartbeat(base_heartbeat)
    surface = validate_surface_heartbeat(surface_heartbeat)

    comparisons = {
        "cmdline_release": identity["release_sha"] == expected_release_sha,
        "cmdline_slot": identity["slot"] == expected_candidate_slot,
        "base_candidate_release": base["candidateSha"] == expected_release_sha,
        "base_source_release": base["sourceSha"] == expected_release_sha,
        "base_slot": base["slot"] == expected_candidate_slot,
        "base_current_boot": base["bootId"] == current_boot_id,
        "checkout_release": source_sha == expected_release_sha,
        "surface_health_release": healthy_sha == expected_release_sha,
        "surface_heartbeat_release": surface["sourceSha"] == expected_release_sha,
        "surface_current_boot": surface["bootId"] == current_boot_id,
    }
    failed = sorted(key for key, passed in comparisons.items() if not passed)
    if failed:
        raise PromotionError("candidate health mismatch: " + ",".join(failed))

    return {
        "$schema": "prototype-ordax.base-update-health/1",
        "release_sha": expected_release_sha,
        "candidate_slot": expected_candidate_slot,
        "previous_slot": previous_slot,
        "boot_id": current_boot_id,
        "checks": comparisons,
        "healthy": True,
    }


def locate_candidate_entry(esp_root: Path) -> Path:
    entries = esp_root / "loader" / "entries"
    candidates = []
    try:
        paths = sorted(entries.glob("ordax-candidate+*.conf"))
    except OSError as exc:
        raise PromotionError("cannot inspect candidate boot entries") from exc
    for path in paths:
        try:
            metadata = path.lstat()
        except OSError:
            continue
        if stat.S_ISREG(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode):
            candidates.append(path)
    if len(candidates) != 1:
        raise PromotionError("exactly one boot-counted candidate entry is required")
    return candidates[0]


def validate_candidate_entry(
    candidate: Path,
    release_sha: str,
    candidate_slot: str,
) -> None:
    values = _activate.read_entry(candidate)
    linux = _activate.single(values, "linux")
    initrd = _activate.single(values, "initrd")
    options = set(_activate.single(values, "options").split())
    if linux != f"/ordax/base/{candidate_slot}/vmlinuz":
        raise PromotionError("candidate kernel target does not match healthy slot")
    if initrd != f"/ordax/base/{candidate_slot}/initrd.gz":
        raise PromotionError("candidate initramfs target does not match healthy slot")
    required = {
        "ordax.mode=normal",
        f"ordax.base_slot={candidate_slot}",
        f"ordax.base_candidate={release_sha}",
    }
    if not required.issubset(options):
        raise PromotionError("candidate boot entry identity does not match health proof")


def entry_payload(title: str, slot: str, mode: str) -> bytes:
    if slot not in SLOTS or mode not in {"normal", "recovery"}:
        raise PromotionError("invalid promoted boot entry")
    return (
        f"title {title}\n"
        f"linux /ordax/base/{slot}/vmlinuz\n"
        f"initrd /ordax/base/{slot}/initrd.gz\n"
        f"options console=tty0 ordax.mode={mode} ordax.base_slot={slot}\n"
    ).encode("utf-8")


def fsync_directory(path: Path) -> None:
    descriptor = os.open(
        path,
        os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_replace_regular(root: Path, relative: Path, payload: bytes) -> None:
    target = root / relative
    try:
        existing = target.lstat()
    except OSError as exc:
        raise PromotionError(f"protected boot entry missing: {relative.name}") from exc
    if stat.S_ISLNK(existing.st_mode) or not stat.S_ISREG(existing.st_mode):
        raise PromotionError(f"protected boot entry is unsafe: {relative.name}")

    temporary = target.with_name(f".{target.name}.ordax-promote-{os.getpid()}")
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        descriptor = os.open(temporary, flags, 0o644)
        try:
            offset = 0
            while offset < len(payload):
                written = os.write(descriptor, payload[offset:])
                if written <= 0:
                    raise PromotionError("short write while promoting boot entry")
                offset += written
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.replace(temporary, target)
        fsync_directory(target.parent)
    except Exception:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise


def commit_current_entry(root: Path, payload: bytes) -> bool:
    target = root / CURRENT_ENTRY
    try:
        existing = target.lstat()
    except OSError as exc:
        raise PromotionError("protected current boot entry is missing") from exc
    if stat.S_ISLNK(existing.st_mode) or not stat.S_ISREG(existing.st_mode):
        raise PromotionError("protected current boot entry is unsafe")

    temporary = target.with_name(f".{target.name}.ordax-commit-{os.getpid()}")
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    replaced = False
    try:
        descriptor = os.open(temporary, flags, 0o644)
        try:
            offset = 0
            while offset < len(payload):
                written = os.write(descriptor, payload[offset:])
                if written <= 0:
                    raise PromotionError("short write while preparing current boot entry")
                offset += written
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

        os.replace(temporary, target)
        replaced = True
        try:
            fsync_directory(target.parent)
            return True
        except OSError:
            # The atomic replace already committed the new default entry. Report
            # durability uncertainty without pretending promotion did not occur.
            return False
    except Exception:
        if not replaced:
            try:
                temporary.unlink()
            except OSError:
                pass
        raise


def prepare_active_record(
    state_root: Path,
    release_sha: str,
    active_slot: str,
    recovery_slot: str,
    boot_id: str,
) -> tuple[Path, Path]:
    root = state_root.resolve()
    if not root.is_dir() or state_root.is_symlink():
        raise PromotionError("state root must be an existing non-symlink directory")
    target = root / ACTIVE_RECORD_RELATIVE
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.parent.is_symlink():
        raise PromotionError("active-slot state directory is unsafe")
    try:
        existing = target.lstat()
    except FileNotFoundError:
        existing = None
    except OSError as exc:
        raise PromotionError("cannot inspect active-slot state record") from exc
    if existing is not None and (stat.S_ISLNK(existing.st_mode) or not stat.S_ISREG(existing.st_mode)):
        raise PromotionError("active-slot state record is unsafe")

    payload = {
        "$schema": "prototype-ordax.base-active-slot/1",
        "releaseSha": release_sha,
        "activeSlot": active_slot,
        "recoverySlot": recovery_slot,
        "bootId": boot_id,
    }
    temporary = target.with_name(f".{target.name}.prepared-{os.getpid()}")
    try:
        with open(temporary, "x", encoding="utf-8") as handle:
            os.fchmod(handle.fileno(), 0o600)
            json.dump(payload, handle, separators=(",", ":"), sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        fsync_directory(target.parent)
        return temporary, target
    except Exception:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise


def discard_prepared_active_record(temporary: Path) -> None:
    try:
        temporary.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        pass


def finalize_active_record(temporary: Path, target: Path) -> bool:
    try:
        os.replace(temporary, target)
        fsync_directory(target.parent)
        return True
    except OSError:
        discard_prepared_active_record(temporary)
        return False


def clear_boot_refresh_marker(state_root: Path) -> str:
    root = state_root.resolve()
    marker = root / BOOT_REFRESH_RELATIVE
    try:
        metadata = marker.lstat()
    except FileNotFoundError:
        return "absent"
    except OSError:
        return "error"

    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        return "unsafe"

    try:
        marker.unlink()
        fsync_directory(root)
        return "cleared"
    except OSError:
        return "error"


def promote(
    *,
    esp_root: Path,
    state_root: Path,
    health: dict,
) -> dict:
    if health.get("$schema") != "prototype-ordax.base-update-health/1" or health.get("healthy") is not True:
        raise PromotionError("a validated healthy candidate proof is required")
    release_sha = health.get("release_sha")
    candidate_slot = health.get("candidate_slot")
    previous_slot = health.get("previous_slot")
    boot_id = health.get("boot_id")
    if (
        not isinstance(release_sha, str)
        or not SHA40_RE.fullmatch(release_sha)
        or candidate_slot not in SLOTS
        or previous_slot not in SLOTS
        or candidate_slot == previous_slot
    ):
        raise PromotionError("healthy candidate proof is malformed")
    validate_boot_id(boot_id)

    root = esp_root.resolve()
    if not root.is_dir() or root.is_symlink():
        raise PromotionError("ESP root must be an existing directory")
    candidate = locate_candidate_entry(root)
    validate_candidate_entry(candidate, release_sha, candidate_slot)

    state_root_resolved = state_root.resolve()
    active_temporary, active_target = prepare_active_record(
        state_root,
        release_sha,
        candidate_slot,
        previous_slot,
        boot_id,
    )

    committed = False
    try:
        # Every fallible cleanup required for safe future boot selection happens
        # before CURRENT_ENTRY is replaced. Until that final replace, the
        # previous/default slot remains authoritative.
        atomic_replace_regular(
            root,
            RECOVERY_ENTRY,
            entry_payload("OrdaX Recovery", previous_slot, "recovery"),
        )
        try:
            candidate.unlink()
            fsync_directory(candidate.parent)
        except OSError as exc:
            raise PromotionError("candidate entry could not be removed before promotion commit") from exc

        # This is the promotion commit point. No mandatory operation after this
        # line is allowed to turn the already-promoted boot configuration into
        # a reported pre-commit failure.
        current_entry_durable = commit_current_entry(
            root,
            entry_payload("OrdaX", candidate_slot, "normal"),
        )
        committed = True
    finally:
        if not committed:
            discard_prepared_active_record(active_temporary)

    active_record_written = finalize_active_record(active_temporary, active_target)
    boot_refresh_status = clear_boot_refresh_marker(state_root_resolved)

    return {
        "$schema": "prototype-ordax.base-update-promotion-result/1",
        "release_sha": release_sha,
        "active_slot": candidate_slot,
        "recovery_slot": previous_slot,
        "current_entry": "/" + CURRENT_ENTRY.as_posix(),
        "recovery_entry": "/" + RECOVERY_ENTRY.as_posix(),
        "current_entry_durable": current_entry_durable,
        "candidate_entry_removed": True,
        "active_slot_record_written": active_record_written,
        "boot_refresh_marker_status": boot_refresh_status,
        "boot_refresh_marker_cleared": boot_refresh_status in {"cleared", "absent"},
        "reboot_requested": False,
        "promoted": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--esp-root", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--cmdline", type=Path, default=Path("/proc/cmdline"))
    parser.add_argument("--boot-id", type=Path, default=Path("/run/ordax-update/base-boot-id"))
    parser.add_argument("--base-heartbeat", type=Path, required=True)
    parser.add_argument("--surface-heartbeat", type=Path, required=True)
    parser.add_argument("--healthy-sha", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--expected-release-sha", required=True)
    parser.add_argument("--candidate-slot", choices=SLOTS, required=True)
    parser.add_argument("--previous-slot", choices=SLOTS, required=True)
    args = parser.parse_args()
    try:
        health = evaluate_health(
            cmdline=args.cmdline.read_text(encoding="utf-8"),
            boot_id=args.boot_id.read_text(encoding="utf-8").strip(),
            source_sha=args.source_sha,
            healthy_sha=args.healthy_sha.read_text(encoding="utf-8").strip(),
            base_heartbeat=load_json(args.base_heartbeat),
            surface_heartbeat=load_json(args.surface_heartbeat),
            expected_release_sha=args.expected_release_sha,
            expected_candidate_slot=args.candidate_slot,
            previous_slot=args.previous_slot,
        )
        result = promote(esp_root=args.esp_root, state_root=args.state_root, health=health)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (OSError, UnicodeError, PromotionError, _activate.ActivateError) as exc:
        print(f"base-update-promote: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
