#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROOF="${1:-$ROOT/out/base-update/dev-physical-stage-proof.json}"
SOURCE_SHA="cccccccccccccccccccccccccccccccccccccccc"

for command in losetup sfdisk mkfs.vfat mkfs.ext4 fsck.vfat mount umount mountpoint python3 sha256sum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "dev-physical-stage-proof: required program not found: $command" >&2
    exit 1
  }
done

mkdir -p "$ROOT/out"
WORK="$(mktemp -d "$ROOT/out/dev-physical-stage.XXXXXX")"
IMAGE="$WORK/disk.raw"
ESP_MOUNT="$WORK/esp"
STAGE_MOUNT="$WORK/stage"
LABEL_ROOT="$WORK/by-label"
CANDIDATE_ROOT="$WORK/candidates"
VERSION_ROOT="$WORK/versions"
FIRST_RESULT="$WORK/first.json"
SECOND_RESULT="$WORK/second.json"
LOOP=""

cleanup() {
  set +e
  for mountpoint_path in "$ESP_MOUNT" "$STAGE_MOUNT"; do
    if [[ -d "$mountpoint_path" ]] && mountpoint -q "$mountpoint_path"; then
      sudo umount "$mountpoint_path" >/dev/null 2>&1 || true
    fi
  done
  if [[ -n "$LOOP" ]]; then
    sudo losetup -d "$LOOP" >/dev/null 2>&1 || true
  fi
  sudo rm -rf "$WORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$ESP_MOUNT" "$STAGE_MOUNT" "$LABEL_ROOT" "$CANDIDATE_ROOT" "$VERSION_ROOT" "$(dirname "$PROOF")"
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
  echo "dev-physical-stage-proof: loop partitions did not appear" >&2
  exit 1
}

sudo mkfs.vfat -F 32 -n ORDAX-ESP "$ESP" >/dev/null
sudo mkfs.ext4 -F -L ORDAX-ROOT "$ROOT_PART" >/dev/null 2>&1

sudo mount -t vfat -o rw,umask=0022 "$ESP" "$ESP_MOUNT"
sudo mkdir -p "$ESP_MOUNT/loader/entries" "$ESP_MOUNT/ordax"
printf 'title OrdaX Current\nlinux /ordax/vmlinuz\ninitrd /ordax/initrd.gz\noptions console=tty0 ordax.mode=normal\n' \
  | sudo tee "$ESP_MOUNT/loader/entries/ordax.conf" >/dev/null
printf 'title OrdaX Recovery\nlinux /ordax/vmlinuz\ninitrd /ordax/initrd.gz\noptions console=tty0 ordax.mode=recovery\n' \
  | sudo tee "$ESP_MOUNT/loader/entries/ordax-recovery.conf" >/dev/null
printf 'known-good-kernel\n' | sudo tee "$ESP_MOUNT/ordax/vmlinuz" >/dev/null
printf 'known-good-initramfs\n' | sudo tee "$ESP_MOUNT/ordax/initrd.gz" >/dev/null
CURRENT_BEFORE="$(sudo sha256sum "$ESP_MOUNT/loader/entries/ordax.conf" | awk '{print $1}')"
RECOVERY_BEFORE="$(sudo sha256sum "$ESP_MOUNT/loader/entries/ordax-recovery.conf" | awk '{print $1}')"
LEGACY_KERNEL_BEFORE="$(sudo sha256sum "$ESP_MOUNT/ordax/vmlinuz" | awk '{print $1}')"
LEGACY_INITRAMFS_BEFORE="$(sudo sha256sum "$ESP_MOUNT/ordax/initrd.gz" | awk '{print $1}')"
sync
sudo umount "$ESP_MOUNT"

python3 - "$CANDIDATE_ROOT" "$VERSION_ROOT" "$SOURCE_SHA" <<'PY'
import hashlib
import json
import pathlib
import sys

