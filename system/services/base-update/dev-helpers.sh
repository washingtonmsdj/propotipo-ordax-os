#!/bin/sh
set -eu

WORKTREE=${ORDAX_WORKTREE:-/workspace/ordax}
STATE_DIR=${ORDAX_STATE_DIR:-/state/ordax}
TARGET_ROOT=${ORDAX_DEV_HELPER_TARGET_ROOT:-/}
SOURCE_SHA=${ORDAX_SOURCE_SHA:-}
MAX_HELPER_BYTES=1048576

case "$TARGET_ROOT" in
    /*) ;;
    *)
        echo "ordax-dev-helpers: target root must be absolute" >&2
        exit 1
        ;;
esac

is_sha() {
    value=${1:-}
    [ "${#value}" -eq 40 ] || return 1
    case "$value" in
        ''|*[!0-9a-f]*) return 1 ;;
    esac
}

if ! is_sha "$SOURCE_SHA"; then
    SOURCE_SHA=$(git -C "$WORKTREE" rev-parse HEAD 2>/dev/null || true)
fi
is_sha "$SOURCE_SHA" || {
    echo "ordax-dev-helpers: source commit is invalid" >&2
    exit 1
}

root_prefix=${TARGET_ROOT%/}
stage_manifest=$STATE_DIR/.dev-helper-stage.$$
receipt=$STATE_DIR/dev-helpers-sha
receipt_tmp=$receipt.tmp.$$

cleanup() {
    if [ -f "$stage_manifest" ]; then
        while IFS="$(printf '\t')" read -r temporary _target; do
            [ -n "$temporary" ] && /bin/busybox rm -f "$temporary" 2>/dev/null || true
        done <"$stage_manifest"
    fi
    /bin/busybox rm -f "$stage_manifest" "$receipt_tmp" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

/bin/busybox mkdir -p "$STATE_DIR"
: >"$stage_manifest"
/bin/busybox chmod 600 "$stage_manifest"

stage_helper() {
    source_relative=$1
    target_relative=$2
    source=$WORKTREE/$source_relative
    target=$root_prefix/$target_relative
    parent=${target%/*}
    temporary=$target.ordax-refresh.$$

    [ -f "$source" ] && [ ! -L "$source" ] || {
        echo "ordax-dev-helpers: source is missing or unsafe: $source_relative" >&2
        exit 1
    }
    size=$(/bin/busybox wc -c <"$source" | /bin/busybox tr -d ' ')
    case "$size" in
        ''|*[!0-9]*) size=0 ;;
    esac
    [ "$size" -gt 0 ] && [ "$size" -le "$MAX_HELPER_BYTES" ] || {
        echo "ordax-dev-helpers: source size is invalid: $source_relative" >&2
        exit 1
    }
    /bin/sh -n "$source" || {
        echo "ordax-dev-helpers: shell syntax is invalid: $source_relative" >&2
        exit 1
    }

    /bin/busybox mkdir -p "$parent"
    [ ! -L "$parent" ] || {
        echo "ordax-dev-helpers: target parent is a symlink: $target_relative" >&2
        exit 1
    }
    if [ -e "$target" ] || [ -L "$target" ]; then
        [ -f "$target" ] && [ ! -L "$target" ] || {
            echo "ordax-dev-helpers: target is not a regular file: $target_relative" >&2
            exit 1
        }
    fi

    /bin/busybox rm -f "$temporary"
    /bin/busybox cp "$source" "$temporary"
    /bin/busybox chmod 755 "$temporary"
    /bin/sh -n "$temporary" || {
        /bin/busybox rm -f "$temporary"
        echo "ordax-dev-helpers: staged shell syntax is invalid: $target_relative" >&2
        exit 1
    }
    printf '%s\t%s\n' "$temporary" "$target" >>"$stage_manifest"
}

stage_helper bootstrap/dev-base/ordax-dev-init sbin/ordax-dev-init
stage_helper bootstrap/dev-base/ordax-network usr/local/bin/ordax-network
stage_helper bootstrap/dev-base/ordax-pull usr/local/bin/ordax-pull
stage_helper bootstrap/dev-base/ordax-rollback usr/local/bin/ordax-rollback
stage_helper bootstrap/dev-base/ordax-run usr/local/bin/ordax-run
stage_helper bootstrap/recovery/entrypoint ordax/bootstrap/recovery/entrypoint

while IFS="$(printf '\t')" read -r temporary target; do
    [ -n "$temporary" ] && [ -n "$target" ] || exit 1
    /bin/busybox mv -f "$temporary" "$target"
done <"$stage_manifest"

printf '%s\n' "$SOURCE_SHA" >"$receipt_tmp"
/bin/busybox chmod 600 "$receipt_tmp"
/bin/busybox mv -f "$receipt_tmp" "$receipt"

trap - EXIT HUP INT TERM
/bin/busybox rm -f "$stage_manifest"
printf 'ORDAX_DEV_HELPERS_SHA=%s\n' "$SOURCE_SHA"
