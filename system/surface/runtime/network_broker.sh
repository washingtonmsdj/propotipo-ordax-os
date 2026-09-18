#!/bin/sh
set -eu

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

STATE_DIR=${ORDAX_NETWORK_STATE_DIR:-/state/network}
SESSION_DIR=${ORDAX_NETWORK_SESSION_DIR:-/run/ordax-surface}
CONTROL=$SESSION_DIR/network-control
REQUEST=$SESSION_DIR/network-request
RESPONSE=$SESSION_DIR/network-response
SCAN_RAW=$SESSION_DIR/network-scan.raw
LINK_RAW=$SESSION_DIR/network-link.raw
SAVED_SSID_LINE=$SESSION_DIR/network-saved-ssid
WPA_CONF=$STATE_DIR/wpa.conf
CANDIDATE=$STATE_DIR/wpa.conf.candidate.$$

umask 077
mkdir -p "$STATE_DIR" "$SESSION_DIR"
chmod 700 "$STATE_DIR" "$SESSION_DIR"

IP_BIN=$(command -v ip || true)
IW_BIN=$(command -v iw || true)
WPA_BIN=$(command -v wpa_supplicant || true)
UDHCPC_BIN=$(command -v udhcpc || true)

[ -n "$IP_BIN" ] && [ -n "$IW_BIN" ] && [ -n "$WPA_BIN" ] && [ -n "$UDHCPC_BIN" ] || {
    echo "ordax-network-broker: required host network tools are unavailable" >&2
    exit 1
}

cleanup() {
    rm -f "$CONTROL" "$REQUEST" "$RESPONSE" "$SCAN_RAW" "$LINK_RAW" "$SAVED_SSID_LINE" "$CANDIDATE"
}
trap cleanup EXIT HUP INT TERM

rm -f "$CONTROL" "$REQUEST" "$RESPONSE" "$SCAN_RAW" "$LINK_RAW" "$SAVED_SSID_LINE" "$CANDIDATE"
mkfifo "$CONTROL"
chmod 600 "$CONTROL"

respond() {
    request_id=$1
    outcome=$2
    interface_name=$3
    detail=$4
    temporary=$RESPONSE.tmp.$
    printf '%s\t%s\t%s\t%s\n' "$request_id" "$outcome" "$interface_name" "$detail" >"$temporary"
    chmod 600 "$temporary"
    mv -f "$temporary" "$RESPONSE"
}

find_wifi_interface() {
    for netpath in /sys/class/net/*; do
        [ -d "$netpath/wireless" ] || continue
        printf '%s\n' "${netpath##*/}"
        return 0
    done
    return 1
}

capture_saved_ssid() {
    temporary=$SAVED_SSID_LINE.tmp.$$
    : >"$temporary"
    if [ -s "$WPA_CONF" ]; then
        /bin/busybox awk '/^[[:space:]]*ssid=/{print; exit}' "$WPA_CONF" >"$temporary" 2>/dev/null || true
    fi
    chmod 600 "$temporary"
    mv -f "$temporary" "$SAVED_SSID_LINE"
}

capture_link() {
    wifi=$1
    temporary=$LINK_RAW.tmp.$$
    if ! "$IW_BIN" dev "$wifi" link >"$temporary" 2>/dev/null; then
        : >"$temporary"
    fi
    chmod 600 "$temporary"
    mv -f "$temporary" "$LINK_RAW"
}

capture_scan() {
    wifi=$1
    temporary=$SCAN_RAW.tmp.$$
    "$IP_BIN" link set "$wifi" up >/dev/null 2>&1 || return 1
    "$IW_BIN" dev "$wifi" scan >"$temporary" 2>/dev/null || {
        rm -f "$temporary"
        return 1
    }
    chmod 600 "$temporary"
    mv -f "$temporary" "$SCAN_RAW"
}

stop_wifi() {
    wifi=$1
    /bin/busybox killall wpa_supplicant >/dev/null 2>&1 || true
    "$IP_BIN" addr flush dev "$wifi" >/dev/null 2>&1 || true
}

wait_for_wifi_link() {
    wifi=$1
    attempts=0
    while [ "$attempts" -lt 12 ]; do
        if "$IW_BIN" dev "$wifi" link 2>/dev/null | /bin/busybox grep -q '^Connected to '; then
            return 0
        fi
        attempts=$((attempts + 1))
        /bin/busybox sleep 1
    done
    return 1
}

have_ipv4() {
    wifi=$1
    "$IP_BIN" -4 -o addr show dev "$wifi" scope global 2>/dev/null | /bin/busybox grep -q ' inet '
}

