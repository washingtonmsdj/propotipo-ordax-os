#!/bin/sh
set -eu

RUNTIME_ROOT=${ORDAX_BASE_RUNTIME_ROOT:-}
HOST_REPO_ROOT=${ORDAX_BASE_HOST_REPO_ROOT:-}
HOST_STATE_ROOT=${ORDAX_BASE_HOST_STATE_ROOT:-/state/ordax}
INTERVAL=${ORDAX_BASE_INTERVAL_SECONDS:-30}
MOUNTINFO_FILE=${ORDAX_BASE_MOUNTINFO_FILE:-/proc/self/mountinfo}
MOUNT_STAGE_HOST=${ORDAX_BASE_MOUNT_STAGE_ROOT:-/run/ordax-base-owner}
PHYSICAL_MOUNT_HOST=
PHYSICAL_BIND_HOST=
PHYSICAL_MOUNT_CHROOT=/mnt/ordax-device
OWNER_STATE_CHROOT=
PREPARE_BLOCKER=
LOG_PREFIX=ordax-base-update-agent

case "$INTERVAL" in
    ''|*[!0-9]*) INTERVAL=30 ;;
esac
[ "$INTERVAL" -ge 15 ] 2>/dev/null || INTERVAL=15

log() {
    printf '%s: %s\n' "$LOG_PREFIX" "$*" >&2
}

write_preflight_status() {
    blocker=${1:-physical-root-unavailable}
    case "$blocker" in
        runtime-unavailable|owner-source-unavailable|repo-bind-unavailable|root-mount-unavailable|root-subpath-unsafe|root-filesystem-unsupported|root-source-unsafe|mount-stage-conflict|mount-stage-failed|physical-mountpoint-conflict|physical-mount-failed|physical-bind-conflict|physical-bind-failed|release-agent-missing|release-channel-missing|development-state-missing|development-state-unsafe)
            ;;
        *) blocker=physical-root-unavailable ;;
    esac

    status_dir=$HOST_STATE_ROOT/base-update
    /bin/busybox mkdir -p "$status_dir" 2>/dev/null || return 0
    temporary=$status_dir/.owner-status.json.preflight.$$
    printf '{"$schema":"ordax.base-update-owner-status/1","status":"blocked","phase":"physical-root-preflight","sourceSha":null,"pendingBootRefreshSha":null,"releaseAgentRefreshState":"blocked","releaseAgentSha256":null,"canonicalTrustPinned":false,"physicalTrustEnrolled":false,"trustEnrollmentState":"blocked","signedReleaseMaterialized":false,"materializedReleaseSha":null,"releaseMaterializationState":"blocked","kernelStaged":false,"candidateArmed":false,"rebootRequested":false,"promotionAttempted":false,"blocker":"%s"}\n' "$blocker" \
        >"$temporary" 2>/dev/null || {
            /bin/busybox rm -f "$temporary" >/dev/null 2>&1 || true
            return 0
        }
    /bin/busybox chmod 600 "$temporary" >/dev/null 2>&1 || true
    /bin/busybox mv -f "$temporary" "$status_dir/owner-status.json" >/dev/null 2>&1 || {
        /bin/busybox rm -f "$temporary" >/dev/null 2>&1 || true
    }
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

ensure_mount_stage() {
    /bin/busybox mkdir -p "$MOUNT_STAGE_HOST" || {
        PREPARE_BLOCKER=mount-stage-failed
        return 1
    }
    stage_record=$(mount_record_for "$MOUNT_STAGE_HOST")
    if [ -n "$stage_record" ]; then
        stage_root=""
        stage_fstype=""
        stage_source=""
        old_ifs=$IFS
        IFS='|'
        read -r stage_root stage_fstype stage_source <<EOF
$stage_record
EOF
        IFS=$old_ifs
        if [ "$stage_root" != "/" ] ||
           [ "$stage_fstype" != "tmpfs" ] ||
           [ "$stage_source" != "tmpfs" ]; then
            PREPARE_BLOCKER=mount-stage-conflict
            log "base-update mount staging path is occupied unexpectedly"
            return 1
        fi
        return 0
    fi

    if ! /bin/busybox mount -t tmpfs -o mode=0700,size=1m tmpfs "$MOUNT_STAGE_HOST"; then
        PREPARE_BLOCKER=mount-stage-failed
        log "cannot create isolated base-update mount staging tmpfs"
        return 1
    fi
    stage_record=$(mount_record_for "$MOUNT_STAGE_HOST")
    [ -n "$stage_record" ] || {
        PREPARE_BLOCKER=mount-stage-failed
        log "base-update mount staging tmpfs was not observable"
        return 1
    }
    return 0
}

