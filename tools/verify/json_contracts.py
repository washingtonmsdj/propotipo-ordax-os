#!/usr/bin/env python3
"""Discover and strictly validate OrdaX JSON contracts and source manifests."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_RE = re.compile(r"^prototype-ordax\.[a-z0-9][a-z0-9.-]*/[1-9][0-9]*$")


class DuplicateKeyError(ValueError):
    pass


def _no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKeyError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json_strict(path: Path):
    text = path.read_text(encoding="utf-8")
    return json.loads(text, object_pairs_hook=_no_duplicate_keys)


def discover_contracts(root: Path) -> list[Path]:
    contract_root = root / "docs" / "contracts"
    if not contract_root.is_dir():
        return []
    return sorted(path for path in contract_root.rglob("*.json") if path.is_file())


def discover_source_manifests(root: Path) -> list[Path]:
    found = set()
    for top_name in ("boot", "bootstrap"):
        top = root / top_name
        if not top.is_dir():
            continue
        found.update(path for path in top.rglob("source.json") if path.is_file())
    return sorted(found)


def validate_document(path: Path, root: Path, require_schema: bool = True) -> list[str]:
    rel = path.relative_to(root).as_posix()
    errors: list[str] = []
    try:
        document = load_json_strict(path)
    except (UnicodeDecodeError, json.JSONDecodeError, DuplicateKeyError, OSError) as exc:
        return [f"{rel}: invalid JSON: {exc}"]

    if not isinstance(document, dict):
        errors.append(f"{rel}: top-level JSON value must be an object")
        return errors

    if require_schema:
        schema = document.get("$schema")
        if not isinstance(schema, str) or not SCHEMA_RE.fullmatch(schema):
            errors.append(
                f"{rel}: $schema must match prototype-ordax.<name>/<positive-major>"
            )
    return errors


def validate_repository(root: Path = ROOT) -> tuple[list[str], int, int]:
    contracts = discover_contracts(root)
    manifests = discover_source_manifests(root)
    errors: list[str] = []

    if not contracts:
        errors.append("docs/contracts: no JSON contracts discovered")

    for path in contracts:
        errors.extend(validate_document(path, root, require_schema=True))
    for path in manifests:
        errors.extend(validate_document(path, root, require_schema=True))

    return sorted(errors), len(contracts), len(manifests)


def main() -> int:
    errors, contract_count, manifest_count = validate_repository(ROOT)
    if errors:
        print("JSON_CONTRACT_DISCOVERY=FAIL")
        for error in errors:
            print("ERROR=" + error)
        return 1

    print("JSON_CONTRACT_DISCOVERY=PASS")
    print(f"JSON_CONTRACT_COUNT={contract_count}")
    print(f"SOURCE_MANIFEST_COUNT={manifest_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