try_dhcp() {
    wifi=$1
    "$IP_BIN" link set "$wifi" up >/dev/null 2>&1 || return 1
    "$UDHCPC_BIN" -n -q -t 4 -T 3 -i "$wifi" >/dev/null 2>&1 || return 1
    have_ipv4 "$wifi"
}

connect_conf() {
    wifi=$1
    conf=$2
    [ -s "$conf" ] || return 1
    stop_wifi "$wifi"
    "$WPA_BIN" -B -i "$wifi" -c "$conf" >/dev/null 2>&1 || return 1
    if ! wait_for_wifi_link "$wifi"; then
        /bin/busybox killall wpa_supplicant >/dev/null 2>&1 || true
        return 1
    fi
    try_dhcp "$wifi"
}

restore_saved_network() {
    wifi=$1
    [ -s "$WPA_CONF" ] || return 1
    connect_conf "$wifi" "$WPA_CONF"
}

valid_hex() {
    value=$1
    min_length=$2
    max_length=$3
    length=${#value}
    [ "$length" -ge "$min_length" ] 2>/dev/null || return 1
    [ "$length" -le "$max_length" ] 2>/dev/null || return 1
    [ $((length % 2)) -eq 0 ] || return 1
    case "$value" in
        *[!0-9A-Fa-f]*|'') return 1 ;;
    esac
    return 0
}

handle_request() {
    request_id=""
    action=""
    IFS= read -r request_id <"$REQUEST" 2>/dev/null || {
        respond unknown error "" invalid-request
        return 0
    }
    action=$(/bin/busybox sed -n '2p' "$REQUEST" 2>/dev/null || true)
    case "$request_id" in
        ''|*[!A-Za-z0-9._:-]*) respond unknown error "" invalid-request; return 0 ;;
    esac

    wifi=$(find_wifi_interface || true)
    [ -n "$wifi" ] || {
        respond "$request_id" error "" no-wifi-interface
        return 0
    }

    case "$action" in
        status)
            capture_link "$wifi"
            capture_saved_ssid
            respond "$request_id" ok "$wifi" status
            ;;
        scan)
            if capture_scan "$wifi"; then
                capture_link "$wifi"
                capture_saved_ssid
                respond "$request_id" ok "$wifi" scanned
            else
                capture_link "$wifi"
                capture_saved_ssid
                respond "$request_id" error "$wifi" scan-failed
            fi
            ;;
        connect)
            ssid_hex=$(/bin/busybox sed -n '3p' "$REQUEST" 2>/dev/null || true)
            psk_hex=$(/bin/busybox sed -n '4p' "$REQUEST" 2>/dev/null || true)
            if ! valid_hex "$ssid_hex" 2 64 || ! valid_hex "$psk_hex" 64 64; then
                respond "$request_id" error "$wifi" invalid-credentials
                return 0
            fi
            {
                printf 'ctrl_interface=/run/wpa_supplicant\n'
                printf 'update_config=0\n'
                printf 'network={\n'
                printf '    ssid=%s\n' "$ssid_hex"
                printf '    psk=%s\n' "$psk_hex"
                printf '}\n'
            } >"$CANDIDATE"
            chmod 600 "$CANDIDATE"

            if connect_conf "$wifi" "$CANDIDATE"; then
                mv -f "$CANDIDATE" "$WPA_CONF"
                chmod 600 "$WPA_CONF"
                capture_link "$wifi"
                capture_saved_ssid
                respond "$request_id" ok "$wifi" connected
            else
                rm -f "$CANDIDATE"
                restore_saved_network "$wifi" >/dev/null 2>&1 || true
                capture_link "$wifi"
                capture_saved_ssid
                respond "$request_id" error "$wifi" connect-failed
            fi
            ;;
        disconnect)
            stop_wifi "$wifi"
            capture_link "$wifi"
            capture_saved_ssid
            respond "$request_id" ok "$wifi" disconnected
            ;;
        forget)
            stop_wifi "$wifi"
            rm -f "$WPA_CONF"
            capture_link "$wifi"
            capture_saved_ssid
            respond "$request_id" ok "$wifi" forgotten
            ;;
        reconnect)
            if restore_saved_network "$wifi"; then
                capture_link "$wifi"
                capture_saved_ssid
                respond "$request_id" ok "$wifi" reconnected
            else
                capture_link "$wifi"
                capture_saved_ssid
                respond "$request_id" error "$wifi" reconnect-failed
            fi
            ;;
        *)
            respond "$request_id" error "$wifi" unsupported-action
            ;;
    esac
}

exec 9<>"$CONTROL"
while :; do
    signal=""
    if IFS= read -r signal <&9; then
        [ "$signal" = request ] && handle_request
    else
        /bin/busybox sleep 1
    fi
done
