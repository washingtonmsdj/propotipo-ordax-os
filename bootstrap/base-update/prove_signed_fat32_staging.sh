#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROOF="${1:-$ROOT/out/base-update/signed-fat32-staging-proof.json}"
SIGNER="${2:-$ROOT/out/base-update-proof/ordax-release-signing}"
MANIFEST_TOOL="${3:-$ROOT/out/base-update-proof/ordax-release-manifest}"
AGENT="${4:-$ROOT/out/base-update-proof/ordax-release-agent}"

for command in losetup mkfs.vfat fsck.vfat mount umount mountpoint sha256sum python3 sync sudo; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "signed-base-update-proof: required program not found: $command" >&2
    exit 1
  }
done
for tool in "$SIGNER" "$MANIFEST_TOOL" "$AGENT"; do
  [ -x "$tool" ] || {
    echo "signed-base-update-proof: required OrdaX tool is unavailable: $tool" >&2
    exit 1
  }
done
if [ -e /ordax ]; then
  echo "signed-base-update-proof: refusing to reuse or remove pre-existing /ordax" >&2
  exit 1
fi

mkdir -p "$ROOT/out" "$(dirname "$PROOF")"
WORK="$(mktemp -d "$ROOT/out/base-update-signed-fat32.XXXXXX")"
IMAGE="$WORK/esp.raw"
MOUNT="$WORK/mnt"
KERNEL="$WORK/candidate-kernel"
INITRAMFS="$WORK/candidate-initramfs"
SYSTEM_TAR="$WORK/system.tar"
MANIFEST="$WORK/release-manifest.json"
TRUST="$WORK/release-trust.json"
PRIVATE_KEY="$WORK/private.pem"
ENVELOPE="$WORK/release-envelope.json"
STAGE_RESULT="$WORK/stage-result.json"
FSCK_RESULT="$WORK/fsck.txt"
LOOP=""
ORDAX_CREATED=0

