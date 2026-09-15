#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELPER="${1:-$ROOT/out/initramfs-work/ordax-grow-ext4}"
PROOF="${2:-$ROOT/out/initramfs/ext4-growth-runtime-proof.json}"

if [[ ! -f "$HELPER" || -L "$HELPER" || ! -x "$HELPER" ]]; then
  echo "ext4-growth-proof: helper is missing, unsafe, or not executable: $HELPER" >&2
  exit 1
fi

for command in losetup mkfs.ext4 resize2fs dumpe2fs mount umount mountpoint blockdev sha256sum grep readelf awk sed; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ext4-growth-proof: required program not found: $command" >&2
    exit 1
  fi
done

if readelf -l "$HELPER" | grep -q 'Requesting program interpreter'; then
  echo "ext4-growth-proof: helper is dynamically linked" >&2
  exit 1
fi

ext4_block_count() {
  sudo dumpe2fs -h "$1" 2>/dev/null | awk '$1 == "Block" && $2 == "count:" {print $3; exit}'
}

ext4_block_size() {
  sudo dumpe2fs -h "$1" 2>/dev/null | awk '$1 == "Block" && $2 == "size:" {print $3; exit}'
}

ext4_blocks_per_group() {
  sudo dumpe2fs -h "$1" 2>/dev/null | awk '$1 == "Blocks" && $2 == "per" && $3 == "group:" {print $4; exit}'
}

WORK="$(mktemp -d "$ROOT/out/ext4-growth-proof.XXXXXX")"
IMAGE="$WORK/ordax.raw"
BASELINE_IMAGE="$WORK/resize2fs-baseline.raw"
DECOY_IMAGE="$WORK/decoy.raw"
MOUNT="$WORK/mnt"
BASELINE_MOUNT="$WORK/baseline-mnt"
LOOP=""
BASELINE_LOOP=""
DECOY_LOOP=""