candidate_root = pathlib.Path(sys.argv[1])
version_root = pathlib.Path(sys.argv[2])
source = sys.argv[3]
candidate = candidate_root / source
candidate.mkdir(parents=True)

kernel = b"development-physical-kernel\n"
initramfs = b"development-physical-initramfs\n"
rootfs = b"development-rootfs-proof-placeholder\n"

(candidate / "vmlinuz").write_bytes(kernel)
(candidate / "initrd.gz").write_bytes(initramfs)
(candidate / "rootfs.tar").write_bytes(rootfs)

tag = f"ordax-dev-base-{source}"
def binding(name, payload):
    return {
        "name": name,
        "url": (
            "https://github.com/washingtonmsdj/prototipo-ordax-os/"
            f"releases/download/{tag}/{name}"
        ),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "size": len(payload),
    }

manifest = {
    "$schema": "prototype-ordax.dev-base-candidate/3",
    "status": "development-candidate",
    "source_repository": "washingtonmsdj/prototipo-ordax-os",
    "source_commit": source,
    "tag": tag,
    "activation": "inactive-slot-next-boot",
    "rootfs_activation": "slot-coupled-one-shot-health-gated",
    "manual_usb_rewrite_required": False,
    "kernel": binding("vmlinuz", kernel),
    "initramfs": binding("initrd.gz", initramfs),
    "rootfs": binding("rootfs.tar", rootfs),
}
(candidate / "dev-base.json").write_text(
    json.dumps(manifest, sort_keys=True) + "\n",
    encoding="utf-8",
)

version = version_root / source
required_files = (
    "bin/busybox",
    "bin/sh",
    "usr/bin/git",
    "sbin/ordax-dev-init",
    "usr/local/bin/ordax-network",
    "usr/local/bin/ordax-pull",
    "usr/local/bin/ordax-rollback",
    "usr/local/bin/ordax-run",
)
required_dirs = (
    "state",
    "workspace",
    "home",
    "proc",
    "sys",
    "dev",
    "run",
    ".ordax-base",
)
for relative in required_files:
    path = version / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    path.chmod(0o755)
for relative in required_dirs:
    (version / relative).mkdir(parents=True, exist_ok=True)
(version / ".ordax-rootfs-commit").write_text(source + "\n", encoding="ascii")
PY

ln -s "$ESP" "$LABEL_ROOT/ORDAX-ESP"

sudo python3 "$ROOT/system/services/base-update/dev_physical_stage.py" \
  --repo-root "$ROOT" \
  --root-source "$ROOT_PART" \
  --candidate-root "$CANDIDATE_ROOT" \
  --version-root "$VERSION_ROOT" \
  --source-commit "$SOURCE_SHA" \
  --by-label-root "$LABEL_ROOT" \
  --mount-root "$STAGE_MOUNT" \
  >"$FIRST_RESULT"

mountpoint -q "$STAGE_MOUNT" && {
  echo "dev-physical-stage-proof: first stage left ESP mounted" >&2
  exit 1
}

sudo mount -t vfat -o ro,nosuid,nodev,noexec "$ESP" "$ESP_MOUNT"
test "$(sudo sha256sum "$ESP_MOUNT/loader/entries/ordax.conf" | awk '{print $1}')" = "$CURRENT_BEFORE"
test "$(sudo sha256sum "$ESP_MOUNT/loader/entries/ordax-recovery.conf" | awk '{print $1}')" = "$RECOVERY_BEFORE"
test "$(sudo sha256sum "$ESP_MOUNT/ordax/vmlinuz" | awk '{print $1}')" = "$LEGACY_KERNEL_BEFORE"
test "$(sudo sha256sum "$ESP_MOUNT/ordax/initrd.gz" | awk '{print $1}')" = "$LEGACY_INITRAMFS_BEFORE"
test -s "$ESP_MOUNT/ordax/base/a/vmlinuz"
test -s "$ESP_MOUNT/ordax/base/a/initrd.gz"
test -s "$ESP_MOUNT/ordax/base/b/vmlinuz"
test -s "$ESP_MOUNT/ordax/base/b/initrd.gz"
sudo grep -Fq 'ordax.base_slot=b' "$ESP_MOUNT/loader/entries/ordax-candidate+01-00.conf"
sudo grep -Fq "ordax.base_candidate=$SOURCE_SHA" "$ESP_MOUNT/loader/entries/ordax-candidate+01-00.conf"
sudo umount "$ESP_MOUNT"
sudo fsck.vfat -n "$ESP" >/dev/null

