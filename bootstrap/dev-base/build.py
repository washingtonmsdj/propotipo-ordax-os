#!/usr/bin/env python3
"""Git-first development base builder with firmware/runtime policy overlays."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CORE = _load_module("ordax_dev_base_core", THIS_DIR / "_build_core.py")
POLICY = _load_module("ordax_dev_base_firmware_policy", THIS_DIR / "firmware_policy.py")

BuildError = CORE.BuildError
BUILD_ONLY_PACKAGES = ["zstd"]
RUNTIME_PACKAGES = [package for package in CORE.PACKAGES if package not in BUILD_ONLY_PACKAGES]
PACKAGES = RUNTIME_PACKAGES
MAX_ROOTFS_BYTES = CORE.MAX_ROOTFS_BYTES
_ORIGINAL_PRUNE_FIRMWARE = CORE.prune_firmware
_ORIGINAL_BUILD = CORE.build

# The core builder records PACKAGES in provenance and installs exactly this set
# into the final runtime. Build-only tools are installed transiently below.
CORE.PACKAGES = RUNTIME_PACKAGES


def required_firmware_names(rootfs: Path) -> set[str]:
    try:
        return POLICY.available_firmware_names(rootfs)
    except POLICY.FirmwareSelectionError as exc:
        raise BuildError(str(exc)) from exc


def _assert_build_only_tools_removed(rootfs: Path) -> None:
    leftovers = []
    for relative in ("usr/bin/zstd", "usr/bin/unzstd", "usr/bin/zstdcat"):
        path = rootfs / relative
        if path.exists() or path.is_symlink():
            leftovers.append("/" + relative)
    if leftovers:
        raise BuildError(f"build-only tools remained in runtime: {leftovers}")


def prune_firmware(rootfs: Path, required: set[str]) -> None:
    """Materialize compressed firmware with transient tooling, then remove it."""
    CORE.proot_rootfs(
        rootfs,
        "apk add --no-cache --virtual .ordax-build " + " ".join(BUILD_ONLY_PACKAGES),
    )
    _ORIGINAL_PRUNE_FIRMWARE(rootfs, required)
    CORE.proot_rootfs(rootfs, "apk del .ordax-build")
    _assert_build_only_tools_removed(rootfs)
    print(
        "ORDAX_DEV_BASE_BUILD_ONLY_REMOVED=" + ",".join(BUILD_ONLY_PACKAGES),
        flush=True,
    )


def build(kernel_modules: Path, out_dir: Path) -> None:
    _ORIGINAL_BUILD(kernel_modules, out_dir)
    provenance_path = out_dir.resolve() / "provenance.json"
    payload = json.loads(provenance_path.read_text(encoding="utf-8"))
    payload["runtime_packages"] = RUNTIME_PACKAGES
    payload["build_only_packages"] = BUILD_ONLY_PACKAGES
    payload["build_only_packages_present_in_runtime"] = False
    provenance_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


# The core builder resolves these symbols from its own module globals at runtime.
CORE.required_firmware_names = required_firmware_names
CORE.prune_firmware = prune_firmware
CORE.build = build


def main() -> int:
    return CORE.main()


if __name__ == "__main__":
    raise SystemExit(main())
