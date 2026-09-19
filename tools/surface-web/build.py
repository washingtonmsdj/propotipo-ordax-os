#!/usr/bin/env python3
"""Build the dependency-free OrdaX Web client from the shared Surface graph."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import shutil
import sys
import tempfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
ENTRYPOINT = PurePosixPath("system/composition/web/index.html")
MANIFEST_NAME = "web-client-manifest.json"
SCHEMA = "prototype-ordax.web-client-bundle/1"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
HTML_REF_RE = re.compile(r"\b(src|href)=(['\"])([^'\"]+)\2", re.IGNORECASE)
JS_FROM_RE = re.compile(r"\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?[\"']([^\"']+)[\"']")
JS_CALL_RE = re.compile(r"\bimport\(\s*[\"']([^\"']+)[\"']\s*\)")
JS_URL_RE = re.compile(r"\bnew\s+URL\(\s*[\"']([^\"']+)[\"']\s*,\s*import\.meta\.url\s*\)")
CSS_IMPORT_RE = re.compile(r"@import\s+(?:url\()?\s*[\"']([^\"']+)[\"']", re.IGNORECASE)
CSS_URL_RE = re.compile(r"url\(\s*[\"']?([^\"')]+)", re.IGNORECASE)
REMOTE_PREFIXES = ("http://", "https://", "//", "data:", "javascript:")


class BundleError(RuntimeError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def resolve_local(source: PurePosixPath, specifier: str) -> PurePosixPath | None:
    spec = specifier.strip().replace("\\", "/")
    if not spec or spec.startswith("#"):
        return None
    if spec.lower().startswith(REMOTE_PREFIXES):
        raise BundleError(f"remote/runtime dependency is not allowed: {specifier}")
    if spec.startswith("/"):
        raise BundleError(f"absolute dependency path is not allowed: {specifier}")
    if not spec.startswith("."):
        raise BundleError(f"bare dependency is not allowed in the zero-dependency Web baseline: {specifier}")

    candidate = posixpath.normpath(str(source.parent / PurePosixPath(spec)))
    if candidate == ".." or candidate.startswith("../") or candidate.startswith("/"):
        raise BundleError(f"dependency escapes repository root: {source} -> {specifier}")
    if not (candidate == "system" or candidate.startswith("system/")):
        raise BundleError(f"Web client dependency must remain under system/: {source} -> {candidate}")
    return PurePosixPath(candidate)


def dependency_specifiers(path: PurePosixPath, text: str) -> list[str]:
    suffix = path.suffix.lower()
    if suffix in {".html", ".htm"}:
        return [match.group(3) for match in HTML_REF_RE.finditer(text)]
    if suffix in {".mjs", ".js", ".cjs"}:
        specs = (
            set(JS_FROM_RE.findall(text))
            | set(JS_CALL_RE.findall(text))
            | set(JS_URL_RE.findall(text))
        )
        return sorted(specs)
    if suffix == ".css":
        specs = set(CSS_IMPORT_RE.findall(text))
        for value in CSS_URL_RE.findall(text):
            if value.strip().startswith("#"):
                continue
            specs.add(value.strip())
        return sorted(specs)
    return []


def discover_graph(root: Path = ROOT, entrypoint: PurePosixPath = ENTRYPOINT) -> list[PurePosixPath]:
    pending = [entrypoint]
    discovered: set[PurePosixPath] = set()

    while pending:
        current = pending.pop()
        if current in discovered:
            continue
        file_path = root / current
        if not file_path.is_file():
            raise BundleError(f"missing Web client dependency: {current}")
        discovered.add(current)

        text = file_path.read_text(encoding="utf-8")
        for specifier in dependency_specifiers(current, text):
            dependency = resolve_local(current, specifier)
            if dependency is not None and dependency not in discovered:
                pending.append(dependency)

    return sorted(discovered, key=str)


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
