#!/bin/sh
set -eu

RUNTIME_ROOT=${ORDAX_BASE_RUNTIME_ROOT:-}
HOST_REPO_ROOT=${ORDAX_BASE_HOST_REPO_ROOT:-}
INTERVAL=${ORDAX_BASE_INTERVAL_SECONDS:-30}
MOUNTINFO_FILE=${ORDAX_BASE_MOUNTINFO_FILE:-/proc/self/mountinfo}
PHYSICAL_MOUNT_HOST=
PHYSICAL_MOUNT_CHROOT=/mnt/ordax-device
OWNER_STATE_CHROOT=
LOG_PREFIX=ordax-base-update-agent

case "$INTERVAL" in
    ''|*[!0-9]*) INTERVAL=30 ;;
esac
[ "$INTERVAL" -ge 15 ] 2>/dev/null || INTERVAL=15

log() {
    printf '%s: %s\n' "$LOG_PREFIX" "$*" >&2
}

[ -n "$RUNTIME_ROOT" ] || {
    log "ORDAX_BASE_RUNTIME_ROOT is empty"
    exit 1
}
[ -n "$HOST_REPO_ROOT" ] || {
    log "ORDAX_BASE_HOST_REPO_ROOT is empty"
    exit 1
}

root_mount_record() {
    /bin/busybox awk '
        $5 == "/" {
            for (i = 6; i <= NF; i++) {
                if ($i == "-") {
                    print $4 "|" $(i + 1) "|" $(i + 2)
                    exit
                }
            }
        }
    ' "$MOUNTINFO_FILE" 2>/dev/null
}

mount_record_for() {
    target=$1
    /bin/busybox awk -v target="$target" '
        $5 == target {
            for (i = 6; i <= NF; i++) {
                if ($i == "-") {
                    print $4 "|" $(i + 1) "|" $(i + 2)
                    exit
                }
            }
        }
    ' "$MOUNTINFO_FILE" 2>/dev/null
}

safe_root_subpath() {
    value=${1:-}
    case "$value" in
        /*) ;;
        *) return 1 ;;
    esac
    case "$value" in
        *'..'*|*'\\'*|*[!A-Za-z0-9_./-]*) return 1 ;;
    esac
    return 0
}

safe_block_source() {
    value=${1:-}
    case "$value" in
        /dev/*) ;;
        *) return 1 ;;
    esac
    case "$value" in
        *'\\'*|*[!A-Za-z0-9_./:+-]*) return 1 ;;
    esac
    return 0
}

prepare_physical_root() {
    record=$(root_mount_record)
    [ -n "$record" ] || {
        log "cannot identify development root mount"
        return 1
    }

    root_subpath=""
    root_fstype=""
    root_source=""
    old_ifs=$IFS
    IFS='|'
    read -r root_subpath root_fstype root_source <<EOF
$record
EOF
    IFS=$old_ifs

    safe_root_subpath "$root_subpath" || {
        log "development root subpath is unsafe"
        return 1
    }
    [ "$root_fstype" = "ext4" ] || {
        log "development root filesystem is not ext4"
        return 1
    }
    safe_block_source "$root_source" || {
        log "development root block source is unsafe"
        return 1
    }

    PHYSICAL_MOUNT_HOST=$RUNTIME_ROOT$PHYSICAL_MOUNT_CHROOT
    /bin/busybox mkdir -p "$PHYSICAL_MOUNT_HOST" || return 1

    mounted=$(mount_record_for "$PHYSICAL_MOUNT_HOST")
    if [ -n "$mounted" ]; then
        mounted_root=""
        mounted_fstype=""
        mounted_source=""
        old_ifs=$IFS
        IFS='|'
        read -r mounted_root mounted_fstype mounted_source <<EOF
$mounted
EOF
        IFS=$old_ifs
        if [ "$mounted_root" != "/" ] ||
           [ "$mounted_fstype" != "ext4" ] ||
           [ "$mounted_source" != "$root_source" ]; then
            log "physical root mountpoint is occupied by an unexpected filesystem"
            return 1
        fi
    else
        if ! /bin/busybox mount -t ext4 -o rw "$root_source" "$PHYSICAL_MOUNT_HOST"; then
            log "cannot mount full ORDAX filesystem root"
            return 1
        fi
        mounted=$(mount_record_for "$PHYSICAL_MOUNT_HOST")
        [ -n "$mounted" ] || {
            log "physical root mount was not observable after mount"
            return 1
        }
    fi

    release_agent=$PHYSICAL_MOUNT_HOST/bootstrap/release-acquisition/ordax-release-agent
    release_channel=$PHYSICAL_MOUNT_HOST/bootstrap/config/release-envelope-url
    if [ ! -f "$release_agent" ] || [ -L "$release_agent" ] || [ ! -x "$release_agent" ]; then
        log "physical ORDAX root does not expose the release agent"
        return 1
    fi
    if [ ! -f "$release_channel" ] || [ -L "$release_channel" ]; then
        log "physical ORDAX root does not expose the release channel"
        return 1
    fi

    host_state=$PHYSICAL_MOUNT_HOST$root_subpath/state/ordax
    if [ ! -d "$host_state" ] || [ -L "$host_state" ]; then
        log "development state alias is unavailable inside physical ORDAX root"
        return 1
    fi
    if [ -L "$PHYSICAL_MOUNT_HOST$root_subpath/state" ]; then
        log "development state parent is unsafe"
        return 1
    fi

    OWNER_STATE_CHROOT=$PHYSICAL_MOUNT_CHROOT$root_subpath/state/ordax
    return 0
}

while :; do
    if [ -x "$RUNTIME_ROOT/usr/bin/python3" ] &&
       [ -f "$RUNTIME_ROOT/srv/ordax-system/services/base-update/orchestrator.py" ] &&
       [ -d "$RUNTIME_ROOT/srv/ordax-repo" ]; then
        if prepare_physical_root; then
            source_sha=""
            if [ -x /usr/bin/git ]; then
                source_sha=$(/usr/bin/git -C "$HOST_REPO_ROOT" rev-parse HEAD 2>/dev/null || true)
            fi
            case "$source_sha" in
                [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*)
                    [ "${#source_sha}" -eq 40 ] || source_sha=""
                    ;;
                *) source_sha="" ;;
            esac

            ORDAX_BASE_SOURCE_SHA="$source_sha" \
                /bin/busybox chroot "$RUNTIME_ROOT" \
                /usr/bin/python3 /srv/ordax-system/services/base-update/orchestrator.py \
                --repo-root /srv/ordax-repo \
                --state-root "$OWNER_STATE_CHROOT" \
                --physical-root "$PHYSICAL_MOUNT_CHROOT" \
                >/dev/null 2>&1 || true
        fi
    fi

    /bin/busybox sleep "$INTERVAL"
done
