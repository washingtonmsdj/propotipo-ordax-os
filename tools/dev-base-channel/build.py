#!/usr/bin/env python3
"""Build/verify an immutable development Base descriptor from CI-built bytes."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys

SCHEMA = "prototype-ordax.dev-base-candidate/1"
REPOSITORY = "washingtonmsdj/prototipo-ordax-os"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_KERNEL_BYTES = 64 * 1024 * 1024
MAX_INITRAMFS_BYTES = 128 * 1024 * 1024


class CandidateError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def regular_file(path: Path, label: str, max_bytes: int) -> Path:
    if path.is_symlink() or not path.is_file():
        raise CandidateError(f"{label} is missing or unsafe")
    size = path.stat().st_size
    if size <= 0 or size > max_bytes:
        raise CandidateError(f"{label} size is outside allowed range")
    return path


def read_json(path: Path, label: str) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise CandidateError(f"{label} is missing or unsafe")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CandidateError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict):
        raise CandidateError(f"{label} must be an object")
    return value


def artifact_from_provenance(
    provenance: dict,
    directory: Path,
    *,
    source_commit: str,
    artifact_name: str | None = None,
    artifact_prefix: str | None = None,
    max_bytes: int,
) -> Path:
    if provenance.get("source_commit") != source_commit:
        raise CandidateError("build provenance source commit does not match candidate")
    artifacts = provenance.get("artifacts")
    if not isinstance(artifacts, dict) or not artifacts:
        raise CandidateError("build provenance artifact map is invalid")
    if artifact_name is not None:
        names = [artifact_name] if artifact_name in artifacts else []
    else:
        names = [name for name in artifacts if name.startswith(artifact_prefix or "")]
    if len(names) != 1:
        raise CandidateError("build provenance does not bind exactly one requested artifact")
    name = names[0]
    expected = artifacts.get(name)
    if not isinstance(expected, str) or SHA256_RE.fullmatch(expected) is None:
        raise CandidateError("build provenance artifact hash is invalid")
    path = regular_file(directory / name, f"candidate artifact {name}", max_bytes)
    if sha256_file(path) != expected:
        raise CandidateError(f"candidate artifact {name} differs from provenance")
    return path


def binding(name: str, path: Path, source_commit: str) -> dict:
    tag = f"ordax-dev-base-{source_commit}"
    return {
        "name": name,
        "url": (
            f"https://github.com/{REPOSITORY}/releases/download/"
            f"{tag}/{name}"
        ),
        "sha256": sha256_file(path),
        "size": path.stat().st_size,
    }


def build(
    *,
    source_commit: str,
    kernel_dir: Path,
    initramfs_dir: Path,
    out_dir: Path,
) -> dict:
    if SHA40_RE.fullmatch(source_commit) is None:
        raise CandidateError("source commit must be lowercase 40-hex")

    kernel_provenance = read_json(
        kernel_dir / "kernel-provenance.json",
        "kernel provenance",
    )
    initramfs_provenance = read_json(
        initramfs_dir / "initramfs-provenance.json",
        "initramfs provenance",
    )
    kernel = artifact_from_provenance(
        kernel_provenance,
        kernel_dir,
        source_commit=source_commit,
        artifact_prefix="vmlinuz-",
        max_bytes=MAX_KERNEL_BYTES,
    )
    initramfs = artifact_from_provenance(
        initramfs_provenance,
        initramfs_dir,
        source_commit=source_commit,
        artifact_name="initramfs.cpio.gz",
        max_bytes=MAX_INITRAMFS_BYTES,
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    for child in out_dir.iterdir():
        raise CandidateError(f"output directory must be empty: {child.name}")

    kernel_out = out_dir / "vmlinuz"
    initramfs_out = out_dir / "initrd.gz"
    shutil.copyfile(kernel, kernel_out)
    shutil.copyfile(initramfs, initramfs_out)

    tag = f"ordax-dev-base-{source_commit}"
    descriptor = {
        "$schema": SCHEMA,
        "status": "development-candidate",
        "source_repository": REPOSITORY,
        "source_commit": source_commit,
        "tag": tag,
        "activation": "inactive-slot-next-boot",
        "manual_usb_rewrite_required": False,
        "kernel": binding("vmlinuz", kernel_out, source_commit),
        "initramfs": binding("initrd.gz", initramfs_out, source_commit),
    }
    (out_dir / "dev-base.json").write_text(
        json.dumps(descriptor, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    verify(out_dir)
    return descriptor


def validate_binding(value: object, expected_name: str, source_commit: str) -> dict:
    if not isinstance(value, dict) or set(value) != {"name", "url", "sha256", "size"}:
        raise CandidateError(f"{expected_name} binding is malformed")
    if value["name"] != expected_name:
        raise CandidateError(f"{expected_name} binding name is invalid")
    tag = f"ordax-dev-base-{source_commit}"
    expected_url = (
        f"https://github.com/{REPOSITORY}/releases/download/{tag}/{expected_name}"
    )
    if value["url"] != expected_url:
        raise CandidateError(f"{expected_name} binding URL is not canonical")
    if not isinstance(value["sha256"], str) or SHA256_RE.fullmatch(value["sha256"]) is None:
        raise CandidateError(f"{expected_name} binding hash is invalid")
    if not isinstance(value["size"], int) or isinstance(value["size"], bool) or value["size"] <= 0:
        raise CandidateError(f"{expected_name} binding size is invalid")
    return value


def validate_descriptor(value: object) -> dict:
    expected = {
        "$schema",
        "status",
        "source_repository",
        "source_commit",
        "tag",
        "activation",
        "manual_usb_rewrite_required",
        "kernel",
        "initramfs",
    }
    if not isinstance(value, dict) or set(value) != expected:
        raise CandidateError("development Base descriptor fields are not canonical")
    if value["$schema"] != SCHEMA or value["status"] != "development-candidate":
        raise CandidateError("unsupported development Base descriptor")
    if value["source_repository"] != REPOSITORY:
        raise CandidateError("development Base source repository is invalid")
    source_commit = value["source_commit"]
    if not isinstance(source_commit, str) or SHA40_RE.fullmatch(source_commit) is None:
        raise CandidateError("development Base source commit is invalid")
    if value["tag"] != f"ordax-dev-base-{source_commit}":
        raise CandidateError("development Base tag is invalid")
    if value["activation"] != "inactive-slot-next-boot":
        raise CandidateError("development Base activation policy is invalid")
    if value["manual_usb_rewrite_required"] is not False:
        raise CandidateError("development Base unexpectedly requires USB rewrite")
    validate_binding(value["kernel"], "vmlinuz", source_commit)
    validate_binding(value["initramfs"], "initrd.gz", source_commit)
    return value


def verify(out_dir: Path) -> dict:
    descriptor = validate_descriptor(
        read_json(out_dir / "dev-base.json", "development Base descriptor")
    )
    for key, max_bytes in (
        ("kernel", MAX_KERNEL_BYTES),
        ("initramfs", MAX_INITRAMFS_BYTES),
    ):
        item = descriptor[key]
        path = regular_file(
            out_dir / item["name"],
            f"development Base {key}",
            max_bytes,
        )
        if path.stat().st_size != item["size"] or sha256_file(path) != item["sha256"]:
            raise CandidateError(f"development Base {key} differs from descriptor")
    return descriptor


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--source-commit", required=True)
    build_parser.add_argument("--kernel-dir", type=Path, default=Path("out/kernel"))
    build_parser.add_argument("--initramfs-dir", type=Path, default=Path("out/initramfs"))
    build_parser.add_argument("--out-dir", type=Path, default=Path("out/dev-base"))
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--out-dir", type=Path, default=Path("out/dev-base"))
    args = parser.parse_args()
    try:
        if args.command == "check":
            print("DEV_BASE_CHANNEL_CONTRACT=PASS")
            return 0
        if args.command == "build":
            result = build(
                source_commit=args.source_commit,
                kernel_dir=args.kernel_dir,
                initramfs_dir=args.initramfs_dir,
                out_dir=args.out_dir,
            )
        else:
            result = verify(args.out_dir)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (CandidateError, OSError) as exc:
        print(f"dev-base-candidate: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
