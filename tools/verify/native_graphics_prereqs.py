#!/usr/bin/env python3
"""Prove that the pinned kernel keeps the minimum display/input substrate for a native graphical host."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FRAGMENT = ROOT / "bootstrap" / "kernel" / "config" / "ordax.fragment"

REQUIRED_GRAPHICS = (
    "CONFIG_DRM=y",
    "CONFIG_DRM_SIMPLEDRM=y",
    "CONFIG_DRM_FBDEV_EMULATION=y",
)

REQUIRED_INPUT = (
    "CONFIG_INPUT=y",
    "CONFIG_INPUT_EVDEV=y",
    "CONFIG_HID=y",
    "CONFIG_HID_GENERIC=y",
    "CONFIG_USB_HID=y",
)

BASELINE_LAPTOP_PATHS = (
    "CONFIG_DRM_I915=y",
    "CONFIG_I2C_HID=y",
    "CONFIG_I2C_HID_ACPI=y",
    "CONFIG_HID_MULTITOUCH=y",
)


def verify_fragment(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    lines = {line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")}
    violations: list[str] = []

    for selector in REQUIRED_GRAPHICS:
        if selector not in lines:
            violations.append(f"missing required graphical selector: {selector}")
    for selector in REQUIRED_INPUT:
        if selector not in lines:
            violations.append(f"missing required input selector: {selector}")
    for selector in BASELINE_LAPTOP_PATHS:
        if selector not in lines:
            violations.append(f"missing current laptop baseline selector: {selector}")

    return violations


def main() -> int:
    path = DEFAULT_FRAGMENT
    violations = verify_fragment(path)
    if violations:
        print("NATIVE_GRAPHICS_KERNEL_PREREQS=FAIL", file=sys.stderr)
        for violation in violations:
            print(f"- {violation}", file=sys.stderr)
        return 1

    print("NATIVE_GRAPHICS_KERNEL_PREREQS=PASS")
    print("NATIVE_GRAPHICS_USERSPACE_HOST_PROVEN=NO")
    print("NATIVE_GRAPHICS_KERNEL_GRAPHICS=DRM,SIMPLEDRM,FBDEV_EMULATION,I915")
    print("NATIVE_GRAPHICS_KERNEL_INPUT=EVDEV,HID,USB_HID,I2C_HID,MULTITOUCH")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
