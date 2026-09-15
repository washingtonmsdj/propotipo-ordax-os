#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELPER="${1:-$ROOT/out/initramfs-work/ordax-grow-ext4}"
PROOF="${2:-$ROOT/out/initramfs/ext4-growth-runtime-proof.json}"

if [[ ! -f "$HELPER" || -L "$HELPER" || ! -x "$HELPER" ]]; then
  echo "ext4-growth-proof: helper is missing, unsafe, or not executable: $HELPER" >&2
  exit 1
fi

for command in losetup mkfs.ext4 mount umount mountpoint blockdev stat sha256sum grep readelf; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ext4-growth-proof: required program not found: $command" >&2
    exit 1
  fi
done

if readelf -l "$HELPER" | grep -q 'Requesting program interpreter'; then
  echo "ext4-growth-proof: helper is dynamically linked" >&2
  exit 1
fi

WORK="$(mktemp -d "$ROOT/out/ext4-growth-proof.XXXXXX")"
IMAGE="$WORK/ordax.raw"
DECOY_IMAGE="$WORK/decoy.raw"
MOUNT="$WORK/mnt"
LOOP=""
DECOY_LOOP=""

cleanup() {
  set +e
  if [[ -d "$MOUNT" ]] && mountpoint -q "$MOUNT"; then
    sudo umount "$MOUNT"
  fi
  if [[ -n "$DECOY_LOOP" ]]; then
    sudo losetup -d "$DECOY_LOOP" >/dev/null 2>&1 || true
  fi
  if [[ -n "$LOOP" ]]; then
    sudo losetup -d "$LOOP" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$MOUNT" "$(dirname "$PROOF")"
truncate -s 128M "$IMAGE"
truncate -s 8M "$DECOY_IMAGE"
LOOP="$(sudo losetup --find --show "$IMAGE")"
DECOY_LOOP="$(sudo losetup --find --show "$DECOY_IMAGE")"

# Deliberately create a 64 MiB ext4 filesystem on a 128 MiB block device.
# The runtime helper must grow the filesystem to the block-device boundary.
sudo mkfs.ext4 -F -q -b 4096 -m 0 "$LOOP" 16384
sudo mount -t ext4 -o rw "$LOOP" "$MOUNT"

BLOCK_SIZE="$(stat -f -c '%S' "$MOUNT")"
BEFORE_BLOCKS="$(stat -f -c '%b' "$MOUNT")"
DEVICE_BYTES="$(sudo blockdev --getsize64 "$LOOP")"
TARGET_BLOCKS="$((DEVICE_BYTES / BLOCK_SIZE))"

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

AFTER_BLOCKS="$(stat -f -c '%b' "$MOUNT")"
if (( AFTER_BLOCKS < TARGET_BLOCKS || AFTER_BLOCKS <= BEFORE_BLOCKS )); then
  echo "ext4-growth-proof: filesystem did not reach block-device capacity" >&2
  exit 1
fi

sudo umount "$MOUNT"

# Recreate the deliberately small filesystem and mount it read-only. The helper
# must reject it before issuing EXT4_IOC_RESIZE_FS, and the size must not change.
sudo mkfs.ext4 -F -q -b 4096 -m 0 "$LOOP" 16384
sudo mount -t ext4 -o ro "$LOOP" "$MOUNT"
RO_BEFORE_BLOCKS="$(stat -f -c '%b' "$MOUNT")"
set +e
RO_OUTPUT="$(sudo "$HELPER" "$LOOP" "$MOUNT" 2>&1)"
RO_RC=$?
set -e
RO_AFTER_BLOCKS="$(stat -f -c '%b' "$MOUNT")"

if (( RO_RC == 0 )) || ! grep -Fq 'mounted filesystem is read-only' <<<"$RO_OUTPUT"; then
  echo "ext4-growth-proof: helper did not reject a read-only mount" >&2
  echo "$RO_OUTPUT" >&2
  exit 1
fi
if [[ "$RO_AFTER_BLOCKS" != "$RO_BEFORE_BLOCKS" ]]; then
  echo "ext4-growth-proof: read-only fixture changed size" >&2
  exit 1
fi

HELPER_SHA256="$(sha256sum "$HELPER" | awk '{print $1}')"
SOURCE_COMMIT="${GITHUB_SHA:-unknown}"
cat >"$PROOF" <<EOF
{
  "\$schema": "prototype-ordax.ext4-growth-runtime-proof/1",
  "status": "pass",
  "source_commit": "$SOURCE_COMMIT",
  "helper_sha256": "$HELPER_SHA256",
  "fixture": {
    "block_device_bytes": $DEVICE_BYTES,
    "filesystem_block_size": $BLOCK_SIZE,
    "initial_blocks": $BEFORE_BLOCKS,
    "target_blocks": $TARGET_BLOCKS,
    "final_blocks": $AFTER_BLOCKS
  },
  "checks": {
    "static_helper": true,
    "mismatched_device_rejected": true,
    "rw_online_growth_reached_device_capacity": true,
    "read_only_mount_rejected": true,
    "read_only_size_unchanged": true
  },
  "physical_write_authorized": false,
  "physical_hardware_proven": false
}
EOF

python3 -m json.tool "$PROOF" >/dev/null
printf '%s\n' "$GROW_OUTPUT"
printf 'ORDAX_EXT4_RUNTIME_PROOF=PASS proof=%s\n' "$PROOF"
