#!/usr/bin/env python3
"""Build and verify a disposable two-partition OrdaX disk image.

This tool is intentionally proof-only. It accepts a staged filesystem tree and
publishes a regular .raw file plus proof.json. It never accepts a block-device
path and it does not authorize physical writes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
from typing import Any

SCHEMA = "prototype-ordax.physical-media/1"
ESP_TYPE_GUID = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b"
LINUX_FS_TYPE_GUID = "0fc63daf-8483-4772-8e79-3d69d8477de4"
REQUIRED_TOOLS = ("sgdisk", "mkfs.vfat", "mkfs.ext4", "mmd", "mcopy", "mdir", "debugfs", "blkid", "dd")


class ProofError(RuntimeError):
    pass


def run(args: list[str], *, text: bool = True) -> subprocess.CompletedProcess[Any]:
    try:
        return subprocess.run(
            args,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=text,
        )
    except subprocess.CalledProcessError as exc:
        stdout = exc.stdout.decode("utf-8", "replace") if isinstance(exc.stdout, bytes) else exc.stdout
        stderr = exc.stderr.decode("utf-8", "replace") if isinstance(exc.stderr, bytes) else exc.stderr
        raise ProofError(
            f"command failed ({' '.join(args)}): stdout={stdout!r} stderr={stderr!r}"
        ) from exc


def load_contract(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProofError(f"cannot load physical-media contract: {exc}") from exc
    validate_contract(data)
    return data


def validate_contract(data: dict[str, Any]) -> None:
    if data.get("$schema") != SCHEMA:
        raise ProofError(f"unsupported physical-media schema {data.get('$schema')!r}")
    if data.get("status") != "prototype-proof-only":
        raise ProofError("physical-media contract is not proof-only")
    if data.get("physical_write_allowed") is not False:
        raise ProofError("physical write must remain blocked by this contract")
    if data.get("partition_table") != "gpt":
        raise ProofError("partition table must be GPT")

    sector = data.get("logical_sector_bytes")
    alignment = data.get("alignment_bytes")
    if sector != 512:
        raise ProofError("logical sector size must be exactly 512 bytes")
    if alignment != 1024 * 1024 or alignment % sector != 0:
        raise ProofError("alignment must be exactly 1 MiB and sector aligned")

    proof = data.get("disposable_proof")
    if not isinstance(proof, dict):
        raise ProofError("disposable_proof must be an object")
    image_bytes = proof.get("image_bytes")
    if not isinstance(image_bytes, int) or image_bytes < 512 * 1024 * 1024:
        raise ProofError("disposable proof image must be at least 512 MiB")
    if image_bytes % alignment != 0:
        raise ProofError("disposable proof image must be alignment sized")
    if proof.get("physical_capacity_policy") != "proof-only-not-a-device-capacity-contract":
        raise ProofError("proof image capacity must not become a physical-device capacity contract")

    partitions = data.get("partitions")
    if not isinstance(partitions, list) or len(partitions) != 2:
        raise ProofError("physical-media contract must define exactly two partitions")

    esp, main = partitions
    expected_esp = {
        "index": 1,
        "name": "ORDAX-ESP",
        "role": "uefi-boot",
        "gpt_type_guid": ESP_TYPE_GUID,
        "filesystem": "fat32",
        "filesystem_label": "ORDAX-ESP",
        "start_lba": alignment // sector,
        "size_bytes": 256 * 1024 * 1024,
    }
    for key, expected in expected_esp.items():
        actual = esp.get(key)
        if isinstance(expected, str) and key == "gpt_type_guid":
            actual = str(actual).lower()
        if actual != expected:
            raise ProofError(f"ESP contract mismatch for {key}: expected={expected!r} actual={actual!r}")

    expected_main_start = esp["start_lba"] + esp["size_bytes"] // sector
    expected_main = {
        "index": 2,
        "name": "ORDAX",
        "role": "main",
        "gpt_type_guid": LINUX_FS_TYPE_GUID,
        "filesystem": "ext4",
        "filesystem_label": "ORDAX",
        "start_lba": expected_main_start,
        "size_policy": "fill-remaining-usable",
    }
    for key, expected in expected_main.items():
        actual = main.get(key)
        if isinstance(expected, str) and key == "gpt_type_guid":
            actual = str(actual).lower()
        if actual != expected:
            raise ProofError(f"main partition contract mismatch for {key}: expected={expected!r} actual={actual!r}")

    forbidden = set(data.get("forbidden_partitions", []))
    if not {"ORDAX-HOME", "ORDAX-PLATFORM"}.issubset(forbidden):
        raise ProofError("legacy physical partitions must remain explicitly forbidden")


def require_tools() -> None:
    missing = [tool for tool in REQUIRED_TOOLS if shutil.which(tool) is None]
    if missing:
        raise ProofError("missing disposable-proof tools: " + ", ".join(missing))


def _is_real_directory(path: Path, label: str) -> None:
    try:
        info = path.lstat()
    except OSError as exc:
        raise ProofError(f"cannot stat {label}: {exc}") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise ProofError(f"{label} must be a real directory, not a symlink")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_stage_tree(stage_root: Path) -> dict[str, list[dict[str, Any]]]:
    stage_root = stage_root.absolute()
    _is_real_directory(stage_root, "stage root")
    entries = sorted(item.name for item in stage_root.iterdir())
    if entries != ["ORDAX", "ORDAX-ESP"]:
        raise ProofError(f"stage root must contain exactly ORDAX-ESP and ORDAX; found={entries!r}")

    inventory: dict[str, list[dict[str, Any]]] = {"ORDAX-ESP": [], "ORDAX": []}
    for partition in ("ORDAX-ESP", "ORDAX"):
        root = stage_root / partition
        _is_real_directory(root, partition)
        for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
            current_path = Path(current)
            for name in list(dirnames):
                candidate = current_path / name
                info = candidate.lstat()
                if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                    raise ProofError(f"unsafe staged directory: {candidate}")
            for name in filenames:
                candidate = current_path / name
                info = candidate.lstat()
                if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                    raise ProofError(f"unsafe staged file: {candidate}")
                relative = candidate.relative_to(root).as_posix()
                if "\n" in relative or "\r" in relative or "\x00" in relative:
                    raise ProofError(f"unsafe staged path: {relative!r}")
                inventory[partition].append(
                    {
                        "path": relative,
                        "sha256": sha256_file(candidate),
                        "size": info.st_size,
                    }
                )
        inventory[partition].sort(key=lambda entry: entry["path"])
    return inventory


def ensure_publish_target(output_root: Path) -> Path:
    output_root = output_root.absolute()
    parent = output_root.parent
    _is_real_directory(parent, "output parent")
    if output_root.exists() or output_root.is_symlink():
        _is_real_directory(output_root, "output root")
        if any(output_root.iterdir()):
            raise ProofError("output root must be empty")
    return output_root


def parse_sgdisk_info(text: str) -> dict[str, Any]:
    patterns = {
        "type_guid": r"Partition GUID code:\s+([0-9A-Fa-f-]{36})",
        "first_lba": r"First sector:\s+(\d+)",
        "last_lba": r"Last sector:\s+(\d+)",
        "name": r"Partition name:\s+'([^']*)'",
    }
    result: dict[str, Any] = {}
    for key, pattern in patterns.items():
        match = re.search(pattern, text)
        if not match:
            raise ProofError(f"cannot parse sgdisk partition field {key}")
        result[key] = match.group(1)
    result["type_guid"] = str(result["type_guid"]).lower()
    result["first_lba"] = int(result["first_lba"])
    result["last_lba"] = int(result["last_lba"])
    result["sector_count"] = result["last_lba"] - result["first_lba"] + 1
    return result


def verify_partition_info(raw: Path, contract: dict[str, Any]) -> list[dict[str, Any]]:
    sector = contract["logical_sector_bytes"]
    verified: list[dict[str, Any]] = []
    for expected in contract["partitions"]:
        info_text = run(["sgdisk", f"--info={expected['index']}", str(raw)]).stdout
        info = parse_sgdisk_info(info_text)
        if info["name"] != expected["name"]:
            raise ProofError(f"partition {expected['index']} name mismatch")
        if info["type_guid"] != expected["gpt_type_guid"].lower():
            raise ProofError(f"partition {expected['index']} type GUID mismatch")
        if info["first_lba"] != expected["start_lba"]:
            raise ProofError(f"partition {expected['index']} start LBA mismatch")
        if expected["index"] == 1:
            expected_sectors = expected["size_bytes"] // sector
            if info["sector_count"] != expected_sectors:
                raise ProofError("ESP size mismatch")
        verified.append(info)
    return verified


def parse_blkid(path: Path) -> dict[str, str]:
    output = run(["blkid", "-p", "-o", "export", str(path)]).stdout
    values: dict[str, str] = {}
    for line in output.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


def make_vfat(image: Path, size_bytes: int, label: str) -> None:
    with image.open("wb") as handle:
        handle.truncate(size_bytes)
    run(["mkfs.vfat", "-F", "32", "-n", label, str(image)])


def populate_vfat(image: Path, source_root: Path) -> None:
    directories: list[Path] = []
    files: list[Path] = []
    for current, dirnames, filenames in os.walk(source_root, topdown=True, followlinks=False):
        current_path = Path(current)
        directories.extend(current_path / name for name in dirnames)
        files.extend(current_path / name for name in filenames)
    directories.sort(key=lambda item: (len(item.relative_to(source_root).parts), item.as_posix()))
    files.sort(key=lambda item: item.as_posix())

    for directory in directories:
        relative = directory.relative_to(source_root).as_posix()
        run(["mmd", "-i", str(image), f"::/{relative}"])
    for source in files:
        relative = source.relative_to(source_root).as_posix()
        run(["mcopy", "-o", "-i", str(image), str(source), f"::/{relative}"])


def make_ext4(image: Path, size_bytes: int, label: str, source_root: Path) -> None:
    with image.open("wb") as handle:
        handle.truncate(size_bytes)
    run(["mkfs.ext4", "-q", "-F", "-L", label, "-d", str(source_root), str(image)])


def verify_filesystem_identity(image: Path, expected_type: str, expected_label: str) -> dict[str, str]:
    values = parse_blkid(image)
    if values.get("TYPE") != expected_type:
        raise ProofError(
            f"filesystem type mismatch for {image.name}: expected={expected_type!r} actual={values.get('TYPE')!r}"
        )
    if values.get("LABEL") != expected_label:
        raise ProofError(
            f"filesystem label mismatch for {image.name}: expected={expected_label!r} actual={values.get('LABEL')!r}"
        )
    return {"type": values["TYPE"], "label": values["LABEL"], "uuid": values.get("UUID", "")}


def verify_vfat_files(image: Path, inventory: list[dict[str, Any]], work: Path) -> None:
    extract_root = work / "fat-extract"
    extract_root.mkdir()
    for entry in inventory:
        target = extract_root / hashlib.sha256(entry["path"].encode("utf-8")).hexdigest()
        run(["mcopy", "-i", str(image), f"::/{entry['path']}", str(target)])
        actual = sha256_file(target)
        if actual != entry["sha256"]:
            raise ProofError(f"FAT32 file hash mismatch after extraction: {entry['path']}")


def _debugfs_quote(path: str) -> str:
    return '"' + path.replace("\\", "\\\\").replace('"', '\\"') + '"'


def verify_ext4_files(image: Path, inventory: list[dict[str, Any]]) -> None:
    for entry in inventory:
        command = "cat " + _debugfs_quote("/" + entry["path"])
        completed = run(["debugfs", "-R", command, str(image)], text=False)
        actual = hashlib.sha256(completed.stdout).hexdigest()
        if actual != entry["sha256"]:
            raise ProofError(f"ext4 file hash mismatch after extraction: {entry['path']}")


def verify_ext4_directories(image: Path, source_root: Path) -> int:
    directories: list[str] = []
    for current, dirnames, _ in os.walk(source_root, topdown=True, followlinks=False):
        current_path = Path(current)
        for name in dirnames:
            directories.append((current_path / name).relative_to(source_root).as_posix())
    for relative in sorted(directories):
        command = "stat " + _debugfs_quote("/" + relative)
        output = run(["debugfs", "-R", command, str(image)]).stdout
        if "Type: directory" not in output:
            raise ProofError(f"ext4 directory missing after materialization: {relative}")
    return len(directories)


def embed_partition(raw: Path, partition_image: Path, start_lba: int, sector: int) -> None:
    run(
        [
            "dd",
            f"if={partition_image}",
            f"of={raw}",
            f"bs={sector}",
            f"seek={start_lba}",
            "conv=notrunc,sparse",
            "status=none",
        ]
    )


def compare_embedded_partition(raw: Path, partition_image: Path, start_lba: int, sector: int) -> None:
    offset = start_lba * sector
    with raw.open("rb") as raw_handle, partition_image.open("rb") as part_handle:
        raw_handle.seek(offset)
        while True:
            expected = part_handle.read(1024 * 1024)
            if not expected:
                break
            actual = raw_handle.read(len(expected))
            if actual != expected:
                raise ProofError(f"raw image differs from {partition_image.name} at partition offset")


def fsync_file(path: Path) -> None:
    with path.open("rb") as handle:
        os.fsync(handle.fileno())


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def build_proof(contract_path: Path, stage_root: Path, output_root: Path) -> dict[str, Any]:
    contract = load_contract(contract_path)
    require_tools()
    inventory = inspect_stage_tree(stage_root)
    output_root = ensure_publish_target(output_root)

    sector = contract["logical_sector_bytes"]
    esp_contract, main_contract = contract["partitions"]
    proof_bytes = contract["disposable_proof"]["image_bytes"]

    staging = Path(
        tempfile.mkdtemp(prefix=f".{output_root.name}.proof-", dir=str(output_root.parent))
    )
    published = False
    try:
        raw = staging / "ordax-disposable.raw"
        with raw.open("wb") as handle:
            handle.truncate(proof_bytes)

        esp_last = esp_contract["start_lba"] + esp_contract["size_bytes"] // sector - 1
        run(["sgdisk", "--zap-all", str(raw)])
        run(["sgdisk", "--clear", str(raw)])
        run(
            [
                "sgdisk",
                f"--new=1:{esp_contract['start_lba']}:{esp_last}",
                f"--typecode=1:{esp_contract['gpt_type_guid']}",
                f"--change-name=1:{esp_contract['name']}",
                str(raw),
            ]
        )
        run(
            [
                "sgdisk",
                f"--new=2:{main_contract['start_lba']}:0",
                f"--typecode=2:{main_contract['gpt_type_guid']}",
                f"--change-name=2:{main_contract['name']}",
                str(raw),
            ]
        )
        run(["sgdisk", "--verify", str(raw)])
        partition_info = verify_partition_info(raw, contract)

        esp_image = staging / "esp.fat32"
        main_image = staging / "ordax.ext4"
        main_bytes = partition_info[1]["sector_count"] * sector

        make_vfat(esp_image, esp_contract["size_bytes"], esp_contract["filesystem_label"])
        populate_vfat(esp_image, stage_root / "ORDAX-ESP")
        make_ext4(main_image, main_bytes, main_contract["filesystem_label"], stage_root / "ORDAX")

        esp_identity = verify_filesystem_identity(
            esp_image, "vfat", esp_contract["filesystem_label"]
        )
        main_identity = verify_filesystem_identity(
            main_image, "ext4", main_contract["filesystem_label"]
        )

        verify_vfat_files(esp_image, inventory["ORDAX-ESP"], staging)
        verify_ext4_files(main_image, inventory["ORDAX"])
        ext4_directory_count = verify_ext4_directories(main_image, stage_root / "ORDAX")

        embed_partition(raw, esp_image, esp_contract["start_lba"], sector)
        embed_partition(raw, main_image, main_contract["start_lba"], sector)
        compare_embedded_partition(raw, esp_image, esp_contract["start_lba"], sector)
        compare_embedded_partition(raw, main_image, main_contract["start_lba"], sector)

        run(["sgdisk", "--verify", str(raw)])
        verify_partition_info(raw, contract)

        esp_image.unlink()
        main_image.unlink()
        extract_root = staging / "fat-extract"
        if extract_root.exists():
            shutil.rmtree(extract_root)

        fsync_file(raw)
        proof = {
            "$schema": "prototype-ordax.creator-disposable-media-proof/1",
            "status": "pass",
            "physical_write_authorized": False,
            "source_contract_schema": contract["$schema"],
            "partition_table": "gpt",
            "logical_sector_bytes": sector,
            "image_bytes": proof_bytes,
            "image_sha256": sha256_file(raw),
            "partitions": [
                {
                    "index": 1,
                    "name": esp_contract["name"],
                    "type_guid": partition_info[0]["type_guid"],
                    "first_lba": partition_info[0]["first_lba"],
                    "last_lba": partition_info[0]["last_lba"],
                    "sector_count": partition_info[0]["sector_count"],
                    "filesystem": esp_identity,
                    "verified_file_count": len(inventory["ORDAX-ESP"]),
                },
                {
                    "index": 2,
                    "name": main_contract["name"],
                    "type_guid": partition_info[1]["type_guid"],
                    "first_lba": partition_info[1]["first_lba"],
                    "last_lba": partition_info[1]["last_lba"],
                    "sector_count": partition_info[1]["sector_count"],
                    "filesystem": main_identity,
                    "verified_file_count": len(inventory["ORDAX"]),
                    "verified_directory_count": ext4_directory_count,
                },
            ],
            "checks": {
                "gpt_valid": True,
                "partition_count_exactly_two": True,
                "partition_geometry_matches_contract": True,
                "filesystem_types_and_labels_match_contract": True,
                "staged_file_hashes_reverified_from_filesystems": True,
                "raw_partition_bytes_match_filesystem_images": True,
                "physical_write_remains_blocked": True,
            },
        }
        proof_path = staging / "proof.json"
        proof_path.write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        fsync_file(proof_path)
        fsync_directory(staging)

        os.replace(staging, output_root)
        fsync_directory(output_root.parent)
        published = True
        return proof
    finally:
        if not published and staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--contract",
        default="docs/contracts/physical-media.json",
        type=Path,
        help="canonical physical-media geometry contract",
    )
    parser.add_argument("--stage-root", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    args = parser.parse_args()

    try:
        proof = build_proof(args.contract, args.stage_root, args.output_root)
    except ProofError as exc:
        print(f"ordax-disposable-media: {exc}", file=os.sys.stderr)
        return 1

    print("DISPOSABLE_GPT=PASS")
    print("PARTITION_COUNT=2")
    print("FILESYSTEMS=FAT32,EXT4")
    print("PROVISION_VERIFY=PASS")
    print("PHYSICAL_WRITE_AUTHORIZED=NO")
    print(f"IMAGE_SHA256={proof['image_sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
