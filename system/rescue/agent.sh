#!/bin/sh
set -eu

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

WORKTREE=${ORDAX_WORKTREE:-/workspace/ordax}
STATE_DIR=${ORDAX_STATE_DIR:-/state/ordax}
RESCUE_DIR=$STATE_DIR/rescue
RESCUE_BRANCH=${ORDAX_RESCUE_BRANCH:-ordax-rescue}
INTERVAL=${ORDAX_RESCUE_INTERVAL_SECONDS:-15}
REMOTE_TIMEOUT=${ORDAX_RESCUE_REMOTE_TIMEOUT_SECONDS:-20}
FETCH_TIMEOUT=${ORDAX_RESCUE_FETCH_TIMEOUT_SECONDS:-30}
GIT_BIN=${ORDAX_GIT_BIN:-/usr/bin/git}
PID_FILE=$RESCUE_DIR/agent.pid
LAST_GENERATION_FILE=$RESCUE_DIR/last-generation
LAST_ACTION_FILE=$RESCUE_DIR/last-action
LOG_FILE=$RESCUE_DIR/agent.log
REJECTED_FILE=$STATE_DIR/rejected-commit

mkdir -p "$RESCUE_DIR"
chmod 700 "$RESCUE_DIR"

log() {
    printf '%s ordax-rescue: %s\n' "$(/bin/busybox date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf unknown)" "$*" >>"$LOG_FILE"
}

case "$INTERVAL" in
    ''|*[!0-9]*) INTERVAL=15 ;;
esac
[ "$INTERVAL" -ge 10 ] 2>/dev/null || INTERVAL=15

case "$REMOTE_TIMEOUT" in
    ''|*[!0-9]*) REMOTE_TIMEOUT=20 ;;
esac
[ "$REMOTE_TIMEOUT" -ge 5 ] 2>/dev/null || REMOTE_TIMEOUT=20

case "$FETCH_TIMEOUT" in
    ''|*[!0-9]*) FETCH_TIMEOUT=30 ;;
esac
[ "$FETCH_TIMEOUT" -ge 10 ] 2>/dev/null || FETCH_TIMEOUT=30

is_pid() {
    case "${1:-}" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$1" -gt 1 ] 2>/dev/null
}

existing_pid=""
if [ -s "$PID_FILE" ]; then
    IFS= read -r existing_pid <"$PID_FILE" || true
fi
if is_pid "$existing_pid" && [ "$existing_pid" != "$$" ] && kill -0 "$existing_pid" >/dev/null 2>&1; then
    exit 0
fi

temporary=$PID_FILE.tmp.$$
printf '%s\n' "$$" >"$temporary"
/bin/busybox mv -f "$temporary" "$PID_FILE"

cleanup() {
    current=""
    if [ -s "$PID_FILE" ]; then
        IFS= read -r current <"$PID_FILE" || true
    fi
    [ "$current" = "$$" ] && rm -f "$PID_FILE"
}
trap cleanup EXIT HUP INT TERM

run_git() {
    timeout_seconds=$1
    shift
    /bin/busybox timeout -k 5 "$timeout_seconds" "$GIT_BIN" "$@"
}

is_sha() {
    value=$1
    [ "${#value}" -eq 40 ] || return 1
    case "$value" in
        ''|*[!0-9a-f]*) return 1 ;;
    esac
    return 0
}

read_generation() {
    value=0
    if [ -s "$LAST_GENERATION_FILE" ]; then
        IFS= read -r value <"$LAST_GENERATION_FILE" || value=0
    fi
    case "$value" in
        ''|*[!0-9]*) value=0 ;;
    esac
    printf '%s' "$value"
}

record_command() {
    generation=$1
    action=$2
    temporary=$LAST_GENERATION_FILE.tmp.$$
    printf '%s\n' "$generation" >"$temporary"
    /bin/busybox mv -f "$temporary" "$LAST_GENERATION_FILE"
    temporary=$LAST_ACTION_FILE.tmp.$$
    printf '%s %s\n' "$generation" "$action" >"$temporary"
    /bin/busybox mv -f "$temporary" "$LAST_ACTION_FILE"
}

