#!/bin/sh
set -eu

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

WORKTREE=${ORDAX_WORKTREE:-/workspace/ordax}
STATE_DIR=${ORDAX_STATE_DIR:-/state/ordax}
TELEMETRY_DIR=$STATE_DIR/telemetry
CONFIG_FILE=$TELEMETRY_DIR/relay.json
DEVICE_ID_FILE=$STATE_DIR/native-state/telemetry-device-id
PID_FILE=$TELEMETRY_DIR/agent.pid
LAST_RESULT_FILE=$TELEMETRY_DIR/last-result
UPDATE_STATE=/run/ordax-update/state.json
HEALTH_FILE=/run/ordax-update/healthy-sha
SURFACE_HEARTBEAT_FILE=$STATE_DIR/native-state/surface-heartbeat.json
CLIENT_DIAGNOSTIC_FILE=$STATE_DIR/native-state/client-diagnostic.json
REJECTED_FILE=$STATE_DIR/rejected-commit
LAST_APPLIED_SHA_FILE=$STATE_DIR/last-applied-sha
LAST_APPLIED_AT_FILE=$STATE_DIR/last-applied-at
RESCUE_ACTION_FILE=$STATE_DIR/rescue/last-action
BOOT_ID_FILE=/proc/sys/kernel/random/boot_id
GIT_BIN=${ORDAX_GIT_BIN:-/usr/bin/git}

mkdir -p "$TELEMETRY_DIR" "$STATE_DIR/native-state"
chmod 700 "$TELEMETRY_DIR" "$STATE_DIR/native-state"
umask 077

is_pid() {
    case "${1:-}" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$1" -gt 1 ] 2>/dev/null
}

is_sha() {
    value=${1:-}
    [ "${#value}" -eq 40 ] || return 1
    case "$value" in
        ''|*[!0-9a-f]*) return 1 ;;
    esac
    return 0
}

read_first_line() {
    path=$1
    value=""
    if [ -s "$path" ]; then
        IFS= read -r value <"$path" || true
    fi
    printf '%s' "$value"
}

json_field() {
    field=$1
    path=$2
    [ -s "$path" ] || return 0
    /bin/busybox sed -n "s/.*\\\"$field\\\":\\\"\\([^\\\"]*\\)\\\".*/\\1/p" "$path" 2>/dev/null | /bin/busybox head -n 1
}

json_number_field() {
    field=$1
    path=$2
    [ -s "$path" ] || return 0
    /bin/busybox sed -n "s/.*\\\"$field\\\":\\([0-9][0-9]*\\).*/\\1/p" "$path" 2>/dev/null | /bin/busybox head -n 1
}

config_string() {
    field=$1
    /bin/busybox sed -n "s/^[[:space:]]*\\\"$field\\\":[[:space:]]*\\\"\\([^\\\"]*\\)\\\".*/\\1/p" "$CONFIG_FILE" 2>/dev/null | /bin/busybox head -n 1
}

config_number() {
    field=$1
    /bin/busybox sed -n "s/^[[:space:]]*\\\"$field\\\":[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" "$CONFIG_FILE" 2>/dev/null | /bin/busybox head -n 1
}

ensure_device_id() {
    current=$(read_first_line "$DEVICE_ID_FILE")
    case "$current" in
        ordax-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
            printf '%s' "$current"
            return 0
            ;;
    esac

    uuid=$(read_first_line /proc/sys/kernel/random/uuid)
    compact=$(printf "%s" "$uuid" | /bin/busybox tr -d "-" | /bin/busybox tr "A-F" "a-f")
    case "$compact" in
        [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
        *) return 1 ;;
    esac
    current=ordax-$compact
    temporary=$DEVICE_ID_FILE.tmp.base
    printf '%s\n' "$current" >"$temporary"
    /bin/busybox mv -f "$temporary" "$DEVICE_ID_FILE"
    printf '%s' "$current"
}

normalize_status() {
    value=${1:-}
    case "$value" in
        ''|*[!a-z0-9-]*) printf '' ;;
        *) printf '%s' "$value" ;;
    esac
}

normalize_apply_mode() {
    case "${1:-}" in
        initial|none|reload|surface-restart|supervisor-restart) printf "%s" "$1" ;;
        *) printf '' ;;
    esac
}

read_rescue_state() {
    generation=""
    action=none
    if [ -s "$RESCUE_ACTION_FILE" ]; then
        IFS=" " read -r generation action <"$RESCUE_ACTION_FILE" || true
    fi
    case "$generation" in
        ''|*[!0-9]*) generation='' ;;
    esac
    case "$action" in
        noop|clear-rejected|retry-main) ;;
        *) action=none ;;
    esac
}

write_result() {
    value=$1
    temporary=$LAST_RESULT_FILE.tmp
    printf '%s\n' "$value" >"$temporary"
    /bin/busybox mv -f "$temporary" "$LAST_RESULT_FILE"
}

