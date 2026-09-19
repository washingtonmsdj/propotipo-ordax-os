#!/usr/bin/env python3
"""Materialize the replaceable Native Surface runtime into an owner dev-base state tree."""

from __future__ import annotations

import argparse
import importlib.util
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
CORE_PATH = ROOT / "bootstrap" / "dev-base" / "_build_core.py"
CONTRACT_PATH = ROOT / "docs" / "contracts" / "native-surface-runtime.env"
CONTRACT_SCHEMA = "ordax.native-surface-runtime/1"
DEFAULT_MAX_TREE_BYTES = 230 * 1024 * 1024
ASSIGNMENT_RE = re.compile(r"^([A-Z][A-Z0-9_]*)='([^']*)'$")

REQUIRED_KEYS = {
    "ORDAX_NATIVE_SURFACE_RUNTIME_SCHEMA",
    "ORDAX_NATIVE_SURFACE_RUNTIME_ID",
    "ORDAX_NATIVE_SURFACE_REPOSITORY_MAIN",
    "ORDAX_NATIVE_SURFACE_REPOSITORY_COMMUNITY",
    "ORDAX_NATIVE_SURFACE_INSTALL_PACKAGES",
    "ORDAX_NATIVE_SURFACE_UPGRADE_PACKAGES",
    "ORDAX_NATIVE_SURFACE_BASE_EXECUTABLES",
    "ORDAX_NATIVE_SURFACE_BASE_FILES",
    "ORDAX_NATIVE_SURFACE_FULL_EXECUTABLES",
    "ORDAX_NATIVE_SURFACE_FULL_FILES",
}


class PreseedError(RuntimeError):
    pass


def load_core():
    spec = importlib.util.spec_from_file_location("ordax_dev_base_core_for_surface_seed", CORE_PATH)
    if spec is None or spec.loader is None:
        raise PreseedError(f"could not load {CORE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CORE = load_core()


def parse_contract(path: Path) -> dict[str, str]:
    if not path.is_file() or path.is_symlink():
        raise PreseedError(f"runtime contract is missing or unsafe: {path}")
    values: dict[str, str] = {}
    for number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = ASSIGNMENT_RE.fullmatch(line)
        if not match:
            raise PreseedError(
                f"runtime contract line {number} is not a literal assignment"
            )
        key, value = match.groups()
        if key in values:
            raise PreseedError(f"runtime contract duplicates {key}")
        values[key] = value

    missing = sorted(REQUIRED_KEYS - values.keys())
    extra = sorted(values.keys() - REQUIRED_KEYS)
    if missing:
        raise PreseedError(f"runtime contract is missing keys: {missing}")
    if extra:
        raise PreseedError(f"runtime contract contains unsupported keys: {extra}")
    if values["ORDAX_NATIVE_SURFACE_RUNTIME_SCHEMA"] != CONTRACT_SCHEMA:
        raise PreseedError("runtime contract schema is unsupported")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,127}", values["ORDAX_NATIVE_SURFACE_RUNTIME_ID"]):
        raise PreseedError("runtime id is invalid")

    for repository_key in (
        "ORDAX_NATIVE_SURFACE_REPOSITORY_MAIN",
        "ORDAX_NATIVE_SURFACE_REPOSITORY_COMMUNITY",
    ):
        if not values[repository_key].startswith("https://"):
            raise PreseedError(f"{repository_key} must use HTTPS")

    for list_key in REQUIRED_KEYS - {
        "ORDAX_NATIVE_SURFACE_RUNTIME_SCHEMA",
        "ORDAX_NATIVE_SURFACE_RUNTIME_ID",
        "ORDAX_NATIVE_SURFACE_REPOSITORY_MAIN",
        "ORDAX_NATIVE_SURFACE_REPOSITORY_COMMUNITY",
    }:
        if not values[list_key].split():
            raise PreseedError(f"{list_key} may not be empty")
    return values


def require_rootfs(rootfs: Path) -> None:
    required = [
        rootfs / "sbin" / "apk",
        rootfs / "bin" / "sh",
        rootfs / "etc" / "apk" / "keys",
    ]
    for path in required:
        if not path.exists() or path.is_symlink():
            raise PreseedError(f"development rootfs prerequisite missing: {path}")
    if os.geteuid() != 0:
        raise PreseedError("Native Surface runtime preseed must run as root")


def copy_trust_material(rootfs: Path, target: Path) -> None:
    target_keys = target / "etc" / "apk" / "keys"
    target_keys.mkdir(parents=True, exist_ok=True)
    keys = sorted((rootfs / "etc" / "apk" / "keys").glob("*.pub"))
    if not keys:
        raise PreseedError("Alpine public keys are missing from development base")
    for key in keys:
        if not key.is_file() or key.is_symlink():
            raise PreseedError(f"unsafe Alpine key: {key}")
        shutil.copy2(key, target_keys / key.name)

    host_ca = rootfs / "etc" / "ssl" / "certs" / "ca-certificates.crt"
    if host_ca.is_file() and not host_ca.is_symlink():
        target_ca = target / "etc" / "ssl" / "certs"
        target_ca.mkdir(parents=True, exist_ok=True)
        shutil.copy2(host_ca, target_ca / "ca-certificates.crt")


def write_repositories(target: Path, contract: dict[str, str]) -> None:
    apk_dir = target / "etc" / "apk"
    apk_dir.mkdir(parents=True, exist_ok=True)
    repositories = (
        contract["ORDAX_NATIVE_SURFACE_REPOSITORY_MAIN"]
        + "\n"
        + contract["ORDAX_NATIVE_SURFACE_REPOSITORY_COMMUNITY"]
        + "\n"
    )
    (apk_dir / "repositories").write_text(repositories, encoding="utf-8")


