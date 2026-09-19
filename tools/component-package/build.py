#!/usr/bin/env python3
"""Build and verify deterministic OrdaX runtime component candidate packages."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parents[1]
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from source_graph import (  # noqa: E402
    SourceGraphError,
    dependency_specifiers,
    discover_graph,
    resolve_local,
)

SCHEMA = "prototype-ordax.runtime-component-package/1"
RELEASE_SCHEMA = "prototype-ordax.runtime-component-release/1"
SOURCE_REPOSITORY = "washingtonmsdj/prototipo-ordax-os"
CREATED_FROM_CI_RECIPE = "runtime-component/package/1"
MANIFEST_NAME = "component-package.json"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$"
)
MAX_FILES = 256
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024
FORBIDDEN_PREFIXES = (
    "system/adapters/",
    "system/composition/",
    "system/surface/runtime/",
)


class ComponentPackageError(RuntimeError):
    pass


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def load_component_metadata(component_id: str, root: Path = ROOT) -> dict:
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", component_id):
        raise ComponentPackageError("component id is invalid")
    script = root / "tools" / "component-package" / "metadata.mjs"
    if not script.is_file():
        raise ComponentPackageError("component package metadata helper is missing")
    try:
        result = subprocess.run(
            ["node", str(script), component_id],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        raise ComponentPackageError(
            f"could not resolve canonical component metadata: {exc}"
        ) from exc
    try:
        metadata = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ComponentPackageError("component metadata helper returned invalid JSON") from exc

    if set(metadata) != {"component", "entrypoint"}:
        raise ComponentPackageError("component metadata has unexpected fields")
    component = metadata["component"]
    expected_component_keys = {
        "id",
        "title",
        "kind",
        "version",
        "releaseMode",
        "criticality",
        "failureDomain",
        "restartScope",
        "healthMode",
        "owner",
        "dependencies",
    }
    if not isinstance(component, dict) or set(component) != expected_component_keys:
        raise ComponentPackageError("component metadata identity is malformed")
    if component["id"] != component_id:
        raise ComponentPackageError("component metadata id mismatch")
    if not SEMVER_RE.fullmatch(str(component["version"])):
        raise ComponentPackageError("component metadata version is not semantic")
    if component["releaseMode"] not in {"bundled", "git-app", "component-slot"}:
        raise ComponentPackageError("component package source has unsupported release mode")
    if not isinstance(component["dependencies"], list):
        raise ComponentPackageError("component dependencies must be a list")
    entrypoint = PurePosixPath(str(metadata["entrypoint"]))
    if entrypoint.is_absolute() or ".." in entrypoint.parts:
        raise ComponentPackageError("component entrypoint is unsafe")
    allowed_entrypoint_roots = (
        f"system/components/{component_id}/",
        f"system/apps/{component_id}/",
    )
    if not str(entrypoint).startswith(allowed_entrypoint_roots):
        raise ComponentPackageError("component entrypoint is outside component ownership")
    return {"component": component, "entrypoint": entrypoint}


def component_graph(component_id: str, root: Path = ROOT) -> tuple[dict, list[PurePosixPath]]:
    metadata = load_component_metadata(component_id, root)
    try:
        graph = discover_graph(
            root,
            metadata["entrypoint"],
            allowed_prefixes=("system",),
        )
    except SourceGraphError as exc:
        raise ComponentPackageError(str(exc)) from exc

    if len(graph) == 0 or len(graph) > MAX_FILES:
        raise ComponentPackageError("component source graph file count is outside allowed bounds")
    total = 0
    for relative in graph:
        path = root / relative
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            raise ComponentPackageError(f"component source is not a regular file: {relative}")
        if info.st_size <= 0 or info.st_size > MAX_FILE_BYTES:
            raise ComponentPackageError(f"component source size is invalid: {relative}")
        total += info.st_size
        if total > MAX_TOTAL_BYTES:
            raise ComponentPackageError("component source graph exceeds total size limit")
        value = relative.as_posix()
        if value.startswith(FORBIDDEN_PREFIXES):
            raise ComponentPackageError(
                f"component package crossed a forbidden platform boundary: {relative}"
            )
        if value.startswith("system/apps/") and not value.startswith(
            f"system/apps/{component_id}/"
        ):
            raise ComponentPackageError(
                f"component package crossed into another app owner: {relative}"
            )
    return metadata, graph


def source_records(root: Path, graph: list[PurePosixPath]) -> list[dict]:
    records = []
    for relative in graph:
        payload = (root / relative).read_bytes()
        records.append(
            {
                "path": relative.as_posix(),
                "sha256": sha256_bytes(payload),
                "size": len(payload),
            }
        )
    return records


def render_manifest(
    component_id: str,
    source_commit: str,
    *,
    root: Path = ROOT,
) -> tuple[dict, list[PurePosixPath]]:
    if not SHA40_RE.fullmatch(source_commit):
        raise ComponentPackageError("source commit must be a full lowercase 40-hex SHA")
    metadata, graph = component_graph(component_id, root)
    records = source_records(root, graph)
    manifest = {
        "$schema": SCHEMA,
        "status": "candidate",
        "component": metadata["component"],
        "source_commit": source_commit,
        "entrypoint": metadata["entrypoint"].as_posix(),
        "self_contained_source_graph": True,
        "remote_runtime_dependencies": False,
        "activation_allowed": False,
        "signature_required_before_activation": True,
        "native_adapters_packaged": False,
        "composition_packaged": False,
        "files": records,
    }
    return manifest, graph


def safe_zip_name(name: str) -> PurePosixPath:
    if not name or "\\" in name:
        raise ComponentPackageError(f"unsafe package path: {name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "." in path.parts:
        raise ComponentPackageError(f"unsafe package path: {name!r}")
    return path


def zip_info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o644) << 16
    return info


def build_package(
    component_id: str,
    source_commit: str,
    output: Path,
    *,
    root: Path = ROOT,
) -> dict:
    if output.exists():
        raise ComponentPackageError(f"refusing to overwrite existing package: {output}")
    manifest, graph = render_manifest(component_id, source_commit, root=root)
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest_bytes = (
        json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    ).encode("utf-8")

    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr(zip_info(MANIFEST_NAME), manifest_bytes)
        for relative in graph:
            archive.writestr(
                zip_info(relative.as_posix()),
                (root / relative).read_bytes(),
            )
    return manifest


def validate_manifest_shape(manifest: object) -> dict:
    if not isinstance(manifest, dict):
        raise ComponentPackageError("component package manifest must be an object")
    expected = {
        "$schema",
        "status",
        "component",
        "source_commit",
        "entrypoint",
        "self_contained_source_graph",
        "remote_runtime_dependencies",
        "activation_allowed",
        "signature_required_before_activation",
        "native_adapters_packaged",
        "composition_packaged",
        "files",
    }
    if set(manifest) != expected:
        raise ComponentPackageError("component package manifest fields are not canonical")
    if manifest["$schema"] != SCHEMA or manifest["status"] != "candidate":
        raise ComponentPackageError("unsupported component package manifest")
    if not SHA40_RE.fullmatch(str(manifest["source_commit"])):
        raise ComponentPackageError("component package source_commit is invalid")
    if (
        manifest["self_contained_source_graph"] is not True
        or manifest["remote_runtime_dependencies"] is not False
        or manifest["activation_allowed"] is not False
        or manifest["signature_required_before_activation"] is not True
        or manifest["native_adapters_packaged"] is not False
        or manifest["composition_packaged"] is not False
    ):
        raise ComponentPackageError("component package safety policy is invalid")

    component = manifest["component"]
    if not isinstance(component, dict):
        raise ComponentPackageError("component package identity is invalid")
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", str(component.get("id", ""))):
        raise ComponentPackageError("component package id is invalid")
    if not SEMVER_RE.fullmatch(str(component.get("version", ""))):
        raise ComponentPackageError("component package version is invalid")
    if component.get("releaseMode") not in {"bundled", "git-app", "component-slot"}:
        raise ComponentPackageError("component package release mode is invalid")

    entrypoint = safe_zip_name(str(manifest["entrypoint"]))
    if not entrypoint.as_posix().startswith(
        (
            f"system/components/{component['id']}/",
            f"system/apps/{component['id']}/",
        )
    ):
        raise ComponentPackageError("component package entrypoint ownership is invalid")

    records = manifest["files"]
    if not isinstance(records, list) or not records or len(records) > MAX_FILES:
        raise ComponentPackageError("component package file records are invalid")
    paths = set()
    total = 0
    for record in records:
        if not isinstance(record, dict) or set(record) != {"path", "sha256", "size"}:
            raise ComponentPackageError("component package file record is malformed")
        path = safe_zip_name(str(record["path"])).as_posix()
        if path in paths:
            raise ComponentPackageError("component package file paths must be unique")
        paths.add(path)
        if path.startswith(FORBIDDEN_PREFIXES):
            raise ComponentPackageError("component package contains forbidden platform code")
        if path.startswith("system/apps/") and not path.startswith(
            f"system/apps/{component['id']}/"
        ):
            raise ComponentPackageError("component package contains another app owner")
        if not SHA256_RE.fullmatch(str(record["sha256"])):
            raise ComponentPackageError("component package file hash is invalid")
        size = record["size"]
        if (
            not isinstance(size, int)
            or isinstance(size, bool)
            or size <= 0
            or size > MAX_FILE_BYTES
        ):
            raise ComponentPackageError("component package file size is invalid")
        total += size
        if total > MAX_TOTAL_BYTES:
            raise ComponentPackageError("component package exceeds total size limit")
    if entrypoint.as_posix() not in paths:
        raise ComponentPackageError("component package entrypoint is not bound by manifest")
    return manifest


def verify_internal_graph(files: dict[str, bytes], entrypoint: str) -> None:
    pending = [PurePosixPath(entrypoint)]
    discovered: set[PurePosixPath] = set()
    available = set(files)
    while pending:
        current = pending.pop()
        if current in discovered:
            continue
        raw = files.get(current.as_posix())
        if raw is None:
            raise ComponentPackageError(f"missing packaged dependency: {current}")
        discovered.add(current)
        if current.suffix.lower() not in {".html", ".htm", ".mjs", ".js", ".cjs", ".css"}:
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeError as exc:
            raise ComponentPackageError(f"packaged source is not UTF-8: {current}") from exc
        for specifier in dependency_specifiers(current, text):
            try:
                dependency = resolve_local(
                    current,
                    specifier,
                    allowed_prefixes=("system",),
                )
            except SourceGraphError as exc:
                raise ComponentPackageError(str(exc)) from exc
            if dependency is None:
                continue
            if dependency.as_posix() not in available:
                raise ComponentPackageError(
                    f"component package is not self-contained: {current} -> {dependency}"
                )
            if dependency not in discovered:
                pending.append(dependency)

    if {path.as_posix() for path in discovered} != available:
        extras = sorted(available - {path.as_posix() for path in discovered})
        raise ComponentPackageError(
            f"component package contains unreachable files: {extras}"
        )


def verify_package(package: Path) -> dict:
    if not package.is_file():
        raise ComponentPackageError("component package file is missing")
    with zipfile.ZipFile(package, "r") as archive:
        infos = archive.infolist()
        if not infos or len(infos) > MAX_FILES + 1:
            raise ComponentPackageError("component package archive entry count is invalid")
        names = [info.filename for info in infos]
        if len(set(names)) != len(names):
            raise ComponentPackageError("component package archive has duplicate paths")
        for info in infos:
            safe_zip_name(info.filename)
            mode = (info.external_attr >> 16) & 0o170000
            if info.is_dir() or mode == stat.S_IFLNK:
                raise ComponentPackageError("component package archive contains unsafe entry type")
            if info.file_size > max(MAX_FILE_BYTES, 1024 * 1024):
                raise ComponentPackageError("component package archive entry is too large")
        if MANIFEST_NAME not in names:
            raise ComponentPackageError("component package manifest is missing")

        try:
            manifest = json.loads(archive.read(MANIFEST_NAME).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeError, KeyError) as exc:
            raise ComponentPackageError("component package manifest cannot be decoded") from exc
        manifest = validate_manifest_shape(manifest)
        records = {record["path"]: record for record in manifest["files"]}
        expected_names = {MANIFEST_NAME, *records}
        if set(names) != expected_names:
            raise ComponentPackageError("component package archive file set does not match manifest")

        files: dict[str, bytes] = {}
        for path, record in records.items():
            payload = archive.read(path)
            if len(payload) != record["size"] or sha256_bytes(payload) != record["sha256"]:
                raise ComponentPackageError(f"component package integrity mismatch: {path}")
            files[path] = payload

    verify_internal_graph(files, manifest["entrypoint"])
    return manifest



def render_release_descriptor(package: Path) -> dict:
    manifest = verify_package(package)
    component_id = manifest["component"]["id"]
    if package.name != f"{component_id}.zip":
        raise ComponentPackageError(
            "runtime component release package filename must match <component>.zip"
        )
    info = package.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise ComponentPackageError("runtime component release package must be a regular file")
    if info.st_size <= 0 or info.st_size > 32 * 1024 * 1024:
        raise ComponentPackageError("runtime component release package size is invalid")
    with zipfile.ZipFile(package, "r") as archive:
        manifest_bytes = archive.read(MANIFEST_NAME)
    package_bytes = package.read_bytes()
    descriptor = {
        "$schema": RELEASE_SCHEMA,
        "source_repository": SOURCE_REPOSITORY,
        "source_commit": manifest["source_commit"],
        "created_from_ci_recipe": CREATED_FROM_CI_RECIPE,
        "component": {
            "id": component_id,
            "version": manifest["component"]["version"],
            "release_mode": manifest["component"]["releaseMode"],
            "package_schema": manifest["$schema"],
        },
        "package": {
            "name": package.name,
            "sha256": sha256_bytes(package_bytes),
            "size": len(package_bytes),
            "manifest_sha256": sha256_bytes(manifest_bytes),
        },
        "activation": {
            "direct_activation_allowed": False,
            "pending_health_required": True,
        },
    }
    return descriptor


def write_release_descriptor(package: Path, output: Path) -> dict:
    if output.exists():
        raise ComponentPackageError(
            f"refusing to overwrite existing release descriptor: {output}"
        )
    descriptor = render_release_descriptor(package)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = (
        json.dumps(descriptor, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    ).encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(output, flags, 0o644)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        try:
            output.unlink()
        except FileNotFoundError:
            pass
        raise
    return descriptor


def command_describe(args: argparse.Namespace) -> int:
    descriptor = write_release_descriptor(
        Path(args.package),
        Path(args.out),
    )
    print("RUNTIME_COMPONENT_RELEASE_DESCRIPTOR=PASS")
    print(f"RUNTIME_COMPONENT_ID={descriptor['component']['id']}")
    print(f"RUNTIME_COMPONENT_VERSION={descriptor['component']['version']}")
    print(f"RUNTIME_COMPONENT_SOURCE_COMMIT={descriptor['source_commit']}")
    print("RUNTIME_COMPONENT_DIRECT_ACTIVATION_ALLOWED=NO")
    print("RUNTIME_COMPONENT_PENDING_HEALTH_REQUIRED=YES")
    return 0

def command_check(args: argparse.Namespace) -> int:
    metadata, graph = component_graph(args.component)
    print("RUNTIME_COMPONENT_SOURCE_GRAPH=PASS")
    print(f"RUNTIME_COMPONENT_ID={metadata['component']['id']}")
    print(f"RUNTIME_COMPONENT_VERSION={metadata['component']['version']}")
    print(f"RUNTIME_COMPONENT_SOURCE_FILE_COUNT={len(graph)}")
    print("RUNTIME_COMPONENT_ACTIVATION_ALLOWED=NO")
    return 0


def command_build(args: argparse.Namespace) -> int:
    manifest = build_package(
        args.component,
        args.source_commit,
        Path(args.out),
    )
    print("RUNTIME_COMPONENT_BUILD=PASS")
    print(f"RUNTIME_COMPONENT_ID={manifest['component']['id']}")
    print(f"RUNTIME_COMPONENT_VERSION={manifest['component']['version']}")
    print(f"RUNTIME_COMPONENT_FILE_COUNT={len(manifest['files'])}")
    print("RUNTIME_COMPONENT_ACTIVATION_ALLOWED=NO")
    return 0


def command_verify(args: argparse.Namespace) -> int:
    manifest = verify_package(Path(args.package))
    print("RUNTIME_COMPONENT_VERIFY=PASS")
    print(f"RUNTIME_COMPONENT_ID={manifest['component']['id']}")
    print(f"RUNTIME_COMPONENT_VERSION={manifest['component']['version']}")
    print(f"RUNTIME_COMPONENT_SOURCE_COMMIT={manifest['source_commit']}")
    print("RUNTIME_COMPONENT_ACTIVATION_ALLOWED=NO")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check")
    check.add_argument("--component", required=True)

    build = sub.add_parser("build")
    build.add_argument("--component", required=True)
    build.add_argument("--source-commit", required=True)
    build.add_argument("--out", required=True)

    verify = sub.add_parser("verify")
    verify.add_argument("--package", required=True)

    describe = sub.add_parser("describe")
    describe.add_argument("--package", required=True)
    describe.add_argument("--out", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "check":
            return command_check(args)
        if args.command == "build":
            return command_build(args)
        if args.command == "describe":
            return command_describe(args)
        return command_verify(args)
    except (
        ComponentPackageError,
        OSError,
        ValueError,
        zipfile.BadZipFile,
    ) as exc:
        print(f"RUNTIME_COMPONENT_ERROR={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
