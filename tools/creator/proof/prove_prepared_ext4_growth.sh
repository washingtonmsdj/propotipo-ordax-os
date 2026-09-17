#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SEED="${1:-}"
HELPER="${2:-$ROOT/out/initramfs-work/ordax-grow-ext4}"
PROOF="${3:-$ROOT/out/full-media-proof/creator-prepared-ext4-growth-proof.json}"
TARGET_BYTES="${4:-805306368}"
SECTOR_BYTES=512

fail() {
  echo "creator-prepared-ext4-proof: $*" >&2
  exit 1
}

[[ -n "$SEED" ]] || fail "seed image path is required"
[[ -f "$SEED" && ! -L "$SEED" ]] || fail "seed image must be a regular non-symlink file"
[[ -f "$HELPER" && ! -L "$HELPER" && -x "$HELPER" ]] || fail "growth helper is missing or unsafe"
[[ "$TARGET_BYTES" =~ ^[0-9]+$ ]] || fail "target bytes must be an integer"
(( TARGET_BYTES > 0 && TARGET_BYTES % SECTOR_BYTES == 0 )) || fail "target bytes must be positive and 512-byte aligned"

for command in go sgdisk losetup mount umount mountpoint blockdev blkid dumpe2fs resize2fs e2fsck sha256sum awk sed stat python3 readelf; do
  command -v "$command" >/dev/null 2>&1 || fail "required program not found: $command"
done

if readelf -l "$HELPER" | grep -q 'Requesting program interpreter'; then
  fail "growth helper is dynamically linked"
fi

SEED_ABS="$(cd "$(dirname "$SEED")" && pwd)/$(basename "$SEED")"
HELPER_ABS="$(cd "$(dirname "$HELPER")" && pwd)/$(basename "$HELPER")"
PROOF_PARENT="$(dirname "$PROOF")"
mkdir -p "$PROOF_PARENT" "$ROOT/out"
PROOF_ABS="$(cd "$PROOF_PARENT" && pwd)/$(basename "$PROOF")"
[[ ! -e "$PROOF_ABS" && ! -L "$PROOF_ABS" ]] || fail "proof output already exists"

SEED_BYTES="$(stat -c '%s' "$SEED_ABS")"
(( TARGET_BYTES > SEED_BYTES )) || fail "target capacity must be larger than seed for this proof"
SEED_SHA256="$(sha256sum "$SEED_ABS" | awk '{print $1}')"

WORK="$(mktemp -d "$ROOT/out/creator-prepared-ext4-proof.XXXXXX")"
PREPARED="$WORK/prepared.raw"
BASELINE="$WORK/baseline.raw"
MOUNT="$WORK/mnt"
BASELINE_MOUNT="$WORK/baseline-mnt"
LOOP=""
BASELINE_LOOP=""

