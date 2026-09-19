#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV_INIT="$ROOT/bootstrap/dev-base/ordax-dev-init"
SOURCE_SHA="1111111111111111111111111111111111111111"

if [[ "${EUID}" -ne 0 ]]; then
  echo "rootfs-selector-proof: must run as root inside a disposable CI runner" >&2
  exit 2
fi

for command in busybox chroot mount timeout unshare; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "rootfs-selector-proof: missing command: $command" >&2
    exit 2
  }
done

BUSYBOX="$(command -v busybox)"
TMP="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

write_file() {
  local path=$1
  local mode=$2
  shift 2
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$@" >"$path"
  chmod "$mode" "$path"
}

install_busybox_root() {
  local root=$1
  mkdir -p     "$root/bin"     "$root/sbin"     "$root/usr/bin"     "$root/usr/local/bin"     "$root/state/ordax"     "$root/state/network"     "$root/workspace/ordax/system"     "$root/home"     "$root/proc"     "$root/sys"     "$root/dev"     "$root/run"     "$root/tmp"     "$root/root"     "$root/versions"
  cp "$BUSYBOX" "$root/bin/busybox"
  cp "$BUSYBOX" "$root/bin/sh"
  chmod 0755 "$root/bin/busybox" "$root/bin/sh"
}

install_seed_root() {
  local seed=$1
  local cmdline=$2
  install_busybox_root "$seed"
  cp "$DEV_INIT" "$seed/sbin/ordax-dev-init"
  chmod 0755 "$seed/sbin/ordax-dev-init"
  printf '%s\n' "$cmdline" >"$seed/run/cmdline"
  mkdir -p "$seed/workspace/ordax/.git"
  write_file "$seed/workspace/ordax/system/entrypoint" 0755     '#!/bin/sh'     "printf '%s\\n' seed-entrypoint"
  printf '%s\n' shared-state >"$seed/state/ordax/shared-state-proof"
}

install_candidate_root() {
  local root=$1
  local marker=$2
  install_busybox_root "$root"
  printf '%s\n' "$marker" >"$root/.ordax-rootfs-commit"
  cp "$DEV_INIT" "$root/sbin/ordax-dev-init"
  chmod 0755 "$root/sbin/ordax-dev-init"

  write_file "$root/usr/bin/git" 0755     '#!/bin/sh'     'case "$*" in'     "  *\"rev-parse HEAD\"*) printf '%s\\n' '$SOURCE_SHA' ;;"     '  *"status --porcelain"*) exit 0 ;;'     '  *) exit 0 ;;'     'esac'

  write_file "$root/usr/local/bin/ordax-network" 0755     '#!/bin/sh'     'exit 0'
  write_file "$root/usr/local/bin/ordax-pull" 0755     '#!/bin/sh'     'exit 1'
  write_file "$root/usr/local/bin/ordax-rollback" 0755     '#!/bin/sh'     'exit 1'

  write_file "$root/usr/local/bin/ordax-run" 0755     '#!/bin/sh'     'set -eu'     "test \"\${ORDAX_DEV_ROOT_COMMIT:-}\" = '$SOURCE_SHA'"     'test "${ORDAX_DEV_ROOT_MODE:-}" = candidate'     'test "${ORDAX_DEV_ROOT_SLOT:-}" = b'     "test \"\$(cat /.ordax-base/versions/$SOURCE_SHA/.ordax-rootfs-commit)\" = '$SOURCE_SHA'"     'test "$(cat /state/ordax/shared-state-proof)" = shared-state'     "printf '%s\\n' ROOTFS_SELECTOR_PIVOT=PASS"     "printf 'ROOTFS_SELECTOR_COMMIT=%s\\n' \"\${ORDAX_DEV_ROOT_COMMIT}\""     "printf 'ROOTFS_SELECTOR_SLOT=%s\\n' \"\${ORDAX_DEV_ROOT_SLOT}\""
}

run_isolated_init() {
  local seed=$1
  timeout 15s unshare --mount --pid --fork bash -euo pipefail -c '
    seed=$1
    mount --make-rprivate /
    mount --bind "$seed" "$seed"
    exec chroot "$seed" /bin/busybox env -i \
      PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
      HOME=/root \
      ORDAX_WORKTREE=/workspace/ordax \
      ORDAX_WORKSPACE_DIR=/workspace \
      ORDAX_STATE_DIR=/state/ordax \
      ORDAX_NETWORK_STATE_DIR=/state/network \
      ORDAX_BIN_DIR=/usr/local/bin \
      ORDAX_DEV_VERSION_ROOT=/versions \
      ORDAX_CMDLINE_FILE=/run/cmdline \
      /sbin/ordax-dev-init
  ' proof "$seed"
}

SUCCESS_SEED="$TMP/success-seed"
install_seed_root   "$SUCCESS_SEED"   "quiet ordax.mode=normal ordax.base_slot=b ordax.base_candidate=$SOURCE_SHA"
install_candidate_root "$SUCCESS_SEED/versions/$SOURCE_SHA" "$SOURCE_SHA"

success_output="$(run_isolated_init "$SUCCESS_SEED" 2>&1)"
printf '%s\n' "$success_output"
grep -Fxq 'ROOTFS_SELECTOR_PIVOT=PASS' <<<"$success_output"
grep -Fxq "ROOTFS_SELECTOR_COMMIT=$SOURCE_SHA" <<<"$success_output"
grep -Fxq 'ROOTFS_SELECTOR_SLOT=b' <<<"$success_output"
test "$(cat "$SUCCESS_SEED/state/ordax/base-update/rootfs/slot-b")" = "$SOURCE_SHA"
test -f "$SUCCESS_SEED/state/ordax/boot-last.tsv"

FAIL_SEED="$TMP/failure-seed"
install_seed_root   "$FAIL_SEED"   "quiet ordax.mode=normal ordax.base_slot=b ordax.base_candidate=$SOURCE_SHA"
install_candidate_root "$FAIL_SEED/versions/$SOURCE_SHA" "2222222222222222222222222222222222222222"

set +e
failure_output="$(run_isolated_init "$FAIL_SEED" 2>&1)"
failure_rc=$?
set -e
printf '%s\n' "$failure_output"

if [[ "$failure_rc" -eq 0 ]]; then
  echo "rootfs-selector-proof: invalid candidate unexpectedly booted" >&2
  exit 1
fi
if [[ "$failure_rc" -eq 124 ]]; then
  echo "rootfs-selector-proof: invalid candidate did not terminate inside bounded namespace" >&2
  exit 1
fi
grep -Fq 'Falha ao ativar Base candidata: rootfs exato nao esta materializado' <<<"$failure_output"
if grep -Fq 'ROOTFS_SELECTOR_PIVOT=PASS' <<<"$failure_output"; then
  echo "rootfs-selector-proof: invalid candidate reached runtime" >&2
  exit 1
fi
test ! -e "$FAIL_SEED/state/ordax/base-update/rootfs/slot-b"

echo "ROOTFS_SELECTOR_DISPOSABLE_PROOF=PASS"
echo "ROOTFS_SELECTOR_INVALID_CANDIDATE_REJECTED=PASS"