cleanup() {
  set +e
  if [[ -d "$MOUNT" ]] && mountpoint -q "$MOUNT"; then
    sudo umount "$MOUNT" >/dev/null 2>&1 || true
  fi
  if [[ -n "$LOOP" ]]; then
    sudo losetup -d "$LOOP" >/dev/null 2>&1 || true
  fi
  if [[ "$ORDAX_CREATED" -eq 1 ]]; then
    sudo rm -rf /ordax >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$MOUNT"
printf 'candidate-kernel-bytes\n' >"$KERNEL"
printf 'candidate-initramfs-bytes\n' >"$INITRAMFS"
KERNEL_SHA="$(sha256sum "$KERNEL" | awk '{print $1}')"
INITRAMFS_SHA="$(sha256sum "$INITRAMFS" | awk '{print $1}')"
RELEASE_SHA="${GITHUB_SHA:-0123456789abcdef0123456789abcdef01234567}"
case "$RELEASE_SHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) echo "signed-base-update-proof: source commit is not lowercase 40-hex" >&2; exit 1 ;;
esac

python3 - "$SYSTEM_TAR" "$KERNEL_SHA" "$INITRAMFS_SHA" <<'PY'
import io
import json
import pathlib
import sys
import tarfile

tar_path = pathlib.Path(sys.argv[1])
descriptor = json.dumps(
    {
        "$schema": "prototype-ordax.base-update-candidate/1",
        "kernel_sha256": sys.argv[2],
        "initramfs_sha256": sys.argv[3],
    },
    separators=(",", ":"),
    sort_keys=True,
).encode("utf-8")
with tarfile.open(tar_path, "w", format=tarfile.GNU_FORMAT) as archive:
    info = tarfile.TarInfo("system/base-update/candidate.json")
    info.mode = 0o644
    info.size = len(descriptor)
    info.mtime = 0
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    archive.addfile(info, io.BytesIO(descriptor))
PY

"$MANIFEST_TOOL" \
  --artifact "$SYSTEM_TAR" \
  --source-commit "$RELEASE_SHA" \
  --artifact-url "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/ci-signed-base-proof/system.tar" \
  --out "$MANIFEST"

"$SIGNER" generate-key \
  --private-key "$PRIVATE_KEY" \
  --trust "$TRUST" \
  --key-id ci-signed-base-update-1

"$SIGNER" sign \
  --manifest "$MANIFEST" \
  --private-key "$PRIVATE_KEY" \
  --trust "$TRUST" \
  --key-id ci-signed-base-update-1 \
  --out "$ENVELOPE"

sudo mkdir -p \
  /ordax/bootstrap/release-acquisition \
  /ordax/bootstrap/trust \
  "/ordax/releases/$RELEASE_SHA/artifacts"
ORDAX_CREATED=1
sudo install -m 0755 "$AGENT" /ordax/bootstrap/release-acquisition/ordax-release-agent
sudo install -m 0644 "$TRUST" /ordax/bootstrap/trust/release-ed25519.json
sudo install -m 0644 "$MANIFEST" "/ordax/releases/$RELEASE_SHA/release-manifest.json"
sudo install -m 0644 "$SYSTEM_TAR" "/ordax/releases/$RELEASE_SHA/artifacts/system.tar"

truncate -s 64M "$IMAGE"
LOOP="$(sudo losetup --find --show "$IMAGE")"
sudo mkfs.vfat -F 32 -n ORDAX-ESP "$LOOP" >/dev/null
sudo mount -t vfat -o rw,umask=0022 "$LOOP" "$MOUNT"

sudo mkdir -p "$MOUNT/loader/entries" "$MOUNT/ordax"
printf 'title OrdaX\nlinux /ordax/vmlinuz\ninitrd /ordax/initrd.gz\noptions console=tty0 ordax.mode=normal\n' \
  | sudo tee "$MOUNT/loader/entries/ordax.conf" >/dev/null
printf 'title OrdaX Recovery\nlinux /ordax/vmlinuz\ninitrd /ordax/initrd.gz\noptions console=tty0 ordax.mode=recovery\n' \
  | sudo tee "$MOUNT/loader/entries/ordax-recovery.conf" >/dev/null
printf 'known-good-kernel\n' | sudo tee "$MOUNT/ordax/vmlinuz" >/dev/null
printf 'known-good-initramfs\n' | sudo tee "$MOUNT/ordax/initrd.gz" >/dev/null
sync

CURRENT_BEFORE="$(sudo sha256sum "$MOUNT/loader/entries/ordax.conf" | awk '{print $1}')"
RECOVERY_BEFORE="$(sudo sha256sum "$MOUNT/loader/entries/ordax-recovery.conf" | awk '{print $1}')"
LEGACY_KERNEL_BEFORE="$(sudo sha256sum "$MOUNT/ordax/vmlinuz" | awk '{print $1}')"
LEGACY_INITRAMFS_BEFORE="$(sudo sha256sum "$MOUNT/ordax/initrd.gz" | awk '{print $1}')"

sudo python3 "$ROOT/bootstrap/base-update/stage.py" \
  --esp-root "$MOUNT" \
  --active-slot legacy \
  --envelope "$ENVELOPE" \
  --kernel "$KERNEL" \
  --initramfs "$INITRAMFS" \
  >"$STAGE_RESULT"

python3 - "$STAGE_RESULT" "$RELEASE_SHA" <<'PY'
import json
import pathlib
import sys
result = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
assert result["$schema"] == "prototype-ordax.base-update-stage-result/1"
assert result["release_sha"] == sys.argv[2]
assert result["active_slot"] == "legacy"
assert result["previous_slot"] == "a"
assert result["candidate_slot"] == "b"
assert result["legacy_enrollment"] is True
assert result["legacy_current_entry_unchanged"] is True
assert result["activation_ready"] is True
assert result["efi_variable_written"] is False
assert result["reboot_requested"] is False
PY

test "$(sudo sha256sum "$MOUNT/loader/entries/ordax.conf" | awk '{print $1}')" = "$CURRENT_BEFORE"
test "$(sudo sha256sum "$MOUNT/loader/entries/ordax-recovery.conf" | awk '{print $1}')" = "$RECOVERY_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/vmlinuz" | awk '{print $1}')" = "$LEGACY_KERNEL_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/initrd.gz" | awk '{print $1}')" = "$LEGACY_INITRAMFS_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/a/vmlinuz" | awk '{print $1}')" = "$LEGACY_KERNEL_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/a/initrd.gz" | awk '{print $1}')" = "$LEGACY_INITRAMFS_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/b/vmlinuz" | awk '{print $1}')" = "$KERNEL_SHA"
test "$(sudo sha256sum "$MOUNT/ordax/base/b/initrd.gz" | awk '{print $1}')" = "$INITRAMFS_SHA"
sudo grep -Fq 'ordax.base_slot=b' "$MOUNT/loader/entries/ordax-candidate+01-00.conf"
sudo grep -Fq "ordax.base_candidate=$RELEASE_SHA" "$MOUNT/loader/entries/ordax-candidate+01-00.conf"

