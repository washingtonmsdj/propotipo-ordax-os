#!/usr/bin/env python3
"""Fail CI when source imports cross canonical OrdaX module boundaries."""

from __future__ import annotations

import json
import posixpath
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = ROOT / "docs" / "contracts" / "module-boundaries.json"
CODE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go"}
IGNORED_DIRS = {".git", "node_modules", "vendor", "dist", "build", "out", "coverage"}

JS_FROM_RE = re.compile(
    r"\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?[\"']([^\"']+)[\"']"
)
JS_CALL_RE = re.compile(r"\b(?:require|import)\(\s*[\"']([^\"']+)[\"']\s*\)")
PY_FROM_RE = re.compile(r"^\s*from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\s+", re.MULTILINE)
PY_IMPORT_RE = re.compile(r"^\s*import\s+([A-Za-z_][A-Za-z0-9_.]*)", re.MULTILINE)
QUOTED_REPO_PATH_RE = re.compile(
    r"[\"']((?:github\.com/washingtonmsdj/prototipo-ordax-os/)?(?:system|bootstrap|tools/creator)/[^\"']+)[\"']"
)


def load_contract(root: Path = ROOT) -> dict:
    path = root / "docs" / "contracts" / "module-boundaries.json"
    return json.loads(path.read_text(encoding="utf-8"))


def extract_import_specifiers(path: Path, text: str) -> set[str]:
    suffix = path.suffix.lower()
    specs: set[str] = set()
    if suffix in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}:
        specs.update(JS_FROM_RE.findall(text))
        specs.update(JS_CALL_RE.findall(text))
    elif suffix == ".py":
        specs.update(PY_FROM_RE.findall(text))
        specs.update(PY_IMPORT_RE.findall(text))
    elif suffix == ".go":
        specs.update(QUOTED_REPO_PATH_RE.findall(text))
    return specs


def normalize_specifier(source_rel: PurePosixPath, specifier: str) -> str | None:
    spec = specifier.strip().replace("\\", "/")
    if not spec:
        return None

    if spec.startswith("github.com/washingtonmsdj/prototipo-ordax-os/"):
        spec = spec.removeprefix("github.com/washingtonmsdj/prototipo-ordax-os/")

    if spec.startswith("@ordax/"):
        spec = "system/" + spec.removeprefix("@ordax/")
    elif spec.startswith("system."):
        spec = spec.replace(".", "/")

    if spec.startswith("."):
        candidate = posixpath.normpath(
            str(PurePosixPath(source_rel.parent) / PurePosixPath(spec))
        )
    elif spec.startswith(("system/", "bootstrap/", "tools/creator/")):
        candidate = posixpath.normpath(spec)
    else:
        return None

    if candidate == ".." or candidate.startswith("../") or candidate.startswith("/"):
        return None
    return candidate


def layer_for_path(rel_path: str, contract: dict) -> str | None:
    normalized = rel_path.rstrip("/")
    matches = []
    for layer in contract["layers"]:
        root = layer["root"].rstrip("/")
        if normalized == root or normalized.startswith(root + "/"):
            matches.append((len(root), layer["id"]))
    if not matches:
        return None
    return max(matches)[1]


def adapter_mode_for_path(rel_path: str, contract: dict) -> str | None:
    prefix = "system/adapters/"
    if not rel_path.startswith(prefix):
        return None
    tail = rel_path[len(prefix):]
    mode = tail.split("/", 1)[0]
    return mode if mode in set(contract.get("adapter_modes", [])) else None


def iter_source_files(root: Path) -> Iterable[Path]:
    for top in (root / "system", root / "bootstrap", root / "tools" / "creator"):
        if not top.exists():
            continue
        for path in top.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in CODE_SUFFIXES:
                continue
            if any(part in IGNORED_DIRS for part in path.relative_to(root).parts):
                continue
            yield path


def find_violations(root: Path, contract: dict | None = None) -> list[str]:
    contract = contract or load_contract(root)
    layers = {entry["id"]: entry for entry in contract["layers"]}
    violations: list[str] = []

    creator_root = contract["external_boundaries"]["creator"]["root"].rstrip("/")
    bootstrap_root = contract["external_boundaries"]["bootstrap"]["root"].rstrip("/")

    for path in iter_source_files(root):
        source_rel = PurePosixPath(path.relative_to(root).as_posix())
        source_str = str(source_rel)
        source_layer = layer_for_path(source_str, contract)
        source_adapter_mode = adapter_mode_for_path(source_str, contract)
        text = path.read_text(encoding="utf-8", errors="ignore")

        for specifier in sorted(extract_import_specifiers(path, text)):
            target = normalize_specifier(source_rel, specifier)
            if target is None:
                continue
            target_layer = layer_for_path(target, contract)

            if source_layer and target_layer and source_layer != target_layer:
                if target_layer not in set(layers[source_layer]["allowed_dependencies"]):
                    violations.append(
                        f"{source_str}: {source_layer} may not import {target_layer} via {specifier!r} -> {target}"
                    )

            if (
                source_layer == "adapters"
                and target_layer == "adapters"
                and not contract["principles"]["adapter_modes_may_import_each_other"]
            ):
                target_mode = adapter_mode_for_path(target, contract)
                if source_adapter_mode and target_mode and source_adapter_mode != target_mode:
                    violations.append(
                        f"{source_str}: adapter mode {source_adapter_mode} may not import {target_mode} via {specifier!r}"
                    )

            if source_layer and (target == creator_root or target.startswith(creator_root + "/")):
                if not contract["external_boundaries"]["creator"]["system_source_direct_import_allowed"]:
                    violations.append(
                        f"{source_str}: system source may not import Creator implementation via {specifier!r}"
                    )

            if source_layer and (target == bootstrap_root or target.startswith(bootstrap_root + "/")):
                if not contract["external_boundaries"]["bootstrap"]["system_source_direct_import_allowed"]:
                    violations.append(
                        f"{source_str}: system source may not import bootstrap implementation via {specifier!r}"
                    )

            if (source_str == creator_root or source_str.startswith(creator_root + "/")) and target_layer:
                violations.append(
                    f"{source_str}: Creator source may not import shared system implementation via {specifier!r}"
                )

            if (source_str == bootstrap_root or source_str.startswith(bootstrap_root + "/")) and target_layer:
                violations.append(
                    f"{source_str}: bootstrap source may not import shared system implementation via {specifier!r}"
                )

    return sorted(set(violations))


def main() -> int:
    contract = load_contract(ROOT)
    violations = find_violations(ROOT, contract)
    if violations:
        print("MODULE_BOUNDARY_CHECK=FAIL")
        for violation in violations:
            print("VIOLATION=" + violation)
        return 1
    print("MODULE_BOUNDARY_CHECK=PASS")
    print(f"MODULE_BOUNDARY_SCHEMA={contract['$schema']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