def ensure_dev_null(rootfs: Path) -> bool:
    path = rootfs / "dev" / "null"
    if path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(mode=0o666)
    return True


def run_apk(rootfs: Path, target_inside: str, packages: list[str]) -> None:
    command = [
        "chroot",
        str(rootfs),
        "/sbin/apk",
        "--root",
        target_inside,
        "--keys-dir",
        "/etc/apk/keys",
        "--no-cache",
        "--initdb",
        "add",
        *packages,
    ]
    print("+", " ".join(command), flush=True)
    completed = subprocess.run(command, check=False)
    if completed.returncode != 0:
        raise PreseedError(f"runtime apk provisioning failed ({completed.returncode})")


def verify_paths(target: Path, contract: dict[str, str]) -> None:
    for relative in contract["ORDAX_NATIVE_SURFACE_FULL_EXECUTABLES"].split():
        path = target / relative
        if not path.is_file() or not os.access(path, os.X_OK):
            raise PreseedError(f"runtime executable is missing: /{relative}")
    for relative in contract["ORDAX_NATIVE_SURFACE_FULL_FILES"].split():
        path = target / relative
        if not path.is_file():
            raise PreseedError(f"runtime file is missing: /{relative}")


def prepare_runtime_directories(target: Path) -> None:
    for relative in (
        "dev",
        "proc",
        "sys",
        "run",
        "tmp",
        "root",
        "ordax",
        "srv/ordax-system",
        "srv/ordax-repo",
        "var/lib/ordax",
        "var/lib/ordax-user",
    ):
        (target / relative).mkdir(parents=True, exist_ok=True)
    (target / "tmp").chmod(0o1777)


def tree_has_symlinks(root: Path) -> bool:
    return any(path.is_symlink() for path in root.rglob("*"))


def preseed(rootfs: Path, contract_path: Path, max_tree_bytes: int) -> tuple[str, int, int]:
    rootfs = rootfs.resolve()
    contract = parse_contract(contract_path.resolve())
    require_rootfs(rootfs)

    runtime_id = contract["ORDAX_NATIVE_SURFACE_RUNTIME_ID"]
    runtime_state = rootfs / "state" / "ordax" / "runtime" / "native-surface"
    final = runtime_state / runtime_id
    staging = runtime_state / f".preseed-{os.getpid()}"
    staging_root = staging / "rootfs"
    target_inside = f"/state/ordax/runtime/native-surface/{staging.name}/rootfs"

    shutil.rmtree(staging, ignore_errors=True)
    runtime_state.mkdir(parents=True, exist_ok=True)
    staging_root.mkdir(parents=True)
    copy_trust_material(rootfs, staging_root)
    write_repositories(staging_root, contract)

    created_dev_null = ensure_dev_null(rootfs)
    try:
        run_apk(
            rootfs,
            target_inside,
            contract["ORDAX_NATIVE_SURFACE_INSTALL_PACKAGES"].split(),
        )
    finally:
        if created_dev_null:
            (rootfs / "dev" / "null").unlink(missing_ok=True)

    prepare_runtime_directories(staging_root)
    flattened = CORE.flatten_symlinks(staging_root)
    if tree_has_symlinks(staging_root):
        raise PreseedError("runtime seed still contains symlinks after flattening")
    verify_paths(staging_root, contract)

    (staging / "ready").write_text(runtime_id + "\n", encoding="utf-8")
    runtime_bytes = CORE.unique_regular_bytes(staging_root)
    combined_bytes = CORE.unique_regular_bytes(rootfs)
    if combined_bytes > max_tree_bytes:
        raise PreseedError(
            f"development tree exceeds seed budget after runtime preseed: "
            f"{combined_bytes} > {max_tree_bytes}"
        )

    shutil.rmtree(final, ignore_errors=True)
    staging.replace(final)
    print(f"ORDAX_NATIVE_SURFACE_PRESEED_ID={runtime_id}", flush=True)
    print(f"ORDAX_NATIVE_SURFACE_PRESEED_BYTES={runtime_bytes}", flush=True)
    print(f"ORDAX_NATIVE_SURFACE_PRESEED_COMBINED_BYTES={combined_bytes}", flush=True)
    print(f"ORDAX_NATIVE_SURFACE_PRESEED_SYMLINKS_FLATTENED={flattened}", flush=True)
    print("ORDAX_NATIVE_SURFACE_PRESEED=PASS", flush=True)
    return runtime_id, runtime_bytes, combined_bytes


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rootfs", type=Path, required=True)
    parser.add_argument("--contract", type=Path, default=CONTRACT_PATH)
    parser.add_argument(
        "--max-tree-bytes",
        type=int,
        default=DEFAULT_MAX_TREE_BYTES,
        help="Maximum unique regular-file bytes for dev-base plus runtime seed",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate the contract and builder inputs without provisioning packages",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        contract = parse_contract(args.contract.resolve())
        if args.check:
            if args.max_tree_bytes <= 0:
                raise PreseedError("max-tree-bytes must be positive")
            print(
                "ORDAX_NATIVE_SURFACE_PRESEED_CONTRACT="
                + contract["ORDAX_NATIVE_SURFACE_RUNTIME_ID"],
                flush=True,
            )
            print("ORDAX_NATIVE_SURFACE_PRESEED_CHECK=PASS", flush=True)
            return 0
        if args.max_tree_bytes <= 0:
            raise PreseedError("max-tree-bytes must be positive")
        preseed(args.rootfs, args.contract, args.max_tree_bytes)
        return 0
    except (OSError, PreseedError, CORE.BuildError) as exc:
        print(f"ordax-native-surface-preseed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
