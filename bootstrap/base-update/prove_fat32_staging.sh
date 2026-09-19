#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROOF="${1:-$ROOT/out/base-update/fat32-staging-proof.json}"

for command in losetup mkfs.vfat fsck.vfat mount umount mountpoint sha256sum python3 sync; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "base-update-fat32-proof: required program not found: $command" >&2
    exit 1
  fi
done

mkdir -p "$ROOT/out"
WORK="$(mktemp -d "$ROOT/out/base-update-fat32.XXXXXX")"
IMAGE="$WORK/esp.raw"
MOUNT="$WORK/mnt"
KERNEL="$WORK/candidate-kernel"
INITRAMFS="$WORK/candidate-initramfs"
STAGE_RESULT="$WORK/stage-result.json"
LAYOUT_RESULT="$WORK/layout-result.json"
FSCK_RESULT="$WORK/fsck.txt"
LOOP=""

cleanup() {
  set +e
  if [[ -d "$MOUNT" ]] && mountpoint -q "$MOUNT"; then
    sudo umount "$MOUNT" >/dev/null 2>&1 || true
  fi
  if [[ -n "$LOOP" ]]; then
    sudo losetup -d "$LOOP" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$MOUNT" "$(dirname "$PROOF")"
truncate -s 64M "$IMAGE"
LOOP="$(sudo losetup --find --show "$IMAGE")"
sudo mkfs.vfat -F 32 -n ORDAX-ESP "$LOOP" >/dev/null
sudo mount -t vfat -o rw,umask=0022 "$LOOP" "$MOUNT"

sudo mkdir -p "$MOUNT/loader/entries" "$MOUNT/ordax/base/a"
printf 'title OrdaX Current\nlinux /ordax/base/a/vmlinuz\ninitrd /ordax/base/a/initrd.gz\noptions console=tty0 ordax.mode=normal ordax.base_slot=a\n' \
  | sudo tee "$MOUNT/loader/entries/ordax.conf" >/dev/null
printf 'title OrdaX Recovery\nlinux /ordax/base/a/vmlinuz\ninitrd /ordax/base/a/initrd.gz\noptions console=tty0 ordax.mode=recovery ordax.base_slot=a\n' \
  | sudo tee "$MOUNT/loader/entries/ordax-recovery.conf" >/dev/null
printf 'known-good-kernel\n' | sudo tee "$MOUNT/ordax/base/a/vmlinuz" >/dev/null
printf 'known-good-initramfs\n' | sudo tee "$MOUNT/ordax/base/a/initrd.gz" >/dev/null
sync

printf 'candidate-kernel-bytes\n' >"$KERNEL"
printf 'candidate-initramfs-bytes\n' >"$INITRAMFS"
KERNEL_SHA="$(sha256sum "$KERNEL" | awk '{print $1}')"
INITRAMFS_SHA="$(sha256sum "$INITRAMFS" | awk '{print $1}')"
RELEASE_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

CURRENT_BEFORE="$(sudo sha256sum "$MOUNT/loader/entries/ordax.conf" | awk '{print $1}')"
RECOVERY_BEFORE="$(sudo sha256sum "$MOUNT/loader/entries/ordax-recovery.conf" | awk '{print $1}')"
ACTIVE_KERNEL_BEFORE="$(sudo sha256sum "$MOUNT/ordax/base/a/vmlinuz" | awk '{print $1}')"
ACTIVE_INITRAMFS_BEFORE="$(sudo sha256sum "$MOUNT/ordax/base/a/initrd.gz" | awk '{print $1}')"

# This proof deliberately exercises only the filesystem staging owner.
# Signed-release verification remains a separate gate and is not bypassed by
# the product CLI, which still requires --envelope and the canonical trust path.
sudo python3 - \
  "$ROOT/bootstrap/base-update/stage.py" \
  "$MOUNT" "$KERNEL" "$INITRAMFS" \
  "$KERNEL_SHA" "$INITRAMFS_SHA" "$RELEASE_SHA" >"$STAGE_RESULT" <<'PY'
import importlib.util
import json
from pathlib import Path
import sys

module_path, esp_root, kernel, initramfs, kernel_sha, initramfs_sha, release_sha = sys.argv[1:]
spec = importlib.util.spec_from_file_location("ordax_base_update_fat32_proof", module_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

candidate = {
    "release_sha": release_sha,
    "kernel_sha256": kernel_sha,
    "initramfs_sha256": initramfs_sha,
}
result = module.stage(
    Path(esp_root),
    "a",
    candidate,
    Path(kernel),
    Path(initramfs),
)
print(json.dumps(result, sort_keys=True))
PY

python3 - "$STAGE_RESULT" <<'PY'
import json
import pathlib
import sys

result = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
assert result["$schema"] == "prototype-ordax.base-update-stage-result/1"
assert result["active_slot"] == "a"
assert result["candidate_slot"] == "b"
assert result["activation_ready"] is True
assert result["efi_variable_written"] is False
assert result["reboot_requested"] is False
PY

test "$(sudo sha256sum "$MOUNT/loader/entries/ordax.conf" | awk '{print $1}')" = "$CURRENT_BEFORE"
test "$(sudo sha256sum "$MOUNT/loader/entries/ordax-recovery.conf" | awk '{print $1}')" = "$RECOVERY_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/a/vmlinuz" | awk '{print $1}')" = "$ACTIVE_KERNEL_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/a/initrd.gz" | awk '{print $1}')" = "$ACTIVE_INITRAMFS_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/b/vmlinuz" | awk '{print $1}')" = "$KERNEL_SHA"
test "$(sudo sha256sum "$MOUNT/ordax/base/b/initrd.gz" | awk '{print $1}')" = "$INITRAMFS_SHA"
sudo grep -Fq 'ordax.base_slot=b' "$MOUNT/loader/entries/ordax-candidate+01-00.conf"
sudo grep -Fq "ordax.base_candidate=$RELEASE_SHA" "$MOUNT/loader/entries/ordax-candidate+01-00.conf"

