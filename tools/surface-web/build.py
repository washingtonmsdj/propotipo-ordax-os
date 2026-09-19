#!/usr/bin/env python3
"""Build the dependency-free OrdaX Web client from the shared Surface graph."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path, PurePosixPath

TOOLS = Path(__file__).resolve().parents[1]
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from source_graph import (
    HTML_REF_RE,
    SourceGraphError,
    discover_graph as discover_source_graph,
    resolve_local as resolve_source_local,
)

ROOT = Path(__file__).resolve().parents[2]
ENTRYPOINT = PurePosixPath("system/composition/web/index.html")
MANIFEST_NAME = "web-client-manifest.json"
SCHEMA = "prototype-ordax.web-client-bundle/1"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")

class BundleError(RuntimeError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def resolve_local(source: PurePosixPath, specifier: str) -> PurePosixPath | None:
    try:
        return resolve_source_local(source, specifier, allowed_prefixes=("system",))
    except SourceGraphError as exc:
        raise BundleError(str(exc)) from exc


def discover_graph(
    root: Path = ROOT,
    entrypoint: PurePosixPath = ENTRYPOINT,
) -> list[PurePosixPath]:
    try:
        return discover_source_graph(
            root,
            entrypoint,
            allowed_prefixes=("system",),
        )
    except SourceGraphError as exc:
        raise BundleError(str(exc)) from exc


def render_root_index(root: Path = ROOT, entrypoint: PurePosixPath = ENTRYPOINT) -> bytes:
    source = (root / entrypoint).read_text(encoding="utf-8")

    def replace(match: re.Match[str]) -> str:
        attribute, quote, specifier = match.groups()
        dependency = resolve_local(entrypoint, specifier)
        if dependency is None:
            return match.group(0)
        return f"{attribute}={quote}./{dependency.as_posix()}{quote}"

    rendered = HTML_REF_RE.sub(replace, source)
    if "../" in rendered:
        raise BundleError("generated root index still contains parent-directory traversal")
    return rendered.encode("utf-8")


def build_bundle(out_dir: Path, source_commit: str, root: Path = ROOT) -> dict:
    if not SHA40_RE.fullmatch(source_commit):
        raise BundleError("source commit must be a full lowercase 40-hex Git SHA")
    if out_dir.exists() and any(out_dir.iterdir()):
        raise BundleError(f"refusing to replace non-empty output directory: {out_dir}")

    graph = discover_graph(root)
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".ordax-web-client-", dir=out_dir.parent))
    try:
        for relative in graph:
            destination = stage / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(root / relative, destination)

        (stage / "index.html").write_bytes(render_root_index(root))

        records = []
        for path in sorted((p for p in stage.rglob("*") if p.is_file()), key=lambda item: item.relative_to(stage).as_posix()):
            relative = path.relative_to(stage).as_posix()
            payload = path.read_bytes()
            records.append({"path": relative, "sha256": sha256_bytes(payload), "size": len(payload)})

        manifest = {
            "$schema": SCHEMA,
            "status": "candidate",
            "source_commit": source_commit,
            "source_graph_entrypoint": ENTRYPOINT.as_posix(),
            "entrypoint": "index.html",
            "remote_runtime_dependencies": False,
            "framework_runtime_dependency": False,
            "files": records,
        }
        (stage / MANIFEST_NAME).write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
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
        raise BundleError(f"missing {MANIFEST_NAME}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("$schema") != SCHEMA:
        raise BundleError("unexpected Web client manifest schema")
    if not SHA40_RE.fullmatch(str(manifest.get("source_commit", ""))):
        raise BundleError("manifest source_commit is invalid")
    if manifest.get("entrypoint") != "index.html" or not (out_dir / "index.html").is_file():
        raise BundleError("Web client root entrypoint is missing")
    if manifest.get("remote_runtime_dependencies") is not False:
        raise BundleError("Web client may not gain an undeclared remote runtime dependency")

    expected = {record["path"]: record for record in manifest.get("files", [])}
    actual = {
        path.relative_to(out_dir).as_posix(): path
        for path in out_dir.rglob("*")
        if path.is_file() and path.name != MANIFEST_NAME
    }
    if set(actual) != set(expected):
        raise BundleError(f"bundle file set mismatch: expected={sorted(expected)} actual={sorted(actual)}")

    for relative, path in actual.items():
        payload = path.read_bytes()
        record = expected[relative]
        if len(payload) != record["size"] or sha256_bytes(payload) != record["sha256"]:
            raise BundleError(f"bundle integrity mismatch: {relative}")

    index_text = (out_dir / "index.html").read_text(encoding="utf-8")
    if "../" in index_text or "http://" in index_text or "https://" in index_text:
        raise BundleError("root index contains a forbidden external/traversal reference")
    return manifest


def command_check() -> int:
    graph = discover_graph(ROOT)
    render_root_index(ROOT)
    print("WEB_CLIENT_SOURCE_GRAPH=PASS")
    print(f"WEB_CLIENT_SOURCE_FILE_COUNT={len(graph)}")
    return 0


def command_build(args: argparse.Namespace) -> int:
    manifest = build_bundle(Path(args.out_dir), args.source_commit)
    print("WEB_CLIENT_BUILD=PASS")
    print(f"WEB_CLIENT_FILE_COUNT={len(manifest['files'])}")
    return 0


def command_verify(args: argparse.Namespace) -> int:
    manifest = verify_bundle(Path(args.out_dir))
    print("WEB_CLIENT_VERIFY=PASS")
    print(f"WEB_CLIENT_SOURCE_COMMIT={manifest['source_commit']}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build = sub.add_parser("build")
    build.add_argument("--out-dir", default="out/web-client")
    build.add_argument("--source-commit", required=True)
    verify = sub.add_parser("verify")
    verify.add_argument("--out-dir", default="out/web-client")
    args = parser.parse_args(argv)

    try:
        if args.command == "check":
            return command_check()
        if args.command == "build":
            return command_build(args)
        return command_verify(args)
    except (BundleError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"WEB_CLIENT_ERROR={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