cleanup() {
  set +e
  if [[ -d "$BASELINE_MOUNT" ]] && mountpoint -q "$BASELINE_MOUNT"; then
    sudo umount "$BASELINE_MOUNT"
  fi
  if [[ -d "$MOUNT" ]] && mountpoint -q "$MOUNT"; then
    sudo umount "$MOUNT"
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
mkdir -p "$MOUNT" "$BASELINE_MOUNT"

pushd "$ROOT/tools/creator" >/dev/null
PREPARE_OUTPUT="$(go run ./cmd/ordax-creator prepare-image \
  --seed "$SEED_ABS" \
  --out "$PREPARED" \
  --target-bytes "$TARGET_BYTES")"
popd >/dev/null
printf '%s\n' "$PREPARE_OUTPUT"
grep -qx 'PREPARED_PHYSICAL_IMAGE=YES' <<<"$PREPARE_OUTPUT" || fail "Creator did not report prepared image success"
grep -qx 'PHYSICAL_DEVICE_TOUCHED=NO' <<<"$PREPARE_OUTPUT" || fail "Creator regular-file preparation lost its no-device guarantee"

PREPARED_SIZE="$(sed -n 's/^PREPARED_SIZE_BYTES=//p' <<<"$PREPARE_OUTPUT")"
PREPARED_SHA256="$(sed -n 's/^PREPARED_SHA256=//p' <<<"$PREPARE_OUTPUT")"
LAST_USABLE_LBA="$(sed -n 's/^PREPARED_LAST_USABLE_LBA=//p' <<<"$PREPARE_OUTPUT")"
MAIN_LAST_FROM_CREATOR="$(sed -n 's/^PREPARED_MAIN_LAST_LBA=//p' <<<"$PREPARE_OUTPUT")"
[[ "$PREPARED_SIZE" == "$TARGET_BYTES" ]] || fail "prepared image size differs from requested target"
[[ "$PREPARED_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail "Creator did not emit a valid prepared image hash"
[[ "$LAST_USABLE_LBA" == "$MAIN_LAST_FROM_CREATOR" ]] || fail "Creator did not extend ORDAX through last usable LBA"
[[ "$(sha256sum "$PREPARED" | awk '{print $1}')" == "$PREPARED_SHA256" ]] || fail "prepared image hash changed after Creator returned"

sgdisk --verify "$PREPARED" >/dev/null
SEED_INFO="$(sgdisk --info=2 "$SEED_ABS")"
PREPARED_INFO="$(sgdisk --info=2 "$PREPARED")"
SEED_FIRST_LBA="$(awk '/First sector:/ {print $3; exit}' <<<"$SEED_INFO")"
SEED_LAST_LBA="$(awk '/Last sector:/ {print $3; exit}' <<<"$SEED_INFO")"
FIRST_LBA="$(awk '/First sector:/ {print $3; exit}' <<<"$PREPARED_INFO")"
LAST_LBA="$(awk '/Last sector:/ {print $3; exit}' <<<"$PREPARED_INFO")"
PARTITION_NAME="$(sed -n "s/^Partition name: '\(.*\)'$/\1/p" <<<"$PREPARED_INFO")"
[[ "$PARTITION_NAME" == "ORDAX" ]] || fail "prepared partition 2 is not ORDAX"
[[ "$FIRST_LBA" == "$SEED_FIRST_LBA" ]] || fail "Creator moved the ORDAX partition start"
(( LAST_LBA > SEED_LAST_LBA )) || fail "Creator did not expand ORDAX partition geometry"
[[ "$LAST_LBA" == "$LAST_USABLE_LBA" ]] || fail "ORDAX partition does not end at GPT last usable LBA"

PARTITION_SECTORS="$((LAST_LBA - FIRST_LBA + 1))"
PARTITION_BYTES="$((PARTITION_SECTORS * SECTOR_BYTES))"
OFFSET_BYTES="$((FIRST_LBA * SECTOR_BYTES))"
cp --sparse=always "$PREPARED" "$BASELINE"
[[ "$(sha256sum "$BASELINE" | awk '{print $1}')" == "$PREPARED_SHA256" ]] || fail "baseline copy differs from prepared image"

LOOP="$(sudo losetup --find --show --offset "$OFFSET_BYTES" --sizelimit "$PARTITION_BYTES" "$PREPARED")"
BASELINE_LOOP="$(sudo losetup --find --show --offset "$OFFSET_BYTES" --sizelimit "$PARTITION_BYTES" "$BASELINE")"
[[ "$(sudo blockdev --getsize64 "$LOOP")" == "$PARTITION_BYTES" ]] || fail "ORDAX loop size differs from GPT partition size"
[[ "$(sudo blockdev --getsize64 "$BASELINE_LOOP")" == "$PARTITION_BYTES" ]] || fail "baseline loop size differs from GPT partition size"
[[ "$(sudo blkid -p -o value -s TYPE "$LOOP")" == "ext4" ]] || fail "prepared ORDAX filesystem is not ext4"
[[ "$(sudo blkid -p -o value -s LABEL "$LOOP")" == "ORDAX" ]] || fail "prepared ORDAX filesystem label changed"

ext4_value() {
  local device="$1"
  local field="$2"
  sudo dumpe2fs -h "$device" 2>/dev/null | awk -v field="$field" 'index($0, field ":") == 1 {sub("^[^:]*:[[:space:]]*", "", $0); print $0; exit}'
}

tree_digest() {
  local root="$1"
  sudo python3 - "$root" <<'PY'
import hashlib, os, pathlib, stat, sys
root = pathlib.Path(sys.argv[1])
digest = hashlib.sha256()
for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
    current_path = pathlib.Path(current)
    dirnames.sort()
    filenames.sort()
    for name in filenames:
        path = current_path / name
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode):
            continue
        rel = path.relative_to(root).as_posix().encode('utf-8')
        file_hash = hashlib.sha256()
        with path.open('rb') as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                file_hash.update(chunk)
        digest.update(len(rel).to_bytes(4, 'big'))
        digest.update(rel)
        digest.update(file_hash.digest())
print(digest.hexdigest())
PY
}

BEFORE_BLOCKS="$(ext4_value "$LOOP" 'Block count')"
BLOCK_SIZE="$(ext4_value "$LOOP" 'Block size')"
BLOCKS_PER_GROUP="$(ext4_value "$LOOP" 'Blocks per group')"
[[ "$BEFORE_BLOCKS" =~ ^[0-9]+$ && "$BLOCK_SIZE" =~ ^[0-9]+$ && "$BLOCKS_PER_GROUP" =~ ^[0-9]+$ ]] || fail "cannot read seed ext4 geometry"
RAW_TARGET_BLOCKS="$((PARTITION_BYTES / BLOCK_SIZE))"
(( BEFORE_BLOCKS < RAW_TARGET_BLOCKS )) || fail "prepared image did not preserve a smaller seed ext4 filesystem"

sudo mount -t ext4 -o rw "$LOOP" "$MOUNT"
TREE_BEFORE="$(tree_digest "$MOUNT")"
BOOTSTRAP_ENTRYPOINT="$MOUNT/bootstrap/entrypoint"
sudo test -f "$BOOTSTRAP_ENTRYPOINT" || fail "prepared ORDAX is missing /bootstrap/entrypoint"
sudo test ! -L "$BOOTSTRAP_ENTRYPOINT" || fail "prepared /bootstrap/entrypoint may not be a symlink"
sudo test -x "$BOOTSTRAP_ENTRYPOINT" || fail "prepared /bootstrap/entrypoint is not executable"
BOOTSTRAP_MODE_BEFORE="$(sudo stat -c '%a' "$BOOTSTRAP_ENTRYPOINT")"
BOOTSTRAP_SHA256_BEFORE="$(sudo sha256sum "$BOOTSTRAP_ENTRYPOINT" | awk '{print $1}')"
[[ "$BOOTSTRAP_MODE_BEFORE" =~ ^[0-7]{3,4}$ ]] || fail "cannot read prepared /bootstrap/entrypoint mode"
[[ "$BOOTSTRAP_SHA256_BEFORE" =~ ^[0-9a-f]{64}$ ]] || fail "cannot hash prepared /bootstrap/entrypoint"
GROW_OUTPUT="$(sudo "$HELPER_ABS" "$LOOP" "$MOUNT")"
printf '%s\n' "$GROW_OUTPUT"
grep -q '^ORDAX_EXT4_GROWTH=PASS ' <<<"$GROW_OUTPUT" || fail "initramfs helper did not grow Creator-prepared ORDAX filesystem"
TREE_AFTER="$(tree_digest "$MOUNT")"
[[ "$TREE_AFTER" == "$TREE_BEFORE" ]] || fail "file contents changed during online ext4 growth"
sudo test -f "$BOOTSTRAP_ENTRYPOINT" || fail "grown ORDAX lost /bootstrap/entrypoint"
sudo test ! -L "$BOOTSTRAP_ENTRYPOINT" || fail "grown /bootstrap/entrypoint became a symlink"
sudo test -x "$BOOTSTRAP_ENTRYPOINT" || fail "grown /bootstrap/entrypoint is not executable"
BOOTSTRAP_MODE_AFTER="$(sudo stat -c '%a' "$BOOTSTRAP_ENTRYPOINT")"
BOOTSTRAP_SHA256_AFTER="$(sudo sha256sum "$BOOTSTRAP_ENTRYPOINT" | awk '{print $1}')"
[[ "$BOOTSTRAP_MODE_AFTER" == "$BOOTSTRAP_MODE_BEFORE" ]] || fail "/bootstrap/entrypoint mode changed during online ext4 growth"
[[ "$BOOTSTRAP_SHA256_AFTER" == "$BOOTSTRAP_SHA256_BEFORE" ]] || fail "/bootstrap/entrypoint bytes changed during online ext4 growth"
sudo umount "$MOUNT"
AFTER_BLOCKS="$(ext4_value "$LOOP" 'Block count')"

sudo mount -t ext4 -o rw "$BASELINE_LOOP" "$BASELINE_MOUNT"
RESIZE2FS_OUTPUT="$(sudo resize2fs "$BASELINE_LOOP" 2>&1)"
printf '%s\n' "$RESIZE2FS_OUTPUT"
sudo umount "$BASELINE_MOUNT"
BASELINE_BLOCKS="$(ext4_value "$BASELINE_LOOP" 'Block count')"

[[ "$AFTER_BLOCKS" == "$BASELINE_BLOCKS" ]] || fail "initramfs helper does not match resize2fs on Creator-prepared media"
(( AFTER_BLOCKS > BEFORE_BLOCKS && AFTER_BLOCKS <= RAW_TARGET_BLOCKS )) || fail "grown ext4 block count is outside valid bounds"
UNUSED_TAIL_BLOCKS="$((RAW_TARGET_BLOCKS - AFTER_BLOCKS))"
(( UNUSED_TAIL_BLOCKS < BLOCKS_PER_GROUP )) || fail "at least one full ext4 block group remained unused"

sudo e2fsck -fn "$LOOP" >/dev/null 2>&1 || fail "grown Creator-prepared ext4 failed read-only e2fsck"

SOURCE_COMMIT="${GITHUB_SHA:-unknown}"
cat >"$PROOF_ABS" <<EOF
{
  "\$schema": "prototype-ordax.creator-prepared-ext4-growth-proof/1",
  "status": "pass",
  "source_commit": "$SOURCE_COMMIT",
  "seed_image_sha256": "$SEED_SHA256",
  "prepared_image_sha256_before_growth": "$PREPARED_SHA256",
  "target_image_bytes": $TARGET_BYTES,
  "gpt": {
    "ordax_first_lba": $FIRST_LBA,
    "seed_ordax_last_lba": $SEED_LAST_LBA,
    "prepared_ordax_last_lba": $LAST_LBA,
    "last_usable_lba": $LAST_USABLE_LBA,
    "ordax_partition_bytes": $PARTITION_BYTES
  },
  "ext4": {
    "block_size": $BLOCK_SIZE,
    "blocks_per_group": $BLOCKS_PER_GROUP,
    "initial_blocks": $BEFORE_BLOCKS,
    "raw_target_blocks": $RAW_TARGET_BLOCKS,
    "ordax_final_blocks": $AFTER_BLOCKS,
    "resize2fs_final_blocks": $BASELINE_BLOCKS,
    "unused_tail_blocks": $UNUSED_TAIL_BLOCKS,
    "tree_digest_before": "$TREE_BEFORE",
    "tree_digest_after": "$TREE_AFTER",
    "bootstrap_entrypoint_path": "/bootstrap/entrypoint",
    "bootstrap_entrypoint_mode_before": "$BOOTSTRAP_MODE_BEFORE",
    "bootstrap_entrypoint_mode_after": "$BOOTSTRAP_MODE_AFTER",
    "bootstrap_entrypoint_sha256_before": "$BOOTSTRAP_SHA256_BEFORE",
    "bootstrap_entrypoint_sha256_after": "$BOOTSTRAP_SHA256_AFTER"
  },
  "checks": {
    "creator_prepare_regular_file_only": true,
    "gpt_valid_after_capacity_expansion": true,
    "ordax_partition_start_preserved": true,
    "ordax_partition_extended_to_last_usable_lba": true,
    "seed_ext4_remained_smaller_before_boot_growth": true,
    "bootstrap_entrypoint_present_and_executable_before_growth": true,
    "bootstrap_entrypoint_present_and_executable_after_growth": true,
    "bootstrap_entrypoint_mode_preserved_across_growth": true,
    "bootstrap_entrypoint_bytes_preserved_across_growth": true,
    "online_growth_matches_resize2fs_maximum": true,
    "file_contents_preserved_across_growth": true,
    "unused_tail_less_than_one_block_group": true,
    "grown_ext4_passes_read_only_e2fsck": true
  },
  "canonical_trust": false,
  "physical_write_authorized": false,
  "physical_hardware_proven": false,
  "real_hardware_touched": false
}
EOF
python3 -m json.tool "$PROOF_ABS" >/dev/null
printf 'CREATOR_PREPARED_EXT4_GROWTH_PROOF=PASS proof=%s\n' "$PROOF_ABS"