sudo umount "$MOUNT"
sudo fsck.vfat -n "$LOOP" >"$FSCK_RESULT"

sudo mount -t vfat -o ro,umask=0022 "$LOOP" "$MOUNT"
test "$(sudo sha256sum "$MOUNT/loader/entries/ordax.conf" | awk '{print $1}')" = "$CURRENT_BEFORE"
test "$(sudo sha256sum "$MOUNT/loader/entries/ordax-recovery.conf" | awk '{print $1}')" = "$RECOVERY_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/a/vmlinuz" | awk '{print $1}')" = "$ACTIVE_KERNEL_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/a/initrd.gz" | awk '{print $1}')" = "$ACTIVE_INITRAMFS_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/b/vmlinuz" | awk '{print $1}')" = "$KERNEL_SHA"
test "$(sudo sha256sum "$MOUNT/ordax/base/b/initrd.gz" | awk '{print $1}')" = "$INITRAMFS_SHA"
sudo grep -Fq 'ordax.base_slot=b' "$MOUNT/loader/entries/ordax-candidate+01-00.conf"

python3 "$ROOT/system/services/base-update/esp_layout.py" \
  --esp-root "$MOUNT" >"$LAYOUT_RESULT"
python3 - "$LAYOUT_RESULT" "$RELEASE_SHA" <<'PY'
import json
import pathlib
import sys

layout = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
assert layout["$schema"] == "prototype-ordax.esp-layout/1"
assert layout["status"] == "valid"
assert layout["layout"] == "ab"
assert layout["active_slot"] == "a"
assert layout["stage_active_slot"] == "a"
assert layout["candidate_entry_present"] is True
assert layout["candidate_slot"] == "b"
assert layout["candidate_release_sha"] == sys.argv[2]
assert layout["write_authorized"] is False
assert layout["activation_authorized"] is False
PY

sudo umount "$MOUNT"

IMAGE_SHA="$(sha256sum "$IMAGE" | awk '{print $1}')"
SOURCE_COMMIT="${GITHUB_SHA:-unknown}"

python3 - \
  "$PROOF" "$SOURCE_COMMIT" "$IMAGE_SHA" "$RELEASE_SHA" "$KERNEL_SHA" "$INITRAMFS_SHA" <<'PY'
import json
import pathlib
import sys

proof_path, source_commit, image_sha, release_sha, kernel_sha, initramfs_sha = sys.argv[1:]
proof = {
    "$schema": "prototype-ordax.base-update-fat32-staging-proof/2",
    "status": "pass",
    "scope": "filesystem-staging-only",
    "source_commit": source_commit,
    "filesystem": "fat32",
    "filesystem_label": "ORDAX-ESP",
    "image_sha256": image_sha,
    "active_slot": "a",
    "candidate_slot": "b",
    "release_sha": release_sha,
    "kernel_sha256": kernel_sha,
    "initramfs_sha256": initramfs_sha,
    "checks": {
        "known_good_current_entry_preserved": True,
        "known_good_recovery_entry_preserved": True,
        "active_kernel_preserved": True,
        "active_initramfs_preserved": True,
        "candidate_kernel_hash_verified": True,
        "candidate_initramfs_hash_verified": True,
        "candidate_entry_written_last": True,
        "filesystem_passes_read_only_fsck": True,
        "filesystem_survives_unmount_fsck_remount": True,
        "readonly_layout_inspection_passed": True,
        "activation_not_performed": True,
        "reboot_not_requested": True,
    },
    "trust_boundary": {
        "stage_api_invocation": "direct-filesystem-proof",
        "canonical_release_trust_exercised": False,
        "release_signature_verification_exercised": False,
        "product_cli_trust_requirement_changed": False,
    },
    "real_hardware_touched": False,
    "physical_hardware_proven": False,
    "physical_write_authorized": False,
    "promotion_effect": "evidence-only; proves FAT32 staging behavior only and does not resolve canonical trust, activate a candidate, authorize physical writes or prove notebook boot",
}
path = pathlib.Path(proof_path)
path.write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

python3 -m json.tool "$PROOF" >/dev/null
rm -f "$IMAGE"
printf 'ORDAX_BASE_UPDATE_FAT32_STAGING_PROOF=PASS proof=%s\n' "$PROOF"
printf 'RAW_IMAGE_PUBLISHED=NO\n'
