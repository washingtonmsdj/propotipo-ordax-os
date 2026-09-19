#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROOF="${1:-$ROOT/out/base-update/esp-readonly-preflight-proof.json}"

for command in losetup sfdisk mkfs.vfat mkfs.ext4 fsck.vfat mount umount mountpoint python3; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "esp-readonly-preflight-proof: required program not found: $command" >&2
    exit 1
  }
done

mkdir -p "$ROOT/out"
WORK="$(mktemp -d "$ROOT/out/esp-readonly.XXXXXX")"
IMAGE="$WORK/disk.raw"
RW_MOUNT="$WORK/rw-esp"
RO_MOUNT="$WORK/ro-esp"
LABEL_ROOT="$WORK/by-label"
LOOP=""

cleanup() {
  set +e
  if [[ -d "$RW_MOUNT" ]] && mountpoint -q "$RW_MOUNT"; then
    sudo umount "$RW_MOUNT" >/dev/null 2>&1 || true
  fi
  if [[ -d "$RO_MOUNT" ]] && mountpoint -q "$RO_MOUNT"; then
    sudo umount "$RO_MOUNT" >/dev/null 2>&1 || true
  fi
  if [[ -n "$LOOP" ]]; then
    sudo losetup -d "$LOOP" >/dev/null 2>&1 || true
  fi
  sudo rm -rf "$WORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$RW_MOUNT" "$RO_MOUNT" "$LABEL_ROOT" "$(dirname "$PROOF")"
truncate -s 96M "$IMAGE"

sudo sfdisk "$IMAGE" >/dev/null <<'EOF'
label: gpt
size=65536, type=C12A7328-F81F-11D2-BA4B-00A0C93EC93B
type=0FC63DAF-8483-4772-8E79-3D69D8477DE4
EOF

LOOP="$(sudo losetup --find --show --partscan "$IMAGE")"
ESP="${LOOP}p1"
ROOT_PART="${LOOP}p2"

for _ in $(seq 1 40); do
  [[ -b "$ESP" && -b "$ROOT_PART" ]] && break
  sleep 0.1
done
[[ -b "$ESP" && -b "$ROOT_PART" ]] || {
  echo "esp-readonly-preflight-proof: loop partitions did not appear" >&2
  exit 1
}

sudo mkfs.vfat -F 32 -n ORDAX-ESP "$ESP" >/dev/null
sudo mkfs.ext4 -F -L ORDAX-ROOT "$ROOT_PART" >/dev/null 2>&1

sudo mount -t vfat -o rw,umask=0022 "$ESP" "$RW_MOUNT"
sudo mkdir -p "$RW_MOUNT/loader/entries" "$RW_MOUNT/ordax"
printf 'title OrdaX Current\nlinux /ordax/vmlinuz\ninitrd /ordax/initrd.gz\noptions console=tty0 ordax.mode=normal\n' \
  | sudo tee "$RW_MOUNT/loader/entries/ordax.conf" >/dev/null
printf 'title OrdaX Recovery\nlinux /ordax/vmlinuz\ninitrd /ordax/initrd.gz\noptions console=tty0 ordax.mode=recovery\n' \
  | sudo tee "$RW_MOUNT/loader/entries/ordax-recovery.conf" >/dev/null
printf 'known-good-kernel\n' | sudo tee "$RW_MOUNT/ordax/vmlinuz" >/dev/null
printf 'known-good-initramfs\n' | sudo tee "$RW_MOUNT/ordax/initrd.gz" >/dev/null
sync
sudo umount "$RW_MOUNT"

ln -s "$ESP" "$LABEL_ROOT/ORDAX-ESP"

sudo python3 "$ROOT/system/services/base-update/esp_readonly.py" \
  --root-source "$ROOT_PART" \
  --by-label-root "$LABEL_ROOT" \
  --mount-root "$RO_MOUNT" \
  >"$PROOF"

mountpoint -q "$RO_MOUNT" && {
  echo "esp-readonly-preflight-proof: helper left ESP mounted" >&2
  exit 1
}
sudo fsck.vfat -n "$ESP" >/dev/null

python3 - "$PROOF" "$ROOT_PART" "$ESP" <<'PY'
import json
import pathlib
import sys

proof = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
assert proof["$schema"] == "prototype-ordax.esp-readonly-preflight/1"
assert proof["status"] == "valid"
assert proof["root_device"] == sys.argv[2]
assert proof["esp_device"] == sys.argv[3]
assert proof["same_parent_disk"] is True
assert proof["mount_mode"] == "read-only"
assert set(proof["mount_options"]) == {"ro", "nosuid", "nodev", "noexec"}
assert proof["layout"]["layout"] == "legacy"
assert proof["layout"]["stage_active_slot"] == "legacy"
assert proof["layout"]["candidate_entry_present"] is False
assert proof["write_authorized"] is False
assert proof["activation_authorized"] is False
assert proof["staging_performed"] is False
assert proof["mount_released"] is True
print("ESP_READONLY_PREFLIGHT_PROOF=PASS")
PY
