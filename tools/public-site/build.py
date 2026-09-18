#!/usr/bin/env python3
"""Build and verify the dependency-free OrdaX public site candidate."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "sites" / "public"
MANIFEST_NAME = "public-site-manifest.json"
SCHEMA = "prototype-ordax.public-site-bundle/1"
CONFIG_SCHEMA = "prototype-ordax.public-site-runtime/1"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
REMOTE_HTML_REF_RE = re.compile(r"\\b(?:src|href)\\s*=\\s*['\"]//", re.IGNORECASE)
PROTOCOL_RELATIVE_CSS_TOKENS = (
    "url(//",
    "url('//",
    'url("//',
    "@import //",
    "@import '//",
    '@import "//',
)
REQUIRED_FILES = (
    "index.html",
    "download/index.html",
    "login/index.html",
    "cadastro/index.html",
    "assets/site.css",
    "assets/site.js",
    "config/public-site.json",
)


class PublicSiteError(RuntimeError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def same_origin_path(value: object) -> bool:
    return value is None or (
        isinstance(value, str)
        and value.startswith("/")
        and not value.startswith("//")
    )


def source_files(root: Path = SOURCE) -> list[Path]:
    if not root.is_dir():
        raise PublicSiteError(f"missing public site source root: {root}")
    files = sorted(
        (path for path in root.rglob("*") if path.is_file()),
        key=lambda p: p.relative_to(root).as_posix(),
    )
    if not files:
        raise PublicSiteError("public site source is empty")
    return files


def validate_source(root: Path = SOURCE) -> list[Path]:
    files = source_files(root)
    relative = {path.relative_to(root).as_posix() for path in files}
    missing = sorted(set(REQUIRED_FILES) - relative)
    if missing:
        raise PublicSiteError(f"missing required public site files: {missing}")

    for path in files:
        suffix = path.suffix.lower()
        if suffix not in {".html", ".css", ".js", ".json", ".md"}:
            raise PublicSiteError(
                f"unexpected public site source type: {path.relative_to(root).as_posix()}"
            )
        if suffix in {".html", ".css", ".js"}:
            text = path.read_text(encoding="utf-8")
            if "http://" in text or "https://" in text:
                raise PublicSiteError(
                    f"remote runtime reference is not allowed: {path.relative_to(root).as_posix()}"
                )
            if suffix == ".html" and REMOTE_HTML_REF_RE.search(text):
                raise PublicSiteError(
                    f"protocol-relative HTML reference is not allowed: {path.relative_to(root).as_posix()}"
                )
            if suffix == ".css" and any(token in text.lower() for token in PROTOCOL_RELATIVE_CSS_TOKENS):
                raise PublicSiteError(
                    f"protocol-relative CSS reference is not allowed: {path.relative_to(root).as_posix()}"
                )

    config_path = root / "config" / "public-site.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if config.get("$schema") != CONFIG_SCHEMA:
        raise PublicSiteError("unexpected public site runtime config schema")

    identity = config.get("identity")
    downloads = config.get("downloads")
    if not isinstance(identity, dict) or not isinstance(downloads, dict):
        raise PublicSiteError("public site runtime config sections are missing")
    for key in ("login_url", "register_url"):
        if not same_origin_path(identity.get(key)):
            raise PublicSiteError(f"identity.{key} must be null or a same-origin path")
    if not same_origin_path(downloads.get("catalog_url")):
        raise PublicSiteError("downloads.catalog_url must be null or a same-origin path")

    return files


def build_bundle(out_dir: Path, source_commit: str, root: Path = SOURCE) -> dict:
    if not SHA40_RE.fullmatch(source_commit):
        raise PublicSiteError("source commit must be a full lowercase 40-hex Git SHA")
    if out_dir.exists() and any(out_dir.iterdir()):
        raise PublicSiteError(f"refusing to replace non-empty output directory: {out_dir}")

    files = validate_source(root)
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".ordax-public-site-", dir=out_dir.parent))
    try:
        for path in files:
            relative = path.relative_to(root)
            destination = stage / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, destination)

        records = []
        for path in sorted(
            (p for p in stage.rglob("*") if p.is_file()),
            key=lambda p: p.relative_to(stage).as_posix(),
        ):
            payload = path.read_bytes()
            records.append(
                {
                    "path": path.relative_to(stage).as_posix(),
                    "sha256": sha256_bytes(payload),
                    "size": len(payload),
                }
            )

        manifest = {
            "$schema": SCHEMA,
            "status": "candidate",
            "artifact_class": "public-site",
            "source_commit": source_commit,
            "source_root": "sites/public",
            "build_recipe": "tools/public-site/build.py",
            "remote_runtime_dependencies": False,
            "framework_runtime_dependency": False,
            "routes": ["/", "/download/", "/login/", "/cadastro/"],
            "files": records,
        }
        (stage / MANIFEST_NAME).write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        if out_dir.exists():
            out_dir.rmdir()
        os.replace(stage, out_dir)
        stage = None
        return manifest
    finally:
        if stage is not None:
            shutil.rmtree(stage, ignore_errors=True)


def verify_bundle(out_dir: Path) -> dict:
    manifest_path = out_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        raise PublicSiteError(f"missing {MANIFEST_NAME}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("$schema") != SCHEMA:
        raise PublicSiteError("unexpected public site bundle schema")
    if manifest.get("artifact_class") != "public-site":
        raise PublicSiteError("unexpected artifact class")
    if not SHA40_RE.fullmatch(str(manifest.get("source_commit", ""))):
        raise PublicSiteError("manifest source_commit is invalid")
    if manifest.get("remote_runtime_dependencies") is not False:
        raise PublicSiteError("public site may not gain undeclared remote runtime dependencies")

    expected = {record["path"]: record for record in manifest.get("files", [])}
    actual = {
        path.relative_to(out_dir).as_posix(): path
        for path in out_dir.rglob("*")
        if path.is_file() and path.name != MANIFEST_NAME
    }
    if set(actual) != set(expected):
        raise PublicSiteError(
            f"bundle file set mismatch: expected={sorted(expected)} actual={sorted(actual)}"
        )

    for relative, path in actual.items():
        payload = path.read_bytes()
        record = expected[relative]
        if len(payload) != record["size"] or sha256_bytes(payload) != record["sha256"]:
            raise PublicSiteError(f"bundle integrity mismatch: {relative}")

    validate_source(out_dir)
    return manifest


def command_check() -> int:
    files = validate_source()
    print("PUBLIC_SITE_SOURCE=PASS")
    print(f"PUBLIC_SITE_SOURCE_FILE_COUNT={len(files)}")
    print("PUBLIC_SITE_REMOTE_RUNTIME_DEPENDENCIES=NO")
    return 0


def command_build(args: argparse.Namespace) -> int:
    manifest = build_bundle(Path(args.out_dir), args.source_commit)
    print("PUBLIC_SITE_BUILD=PASS")
    print(f"PUBLIC_SITE_FILE_COUNT={len(manifest['files'])}")
    return 0


def command_verify(args: argparse.Namespace) -> int:
    manifest = verify_bundle(Path(args.out_dir))
    print("PUBLIC_SITE_VERIFY=PASS")
    print(f"PUBLIC_SITE_SOURCE_COMMIT={manifest['source_commit']}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build = sub.add_parser("build")
    build.add_argument("--out-dir", default="out/public-site")
    build.add_argument("--source-commit", required=True)
    verify = sub.add_parser("verify")
    verify.add_argument("--out-dir", default="out/public-site")
    args = parser.parse_args(argv)

    try:
        if args.command == "check":
            return command_check()
        if args.command == "build":
            return command_build(args)
        return command_verify(args)
    except (PublicSiteError, OSError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        print(f"PUBLIC_SITE_ERROR={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
