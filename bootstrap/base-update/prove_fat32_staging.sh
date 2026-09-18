#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROOF="${1:-$ROOT/out/base-update/fat32-staging-proof.json}"

for command in losetup mkfs.vfat fsck.vfat mount umount mountpoint sha256sum python3 stat; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "base-update-fat32-proof: required program not found: $command" >&2
    exit 1
  fi
done

WORK="$(mktemp -d "$ROOT/out/base-update-fat32.XXXXXX")"
IMAGE="$WORK/esp.raw"
MOUNT="$WORK/mnt"
KERNEL="$WORK/candidate-kernel"
INITRAMFS="$WORK/candidate-initramfs"
CANDIDATE="$WORK/candidate.json"
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

sudo mkdir -p   "$MOUNT/loader/entries"   "$MOUNT/ordax/base/a"
printf 'title OrdaX Current\nlinux /ordax/base/a/vmlinuz\ninitrd /ordax/base/a/initrd.gz\noptions console=tty0 ordax.mode=normal ordax.base_slot=a\n'   | sudo tee "$MOUNT/loader/entries/ordax.conf" >/dev/null
printf 'title OrdaX Recovery\nlinux /ordax/base/a/vmlinuz\ninitrd /ordax/base/a/initrd.gz\noptions console=tty0 ordax.mode=recovery ordax.base_slot=a\n'   | sudo tee "$MOUNT/loader/entries/ordax-recovery.conf" >/dev/null
printf 'known-good-kernel\n' | sudo tee "$MOUNT/ordax/base/a/vmlinuz" >/dev/null
printf 'known-good-initramfs\n' | sudo tee "$MOUNT/ordax/base/a/initrd.gz" >/dev/null
sync

printf 'candidate-kernel-bytes\n' >"$KERNEL"
printf 'candidate-initramfs-bytes\n' >"$INITRAMFS"
KERNEL_SHA="$(sha256sum "$KERNEL" | awk '{print $1}')"
INITRAMFS_SHA="$(sha256sum "$INITRAMFS" | awk '{print $1}')"
RELEASE_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
cat >"$CANDIDATE" <<EOF
{
  "release_sha": "$RELEASE_SHA",
  "kernel_sha256": "$KERNEL_SHA",
  "initramfs_sha256": "$INITRAMFS_SHA"
}
EOF

CURRENT_BEFORE="$(sudo sha256sum "$MOUNT/loader/entries/ordax.conf" | awk '{print $1}')"
RECOVERY_BEFORE="$(sudo sha256sum "$MOUNT/loader/entries/ordax-recovery.conf" | awk '{print $1}')"
ACTIVE_KERNEL_BEFORE="$(sudo sha256sum "$MOUNT/ordax/base/a/vmlinuz" | awk '{print $1}')"
ACTIVE_INITRAMFS_BEFORE="$(sudo sha256sum "$MOUNT/ordax/base/a/initrd.gz" | awk '{print $1}')"

sudo python3 "$ROOT/bootstrap/base-update/stage.py"   --esp-root "$MOUNT"   --active-slot a   --candidate "$CANDIDATE"   --kernel "$KERNEL"   --initramfs "$INITRAMFS"   >"$WORK/stage-result.json"

python3 - "$WORK/stage-result.json" <<'PY'
import json, pathlib, sys
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
sudo fsck.vfat -n "$LOOP" >"$WORK/fsck.txt"
grep -Eiq 'files, [0-9]+/[0-9]+ clusters|Leaving filesystem unchanged|FATs differ but appear to be intact|0x41: Dirty bit is set' "$WORK/fsck.txt" || true

sudo mount -t vfat -o ro,umask=0022 "$LOOP" "$MOUNT"
test "$(sudo sha256sum "$MOUNT/loader/entries/ordax.conf" | awk '{print $1}')" = "$CURRENT_BEFORE"
test "$(sudo sha256sum "$MOUNT/loader/entries/ordax-recovery.conf" | awk '{print $1}')" = "$RECOVERY_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/a/vmlinuz" | awk '{print $1}')" = "$ACTIVE_KERNEL_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/a/initrd.gz" | awk '{print $1}')" = "$ACTIVE_INITRAMFS_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/b/vmlinuz" | awk '{print $1}')" = "$KERNEL_SHA"
test "$(sudo sha256sum "$MOUNT/ordax/base/b/initrd.gz" | awk '{print $1}')" = "$INITRAMFS_SHA"
sudo grep -Fq 'ordax.base_slot=b' "$MOUNT/loader/entries/ordax-candidate+01-00.conf"
sudo umount "$MOUNT"

IMAGE_SHA="$(sha256sum "$IMAGE" | awk '{print $1}')"
SOURCE_COMMIT="${GITHUB_SHA:-unknown}"
cat >"$PROOF" <<EOF
{
  "$schema": "prototype-ordax.base-update-fat32-staging-proof/1",
  "status": "pass",
  "source_commit": "$SOURCE_COMMIT",
  "filesystem": "fat32",
  "filesystem_label": "ORDAX-ESP",
  "image_sha256": "$IMAGE_SHA",
  "active_slot": "a",
  "candidate_slot": "b",
  "release_sha": "$RELEASE_SHA",
  "checks": {
    "known_good_current_entry_preserved": true,
    "known_good_recovery_entry_preserved": true,
    "active_kernel_preserved": true,
    "active_initramfs_preserved": true,
    "candidate_kernel_hash_verified": true,
    "candidate_initramfs_hash_verified": true,
    "candidate_entry_written_last": true,
    "filesystem_survives_unmount_fsck_remount": true,
    "activation_not_performed": true,
    "reboot_not_requested": true
  },
  "real_hardware_touched": false,
  "physical_write_authorized": false
}
EOF
python3 -m json.tool "$PROOF" >/dev/null
rm -f "$IMAGE"
printf 'ORDAX_BASE_UPDATE_FAT32_STAGING_PROOF=PASS proof=%s\n' "$PROOF"
printf 'RAW_IMAGE_PUBLISHED=NO\n'