find_surface_pid() {
    found=""
    target="$WORKTREE/system/surface/bin/ordax-surface"
    for cmdline in /proc/[0-9]*/cmdline; do
        [ -r "$cmdline" ] || continue
        pid=${cmdline#/proc/}
        pid=${pid%/cmdline}
        [ "$pid" = "$$" ] && continue
        command_line=$(/bin/busybox tr '\000' ' ' <"$cmdline" 2>/dev/null || true)
        case "$command_line" in
            *"$target"*)
                if [ -n "$found" ]; then
                    return 2
                fi
                found=$pid
                ;;
        esac
    done
    [ -n "$found" ] || return 1
    printf '%s' "$found"
}

remote_main_sha() {
    output=$(run_git "$REMOTE_TIMEOUT" -C "$WORKTREE" ls-remote --heads origin refs/heads/main 2>/dev/null || true)
    set -- $output
    value=${1:-}
    is_sha "$value" || return 1
    printf '%s' "$value"
}

parse_command() {
    command_text=$1
    magic=""
    generation=""
    action=""
    target_sha=""
    line_number=0
    while IFS= read -r line; do
        line_number=$((line_number + 1))
        case "$line_number:$line" in
            1:ORDAX_RESCUE_COMMAND_V1)
                magic=1
                ;;
            2:generation=*)
                generation=${line#generation=}
                ;;
            3:action=*)
                action=${line#action=}
                ;;
            4:target_sha=*)
                target_sha=${line#target_sha=}
                ;;
            *)
                return 1
                ;;
        esac
    done <<EOF
$command_text
EOF

    [ "$magic" = 1 ] || return 1
    case "$generation" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$generation" -ge 1 ] 2>/dev/null || return 1
    case "$action" in
        noop|clear-rejected|retry-main) ;;
        *) return 1 ;;
    esac
    is_sha "$target_sha" || return 1
    RESCUE_GENERATION=$generation
    RESCUE_ACTION=$action
    RESCUE_TARGET_SHA=$target_sha
    return 0
}

apply_command() {
    generation=$1
    action=$2
    target_sha=$3

    remote_sha=$(remote_main_sha || true)
    if [ "$remote_sha" != "$target_sha" ]; then
        log "generation $generation ignored: rescue target $target_sha is not current main ${remote_sha:-unknown}"
        return 1
    fi

    case "$action" in
        noop)
            log "generation $generation acknowledged as noop for $target_sha"
            ;;
        clear-rejected)
            rm -f "$REJECTED_FILE"
            log "generation $generation cleared rejected commit marker for $target_sha"
            ;;
        retry-main)
            rm -f "$REJECTED_FILE"
            surface_pid=$(find_surface_pid || true)
            if is_pid "$surface_pid" && kill -0 "$surface_pid" >/dev/null 2>&1; then
                kill "$surface_pid" >/dev/null 2>&1 || true
                log "generation $generation requested Surface restart through pid $surface_pid for $target_sha"
            else
                log "generation $generation cleared rejection; Surface pid was not uniquely discoverable"
            fi
            ;;
    esac

    record_command "$generation" "$action"
    return 0
}

log "agent started pid=$$ branch=$RESCUE_BRANCH"

while :; do
    if [ -x "$GIT_BIN" ] && [ -d "$WORKTREE/.git" ]; then
        remote_output=$(run_git "$REMOTE_TIMEOUT" -C "$WORKTREE" ls-remote --heads origin "refs/heads/$RESCUE_BRANCH" 2>/dev/null || true)
        set -- $remote_output
        rescue_sha=${1:-}
        if is_sha "$rescue_sha"; then
            if run_git "$FETCH_TIMEOUT" -C "$WORKTREE" fetch --no-tags origin                 "refs/heads/$RESCUE_BRANCH:refs/remotes/origin/$RESCUE_BRANCH" >>"$LOG_FILE" 2>&1; then
                command_text=$(run_git "$REMOTE_TIMEOUT" -C "$WORKTREE" show                     "$rescue_sha:rescue/command.txt" 2>/dev/null || true)
                if [ -n "$command_text" ] && parse_command "$command_text"; then
                    last_generation=$(read_generation)
                    if [ "$RESCUE_GENERATION" -gt "$last_generation" ] 2>/dev/null; then
                        apply_command "$RESCUE_GENERATION" "$RESCUE_ACTION" "$RESCUE_TARGET_SHA" || true
                    fi
                fi
            fi
        fi
    fi
    /bin/busybox sleep "$INTERVAL"
done
