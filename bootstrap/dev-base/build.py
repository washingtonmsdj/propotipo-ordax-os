#!/usr/bin/env python3
"""Git-first development base builder with firmware-alternative coverage policy."""

from __future__ import annotations

import importlib.util
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
PACKAGES = CORE.PACKAGES
MAX_ROOTFS_BYTES = CORE.MAX_ROOTFS_BYTES
prune_firmware = CORE.prune_firmware


def required_firmware_names(rootfs: Path) -> set[str]:
    try:
        return POLICY.available_firmware_names(rootfs)
    except POLICY.FirmwareSelectionError as exc:
        raise BuildError(str(exc)) from exc


# The core builder resolves this symbol from its own module globals at runtime.
CORE.required_firmware_names = required_firmware_names


def main() -> int:
    return CORE.main()


if __name__ == "__main__":
    raise SystemExit(main())
