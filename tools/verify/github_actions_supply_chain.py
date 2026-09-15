#!/usr/bin/env python3
"""Validate GitHub Actions references against the canonical OrdaX CI supply-chain contract."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = ROOT / "docs" / "contracts" / "ci-supply-chain.json"
USES_RE = re.compile(r"^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$")
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
DOCKER_DIGEST_RE = re.compile(r"^docker://.+@sha256:[0-9a-f]{64}$")


def workflow_files(root: Path, contract: dict) -> list[Path]:
    files: list[Path] = []
    for rel in contract["scope"]["workflow_roots"]:
        base = root / rel
        if base.exists():
            files.extend(base.rglob("*.yml"))
            files.extend(base.rglob("*.yaml"))
    for rel in contract["scope"]["local_action_roots"]:
        base = root / rel
        if base.exists():
            files.extend(base.rglob("action.yml"))
            files.extend(base.rglob("action.yaml"))
    return sorted(set(files))


def approved_refs(contract: dict) -> set[tuple[str, str]]:
    return {
        (item["uses"], item["sha"])
        for item in contract["external_actions"]["approved_external_actions"]
    }


def find_violations(root: Path, contract: dict) -> list[str]:
    violations: list[str] = []
    approved = approved_refs(contract)
    policy = contract["workflow_policy"]

    for path in workflow_files(root, contract):
        rel = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()

        if rel.startswith(".github/workflows/"):
            if policy["explicit_permissions_required"] and not any(
                line.startswith("permissions:") for line in lines
            ):
                violations.append(f"{rel}: workflow must declare top-level permissions")
            if not policy["write_all_allowed"] and re.search(r"(?m)^\s*permissions:\s*write-all\s*$", text):
                violations.append(f"{rel}: permissions: write-all is forbidden")
            if not policy["pull_request_target_allowed"] and re.search(
                r"(?m)^\s*pull_request_target\s*:", text
            ):
                violations.append(f"{rel}: pull_request_target is forbidden by default")

        for lineno, line in enumerate(lines, start=1):
            match = USES_RE.match(line)
            if not match:
                continue
            value = match.group(1)
            location = f"{rel}:{lineno}"

            if value.startswith("./"):
                if not contract["external_actions"]["local_repository_action_allowed"]:
                    violations.append(f"{location}: local repository actions are disabled")
                continue

            if value.startswith("docker://"):
                if contract["external_actions"]["docker_action_requires_sha256_digest"] and not DOCKER_DIGEST_RE.match(value):
                    violations.append(f"{location}: Docker action must be pinned by sha256 digest")
                continue

            if "@" not in value:
                violations.append(f"{location}: external action is missing an immutable ref: {value}")
                continue

            source, ref = value.rsplit("@", 1)
            if contract["external_actions"]["full_commit_sha_required"] and not SHA40_RE.match(ref):
                violations.append(f"{location}: external action must use a full 40-hex commit SHA: {value}")
                continue

            if not contract["external_actions"]["unknown_external_action_allowed"] and (source, ref) not in approved:
                violations.append(f"{location}: external action/ref is not approved: {value}")

    return violations


def main() -> int:
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    violations = find_violations(ROOT, contract)
    if violations:
        print("GITHUB_ACTIONS_SUPPLY_CHAIN=FAIL", file=sys.stderr)
        for item in violations:
            print(f"- {item}", file=sys.stderr)
        return 1
    print("GITHUB_ACTIONS_SUPPLY_CHAIN=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