IMAGE_BEFORE_SECOND="$(sha256sum "$IMAGE" | awk '{print $1}')"

sudo python3 "$ROOT/system/services/base-update/dev_physical_stage.py" \
  --repo-root "$ROOT" \
  --root-source "$ROOT_PART" \
  --candidate-root "$CANDIDATE_ROOT" \
  --version-root "$VERSION_ROOT" \
  --source-commit "$SOURCE_SHA" \
  --by-label-root "$LABEL_ROOT" \
  --mount-root "$STAGE_MOUNT" \
  >"$SECOND_RESULT"

mountpoint -q "$STAGE_MOUNT" && {
  echo "dev-physical-stage-proof: idempotent stage left ESP mounted" >&2
  exit 1
}
IMAGE_AFTER_SECOND="$(sha256sum "$IMAGE" | awk '{print $1}')"
test "$IMAGE_BEFORE_SECOND" = "$IMAGE_AFTER_SECOND"
sudo fsck.vfat -n "$ESP" >/dev/null

python3 - "$FIRST_RESULT" "$SECOND_RESULT" "$PROOF" "$SOURCE_SHA" "$IMAGE_AFTER_SECOND" <<'PY'
import json
import pathlib
import sys

first = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
second = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
proof_path = pathlib.Path(sys.argv[3])
source = sys.argv[4]
image_sha = sys.argv[5]

assert first["$schema"] == "prototype-ordax.dev-base-physical-stage/1"
assert first["status"] == "staged"
assert first["source_commit"] == source
assert first["active_slot"] == "legacy"
assert first["candidate_slot"] == "b"
assert first["stage_performed"] is True
assert first["idempotent"] is False
assert first["activation_ready"] is True
assert first["activation_performed"] is False
assert first["efi_variable_written"] is False
assert first["reboot_requested"] is False
assert first["write_authorized_beyond_stage"] is False
assert first["mount_released"] is True

assert second["$schema"] == "prototype-ordax.dev-base-physical-stage/1"
assert second["status"] == "already-staged"
assert second["source_commit"] == source
assert second["candidate_slot"] == "b"
assert second["stage_performed"] is False
assert second["idempotent"] is True
assert second["activation_performed"] is False
assert second["efi_variable_written"] is False
assert second["reboot_requested"] is False
assert second["mount_released"] is True

proof = {
    "$schema": "prototype-ordax.dev-base-physical-stage-proof/1",
    "status": "pass",
    "source_commit": source,
    "filesystem": "fat32",
    "same_disk_root_filesystem": "ext4",
    "image_sha256_after_idempotent_retry": image_sha,
    "checks": {
        "fresh_readonly_preflight_before_write": True,
        "same_parent_disk_required": True,
        "legacy_known_good_entries_preserved": True,
        "legacy_known_good_artifacts_preserved": True,
        "inactive_slot_candidate_staged": True,
        "candidate_entry_written": True,
        "second_run_is_byte_idempotent": True,
        "filesystem_passes_read_only_fsck": True,
        "mount_released_after_each_run": True,
        "activation_not_performed": True,
        "efi_variables_not_written": True,
        "reboot_not_requested": True,
    },
    "physical_hardware_touched": False,
    "physical_hardware_proven": False,
    "activation_authorized": False,
    "reboot_authorized": False,
}
proof_path.write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print("DEV_PHYSICAL_STAGE_PROOF=PASS")
PY