cleanup() {
  set +e
  if [[ -d "$BASELINE_MOUNT" ]] && mountpoint -q "$BASELINE_MOUNT"; then
    sudo umount "$BASELINE_MOUNT"
  fi
  if [[ -d "$MOUNT" ]] && mountpoint -q "$MOUNT"; then
    sudo umount "$MOUNT"
  fi
  if [[ -n "$DECOY_LOOP" ]]; then
    sudo losetup -d "$DECOY_LOOP" >/dev/null 2>&1 || true
  fi
  if [[ -n "$BASELINE_LOOP" ]]; then
    sudo losetup -d "$BASELINE_LOOP" >/dev/null 2>&1 || true
  fi
  if [[ -n "$LOOP" ]]; then
    sudo losetup -d "$LOOP" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$MOUNT" "$BASELINE_MOUNT" "$(dirname "$PROOF")"

# 132 MiB deliberately leaves a small partial ext4 block group after the
# first full 128 MiB group. Both the OrdaX helper and upstream resize2fs must
# converge to the same safe maximum instead of assuming raw device blocks are
# identical to statfs capacity.
truncate -s 132M "$IMAGE"
truncate -s 132M "$BASELINE_IMAGE"
truncate -s 8M "$DECOY_IMAGE"
LOOP="$(sudo losetup --find --show "$IMAGE")"
BASELINE_LOOP="$(sudo losetup --find --show "$BASELINE_IMAGE")"
DECOY_LOOP="$(sudo losetup --find --show "$DECOY_IMAGE")"

# Deliberately create identical 64 MiB ext4 filesystems on larger devices.
sudo mkfs.ext4 -F -q -b 4096 -m 0 "$LOOP" 16384
sudo mkfs.ext4 -F -q -b 4096 -m 0 "$BASELINE_LOOP" 16384
sudo mount -t ext4 -o rw "$LOOP" "$MOUNT"

BLOCK_SIZE="$(ext4_block_size "$LOOP")"
BLOCKS_PER_GROUP="$(ext4_blocks_per_group "$LOOP")"
BEFORE_BLOCKS="$(ext4_block_count "$LOOP")"
DEVICE_BYTES="$(sudo blockdev --getsize64 "$LOOP")"
TARGET_BLOCKS="$((DEVICE_BYTES / BLOCK_SIZE))"

if [[ -z "$BLOCK_SIZE" || -z "$BLOCKS_PER_GROUP" || -z "$BEFORE_BLOCKS" ]]; then
  echo "ext4-growth-proof: could not read canonical ext4 superblock sizing" >&2
  exit 1
fi
if (( BEFORE_BLOCKS >= TARGET_BLOCKS )); then
  echo "ext4-growth-proof: fixture did not create a smaller filesystem" >&2
  exit 1
fi

set +e
MISMATCH_OUTPUT="$(sudo "$HELPER" "$DECOY_LOOP" "$MOUNT" 2>&1)"
MISMATCH_RC=$?
set -e
if (( MISMATCH_RC == 0 )) || ! grep -Fq 'mountpoint does not belong to the supplied block device' <<<"$MISMATCH_OUTPUT"; then
  echo "ext4-growth-proof: helper did not reject a mismatched block device" >&2
  echo "$MISMATCH_OUTPUT" >&2
  exit 1
fi

GROW_OUTPUT="$(sudo "$HELPER" "$LOOP" "$MOUNT")"
if ! grep -Fq 'ORDAX_EXT4_GROWTH=PASS' <<<"$GROW_OUTPUT"; then
  echo "ext4-growth-proof: helper did not report a successful online resize" >&2
  echo "$GROW_OUTPUT" >&2
  exit 1
fi

AFTER_BLOCKS="$(ext4_block_count "$LOOP")"
HELPER_FINAL_BLOCKS="$(sed -n 's/.* final_blocks=\([0-9][0-9]*\).*/\1/p' <<<"$GROW_OUTPUT")"
if [[ -z "$HELPER_FINAL_BLOCKS" || "$HELPER_FINAL_BLOCKS" != "$AFTER_BLOCKS" ]]; then
  echo "ext4-growth-proof: helper output disagrees with the ext4 primary superblock" >&2
  echo "$GROW_OUTPUT" >&2
  exit 1
fi
if (( AFTER_BLOCKS <= BEFORE_BLOCKS || AFTER_BLOCKS > TARGET_BLOCKS )); then
  echo "ext4-growth-proof: filesystem growth is outside the valid device range" >&2
  exit 1
fi

sudo umount "$MOUNT"

# Independent oracle: upstream resize2fs, on an identical mounted filesystem,
# must choose exactly the same maximum block count.
sudo mount -t ext4 -o rw "$BASELINE_LOOP" "$BASELINE_MOUNT"
RESIZE2FS_OUTPUT="$(sudo resize2fs "$BASELINE_LOOP" 2>&1)"
BASELINE_BLOCKS="$(ext4_block_count "$BASELINE_LOOP")"
sudo umount "$BASELINE_MOUNT"

if [[ "$AFTER_BLOCKS" != "$BASELINE_BLOCKS" ]]; then
  echo "ext4-growth-proof: OrdaX helper does not match upstream resize2fs maximum" >&2
  echo "helper_blocks=$AFTER_BLOCKS resize2fs_blocks=$BASELINE_BLOCKS" >&2
  echo "$RESIZE2FS_OUTPUT" >&2
  exit 1
fi

UNUSED_TAIL_BLOCKS="$((TARGET_BLOCKS - AFTER_BLOCKS))"
if (( UNUSED_TAIL_BLOCKS >= BLOCKS_PER_GROUP )); then
  echo "ext4-growth-proof: resize left at least one full block group unused" >&2
  exit 1
fi

# Recreate the deliberately small filesystem and mount it read-only. The helper
# must reject it before issuing EXT4_IOC_RESIZE_FS, and the canonical block
# count in the primary ext4 superblock must not change.
sudo mkfs.ext4 -F -q -b 4096 -m 0 "$LOOP" 16384
sudo mount -t ext4 -o ro "$LOOP" "$MOUNT"
RO_BEFORE_BLOCKS="$(ext4_block_count "$LOOP")"
set +e
RO_OUTPUT="$(sudo "$HELPER" "$LOOP" "$MOUNT" 2>&1)"
RO_RC=$?
set -e
RO_AFTER_BLOCKS="$(ext4_block_count "$LOOP")"

if (( RO_RC == 0 )) || ! grep -Fq 'mounted filesystem is read-only' <<<"$RO_OUTPUT"; then
  echo "ext4-growth-proof: helper did not reject a read-only mount" >&2
  echo "$RO_OUTPUT" >&2
  exit 1
fi
if [[ "$RO_AFTER_BLOCKS" != "$RO_BEFORE_BLOCKS" ]]; then
  echo "ext4-growth-proof: read-only fixture changed filesystem block count" >&2
  exit 1
fi

HELPER_SHA256="$(sha256sum "$HELPER" | awk '{print $1}')"
SOURCE_COMMIT="${GITHUB_SHA:-unknown}"
cat >"$PROOF" <<EOF
{
  "\$schema": "prototype-ordax.ext4-growth-runtime-proof/2",
  "status": "pass",
  "source_commit": "$SOURCE_COMMIT",
  "helper_sha256": "$HELPER_SHA256",
  "fixture": {
    "block_device_bytes": $DEVICE_BYTES,
    "filesystem_block_size": $BLOCK_SIZE,
    "blocks_per_group": $BLOCKS_PER_GROUP,
    "initial_blocks": $BEFORE_BLOCKS,
    "raw_target_blocks": $TARGET_BLOCKS,
    "ordax_final_blocks": $AFTER_BLOCKS,
    "resize2fs_final_blocks": $BASELINE_BLOCKS,
    "unused_tail_blocks": $UNUSED_TAIL_BLOCKS
  },
  "checks": {
    "static_helper": true,
    "mismatched_device_rejected": true,
    "canonical_superblock_count_used": true,
    "rw_online_growth_matches_resize2fs_maximum": true,
    "unused_tail_less_than_one_block_group": true,
    "read_only_mount_rejected": true,
    "read_only_size_unchanged": true
  },
  "physical_write_authorized": false,
  "physical_hardware_proven": false
}
EOF

python3 -m json.tool "$PROOF" >/dev/null
printf '%s\n' "$GROW_OUTPUT"
printf 'RESIZE2FS_BASELINE_BLOCKS=%s\n' "$BASELINE_BLOCKS"
printf 'ORDAX_EXT4_RUNTIME_PROOF=PASS proof=%s\n' "$PROOF"
