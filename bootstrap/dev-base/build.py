#!/usr/bin/env python3
"""Git-first development base builder with firmware/runtime pruning policy."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import shutil

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

# The native USB Surface uses the same standards-first HTML/CSS/JS source as
# the Web composition. Cage provides a minimal DRM/Wayland kiosk compositor and
# Cog/WPE WebKit is the thin browser host. Keep these capabilities in the
# development substrate rather than vendoring a second target-specific UI.
GRAPHICAL_RUNTIME_PACKAGES = (
    "cage",
    "cog",
    "seatd-launch",
    "mesa-dri-gallium",
    "mesa-egl",
    "mesa-gbm",
    "font-dejavu",
)
CORE.PACKAGES.extend(GRAPHICAL_RUNTIME_PACKAGES)
CORE.MAX_ROOTFS_BYTES = 512 * 1024 * 1024

BuildError = CORE.BuildError
PACKAGES = CORE.PACKAGES
MAX_ROOTFS_BYTES = CORE.MAX_ROOTFS_BYTES
prune_firmware = CORE.prune_firmware

BUILD_ONLY_PACKAGES = ("zstd",)
RUNTIME_PRUNE_PATHS = (
    "etc/apk/repositories",
    "lib/apk/db",
    "var/cache/apk",
    "usr/share/doc",
    "usr/share/man",
)


def required_firmware_names(rootfs: Path) -> set[str]:
    try:
        return POLICY.available_firmware_names(rootfs)
    except POLICY.FirmwareSelectionError as exc:
        raise BuildError(str(exc)) from exc


def prune_build_only_runtime(rootfs: Path) -> None:
    """Remove tooling/metadata needed to assemble the image, not to run it."""
    command = "apk del --no-cache " + " ".join(BUILD_ONLY_PACKAGES)
    CORE.proot_rootfs(rootfs, command)

    for relative in RUNTIME_PRUNE_PATHS:
        path = rootfs / relative
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        elif path.exists() or path.is_symlink():
            path.unlink()

    for executable in ("usr/bin/zstd", "bin/zstd"):
        path = rootfs / executable
        if path.exists() or path.is_symlink():
            raise BuildError(f"build-only executable remained in runtime: /{executable}")

    print(
        "ORDAX_DEV_BASE_BUILD_ONLY_PRUNED=" + ",".join(BUILD_ONLY_PACKAGES),
        flush=True,
    )


def _prune_firmware_then_build_only_runtime(rootfs: Path, required: set[str]) -> None:
    # Firmware is shipped compressed by Alpine. Materialize it first while zstd
    # still exists, then remove zstd and package-manager metadata from the image.
    prune_firmware(rootfs, required)
    prune_build_only_runtime(rootfs)


# The core builder resolves these symbols from its own module globals at runtime.
CORE.required_firmware_names = required_firmware_names
CORE.prune_firmware = _prune_firmware_then_build_only_runtime


def main() -> int:
    return CORE.main()


if __name__ == "__main__":
    raise SystemExit(main())
