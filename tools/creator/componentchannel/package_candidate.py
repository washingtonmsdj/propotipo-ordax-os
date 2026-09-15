#!/usr/bin/env python3
"""Package one read-only Creator inspection component for offline Ed25519 signing."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import zipfile

MANIFEST_SCHEMA = "prototype-ordax.creator-component-manifest/1"
PURPOSE = "creator-inspection-windows-amd64"
SOURCE_REPOSITORY = "washingtonmsdj/prototipo-ordax-os"
RECIPE = "creator/component/windows/1"
BUNDLE_NAME = "ordax-creator-components-windows-amd64.zip"
COMPONENT_NAME = "ordax-creator-physical-test.exe"
MANIFEST_NAME = "creator-component-manifest.json"
BUNDLE_URL = (
    "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/"
    "creator-components/ordax-creator-components-windows-amd64.zip"
)
MAX_COMPONENT_BYTES = 32 << 20
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


class PackagingError(RuntimeError):
    pass


def _regular_file(path: Path) -> Path:
    absolute = path.expanduser().resolve(strict=False)
    try:
        info = path.lstat()
    except OSError as exc:
        raise PackagingError(f"component executable is unavailable: {path}: {exc}") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise PackagingError("component executable must be a regular non-symlink file")
    if info.st_size <= 0 or info.st_size > MAX_COMPONENT_BYTES:
        raise PackagingError(f"component executable size outside allowed range: {info.st_size}")
    resolved = path.resolve(strict=True)
    if resolved != absolute:
        raise PackagingError("component executable path resolution changed unexpectedly")
    return resolved


def _real_output_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise PackagingError("output directory must be a real non-symlink directory")
    return path.resolve(strict=True)


def _digest(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
            size += len(chunk)
    return h.hexdigest(), size


def package_candidate(
    executable: Path,
    output_dir: Path,
    version: str,
    release_sequence: int,
    source_commit: str,
) -> dict[str, object]:
    if not COMMIT_RE.fullmatch(source_commit):
        raise PackagingError("source commit must be lowercase 40-hex")
    if not VERSION_RE.fullmatch(version):
        raise PackagingError("component version is invalid")
    if isinstance(release_sequence, bool) or not isinstance(release_sequence, int) or release_sequence <= 0:
        raise PackagingError("release sequence must be a positive integer")

    executable = _regular_file(executable)
    output_dir = _real_output_dir(output_dir)
    bundle = output_dir / BUNDLE_NAME
    manifest_path = output_dir / MANIFEST_NAME
    for output in (bundle, manifest_path):
        if output.exists() or output.is_symlink():
            raise PackagingError(f"refusing to replace existing output: {output}")

    component_sha, component_size = _digest(executable)

    info = zipfile.ZipInfo(COMPONENT_NAME, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    info.create_system = 3
    info.external_attr = 0o100755 << 16
    info.flag_bits = 0
    try:
        with zipfile.ZipFile(bundle, "x", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            with executable.open("rb") as source, archive.open(info, "w", force_zip64=True) as target:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    target.write(chunk)
        bundle_sha, bundle_size = _digest(bundle)
        manifest: dict[str, object] = {
            "$schema": MANIFEST_SCHEMA,
            "purpose": PURPOSE,
            "source_repository": SOURCE_REPOSITORY,
            "source_commit": source_commit,
            "version": version,
            "release_sequence": release_sequence,
            "created_from_recipe": RECIPE,
            "bundle": {
                "url": BUNDLE_URL,
                "sha256": bundle_sha,
                "size": bundle_size,
            },
            "file": {
                "name": COMPONENT_NAME,
                "sha256": component_sha,
                "size": component_size,
            },
        }
        manifest_bytes = (json.dumps(manifest, indent=2, separators=(",", ": ")) + "\n").encode("utf-8")
        with manifest_path.open("xb") as stream:
            stream.write(manifest_bytes)
        return manifest
    except Exception:
        bundle.unlink(missing_ok=True)
        manifest_path.unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--release-sequence", type=int, required=True)
    parser.add_argument("--source-commit", required=True)
    args = parser.parse_args()
    try:
        manifest = package_candidate(
            args.executable,
            args.output_dir,
            args.version,
            args.release_sequence,
            args.source_commit,
        )
    except PackagingError as exc:
        print(f"CREATOR_COMPONENT_PACKAGING=ERROR: {exc}")
        return 1
    print("CREATOR_COMPONENT_PACKAGING=PASS")
    print(f"SOURCE_COMMIT={manifest['source_commit']}")
    print(f"VERSION={manifest['version']}")
    print(f"RELEASE_SEQUENCE={manifest['release_sequence']}")
    print("PRIVATE_KEY_REQUIRED=NO")
    print("SIGNED_ENVELOPE_CREATED=NO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
