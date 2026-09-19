#!/usr/bin/env python3
"""Create a signed-channel manifest binding one verified runtime component package."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

import build as package_builder

SCHEMA = "prototype-ordax.runtime-component-release-manifest/1"
PURPOSE = "ordax-runtime-component"
SOURCE_REPOSITORY = "washingtonmsdj/prototipo-ordax-os"
RECIPE = "runtime/component/package/1"
MAX_PACKAGE_BYTES = 32 * 1024 * 1024
COMPONENT_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


class ReleaseManifestError(RuntimeError):
    pass


def validate_https_url(raw: str) -> str:
    parsed = urlsplit(raw)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise ReleaseManifestError(
            "runtime component package URL must be absolute HTTPS without credentials or fragment"
        )
    return raw


def package_digest(path: Path) -> tuple[str, int]:
    metadata = path.lstat()
    if not path.is_file() or path.is_symlink():
        raise ReleaseManifestError("runtime component package must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > MAX_PACKAGE_BYTES:
        raise ReleaseManifestError("runtime component package size is outside allowed bounds")
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_PACKAGE_BYTES:
                raise ReleaseManifestError("runtime component package grew while hashing")
            digest.update(chunk)
    if total != metadata.st_size:
        raise ReleaseManifestError("runtime component package changed while hashing")
    return digest.hexdigest(), total


def build_manifest(
    package: Path,
    release_sequence: int,
    package_url: str,
) -> dict:
    if (
        isinstance(release_sequence, bool)
        or not isinstance(release_sequence, int)
        or release_sequence <= 0
    ):
        raise ReleaseManifestError("release_sequence must be a positive integer")

    package_manifest = package_builder.verify_package(package)
    component = package_manifest["component"]
    component_id = component["id"]
    if not COMPONENT_ID_RE.fullmatch(component_id):
        raise ReleaseManifestError("runtime component id is invalid")
    expected_name = f"{component_id}.zip"
    url = validate_https_url(package_url)
    if Path(urlsplit(url).path).name != expected_name:
        raise ReleaseManifestError(
            f"runtime component package URL must end with {expected_name}"
        )

    sha256, size = package_digest(package)
    return {
        "$schema": SCHEMA,
        "purpose": PURPOSE,
        "source_repository": SOURCE_REPOSITORY,
        "source_commit": package_manifest["source_commit"],
        "component_id": component_id,
        "version": component["version"],
        "release_sequence": release_sequence,
        "created_from_recipe": RECIPE,
        "package": {
            "name": expected_name,
            "url": url,
            "sha256": sha256,
            "size": size,
        },
    }


def write_manifest(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, 0o644)
    try:
        payload = (
            json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
        ).encode("utf-8")
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                raise ReleaseManifestError("short write while creating release manifest")
            offset += written
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True)
    parser.add_argument("--release-sequence", required=True, type=int)
    parser.add_argument("--package-url", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    try:
        manifest = build_manifest(
            Path(args.package),
            args.release_sequence,
            args.package_url,
        )
        write_manifest(Path(args.out), manifest)
    except (
        ReleaseManifestError,
        package_builder.ComponentPackageError,
        OSError,
        ValueError,
    ) as exc:
        print(f"RUNTIME_COMPONENT_RELEASE_MANIFEST_ERROR={exc}", file=sys.stderr)
        return 1

    print("RUNTIME_COMPONENT_RELEASE_MANIFEST=PASS")
    print(f"RUNTIME_COMPONENT_ID={manifest['component_id']}")
    print(f"RUNTIME_COMPONENT_VERSION={manifest['version']}")
    print(f"RUNTIME_COMPONENT_RELEASE_SEQUENCE={manifest['release_sequence']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