existing_pid=$(read_first_line "$PID_FILE")
if is_pid "$existing_pid" && [ "$existing_pid" != "$$" ] && [ -d "/proc/$existing_pid" ]; then
    exit 0
fi
printf '%s\n' "$$" >"$PID_FILE"

cleanup() {
    current=$(read_first_line "$PID_FILE")
    [ "$current" = "$$" ] && rm -f "$PID_FILE"
}
trap cleanup EXIT HUP INT TERM

while :; do
    endpoint=$(config_string endpoint)
    publishable_key=$(config_string publishableKey)
    interval=$(config_number intervalSeconds)
    timeout=$(config_number timeoutSeconds)

    case "$endpoint" in
        https://*) ;;
        *) endpoint='' ;;
    esac
    case "$publishable_key" in
        sb_publishable_*) ;;
        *) publishable_key='' ;;
    esac
    case "$interval" in
        ''|*[!0-9]*) interval=30 ;;
    esac
    [ "$interval" -ge 15 ] 2>/dev/null || interval=30
    [ "$interval" -le 3600 ] 2>/dev/null || interval=30
    case "$timeout" in
        ''|*[!0-9]*) timeout=4 ;;
    esac
    [ "$timeout" -ge 1 ] 2>/dev/null || timeout=4
    [ "$timeout" -le 15 ] 2>/dev/null || timeout=4

    if [ -n "$endpoint" ] && [ -n "$publishable_key" ]; then
        device_root=$(ensure_device_id || true)
        source_sha=""
        if [ -n "$device_root" ] && [ -x "$GIT_BIN" ] && [ -d "$WORKTREE/.git" ]; then
            candidate=$("$GIT_BIN" -C "$WORKTREE" rev-parse HEAD 2>/dev/null || true)
            is_sha "$candidate" && source_sha=$candidate
        fi

        update_status=$(normalize_status "$(json_field status "$UPDATE_STATE")")
        target_sha=$(json_field targetSha "$UPDATE_STATE")
        is_sha "$target_sha" || target_sha=""
        runtime_surface_sha=$(json_field runtimeSurfaceSha "$UPDATE_STATE")
        is_sha "$runtime_surface_sha" || runtime_surface_sha=""
        phase=$(json_field phase "$UPDATE_STATE")
        case "$phase" in
            idle|checking|fetching|validating|activating|health-wait|rollback|blocked|error) ;;
            *) phase="" ;;
        esac
        apply_mode=$(normalize_apply_mode "$(json_field applyMode "$UPDATE_STATE")")
        supervisor_checked_at=$(json_field checkedAt "$UPDATE_STATE")
        [ "${#supervisor_checked_at}" -le 64 ] || supervisor_checked_at=""
        supervisor_state_epoch=$(/bin/busybox stat -c %Y "$UPDATE_STATE" 2>/dev/null || true)
        case "$supervisor_state_epoch" in
            ''|*[!0-9]*) supervisor_state_epoch=null ;;
        esac
        surface_source_sha=$(json_field sourceSha "$SURFACE_HEARTBEAT_FILE")
        is_sha "$surface_source_sha" || surface_source_sha=""
        surface_heartbeat_epoch=$(/bin/busybox stat -c %Y "$SURFACE_HEARTBEAT_FILE" 2>/dev/null || true)
        case "$surface_heartbeat_epoch" in
            ''|*[!0-9]*) surface_heartbeat_epoch=null ;;
        esac
        surface_state=unknown
        if [ -n "$surface_source_sha" ] && [ "$surface_heartbeat_epoch" != null ]; then
            now_epoch=$(/bin/busybox date +%s 2>/dev/null || true)
            case "$now_epoch" in
                ''|*[!0-9]*) ;;
                *)
                    surface_age=$((now_epoch - surface_heartbeat_epoch))
                    if [ "$surface_age" -ge 0 ] 2>/dev/null && [ "$surface_age" -le 60 ] 2>/dev/null; then
                        surface_state=running
                    else
                        surface_state=stopped
                    fi
                    ;;
            esac
        fi
        attempt_id=$(json_field attemptId "$UPDATE_STATE")
        [ "${#attempt_id}" -le 96 ] || attempt_id=""
        last_error=$(json_field lastError "$UPDATE_STATE")
        [ "${#last_error}" -le 1024 ] || last_error=""
        rejected_sha=$(read_first_line "$REJECTED_FILE")
        is_sha "$rejected_sha" || rejected_sha=""
        healthy_sha=$(read_first_line "$HEALTH_FILE")
        is_sha "$healthy_sha" || healthy_sha=""
        last_applied_sha=$(read_first_line "$LAST_APPLIED_SHA_FILE")
        is_sha "$last_applied_sha" || last_applied_sha=""
        last_applied_at=$(read_first_line "$LAST_APPLIED_AT_FILE")
        [ "${#last_applied_at}" -le 64 ] || last_applied_at=""
        staged_release_sha=$(json_field stagedReleaseSha "$UPDATE_STATE")
        is_sha "$staged_release_sha" || staged_release_sha=""
        last_apply_duration=$(json_number_field lastApplyDurationSeconds "$UPDATE_STATE")
        case "$last_apply_duration" in ''|*[!0-9]*) last_apply_duration=0 ;; esac
        [ "$last_apply_duration" -le 3600 ] 2>/dev/null || last_apply_duration=0
        last_stage_duration=$(json_number_field lastStageDurationSeconds "$UPDATE_STATE")
        case "$last_stage_duration" in ''|*[!0-9]*) last_stage_duration=0 ;; esac
        [ "$last_stage_duration" -le 3600 ] 2>/dev/null || last_stage_duration=0
        boot_id=$(read_first_line "$BOOT_ID_FILE")

        power_supply_class_available=false
        battery_detected=false
        if [ -d /sys/class/power_supply ]; then
            power_supply_class_available=true
            for supply_path in /sys/class/power_supply/*; do
                [ -d "$supply_path" ] || continue
                supply_type=$(read_first_line "$supply_path/type")
                [ "$supply_type" = "Battery" ] || continue
                present=$(read_first_line "$supply_path/present")
                [ "$present" = "0" ] && continue
                battery_detected=true
                break
            done
        fi

        client_diagnostic_sha=$(json_field sourceSha "$CLIENT_DIAGNOSTIC_FILE")
        is_sha "$client_diagnostic_sha" || client_diagnostic_sha=""
        client_diagnostic_stage=$(json_field stage "$CLIENT_DIAGNOSTIC_FILE")
        case "$client_diagnostic_stage" in
            ''|*[!a-z0-9.-]*) client_diagnostic_stage="" ;;
        esac
        [ "${#client_diagnostic_stage}" -le 64 ] || client_diagnostic_stage=""
        client_diagnostic_name=$(json_field errorName "$CLIENT_DIAGNOSTIC_FILE")
        case "$client_diagnostic_name" in
            ''|*[!A-Za-z0-9]*) client_diagnostic_name="" ;;
        esac
        [ "${#client_diagnostic_name}" -le 64 ] || client_diagnostic_name=""
        client_diagnostic_source=$(json_field source "$CLIENT_DIAGNOSTIC_FILE")
        case "$client_diagnostic_source" in
            ''|*[!A-Za-z0-9_.:-]*) client_diagnostic_source="" ;;
        esac
        [ "${#client_diagnostic_source}" -le 96 ] || client_diagnostic_source=""
        client_diagnostic_epoch=$(json_number_field observedEpoch "$CLIENT_DIAGNOSTIC_FILE")
        case "$client_diagnostic_epoch" in
            ''|*[!0-9]*) client_diagnostic_epoch=null ;;
        esac

        read_rescue_state

        if [ -n "$device_root" ]; then
            device_id=$device_root:base
            rescue_generation_json=null
            [ -n "$generation" ] && rescue_generation_json=$generation
            payload=$(printf '{"deviceId":"%s","sourceSha":"%s","runtimeSurfaceSha":"%s","targetSha":"%s","remoteSha":"","updateStatus":"%s","phase":"%s","applyMode":"%s","supervisorCheckedAt":"%s","supervisorStateEpoch":%s,"surfaceSourceSha":"%s","surfaceHeartbeatEpoch":%s,"attemptId":"%s","rejectedSha":"%s","healthySha":"%s","lastAppliedSha":"%s","lastAppliedAt":"%s","stagedReleaseSha":"%s","lastApplyDurationSeconds":%s,"lastStageDurationSeconds":%s,"rescueGeneration":%s,"rescueAction":"%s","surfaceState":"%s","bootId":"%s","lastError":"%s","powerSupplyClassAvailable":%s,"batteryDetected":%s,"clientDiagnosticSha":"%s","clientDiagnosticStage":"%s","clientDiagnosticName":"%s","clientDiagnosticSource":"%s","clientDiagnosticEpoch":%s,"relayVersion":2}' "$device_id" "$source_sha" "$runtime_surface_sha" "$target_sha" "$update_status" "$phase" "$apply_mode" "$supervisor_checked_at" "$supervisor_state_epoch" "$surface_source_sha" "$surface_heartbeat_epoch" "$attempt_id" "$rejected_sha" "$healthy_sha" "$last_applied_sha" "$last_applied_at" "$staged_release_sha" "$last_apply_duration" "$last_stage_duration" "$rescue_generation_json" "$action" "$surface_state" "$boot_id" "$last_error" "$power_supply_class_available" "$battery_detected" "$client_diagnostic_sha" "$client_diagnostic_stage" "$client_diagnostic_name" "$client_diagnostic_source" "$client_diagnostic_epoch")

            if /bin/busybox wget -q -T "$timeout" -O /dev/null \
                --header="Content-Type: application/json" \
                --header="Accept: application/json" \
                --header="apikey: $publishable_key" \
                --post-data="$payload" "$endpoint" >/dev/null 2>&1; then
                write_result "ok"
            else
                write_result "offline"
            fi
        fi
    fi

    /bin/busybox sleep "$interval"
done