prepare_physical_root() {
    PREPARE_BLOCKER=
    record=$(root_mount_record)
    [ -n "$record" ] || {
        PREPARE_BLOCKER=root-mount-unavailable
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
        PREPARE_BLOCKER=root-subpath-unsafe
        log "development root subpath is unsafe"
        return 1
    }
    [ "$root_fstype" = "ext4" ] || {
        PREPARE_BLOCKER=root-filesystem-unsupported
        log "development root filesystem is not ext4"
        return 1
    }
    safe_block_source "$root_source" || {
        PREPARE_BLOCKER=root-source-unsafe
        log "development root block source is unsafe"
        return 1
    }

    ensure_mount_stage || return 1

    PHYSICAL_MOUNT_HOST=$MOUNT_STAGE_HOST/physical
    /bin/busybox mkdir -p "$PHYSICAL_MOUNT_HOST" || {
        PREPARE_BLOCKER=physical-mount-failed
        return 1
    }

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
            PREPARE_BLOCKER=physical-mountpoint-conflict
            log "physical root mountpoint is occupied by an unexpected filesystem"
            return 1
        fi
    else
        if ! /bin/busybox mount -t ext4 -o rw "$root_source" "$PHYSICAL_MOUNT_HOST"; then
            PREPARE_BLOCKER=physical-mount-failed
            log "cannot mount full ORDAX filesystem root"
            return 1
        fi
        mounted=$(mount_record_for "$PHYSICAL_MOUNT_HOST")
        [ -n "$mounted" ] || {
            PREPARE_BLOCKER=physical-mount-failed
            log "physical root mount was not observable after mount"
            return 1
        }
    fi

    PHYSICAL_BIND_HOST=$RUNTIME_ROOT$PHYSICAL_MOUNT_CHROOT
    /bin/busybox mkdir -p "$PHYSICAL_BIND_HOST" || {
        PREPARE_BLOCKER=physical-bind-failed
        return 1
    }
    bound=$(mount_record_for "$PHYSICAL_BIND_HOST")
    if [ -n "$bound" ]; then
        bound_root=""
        bound_fstype=""
        bound_source=""
        old_ifs=$IFS
        IFS='|'
        read -r bound_root bound_fstype bound_source <<EOF
$bound
EOF
        IFS=$old_ifs
        if [ "$bound_root" != "/" ] ||
           [ "$bound_fstype" != "ext4" ] ||
           [ "$bound_source" != "$root_source" ]; then
            PREPARE_BLOCKER=physical-bind-conflict
            log "physical ORDAX chroot bind is occupied unexpectedly"
            return 1
        fi
    else
        if ! /bin/busybox mount -o bind "$PHYSICAL_MOUNT_HOST" "$PHYSICAL_BIND_HOST"; then
            PREPARE_BLOCKER=physical-bind-failed
            log "cannot bind physical ORDAX root into graphical runtime"
            return 1
        fi
        bound=$(mount_record_for "$PHYSICAL_BIND_HOST")
        [ -n "$bound" ] || {
            PREPARE_BLOCKER=physical-bind-failed
            log "physical ORDAX chroot bind was not observable"
            return 1
        }
    fi

    release_agent=$PHYSICAL_MOUNT_HOST/bootstrap/release-acquisition/ordax-release-agent
    release_channel=$PHYSICAL_MOUNT_HOST/bootstrap/config/release-envelope-url
    if [ ! -f "$release_agent" ] || [ -L "$release_agent" ] || [ ! -x "$release_agent" ]; then
        PREPARE_BLOCKER=release-agent-missing
        log "physical ORDAX root does not expose the release agent"
        return 1
    fi
    if [ ! -f "$release_channel" ] || [ -L "$release_channel" ]; then
        PREPARE_BLOCKER=release-channel-missing
        log "physical ORDAX root does not expose the release channel"
        return 1
    fi

    host_state=$PHYSICAL_MOUNT_HOST$root_subpath/state/ordax
    if [ ! -d "$host_state" ] || [ -L "$host_state" ]; then
        PREPARE_BLOCKER=development-state-missing
        log "development state alias is unavailable inside physical ORDAX root"
        return 1
    fi
    if [ -L "$PHYSICAL_MOUNT_HOST$root_subpath/state" ]; then
        PREPARE_BLOCKER=development-state-unsafe
        log "development state parent is unsafe"
        return 1
    fi

    OWNER_STATE_CHROOT=$PHYSICAL_MOUNT_CHROOT$root_subpath/state/ordax
    return 0
}

while :; do
    if [ ! -x "$RUNTIME_ROOT/usr/bin/python3" ]; then
        write_preflight_status runtime-unavailable
    elif [ ! -f "$RUNTIME_ROOT/srv/ordax-system/services/base-update/orchestrator.py" ]; then
        write_preflight_status owner-source-unavailable
    elif [ ! -d "$RUNTIME_ROOT/srv/ordax-repo" ]; then
        write_preflight_status repo-bind-unavailable
    elif prepare_physical_root; then
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
    else
        write_preflight_status "${PREPARE_BLOCKER:-physical-root-unavailable}"
    fi

    /bin/busybox sleep "$INTERVAL"
done
