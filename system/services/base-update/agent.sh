#!/bin/sh
set -eu

RUNTIME_ROOT=${ORDAX_BASE_RUNTIME_ROOT:-}
HOST_REPO_ROOT=${ORDAX_BASE_HOST_REPO_ROOT:-}
INTERVAL=${ORDAX_BASE_INTERVAL_SECONDS:-30}
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

while :; do
    if [ -x "$RUNTIME_ROOT/usr/bin/python3" ] &&
       [ -f "$RUNTIME_ROOT/srv/ordax-system/services/base-update/orchestrator.py" ] &&
       [ -d "$RUNTIME_ROOT/srv/ordax-repo" ] &&
       [ -d "$RUNTIME_ROOT/ordax" ]; then
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
            --state-root /var/lib/ordax \
            --physical-root /ordax \
            >/dev/null 2>&1 || true
    fi

    /bin/busybox sleep "$INTERVAL"
done
