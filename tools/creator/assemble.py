#!/usr/bin/env python3
"""Assemble the source-controlled OrdaX Creator payload from verified candidates."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "docs" / "contracts" / "minimal-bootstrap.json"
DEFAULT_OUT = ROOT / "out" / "creator-payload"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

# Generated payload paths are intentionally different from transient build-output
# paths. The manifest names stable payload paths; this map is the only adapter
# from repository build outputs to those payload names.
GENERATED_SOURCES = {
    "boot/esp/EFI/BOOT/BOOTX64.EFI": "out/esp/systemd-bootx64.efi",
    "bootstrap/kernel/vmlinuz-6.6.52": "out/kernel/vmlinuz-6.6.52",
    "bootstrap/initramfs/initramfs.cpio.gz": "out/initramfs/initramfs.cpio.gz",
    "bootstrap/network/bin/netbox": "out/network-bootstrap/netbox",
    "bootstrap/release-acquisition/ordax-release-agent": "out/release-acquisition/ordax-release-agent",
}


class AssembleError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_relative(value: str) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value:
        raise AssembleError(f"unsafe payload source path: {value!r}")
    pure = PurePosixPath(value)
    if pure.is_absolute() or pure.as_posix() != value or any(part in ("", ".", "..") for part in pure.parts):
        raise AssembleError(f"unsafe payload source path: {value!r}")
    return pure


def real_regular_file(root: Path, relative: str) -> Path:
    pure = safe_relative(relative)
    root = root.resolve()
    current = root
    for index, part in enumerate(pure.parts):
        current = current / part
        try:
            info = current.lstat()
        except OSError as exc:
            raise AssembleError(f"source artifact missing: {relative}: {exc}") from exc
        if current.is_symlink():
            raise AssembleError(f"source artifact traverses a symlink: {relative}")
        if index < len(pure.parts) - 1 and not current.is_dir():
            raise AssembleError(f"source artifact has a non-directory parent: {relative}")
        if index == len(pure.parts) - 1 and not current.is_file():
            raise AssembleError(f"source artifact is not a regular file: {relative}")
    return current


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AssembleError(f"cannot read manifest: {exc}") from exc
    if manifest.get("$schema") != "prototype-ordax.minimal-bootstrap/4":
        raise AssembleError("unexpected minimal-bootstrap schema")
    if manifest.get("physical_write_allowed") is not False:
        raise AssembleError("candidate payload assembler refuses a physically authorized manifest")
    groups = manifest.get("artifact_groups")
    if not isinstance(groups, list) or not groups:
        raise AssembleError("manifest has no artifact groups")
    return manifest


def source_for_artifact(repository_root: Path, source_path: str, generated_sources: dict[str, str]) -> Path:
    if source_path in generated_sources:
        return real_regular_file(repository_root, generated_sources[source_path])
    return real_regular_file(repository_root, source_path)


def prepare_empty_output(out_dir: Path) -> Path:
    out_dir = out_dir.resolve()
    if out_dir.exists():
        if out_dir.is_symlink() or not out_dir.is_dir():
            raise AssembleError("payload output must be a real directory")
        try:
            next(out_dir.iterdir())
        except StopIteration:
            return out_dir
        raise AssembleError("payload output must be empty")
    out_dir.mkdir(parents=True, mode=0o755)
    return out_dir


def source_commit(repository_root: Path) -> str:
    github_sha = os.environ.get("GITHUB_SHA", "").lower()
    if re.fullmatch(r"[0-9a-f]{40}", github_sha):
        return github_sha
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repository_root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except Exception:
        return "unknown"


def assemble(
    repository_root: Path,
    manifest: dict[str, Any],
    out_dir: Path,
    *,
    allow_unresolved: bool,
    generated_sources: dict[str, str] | None = None,
) -> dict[str, Any]:
    generated_sources = dict(GENERATED_SOURCES if generated_sources is None else generated_sources)
    out_dir = prepare_empty_output(out_dir)
    unresolved: list[str] = []
    artifacts: dict[str, dict[str, Any]] = {}
    seen_targets: set[tuple[str, str]] = set()

    groups = manifest["artifact_groups"]
    for group in groups:
        group_id = group.get("id")
        partition = group.get("partition")
        resolved = group.get("resolved")
        declared = group.get("artifacts")
        if not isinstance(group_id, str) or not group_id or partition not in ("ORDAX-ESP", "ORDAX"):
            raise AssembleError("artifact group identity is invalid")
        if not isinstance(declared, list):
            raise AssembleError(f"artifact group {group_id!r} has invalid artifacts")
        if resolved is not True:
            unresolved.append(group_id)
            if declared:
                raise AssembleError(f"unresolved group {group_id!r} may not carry candidate payload bytes")
            continue
        if not declared:
            raise AssembleError(f"resolved group {group_id!r} has no artifacts")

        for artifact in declared:
            source_path = artifact.get("source_path")
            target_path = artifact.get("target_path")
            expected = artifact.get("sha256")
            mode_text = artifact.get("mode")
            safe_relative(source_path)
            if not isinstance(target_path, str) or not target_path.startswith("/"):
                raise AssembleError(f"invalid target path for {source_path!r}")
            if not SHA256_RE.fullmatch(str(expected or "")):
                raise AssembleError(f"invalid SHA-256 for {source_path!r}")
            if not isinstance(mode_text, str) or not re.fullmatch(r"0[0-7]{3}", mode_text):
                raise AssembleError(f"invalid mode for {source_path!r}")
            target_key = (partition, target_path)
            if target_key in seen_targets:
                raise AssembleError(f"duplicate target {target_path!r} on {partition}")
            seen_targets.add(target_key)

            source = source_for_artifact(repository_root, source_path, generated_sources)
            actual = sha256_file(source)
            if actual != expected:
                raise AssembleError(
                    f"source artifact SHA-256 mismatch: {source_path}: expected={expected} actual={actual}"
                )

            destination = out_dir.joinpath(*PurePosixPath(source_path).parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists() or destination.is_symlink():
                raise AssembleError(f"duplicate payload source path: {source_path}")
            with source.open("rb") as input_handle, destination.open("xb") as output_handle:
                shutil.copyfileobj(input_handle, output_handle, length=1024 * 1024)
                output_handle.flush()
                os.fsync(output_handle.fileno())
            destination.chmod(int(mode_text, 8))
            copied = sha256_file(destination)
            if copied != expected:
                raise AssembleError(f"payload copy SHA-256 mismatch: {source_path}")

            artifacts[source_path] = {
                "sha256": copied,
                "size": destination.stat().st_size,
                "mode": mode_text,
                "partition": partition,
                "target_path": target_path,
                "logical_owner": artifact.get("logical_owner"),
            }

    all_groups_resolved = not unresolved
    manifest_flag = manifest.get("all_artifacts_resolved") is True
    if manifest_flag != all_groups_resolved:
        raise AssembleError(
            "all_artifacts_resolved disagrees with artifact-group resolution state"
        )
    if unresolved and not allow_unresolved:
        raise AssembleError(
            "manifest still has unresolved groups: " + ", ".join(unresolved)
        )

    provenance = {
        "$schema": "prototype-ordax.creator-payload-provenance/1",
        "status": "complete-candidate" if all_groups_resolved else "resolved-subset-candidate",
        "physical_write_authorized": False,
        "source_commit": source_commit(repository_root),
        "manifest_schema": manifest["$schema"],
        "manifest_all_artifacts_resolved": manifest_flag,
        "artifact_count": len(artifacts),
        "unresolved_groups": unresolved,
        "artifacts": dict(sorted(artifacts.items())),
    }
    provenance_path = out_dir / "payload-provenance.json"
    provenance_path.write_text(
        json.dumps(provenance, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return provenance


def verify(
    repository_root: Path,
    manifest: dict[str, Any],
    payload_root: Path,
    *,
    allow_unresolved: bool,
) -> dict[str, Any]:
    payload_root = payload_root.resolve()
    provenance_path = real_regular_file(payload_root, "payload-provenance.json")
    try:
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AssembleError(f"cannot read payload provenance: {exc}") from exc
    if provenance.get("$schema") != "prototype-ordax.creator-payload-provenance/1":
        raise AssembleError("unexpected payload provenance schema")
    if provenance.get("physical_write_authorized") is not False:
        raise AssembleError("candidate payload provenance must remain physically unauthorized")

    unresolved = [group["id"] for group in manifest["artifact_groups"] if group.get("resolved") is not True]
    if unresolved and not allow_unresolved:
        raise AssembleError("payload is incomplete because manifest groups remain unresolved")
    if provenance.get("unresolved_groups") != unresolved:
        raise AssembleError("payload provenance unresolved-group list is stale")

    expected_artifacts: dict[str, dict[str, Any]] = {}
    for group in manifest["artifact_groups"]:
        if group.get("resolved") is not True:
            if group.get("artifacts"):
                raise AssembleError(f"unresolved group {group.get('id')!r} carries payload bytes")
            continue
        for artifact in group.get("artifacts", []):
            expected_artifacts[artifact["source_path"]] = artifact

    if set(provenance.get("artifacts", {})) != set(expected_artifacts):
        raise AssembleError("payload provenance artifact set disagrees with manifest")
    for source_path, artifact in expected_artifacts.items():
        path = real_regular_file(payload_root, source_path)
        actual = sha256_file(path)
        if actual != artifact["sha256"]:
            raise AssembleError(f"payload artifact SHA-256 mismatch: {source_path}")
        recorded = provenance["artifacts"][source_path]
        if recorded.get("sha256") != actual or recorded.get("size") != path.stat().st_size:
            raise AssembleError(f"payload provenance mismatch: {source_path}")

    return {
        "status": "verified",
        "artifact_count": len(expected_artifacts),
        "unresolved_groups": unresolved,
        "physical_write_authorized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("build", "verify"):
        command = sub.add_parser(name)
        command.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
        command.add_argument("--allow-unresolved", action="store_true")
        if name == "build":
            command.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
        else:
            command.add_argument("--payload-root", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    try:
        manifest = load_manifest(args.manifest.resolve())
        if args.command == "build":
            result = assemble(
                ROOT,
                manifest,
                args.out_dir,
                allow_unresolved=args.allow_unresolved,
            )
        else:
            result = verify(
                ROOT,
                manifest,
                args.payload_root,
                allow_unresolved=args.allow_unresolved,
            )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (AssembleError, OSError, KeyError, ValueError) as exc:
        print(f"creator-payload: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
