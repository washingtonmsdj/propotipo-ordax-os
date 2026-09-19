"""Shared local source-graph discovery for OrdaX zero-dependency artifacts."""

from __future__ import annotations

import posixpath
import re
from pathlib import Path, PurePosixPath

HTML_REF_RE = re.compile(r"\b(src|href)=(['\"])([^'\"]+)\2", re.IGNORECASE)
JS_FROM_RE = re.compile(r"\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?[\"']([^\"']+)[\"']")
JS_CALL_RE = re.compile(r"\bimport\(\s*[\"']([^\"']+)[\"']\s*\)")
JS_URL_RE = re.compile(
    r"\bnew\s+URL\(\s*[\"']([^\"']+)[\"']\s*,\s*import\.meta\.url\s*\)"
)
CSS_IMPORT_RE = re.compile(
    r"@import\s+(?:url\()?\s*[\"']([^\"']+)[\"']",
    re.IGNORECASE,
)
CSS_URL_RE = re.compile(r"url\(\s*[\"']?([^\"')]+)", re.IGNORECASE)
REMOTE_PREFIXES = ("http://", "https://", "//", "data:", "javascript:")


class SourceGraphError(RuntimeError):
    pass


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


def resolve_local(
    source: PurePosixPath,
    specifier: str,
    *,
    allowed_prefixes: tuple[str, ...] = ("system",),
) -> PurePosixPath | None:
    spec = specifier.strip().replace("\\", "/")
    if not spec or spec.startswith("#"):
        return None
    if spec.lower().startswith(REMOTE_PREFIXES):
        raise SourceGraphError(f"remote/runtime dependency is not allowed: {specifier}")
    if spec.startswith("/"):
        raise SourceGraphError(f"absolute dependency path is not allowed: {specifier}")
    if not spec.startswith("."):
        raise SourceGraphError(f"bare dependency is not allowed: {specifier}")

    candidate = posixpath.normpath(str(source.parent / PurePosixPath(spec)))
    if candidate == ".." or candidate.startswith("../") or candidate.startswith("/"):
        raise SourceGraphError(
            f"dependency escapes repository root: {source} -> {specifier}"
        )
    if not any(
        candidate == prefix or candidate.startswith(prefix + "/")
        for prefix in allowed_prefixes
    ):
        raise SourceGraphError(
            f"dependency is outside allowed source roots: {source} -> {candidate}"
        )
    return PurePosixPath(candidate)


def discover_graph(
    root: Path,
    entrypoint: PurePosixPath,
    *,
    allowed_prefixes: tuple[str, ...] = ("system",),
) -> list[PurePosixPath]:
    pending = [entrypoint]
    discovered: set[PurePosixPath] = set()

    while pending:
        current = pending.pop()
        if current in discovered:
            continue
        file_path = root / current
        if not file_path.is_file():
            raise SourceGraphError(f"missing source dependency: {current}")
        discovered.add(current)

        if file_path.suffix.lower() not in {".html", ".htm", ".mjs", ".js", ".cjs", ".css"}:
            continue
        text = file_path.read_text(encoding="utf-8")
        for specifier in dependency_specifiers(current, text):
            dependency = resolve_local(
                current,
                specifier,
                allowed_prefixes=allowed_prefixes,
            )
            if dependency is not None and dependency not in discovered:
                pending.append(dependency)

    return sorted(discovered, key=str)
