#!/usr/bin/env python3
"""Select runtime firmware from alternatives declared by the chosen kernel modules."""

from __future__ import annotations

import os
from pathlib import Path
import re

FIRMWARE_FIELD_RE = re.compile(rb"(?:^|\x00)firmware=([^\x00]+)")


class FirmwareSelectionError(RuntimeError):
    pass


def module_firmware_declarations(rootfs: Path) -> dict[Path, set[str]]:
    modules_root = rootfs / "lib" / "modules"
    if not modules_root.is_dir():
        raise FirmwareSelectionError("kernel modules directory is missing")
    release_dirs = [path for path in modules_root.iterdir() if path.is_dir()]
    if len(release_dirs) != 1:
        raise FirmwareSelectionError(
            f"expected one installed kernel release, found {len(release_dirs)}"
        )

    module_files = sorted(release_dirs[0].rglob("*.ko"))
    if not module_files:
        raise FirmwareSelectionError("development kernel modules are missing")

    declarations: dict[Path, set[str]] = {}
    for module in module_files:
        names: set[str] = set()
        data = module.read_bytes()
        for match in FIRMWARE_FIELD_RE.finditer(data):
            try:
                name = match.group(1).decode("ascii")
            except UnicodeDecodeError as exc:
                raise FirmwareSelectionError(
                    f"invalid firmware declaration in {module.name}"
                ) from exc
            relative = Path(name)
            if not name or relative.is_absolute() or ".." in relative.parts:
                raise FirmwareSelectionError(
                    f"unsafe firmware declaration in {module.name}: {name}"
                )
            names.add(relative.as_posix())
        declarations[module] = names
    return declarations


def resolve_firmware_source(firmware_root: Path, name: str) -> Path | None:
    exact = firmware_root / name
    candidates = (exact, Path(str(exact) + ".zst"))
    source = next(
        (candidate for candidate in candidates if candidate.exists() or candidate.is_symlink()),
        None,
    )
    if source is None:
        return None

    current = source
    seen: set[Path] = set()
    for _ in range(64):
        try:
            current.relative_to(firmware_root)
        except ValueError as exc:
            raise FirmwareSelectionError(
                f"firmware symlink escaped /lib/firmware: {name}"
            ) from exc

        if not current.is_symlink():
            return current if current.is_file() else None
        if current in seen:
            raise FirmwareSelectionError(f"firmware symlink loop: {name}")
        seen.add(current)

        value = os.readlink(current)
        if os.path.isabs(value):
            current = firmware_root / value.lstrip("/")
        else:
            current = current.parent / value
        current = Path(os.path.normpath(current))
        try:
            current.relative_to(firmware_root)
        except ValueError as exc:
            raise FirmwareSelectionError(
                f"firmware symlink escaped /lib/firmware: {name}"
            ) from exc
        if not current.exists() and not current.is_symlink():
            compressed = Path(str(current) + ".zst")
            if compressed.exists() or compressed.is_symlink():
                current = compressed
            else:
                return None
    raise FirmwareSelectionError(f"firmware symlink depth exceeded: {name}")


def available_firmware_names(rootfs: Path) -> set[str]:
    firmware_root = rootfs / "lib" / "firmware"
    if not firmware_root.is_dir():
        raise FirmwareSelectionError("firmware directory is missing")

    declarations = module_firmware_declarations(rootfs)
    declared_names = set().union(*declarations.values()) if declarations else set()
    requiring = {module: names for module, names in declarations.items() if names}
    if not requiring:
        raise FirmwareSelectionError("selected Wi-Fi modules declared no firmware")

    selected: set[str] = set()
    unavailable_alternatives = 0
    uncovered: list[tuple[Path, set[str]]] = []

    for module, names in requiring.items():
        available = {
            name
            for name in names
            if resolve_firmware_source(firmware_root, name) is not None
        }
        unavailable_alternatives += len(names - available)
        if not available:
            uncovered.append((module, names))
            continue
        selected.update(available)

    print(f"ORDAX_DEV_BASE_FIRMWARE_DECLARED={len(declared_names)}", flush=True)
    print(f"ORDAX_DEV_BASE_FIRMWARE_MODULES_REQUIRING={len(requiring)}", flush=True)
    print(
        "ORDAX_DEV_BASE_FIRMWARE_AVAILABLE="
        f"{len(selected)} unavailable_alternatives={unavailable_alternatives}",
        flush=True,
    )

    if uncovered:
        details = []
        for module, names in uncovered[:6]:
            preview = ", ".join(sorted(names)[:6])
            details.append(f"{module.name}: {preview}")
        raise FirmwareSelectionError(
            "firmware coverage missing for "
            f"{len(uncovered)} module(s): {'; '.join(details)}"
        )
    if not selected:
        raise FirmwareSelectionError("no declared firmware is available in the development base")
    return selected