sudo umount "$MOUNT"
sudo fsck.vfat -n "$LOOP" >"$FSCK_RESULT"
sudo mount -t vfat -o ro,umask=0022 "$LOOP" "$MOUNT"
test "$(sudo sha256sum "$MOUNT/ordax/vmlinuz" | awk '{print $1}')" = "$LEGACY_KERNEL_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/initrd.gz" | awk '{print $1}')" = "$LEGACY_INITRAMFS_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/a/vmlinuz" | awk '{print $1}')" = "$LEGACY_KERNEL_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/a/initrd.gz" | awk '{print $1}')" = "$LEGACY_INITRAMFS_BEFORE"
test "$(sudo sha256sum "$MOUNT/ordax/base/b/vmlinuz" | awk '{print $1}')" = "$KERNEL_SHA"
test "$(sudo sha256sum "$MOUNT/ordax/base/b/initrd.gz" | awk '{print $1}')" = "$INITRAMFS_SHA"
sudo umount "$MOUNT"

rm -f "$PRIVATE_KEY"
test ! -e "$PRIVATE_KEY"

IMAGE_SHA="$(sha256sum "$IMAGE" | awk '{print $1}')"
python3 - "$PROOF" "$RELEASE_SHA" "$IMAGE_SHA" "$KERNEL_SHA" "$INITRAMFS_SHA" <<'PY'
import json
import pathlib
import sys

proof_path, release_sha, image_sha, kernel_sha, initramfs_sha = sys.argv[1:]
proof = {
    "$schema": "prototype-ordax.base-update-signed-fat32-proof/1",
    "status": "pass",
    "scope": "signed-release-to-filesystem-staging",
    "release_sha": release_sha,
    "filesystem": "fat32",
    "filesystem_label": "ORDAX-ESP",
    "image_sha256": image_sha,
    "active_slot": "legacy",
    "previous_slot": "a",
    "candidate_slot": "b",
    "kernel_sha256": kernel_sha,
    "initramfs_sha256": initramfs_sha,
    "checks": {
        "product_cli_exercised": True,
        "release_signature_verification_exercised": True,
        "signed_system_artifact_bound": True,
        "signed_candidate_descriptor_consumed": True,
        "known_good_entries_preserved": True,
        "legacy_default_preserved": True,
        "legacy_known_good_enrolled_as_slot_a": True,
        "active_slot_preserved": True,
        "candidate_hashes_verified": True,
        "filesystem_passes_read_only_fsck": True,
        "activation_not_performed": True,
        "reboot_not_requested": True,
        "ci_private_key_removed": True,
    },
    "trust_boundary": {
        "test_key_scope": "ci-ephemeral-only",
        "canonical_runtime_paths_exercised": True,
        "canonical_release_trust_exercised": False,
        "canonical_public_anchor_promoted": False,
        "physical_write_authorized": False,
        "real_hardware_touched": False,
        "physical_hardware_proven": False,
    },
    "promotion_effect": "evidence-only; proves a signed release can migrate legacy single-slot bytes into preserved slot A while staging candidate slot B without changing the legacy default; it does not promote canonical trust, activate a candidate, authorize physical writes or prove notebook boot",
}
pathlib.Path(proof_path).write_text(
    json.dumps(proof, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY

python3 -m json.tool "$PROOF" >/dev/null
rm -f "$IMAGE"
printf 'ORDAX_BASE_UPDATE_SIGNED_FAT32_PROOF=PASS proof=%s\n' "$PROOF"
printf 'CI_PRIVATE_KEY_REMOVED=YES\n'
printf 'CANONICAL_TRUST_PROMOTED=NO\n'
printf 'PHYSICAL_WRITE_AUTHORIZED=NO\n'
