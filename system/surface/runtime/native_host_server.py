#!/usr/bin/env python3
"""Serve the checked-out OrdaX system and a narrow loopback-only native control API."""

from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import stat
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlsplit
from urllib.request import Request, urlopen

SESSION_PATH = "/__ordax/native/session"
POWER_PATH = "/__ordax/native/power"
UPDATE_PATH = "/__ordax/native/update"
HEALTH_PATH = "/__ordax/native/health"
SURFACE_HEARTBEAT_PATH = "/__ordax/native/surface-heartbeat"
CLIENT_DIAGNOSTIC_PATH = "/__ordax/native/client-diagnostic"
PREFERENCES_PATH = "/__ordax/native/preferences"
SYNC_STATE_PATH = "/__ordax/native/sync-state"
FILES_PATH = "/__ordax/native/files"
FILE_CONTENT_PATH = "/__ordax/native/file-content"
FILE_EXPORT_PATH = "/__ordax/native/file-export"
FILE_IMPORT_PATH = "/__ordax/native/file-import"
METRICS_PATH = "/__ordax/native/metrics"
POWER_STATUS_PATH = "/__ordax/native/power-status"
NETWORK_STATUS_PATH = "/__ordax/native/network-status"
NETWORK_MANAGEMENT_PATH = "/__ordax/native/network-management"
UPDATE_HISTORY_PATH = "/__ordax/native/update-history"
UPDATE_STATE_FILE = "/run/ordax-update/state.json"
HEALTH_STATE_FILE = "/run/ordax-update/healthy-sha"
PREFERENCES_FILE = "/var/lib/ordax/preferences.json"
SYNC_STATE_FILE = "/var/lib/ordax/sync-state.json"
UPDATE_HISTORY_FILE = "/var/lib/ordax/update-history.tsv"
RELEASE_HISTORY_FILE = "/var/lib/ordax/release-history.tsv"
SURFACE_HEARTBEAT_FILE = "/var/lib/ordax/surface-heartbeat.json"
CLIENT_DIAGNOSTIC_FILE = "/var/lib/ordax/client-diagnostic.json"
TELEMETRY_DEVICE_ID_FILE = "/var/lib/ordax/telemetry-device-id"
RESCUE_STATUS_FILE = "/var/lib/ordax/rescue-status.json"
BOOT_ID_FILE = "/run/ordax-update/base-boot-id"
TOKEN_HEADER = "X-OrdaX-Power-Token"
NETWORK_TOKEN_HEADER = "X-OrdaX-Network-Token"
DIAGNOSTIC_TOKEN_HEADER = "X-OrdaX-Diagnostic-Token"
HEALTH_TOKEN_HEADER = "X-OrdaX-Health-Token"
MAX_CONTROL_BODY = 512
MAX_NETWORK_ACTION_BODY = 1024
MAX_NETWORK_SCAN_BYTES = 512 * 1024
MAX_NETWORKS = 32
MAX_SURFACE_HEARTBEAT_BODY = 512
MAX_CLIENT_DIAGNOSTIC_BODY = 512
MAX_PREFERENCE_BODY = 8192
MAX_SYNC_STATE_PAYLOAD = 65536
MAX_SYNC_STATE_BODY = 393216
MAX_FILE_ACTION_BODY = 2048
MAX_FILE_ENTRIES = 1000
MAX_TEXT_FILE_BYTES = 256 * 1024
MAX_FILE_COPY_BYTES = 64 * 1024 * 1024
MAX_FILE_EXPORT_BYTES = 64 * 1024 * 1024
MAX_FILE_IMPORT_BYTES = 64 * 1024 * 1024
MAX_UPDATE_HISTORY_BYTES = 256 * 1024
MAX_RELEASE_HISTORY_ENTRIES = 80
MAX_APPLICATION_HISTORY_ENTRIES = 200
STANDARD_USER_DIRECTORIES = ("Documentos", "Imagens", "Downloads")
PREFERENCE_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$")
NETWORK_INTERFACE_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,32}$")
CLIENT_DIAGNOSTIC_STAGE_RE = re.compile(r"^[a-z][a-z0-9.-]{0,63}$")
CLIENT_DIAGNOSTIC_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,63}$")
CLIENT_DIAGNOSTIC_SOURCE_RE = re.compile(r"^[A-Za-z0-9_.-]+\.mjs:[1-9][0-9]{0,5}:[1-9][0-9]{0,5}$")
POWER_ACTIONS = ("restart", "shutdown")
DEFAULT_POWER_REQUEST_PATH = "/run/ordax-surface/power-request"
DEFAULT_NETWORK_SESSION_DIR = "/run/ordax-surface"
SURFACE_HOST_RECOVERY_GENERATION = 1
RENAME_NOREPLACE = 1


def read_small_text(path: str, max_chars: int = 4096) -> str:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read(max_chars).strip()
    except (OSError, UnicodeError):
        return ""


def persistent_telemetry_device_id() -> str:
    current = read_small_text(TELEMETRY_DEVICE_ID_FILE, 256)
    if re.fullmatch(r"ordax-[0-9a-f]{32}", current):
        return current

    device_id = f"ordax-{secrets.token_hex(16)}"
    directory = os.path.dirname(TELEMETRY_DEVICE_ID_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    temporary = f"{TELEMETRY_DEVICE_ID_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write(device_id)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, TELEMETRY_DEVICE_ID_FILE)
    return device_id


def read_telemetry_config(path: str) -> dict | None:
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("$schema") != "ordax.telemetry-relay/1":
        return None
    endpoint = payload.get("endpoint")
    publishable_key = payload.get("publishableKey")
    interval = payload.get("intervalSeconds", 30)
    timeout = payload.get("timeoutSeconds", 4)
    if (
        not isinstance(endpoint, str)
        or not endpoint.startswith("https://")
        or len(endpoint) > 2048
        or not isinstance(publishable_key, str)
        or not publishable_key.startswith("sb_publishable_")
        or len(publishable_key) > 512
        or not isinstance(interval, int)
        or interval < 15
        or interval > 3600
        or not isinstance(timeout, int)
        or timeout < 1
        or timeout > 15
    ):
        return None
    return {
        "endpoint": endpoint,
        "publishableKey": publishable_key,
        "intervalSeconds": interval,
        "timeoutSeconds": timeout,
    }


def read_rescue_status() -> tuple[int | None, str]:
    try:
        with open(RESCUE_STATUS_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None, "none"
    if not isinstance(payload, dict):
        return None, "none"
    generation = payload.get("generation")
    action = payload.get("action")
    if not isinstance(generation, int) or generation < 0:
        generation = None
    if action not in {"none", "noop", "clear-rejected", "retry-main"}:
        action = "none"
    return generation, action


def bounded_telemetry_duration(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    if value < 0 or value > 3600:
        return 0
    return value


def build_telemetry_payload(device_id: str) -> dict:
    update = read_update_state() or {}
    rescue_generation, rescue_action = read_rescue_status()
    healthy_sha = read_small_text(HEALTH_STATE_FILE, 128)
    if not valid_commit_sha(healthy_sha):
        healthy_sha = ""

    last_applied_at = update.get("lastAppliedAt")
    if not isinstance(last_applied_at, str) or last_applied_at in {"", "unknown"}:
        last_applied_at = ""

    client_diagnostic = read_client_diagnostic()
    return {
        "deviceId": device_id,
        "sourceSha": update.get("sourceSha") if valid_commit_sha(update.get("sourceSha")) else "",
        "targetSha": update.get("targetSha") if valid_commit_sha(update.get("targetSha")) else "",
        "remoteSha": "",
        "updateStatus": update.get("status") if isinstance(update.get("status"), str) else "",
        "phase": update.get("phase") if isinstance(update.get("phase"), str) else "",
        "applyMode": update.get("applyMode") if isinstance(update.get("applyMode"), str) else "",
        "attemptId": update.get("attemptId") if isinstance(update.get("attemptId"), str) else "",
        "rejectedSha": update.get("rejectedSha") if valid_commit_sha(update.get("rejectedSha")) else "",
        "healthySha": healthy_sha,
        "lastAppliedSha": update.get("lastAppliedSha") if valid_commit_sha(update.get("lastAppliedSha")) else "",
        "lastAppliedAt": last_applied_at,
        "stagedReleaseSha": update.get("stagedReleaseSha") if valid_commit_sha(update.get("stagedReleaseSha")) else "",
        "lastApplyDurationSeconds": bounded_telemetry_duration(update.get("lastApplyDurationSeconds")),
        "lastStageDurationSeconds": bounded_telemetry_duration(update.get("lastStageDurationSeconds")),
        "rescueGeneration": rescue_generation,
        "rescueAction": rescue_action,
        "surfaceState": "running",
        "bootId": read_small_text(BOOT_ID_FILE, 256),
        "lastError": update.get("lastError") if isinstance(update.get("lastError"), str) else "",
        "clientDiagnosticSha": client_diagnostic.get("sourceSha", ""),
        "clientDiagnosticStage": client_diagnostic.get("stage", ""),
        "clientDiagnosticName": client_diagnostic.get("errorName", ""),
        "clientDiagnosticSource": client_diagnostic.get("source", ""),
        "clientDiagnosticEpoch": client_diagnostic.get("observedEpoch"),
        "relayVersion": 2,
    }


def submit_telemetry(config: dict, payload: dict) -> bool:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    request = Request(
        config["endpoint"],
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "apikey": config["publishableKey"],
            "User-Agent": "OrdaX-OS-Telemetry/1",
        },
    )
    try:
        with urlopen(request, timeout=config["timeoutSeconds"]) as response:
            return 200 <= response.status < 300
    except (HTTPError, URLError, OSError, TimeoutError):
        return False


def telemetry_heartbeat_loop(config: dict) -> None:
    try:
        device_id = persistent_telemetry_device_id()
    except OSError as exc:
        print(f"ordax-native-host: telemetry device id unavailable: {exc}", file=sys.stderr, flush=True)
        return

    while True:
        try:
            submit_telemetry(config, build_telemetry_payload(device_id))
        except Exception as exc:
            print(f"ordax-native-host: telemetry heartbeat failed safely: {exc}", file=sys.stderr, flush=True)
        time.sleep(config["intervalSeconds"])


def start_telemetry_heartbeat(config_path: str) -> bool:
    config = read_telemetry_config(config_path)
    if config is None:
        return False
    thread = threading.Thread(
        target=telemetry_heartbeat_loop,
        args=(config,),
        name="ordax-telemetry",
        daemon=True,
    )
    thread.start()
    return True


def supported_power_actions(power_request_path: str) -> tuple[str, ...]:
    try:
        metadata = os.stat(power_request_path)
    except OSError:
        return ()
    if (
        not stat.S_ISFIFO(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) != 0o600
        or not os.access(power_request_path, os.W_OK)
    ):
        return ()
    return POWER_ACTIONS


def queue_power_action(power_request_path: str, action: str) -> None:
    if action not in POWER_ACTIONS:
        raise ValueError("unsupported power action")
    descriptor = os.open(
        power_request_path,
        os.O_WRONLY
        | getattr(os, "O_NONBLOCK", 0)
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0),
    )
    try:
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISFIFO(metadata.st_mode)
            or metadata.st_uid != os.geteuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
        ):
            raise PermissionError("host power broker boundary is not a private FIFO")
        payload = f"{action}\n".encode("ascii")
        written = os.write(descriptor, payload)
        if written != len(payload):
            raise OSError("short write to host power broker")
    finally:
        os.close(descriptor)


def read_update_state() -> dict | None:
    try:
        with open(UPDATE_STATE_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    source_sha = payload.get("sourceSha")
    if not isinstance(source_sha, str) or not source_sha:
        return None
    return payload


def valid_commit_sha(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 40
        and all(character in "0123456789abcdef" for character in value)
    )


def valid_client_diagnostic_payload(value: object) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"sourceSha", "stage", "errorName", "source"}
        and valid_commit_sha(value.get("sourceSha"))
        and isinstance(value.get("stage"), str)
        and CLIENT_DIAGNOSTIC_STAGE_RE.fullmatch(value["stage"]) is not None
        and isinstance(value.get("errorName"), str)
        and CLIENT_DIAGNOSTIC_NAME_RE.fullmatch(value["errorName"]) is not None
        and isinstance(value.get("source"), str)
        and (
            value["source"] == ""
            or CLIENT_DIAGNOSTIC_SOURCE_RE.fullmatch(value["source"]) is not None
        )
    )


def record_client_diagnostic(payload: dict) -> None:
    if not valid_client_diagnostic_payload(payload):
        raise ValueError("invalid client diagnostic")
    directory = os.path.dirname(CLIENT_DIAGNOSTIC_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    record = {
        "sourceSha": payload["sourceSha"],
        "stage": payload["stage"],
        "errorName": payload["errorName"],
        "source": payload["source"],
        "observedEpoch": max(0, int(time.time())),
    }
    temporary = f"{CLIENT_DIAGNOSTIC_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
    with open(temporary, "w", encoding="utf-8") as handle:
        os.fchmod(handle.fileno(), 0o600)
        json.dump(record, handle, separators=(",", ":"), sort_keys=True, allow_nan=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, CLIENT_DIAGNOSTIC_FILE)


def read_client_diagnostic() -> dict:
    try:
        with open(CLIENT_DIAGNOSTIC_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    candidate = {
        "sourceSha": payload.get("sourceSha"),
        "stage": payload.get("stage"),
        "errorName": payload.get("errorName"),
        "source": payload.get("source"),
    }
    if not valid_client_diagnostic_payload(candidate):
        return {}
    observed_epoch = payload.get("observedEpoch")
    if not isinstance(observed_epoch, int) or observed_epoch < 0:
        return {}
    return {**candidate, "observedEpoch": observed_epoch}


def valid_preference_record(value: object) -> bool:
    if not isinstance(value, dict) or len(value) > 128:
        return False
    for preference_id, preference_value in value.items():
        if not isinstance(preference_id, str) or not PREFERENCE_ID_RE.fullmatch(preference_id):
            return False
        if preference_value is None or isinstance(preference_value, (str, bool, int)):
            if isinstance(preference_value, str) and len(preference_value) > 4096:
                return False
            continue
        if isinstance(preference_value, float) and math.isfinite(preference_value):
            continue
        return False
    return True


def read_preferences() -> dict:
    try:
        with open(PREFERENCES_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if valid_preference_record(payload) else {}


def write_preferences(preferences: dict) -> None:
    if not valid_preference_record(preferences):
        raise ValueError("invalid preference record")
    directory = os.path.dirname(PREFERENCES_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    temporary = f"{PREFERENCES_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(preferences, handle, separators=(",", ":"), sort_keys=True, allow_nan=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, PREFERENCES_FILE)
    try:
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def valid_sync_state_payload(value: object) -> bool:
    return (
        value is None
        or (
            isinstance(value, str)
            and len(value.encode("utf-8")) <= MAX_SYNC_STATE_PAYLOAD
        )
    )


def read_sync_state_payload() -> str | None:
    try:
        with open(SYNC_STATE_FILE, "r", encoding="utf-8") as handle:
            payload = handle.read(MAX_SYNC_STATE_PAYLOAD + 1)
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError):
        return None
    return payload if valid_sync_state_payload(payload) else None


def write_sync_state_payload(payload: str | None) -> None:
    if not valid_sync_state_payload(payload):
        raise ValueError("invalid sync state payload")
    directory = os.path.dirname(SYNC_STATE_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    if payload is None:
        try:
            os.unlink(SYNC_STATE_FILE)
        except FileNotFoundError:
            return
    else:
        temporary = f"{SYNC_STATE_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
        try:
            with open(temporary, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, SYNC_STATE_FILE)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
    try:
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def parse_meminfo(text: str) -> tuple[int, int]:
    fields: dict[str, int] = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        name, raw_value = line.split(":", 1)
        parts = raw_value.strip().split()
        if not parts:
            continue
        try:
            value = int(parts[0])
        except ValueError:
            continue
        if value < 0:
            continue
        unit = parts[1] if len(parts) > 1 else ""
        if unit not in {"", "kB"}:
            continue
        fields[name] = value * 1024 if unit == "kB" else value

    total = fields.get("MemTotal")
    available = fields.get("MemAvailable")
    if total is None or available is None or available > total:
        raise ValueError("required memory metrics are unavailable")
    return total, available


def read_system_metrics(user_root: str, proc_root: str = "/proc") -> dict:
    with open(os.path.join(proc_root, "uptime"), "r", encoding="utf-8") as handle:
        uptime_parts = handle.read().strip().split()
    if not uptime_parts:
        raise ValueError("uptime metric is unavailable")
    uptime_value = float(uptime_parts[0])
    if not math.isfinite(uptime_value) or uptime_value < 0:
        raise ValueError("uptime metric is invalid")

    with open(os.path.join(proc_root, "meminfo"), "r", encoding="utf-8") as handle:
        memory_total, memory_available = parse_meminfo(handle.read())

    os.makedirs(user_root, mode=0o700, exist_ok=True)
    storage = os.statvfs(user_root)
    block_size = storage.f_frsize or storage.f_bsize
    storage_total = max(0, int(storage.f_blocks) * int(block_size))
    storage_free = max(0, int(storage.f_bavail) * int(block_size))
    storage_free = min(storage_free, storage_total)

    return {
        "uptimeSeconds": max(0, int(uptime_value)),
        "memoryTotalBytes": memory_total,
        "memoryAvailableBytes": memory_available,
        "userStorageTotalBytes": storage_total,
        "userStorageFreeBytes": storage_free,
    }


def read_power_supply_percent(path: str) -> int | None:
    raw_capacity = read_small_text(os.path.join(path, "capacity"), 16)
    try:
        capacity = int(raw_capacity)
    except ValueError:
        capacity = -1
    if 0 <= capacity <= 100:
        return capacity

    for current_name, full_names in (
        ("energy_now", ("energy_full", "energy_full_design")),
        ("charge_now", ("charge_full", "charge_full_design")),
    ):
        raw_current = read_small_text(os.path.join(path, current_name), 32)
        try:
            current = int(raw_current)
        except ValueError:
            continue
        if current < 0:
            continue
        for full_name in full_names:
            raw_full = read_small_text(os.path.join(path, full_name), 32)
            try:
                full = int(raw_full)
            except ValueError:
                continue
            if full <= 0:
                continue
            return max(0, min(100, int(round((current * 100) / full))))
    return None


def read_power_status(sys_class_power_supply: str = "/sys/class/power_supply") -> dict:
    try:
        names = sorted(os.listdir(sys_class_power_supply))
    except FileNotFoundError:
        return {"battery": None, "externalPower": None}
    except OSError as exc:
        raise ValueError("power supply inventory is unavailable") from exc

    batteries = []
    external_online = []
    for name in names[:64]:
        path = os.path.join(sys_class_power_supply, name)
        if not os.path.isdir(path):
            continue
        supply_type = read_small_text(os.path.join(path, "type"), 64).strip().lower()
        if supply_type == "battery":
            present = read_small_text(os.path.join(path, "present"), 8)
            if present == "0":
                continue
            capacity = read_power_supply_percent(path)
            if capacity is None:
                continue
            raw_status = read_small_text(os.path.join(path, "status"), 64).strip().lower()
            state = {
                "charging": "charging",
                "discharging": "discharging",
                "full": "full",
                "not charging": "not-charging",
            }.get(raw_status, "unknown")
            batteries.append({"percent": capacity, "state": state})
            continue

        raw_online = read_small_text(os.path.join(path, "online"), 8)
        if raw_online == "1":
            external_online.append(True)
        elif raw_online == "0":
            external_online.append(False)

    if batteries:
        percent = int(round(sum(item["percent"] for item in batteries) / len(batteries)))
        states = {item["state"] for item in batteries}
        if "charging" in states:
            state = "charging"
        elif states == {"full"}:
            state = "full"
        elif "discharging" in states:
            state = "discharging"
        elif "not-charging" in states:
            state = "not-charging"
        else:
            state = "unknown"
        battery = {"percent": percent, "state": state}
    else:
        battery = None

    external_power = (
        True
        if any(external_online)
        else (False if external_online else None)
    )
    return {
        "battery": battery,
        "externalPower": external_power,
    }


def parse_wireless_signals(text: str) -> dict[str, int]:
    signals: dict[str, int] = {}
    for raw_line in text.splitlines()[2:]:
        if ":" not in raw_line:
            continue
        interface_name, values = raw_line.split(":", 1)
        interface_name = interface_name.strip()
        if not NETWORK_INTERFACE_RE.fullmatch(interface_name):
            continue
        fields = values.split()
        if len(fields) < 3:
            continue
        try:
            level = float(fields[2].rstrip("."))
        except ValueError:
            continue
        if not math.isfinite(level):
            continue
        signal_dbm = int(level)
        if -200 <= signal_dbm <= 0:
            signals[interface_name] = signal_dbm
    return signals


def read_network_status(
    sys_class_net: str = "/sys/class/net",
    proc_net_wireless: str = "/proc/net/wireless",
) -> dict:
    try:
        with open(proc_net_wireless, "r", encoding="utf-8") as handle:
            wireless_signals = parse_wireless_signals(handle.read(65536))
    except (OSError, UnicodeError):
        wireless_signals = {}

    interfaces = []
    try:
        names = sorted(os.listdir(sys_class_net))
    except OSError as exc:
        raise ValueError("network interface inventory is unavailable") from exc

    for name in names[:64]:
        if name == "lo" or not NETWORK_INTERFACE_RE.fullmatch(name):
            continue
        interface_path = os.path.join(sys_class_net, name)
        if not os.path.isdir(interface_path):
            continue

        is_wifi = os.path.isdir(os.path.join(interface_path, "wireless"))
        interface_type = read_small_text(os.path.join(interface_path, "type"), 32)
        kind = "wifi" if is_wifi else ("ethernet" if interface_type == "1" else "other")

        carrier = read_small_text(os.path.join(interface_path, "carrier"), 8)
        operstate = read_small_text(os.path.join(interface_path, "operstate"), 32)
        if carrier == "1":
            link_state = "connected"
        elif carrier == "0":
            link_state = "disconnected"
        elif operstate == "up":
            link_state = "connected"
        elif operstate in {"down", "dormant", "notpresent", "lowerlayerdown"}:
            link_state = "disconnected"
        else:
            link_state = "unknown"

        interfaces.append(
            {
                "name": name,
                "kind": kind,
                "state": link_state,
                "signalDbm": wireless_signals.get(name) if is_wifi else None,
            }
        )

    return {"interfaces": interfaces}


def valid_wifi_ssid(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        encoded = value.encode("utf-8")
    except UnicodeError:
        return False
    return (
        1 <= len(encoded) <= 32
        and "\x00" not in value
        and not any(ord(character) < 32 for character in value)
    )


def valid_wifi_password(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        encoded = value.encode("utf-8")
    except UnicodeError:
        return False
    return (
        8 <= len(encoded) <= 63
        and "\x00" not in value
        and not any(ord(character) < 32 for character in value)
    )


def derive_wpa_psk(ssid: str, password: str) -> str:
    if not valid_wifi_ssid(ssid) or not valid_wifi_password(password):
        raise ValueError("invalid Wi-Fi credentials")
    return hashlib.pbkdf2_hmac(
        "sha1",
        password.encode("utf-8"),
        ssid.encode("utf-8"),
        4096,
        dklen=32,
    ).hex()


def decode_wpa_ssid_line(line: str) -> str | None:
    value = line.strip()
    if not value.startswith("ssid="):
        return None
    raw = value[5:].strip()
    if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
        decoded_characters = []
        escaped = False
        for character in raw[1:-1]:
            if escaped:
                decoded_characters.append(character)
                escaped = False
            elif character == "\\":
                escaped = True
            else:
                decoded_characters.append(character)
        if escaped:
            return None
        decoded = "".join(decoded_characters)
        return decoded if valid_wifi_ssid(decoded) else None
    if not raw or len(raw) % 2 != 0 or any(character not in "0123456789abcdefABCDEF" for character in raw):
        return None
    try:
        decoded = bytes.fromhex(raw).decode("utf-8")
    except (ValueError, UnicodeError):
        return None
    return decoded if valid_wifi_ssid(decoded) else None


def parse_iw_link(text: str) -> str | None:
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line.startswith("SSID:"):
            continue
        ssid = line[5:].strip()
        return ssid if valid_wifi_ssid(ssid) else None
    return None


def parse_iw_scan(text: str, *, current_ssid: str | None, saved_ssid: str | None) -> list[dict]:
    networks: dict[str, dict] = {}
    block: list[str] = []

    def consume(lines: list[str]) -> None:
        if not lines:
            return
        ssid = None
        signal_dbm = None
        supports_psk = False
        for raw_line in lines:
            line = raw_line.strip()
            if line.startswith("SSID:"):
                candidate = line[5:].strip()
                if valid_wifi_ssid(candidate):
                    ssid = candidate
            elif line.startswith("signal:"):
                raw_signal = line[7:].strip().split(" ", 1)[0]
                try:
                    signal_value = float(raw_signal)
                except ValueError:
                    continue
                if math.isfinite(signal_value) and -200 <= signal_value <= 0:
                    signal_dbm = int(round(signal_value))
            elif "Authentication suites:" in line and "PSK" in line.split(":", 1)[-1].split():
                supports_psk = True

        if ssid is None or signal_dbm is None or not supports_psk:
            return
        existing = networks.get(ssid)
        if existing is not None and existing["signalDbm"] >= signal_dbm:
            return
        networks[ssid] = {
            "ssid": ssid,
            "signalDbm": signal_dbm,
            "security": "wpa-psk",
            "connected": ssid == current_ssid,
            "saved": ssid == saved_ssid,
        }

    for raw_line in text.splitlines():
        if raw_line.startswith("BSS "):
            consume(block)
            block = [raw_line]
        elif block:
            block.append(raw_line)
    consume(block)

    return sorted(
        networks.values(),
        key=lambda entry: (not entry["connected"], not entry["saved"], -entry["signalDbm"], entry["ssid"].casefold()),
    )[:MAX_NETWORKS]


def network_broker_paths(session_dir: str) -> dict[str, str]:
    return {
        "control": os.path.join(session_dir, "network-control"),
        "request": os.path.join(session_dir, "network-request"),
        "response": os.path.join(session_dir, "network-response"),
        "scan": os.path.join(session_dir, "network-scan.raw"),
        "link": os.path.join(session_dir, "network-link.raw"),
        "saved": os.path.join(session_dir, "network-saved-ssid"),
    }


def network_broker_available(paths: dict[str, str]) -> bool:
    try:
        metadata = os.stat(paths["control"])
    except OSError:
        return False
    return (
        stat.S_ISFIFO(metadata.st_mode)
        and metadata.st_uid == os.geteuid()
        and stat.S_IMODE(metadata.st_mode) == 0o600
        and os.access(paths["control"], os.W_OK)
    )


def _read_bounded_bytes(path: str, max_bytes: int) -> bytes:
    try:
        with open(path, "rb") as handle:
            payload = handle.read(max_bytes + 1)
    except OSError:
        return b""
    return payload if len(payload) <= max_bytes else b""


def build_network_management_snapshot(paths: dict[str, str], wifi_interface: str) -> dict:
    if not NETWORK_INTERFACE_RE.fullmatch(wifi_interface):
        raise ValueError("invalid Wi-Fi interface")
    link_payload = _read_bounded_bytes(paths["link"], 64 * 1024)
    scan_payload = _read_bounded_bytes(paths["scan"], MAX_NETWORK_SCAN_BYTES)
    saved_payload = _read_bounded_bytes(paths["saved"], 1024)
    try:
        link_text = link_payload.decode("utf-8")
        scan_text = scan_payload.decode("utf-8")
        saved_text = saved_payload.decode("utf-8")
    except UnicodeError as exc:
        raise ValueError("invalid network broker output") from exc

    current_ssid = parse_iw_link(link_text)
    saved_ssid = None
    for line in saved_text.splitlines()[:1]:
        saved_ssid = decode_wpa_ssid_line(line)
    return {
        "wifiInterface": wifi_interface,
        "currentSsid": current_ssid,
        "savedSsid": saved_ssid,
        "networks": parse_iw_scan(
            scan_text,
            current_ssid=current_ssid,
            saved_ssid=saved_ssid,
        ),
    }


def queue_network_broker_request(
    paths: dict[str, str],
    action: str,
    *,
    ssid: str | None = None,
    password: str | None = None,
    timeout_seconds: float = 20.0,
) -> dict:
    if action not in {"status", "scan", "connect", "disconnect", "forget", "reconnect"}:
        raise ValueError("unsupported network action")
    if not network_broker_available(paths):
        raise FileNotFoundError("network broker unavailable")

    request_id = secrets.token_hex(12)
    lines = [request_id, action]
    if action == "connect":
        if not valid_wifi_ssid(ssid) or not valid_wifi_password(password):
            raise ValueError("invalid Wi-Fi credentials")
        lines.extend([ssid.encode("utf-8").hex(), derive_wpa_psk(ssid, password)])
    payload = ("\n".join(lines) + "\n").encode("ascii")
    request_dir = os.path.dirname(paths["request"])
    temporary = f'{paths["request"]}.tmp.{os.getpid()}.{threading.get_ident()}'
    with open(temporary, "wb") as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, paths["request"])

    try:
        try:
            os.unlink(paths["response"])
        except FileNotFoundError:
            pass

        descriptor = os.open(
            paths["control"],
            os.O_WRONLY
            | getattr(os, "O_NONBLOCK", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            metadata = os.fstat(descriptor)
            if (
                not stat.S_ISFIFO(metadata.st_mode)
                or metadata.st_uid != os.geteuid()
                or stat.S_IMODE(metadata.st_mode) != 0o600
            ):
                raise PermissionError("network broker boundary is not private")
            if os.write(descriptor, b"request\n") != len(b"request\n"):
                raise OSError("short write to network broker")
        finally:
            os.close(descriptor)

        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            response = read_small_text(paths["response"], 512)
            if response:
                fields = response.split("\t")
                if len(fields) == 4 and fields[0] == request_id:
                    _, outcome, wifi_interface, detail = fields
                    if outcome == "ok":
                        return build_network_management_snapshot(paths, wifi_interface)
                    error = RuntimeError(detail or "network-action-failed")
                    error.network_detail = detail
                    raise error
            time.sleep(0.05)
        raise TimeoutError("network broker response timed out")
    finally:
        try:
            os.unlink(paths["request"])
        except FileNotFoundError:
            pass


def _bounded_history_lines(path: str, max_entries: int) -> list[str]:
    try:
        with open(path, "rb") as handle:
            payload = handle.read(MAX_UPDATE_HISTORY_BYTES + 1)
    except OSError:
        return []
    if len(payload) > MAX_UPDATE_HISTORY_BYTES:
        return []
    try:
        text = payload.decode("utf-8")
    except UnicodeError:
        return []
    return text.splitlines()[-max_entries:]


def _history_text(value: str, max_length: int) -> str | None:
    if not value or len(value) > max_length or any(ord(character) < 32 for character in value):
        return None
    return value


def _history_version(value: str) -> int | None:
    try:
        number = int(value)
    except ValueError:
        return None
    return number if 1 <= number <= 1_000_000 else None


def _history_duration(value: str) -> int | None:
    try:
        seconds = int(value)
    except ValueError:
        return None
    return seconds if 0 <= seconds <= 3600 else None


def read_release_history(path: str = RELEASE_HISTORY_FILE) -> list[dict]:
    releases = []
    for line in _bounded_history_lines(path, MAX_RELEASE_HISTORY_ENTRIES):
        fields = line.split("\t")
        if len(fields) != 4:
            continue
        version = _history_version(fields[0])
        released_at = _history_text(fields[1], 64)
        source_sha = fields[2]
        title = _history_text(fields[3], 200)
        if version is None or released_at is None or not valid_commit_sha(source_sha) or title is None:
            continue
        releases.append(
            {
                "deliveryNumber": version,
                "versionNumber": version,
                "sourceSha": source_sha,
                "releasedAt": released_at,
                "title": title,
            }
        )
    return releases


def read_application_history(path: str = UPDATE_HISTORY_FILE) -> list[dict]:
    applications = []
    valid_modes = {"none", "reload", "surface-restart", "supervisor-restart", "initial"}
    valid_results = {"applied", "rolled-back"}
    for line in _bounded_history_lines(path, MAX_APPLICATION_HISTORY_ENTRIES):
        fields = line.split("\t")
        if len(fields) != 7:
            continue
        version = _history_version(fields[0])
        applied_at = _history_text(fields[1], 64)
        source_sha = fields[2]
        apply_mode = fields[3]
        result = fields[4]
        apply_duration = _history_duration(fields[5])
        stage_duration = _history_duration(fields[6])
        if (
            version is None
            or applied_at is None
            or not valid_commit_sha(source_sha)
            or apply_mode not in valid_modes
            or result not in valid_results
            or apply_duration is None
            or stage_duration is None
        ):
            continue
        applications.append(
            {
                "deliveryNumber": version,
                "versionNumber": version,
                "sourceSha": source_sha,
                "appliedAt": applied_at,
                "applyMode": apply_mode,
                "result": result,
                "applyDurationSeconds": apply_duration,
                "stageDurationSeconds": stage_duration,
            }
        )
    applications.reverse()
    return applications


def read_update_history() -> dict:
    return {
        "releases": read_release_history(RELEASE_HISTORY_FILE),
        "applications": read_application_history(UPDATE_HISTORY_FILE),
    }


def valid_logical_file_path(value: object) -> bool:
    if not isinstance(value, str) or not value.startswith("/") or len(value) > 4096:
        return False
    if value != "/" and value.endswith("/"):
        return False
    if value == "/":
        return True
    parts = value.split("/")[1:]
    return bool(parts) and all(valid_file_name(part) for part in parts)


def valid_file_name(value: object) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value) <= 255
        and value not in {".", ".."}
        and "/" not in value
        and "\0" not in value
        and not any(ord(character) < 32 for character in value)
    )


def _directory_open_flags() -> int:
    return (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0)
    )


def open_user_directory(user_root: str, logical_path: str) -> int:
    if not valid_logical_file_path(logical_path):
        raise ValueError("invalid logical file-space path")
    os.makedirs(user_root, mode=0o700, exist_ok=True)
    descriptor = os.open(user_root, _directory_open_flags())
    try:
        for segment in logical_path.split("/")[1:]:
            if not segment:
                continue
            next_descriptor = os.open(segment, _directory_open_flags(), dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_descriptor
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def list_user_directory(user_root: str, logical_path: str) -> dict:
    descriptor = open_user_directory(user_root, logical_path)
    try:
        entries = []
        with os.scandir(descriptor) as iterator:
            for entry in iterator:
                if not valid_file_name(entry.name) or entry.is_symlink():
                    continue
                try:
                    metadata = entry.stat(follow_symlinks=False)
                    if entry.is_dir(follow_symlinks=False):
                        kind = "directory"
                        size = 0
                    elif entry.is_file(follow_symlinks=False):
                        kind = "file"
                        size = metadata.st_size
                    else:
                        continue
                    modified_at = max(0, int(metadata.st_mtime_ns // 1_000_000))
                except OSError:
                    continue
                entries.append(
                    {
                        "name": entry.name,
                        "kind": kind,
                        "size": max(0, int(size)),
                        "modifiedAt": modified_at,
                    }
                )
        entries.sort(key=lambda item: (item["kind"] != "directory", item["name"].casefold(), item["name"]))
        return {"path": logical_path, "entries": entries[:MAX_FILE_ENTRIES]}
    finally:
        os.close(descriptor)


class FileSpaceTextTooLargeError(Exception):
    pass


class FileSpaceTextEncodingError(Exception):
    pass


class FileSpaceCopyTooLargeError(Exception):
    pass


class FileSpaceCopyChangedError(Exception):
    pass


class FileSpaceCrossDeviceMoveError(Exception):
    pass


class FileSpaceExportTooLargeError(Exception):
    pass


class FileSpaceExportChangedError(Exception):
    pass


class FileSpaceImportTooLargeError(Exception):
    pass


class FileSpaceImportIncompleteError(Exception):
    pass


def read_user_text_file(
    user_root: str,
    logical_path: str,
    max_bytes: int = MAX_TEXT_FILE_BYTES,
) -> dict:
    if not valid_logical_file_path(logical_path) or logical_path == "/":
        raise ValueError("invalid text-file path")
    parent_path, name = logical_path.rsplit("/", 1)
    parent_path = parent_path or "/"
    if not valid_file_name(name):
        raise ValueError("invalid text-file name")

    parent_descriptor = open_user_directory(user_root, parent_path)
    descriptor = None
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            dir_fd=parent_descriptor,
        )
    finally:
        os.close(parent_descriptor)

    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError("text-file preview requires a regular file")
        if metadata.st_size > max_bytes:
            raise FileSpaceTextTooLargeError("text file exceeds preview limit")

        content = bytearray()
        while len(content) <= max_bytes:
            remaining = max_bytes + 1 - len(content)
            chunk = os.read(descriptor, min(65536, remaining))
            if not chunk:
                break
            content.extend(chunk)
            if len(content) > max_bytes:
                raise FileSpaceTextTooLargeError("text file exceeds preview limit")

        try:
            text = bytes(content).decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise FileSpaceTextEncodingError("text file is not valid UTF-8") from exc
        if "\0" in text:
            raise FileSpaceTextEncodingError("text file contains NUL bytes")
        return {"path": logical_path, "size": len(content), "text": text}
    finally:
        os.close(descriptor)


def read_user_export_file(
    user_root: str,
    logical_path: str,
    max_bytes: int = MAX_FILE_EXPORT_BYTES,
) -> tuple[str, bytes]:
    if not valid_logical_file_path(logical_path) or logical_path == "/":
        raise ValueError("invalid export path")
    parent_path, name = logical_path.rsplit("/", 1)
    parent_path = parent_path or "/"
    if not valid_file_name(name):
        raise ValueError("invalid export name")

    parent_descriptor = open_user_directory(user_root, parent_path)
    descriptor = None
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            dir_fd=parent_descriptor,
        )
    finally:
        os.close(parent_descriptor)

    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("file export requires a regular file")
        if before.st_size > max_bytes:
            raise FileSpaceExportTooLargeError("file exceeds export limit")

        content = bytearray()
        while len(content) <= max_bytes:
            remaining = max_bytes + 1 - len(content)
            chunk = os.read(descriptor, min(65536, remaining))
            if not chunk:
                break
            content.extend(chunk)
            if len(content) > max_bytes:
                raise FileSpaceExportTooLargeError("file exceeded export limit during read")

        after = os.fstat(descriptor)
        before_identity = (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        )
        after_identity = (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        )
        if before_identity != after_identity or len(content) != after.st_size:
            raise FileSpaceExportChangedError("file changed while being exported")
        return name, bytes(content)
    finally:
        os.close(descriptor)


def import_user_file(
    user_root: str,
    logical_path: str,
    name: str,
    source,
    length: int,
    max_bytes: int = MAX_FILE_IMPORT_BYTES,
) -> dict:
    if not valid_logical_file_path(logical_path):
        raise ValueError("invalid import directory path")
    if not valid_file_name(name):
        raise ValueError("invalid import name")
    if isinstance(length, bool) or not isinstance(length, int) or length < 0:
        raise ValueError("invalid import length")
    if length > max_bytes:
        raise FileSpaceImportTooLargeError("import exceeds size limit")

    directory_fd = open_user_directory(user_root, logical_path)
    destination_fd = None
    destination_created = False
    try:
        destination_fd = os.open(
            name,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=directory_fd,
        )
        destination_created = True

        remaining = length
        while remaining > 0:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                raise FileSpaceImportIncompleteError(
                    "import body ended before declared content length"
                )
            if len(chunk) > remaining:
                chunk = chunk[:remaining]

            view = memoryview(chunk)
            while view:
                written = os.write(destination_fd, view)
                if written <= 0:
                    raise OSError(errno.EIO, "import write made no progress")
                view = view[written:]
            remaining -= len(chunk)

        os.fsync(destination_fd)
        os.close(destination_fd)
        destination_fd = None
        os.fsync(directory_fd)
        return list_user_directory(user_root, logical_path)
    except Exception:
        if destination_fd is not None:
            os.close(destination_fd)
            destination_fd = None
        if destination_created:
            try:
                os.unlink(name, dir_fd=directory_fd)
                os.fsync(directory_fd)
            except FileNotFoundError:
                pass
        raise
    finally:
        if destination_fd is not None:
            os.close(destination_fd)
        os.close(directory_fd)


def _file_identity(metadata) -> tuple[int, int, int, int, int]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def _remove_copy_destination(destination_directory_fd: int, name: str) -> None:
    try:
        os.unlink(name, dir_fd=destination_directory_fd)
    except FileNotFoundError:
        return
    os.fsync(destination_directory_fd)


def _copy_open_regular_file(
    source_fd: int,
    source_before,
    destination_directory_fd: int,
    new_name: str,
    max_bytes: int = MAX_FILE_COPY_BYTES,
):
    if not stat.S_ISREG(source_before.st_mode):
        raise ValueError("file copy requires a regular source file")
    if source_before.st_size > max_bytes:
        raise FileSpaceCopyTooLargeError("source file exceeds copy limit")

    destination_fd = None
    destination_created = False
    try:
        destination_fd = os.open(
            new_name,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=destination_directory_fd,
        )
        destination_created = True

        copied = 0
        while True:
            remaining = max_bytes + 1 - copied
            chunk = os.read(source_fd, min(65536, remaining))
            if not chunk:
                break
            copied += len(chunk)
            if copied > max_bytes:
                raise FileSpaceCopyTooLargeError(
                    "source file exceeded copy limit during read"
                )

            view = memoryview(chunk)
            while view:
                written = os.write(destination_fd, view)
                if written <= 0:
                    raise OSError(errno.EIO, "copy write made no progress")
                view = view[written:]

        source_after = os.fstat(source_fd)
        if (
            _file_identity(source_before) != _file_identity(source_after)
            or copied != source_after.st_size
        ):
            raise FileSpaceCopyChangedError("source changed while being copied")

        os.fsync(destination_fd)
        os.close(destination_fd)
        destination_fd = None
        os.fsync(destination_directory_fd)
        return source_after
    except Exception:
        if destination_fd is not None:
            os.close(destination_fd)
            destination_fd = None
        if destination_created:
            _remove_copy_destination(destination_directory_fd, new_name)
        raise
    finally:
        if destination_fd is not None:
            os.close(destination_fd)


def _renameat2_noreplace_between(
    source_directory_fd: int,
    old_name: str,
    destination_directory_fd: int,
    new_name: str,
) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise OSError(errno.ENOSYS, "renameat2 is unavailable")
    renameat2.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    renameat2.restype = ctypes.c_int
    result = renameat2(
        source_directory_fd,
        os.fsencode(old_name),
        destination_directory_fd,
        os.fsencode(new_name),
        RENAME_NOREPLACE,
    )
    if result == 0:
        return
    error_number = ctypes.get_errno()
    if error_number == errno.EEXIST:
        raise FileExistsError(error_number, os.strerror(error_number), new_name)
    raise OSError(error_number, os.strerror(error_number), new_name)


def _renameat2_noreplace(directory_fd: int, old_name: str, new_name: str) -> None:
    _renameat2_noreplace_between(directory_fd, old_name, directory_fd, new_name)


def rename_user_entry(
    user_root: str,
    logical_path: str,
    name: str,
    new_name: str,
) -> dict:
    if not valid_logical_file_path(logical_path):
        raise ValueError("invalid rename directory path")
    if not valid_file_name(name) or not valid_file_name(new_name):
        raise ValueError("invalid rename name")
    if name == new_name:
        return list_user_directory(user_root, logical_path)

    descriptor = open_user_directory(user_root, logical_path)
    try:
        metadata = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
        if stat.S_ISLNK(metadata.st_mode):
            raise ValueError("symbolic links cannot be renamed through file-space")
        if not (stat.S_ISREG(metadata.st_mode) or stat.S_ISDIR(metadata.st_mode)):
            raise ValueError("unsupported file-space entry kind")
        _renameat2_noreplace(descriptor, name, new_name)
    finally:
        os.close(descriptor)
    return list_user_directory(user_root, logical_path)


def move_user_entry(
    user_root: str,
    source_path: str,
    name: str,
    destination_path: str,
    max_bytes: int = MAX_FILE_COPY_BYTES,
) -> dict:
    if not valid_logical_file_path(source_path):
        raise ValueError("invalid move source path")
    if not valid_logical_file_path(destination_path):
        raise ValueError("invalid move destination path")
    if not valid_file_name(name):
        raise ValueError("invalid move name")
    if source_path == destination_path:
        return list_user_directory(user_root, source_path)

    source_entry_path = (
        f"/{name}" if source_path == "/" else f"{source_path}/{name}"
    )
    if (
        destination_path == source_entry_path
        or destination_path.startswith(f"{source_entry_path}/")
    ):
        raise ValueError("cannot move a directory into itself")

    source_directory_fd = open_user_directory(user_root, source_path)
    destination_directory_fd = None
    source_fd = None
    try:
        metadata = os.stat(name, dir_fd=source_directory_fd, follow_symlinks=False)
        if stat.S_ISLNK(metadata.st_mode):
            raise ValueError("symbolic links cannot be moved through file-space")
        if not (stat.S_ISREG(metadata.st_mode) or stat.S_ISDIR(metadata.st_mode)):
            raise ValueError("unsupported file-space entry kind")

        source_before = None
        if stat.S_ISREG(metadata.st_mode):
            source_fd = os.open(
                name,
                os.O_RDONLY
                | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_CLOEXEC", 0),
                dir_fd=source_directory_fd,
            )
            source_before = os.fstat(source_fd)
            if _file_identity(source_before)[:2] != _file_identity(metadata)[:2]:
                raise FileSpaceCopyChangedError(
                    "source changed while preparing cross-device move"
                )

        destination_directory_fd = open_user_directory(user_root, destination_path)
        try:
            _renameat2_noreplace_between(
                source_directory_fd,
                name,
                destination_directory_fd,
                name,
            )
        except OSError as exc:
            if exc.errno != errno.EXDEV:
                raise
            if source_fd is None or source_before is None:
                raise FileSpaceCrossDeviceMoveError(
                    "cross-device directory move is not supported"
                ) from exc

            source_after = _copy_open_regular_file(
                source_fd,
                source_before,
                destination_directory_fd,
                name,
                max_bytes=max_bytes,
            )
            current = os.stat(
                name,
                dir_fd=source_directory_fd,
                follow_symlinks=False,
            )
            if _file_identity(current) != _file_identity(source_after):
                _remove_copy_destination(destination_directory_fd, name)
                raise FileSpaceCopyChangedError(
                    "source path changed before cross-device move commit"
                )

            try:
                os.unlink(name, dir_fd=source_directory_fd)
            except Exception:
                _remove_copy_destination(destination_directory_fd, name)
                raise
            try:
                os.fsync(source_directory_fd)
            except OSError:
                # The destination is already durable and the source name is gone.
                # Do not delete the only remaining copy merely because directory
                # durability could not be confirmed by this filesystem.
                pass
        else:
            os.fsync(destination_directory_fd)
            os.fsync(source_directory_fd)
    finally:
        if source_fd is not None:
            os.close(source_fd)
        if destination_directory_fd is not None:
            os.close(destination_directory_fd)
        os.close(source_directory_fd)

    return list_user_directory(user_root, destination_path)


def copy_user_file(
    user_root: str,
    source_path: str,
    name: str,
    destination_path: str,
    new_name: str,
    max_bytes: int = MAX_FILE_COPY_BYTES,
) -> dict:
    if not valid_logical_file_path(source_path):
        raise ValueError("invalid copy source path")
    if not valid_logical_file_path(destination_path):
        raise ValueError("invalid copy destination path")
    if not valid_file_name(name) or not valid_file_name(new_name):
        raise ValueError("invalid copy name")
    if source_path == destination_path and name == new_name:
        raise FileExistsError(errno.EEXIST, os.strerror(errno.EEXIST), new_name)

    source_directory_fd = open_user_directory(user_root, source_path)
    destination_directory_fd = None
    source_fd = None
    try:
        source_fd = os.open(
            name,
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            dir_fd=source_directory_fd,
        )
        source_before = os.fstat(source_fd)

        destination_directory_fd = open_user_directory(user_root, destination_path)
        _copy_open_regular_file(
            source_fd,
            source_before,
            destination_directory_fd,
            new_name,
            max_bytes=max_bytes,
        )
    finally:
        if source_fd is not None:
            os.close(source_fd)
        if destination_directory_fd is not None:
            os.close(destination_directory_fd)
        os.close(source_directory_fd)

    return list_user_directory(user_root, destination_path)


def create_user_directory(user_root: str, logical_path: str, name: str) -> dict:
    if not valid_file_name(name):
        raise ValueError("invalid directory name")
    descriptor = open_user_directory(user_root, logical_path)
    try:
        os.mkdir(name, mode=0o700, dir_fd=descriptor)
    finally:
        os.close(descriptor)
    return list_user_directory(user_root, logical_path)


def ensure_standard_user_directories(user_root: str) -> tuple[str, ...]:
    descriptor = open_user_directory(user_root, "/")
    ready = []
    try:
        for name in STANDARD_USER_DIRECTORIES:
            try:
                os.mkdir(name, mode=0o700, dir_fd=descriptor)
            except FileExistsError:
                try:
                    child = os.open(name, _directory_open_flags(), dir_fd=descriptor)
                except OSError:
                    continue
                else:
                    os.close(child)
            ready.append(name)
    finally:
        os.close(descriptor)
    return tuple(ready)


def requested_file_path(request_target: str, endpoint: str = FILES_PATH) -> str:
    parsed = urlsplit(request_target)
    if parsed.path != endpoint:
        raise ValueError("not a file-space request")
    query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
    if set(query) != {"path"} or len(query["path"]) != 1:
        raise ValueError("file-space request requires exactly one path")
    logical_path = query["path"][0]
    if not valid_logical_file_path(logical_path):
        raise ValueError("invalid file-space path")
    return logical_path


def requested_file_import_target(request_target: str) -> tuple[str, str]:
    parsed = urlsplit(request_target)
    if parsed.path != FILE_IMPORT_PATH:
        raise ValueError("not a file import request")
    query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
    if set(query) != {"path", "name"}:
        raise ValueError("file import requires path and name")
    if len(query["path"]) != 1 or len(query["name"]) != 1:
        raise ValueError("file import requires one path and one name")
    logical_path = query["path"][0]
    name = query["name"][0]
    if not valid_logical_file_path(logical_path) or not valid_file_name(name):
        raise ValueError("invalid file import target")
    return logical_path, name


def valid_surface_heartbeat_payload(value: object) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"sourceSha"}
        and valid_commit_sha(value.get("sourceSha"))
    )


def record_surface_heartbeat(source_sha: str) -> None:
    if not valid_commit_sha(source_sha):
        raise ValueError("invalid Surface heartbeat SHA")
    directory = os.path.dirname(SURFACE_HEARTBEAT_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    temporary = f"{SURFACE_HEARTBEAT_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
    boot_id = read_small_text(BOOT_ID_FILE, 128)
    if len(boot_id) != 32 or any(
        character not in "0123456789abcdef" for character in boot_id
    ):
        raise ValueError("invalid current boot id")
    payload = {
        "sourceSha": source_sha,
        "bootId": boot_id,
        "observedEpoch": max(0, int(time.time())),
    }
    try:
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"), sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, SURFACE_HEARTBEAT_FILE)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def record_surface_health(source_sha: str) -> None:
    directory = os.path.dirname(HEALTH_STATE_FILE)
    os.makedirs(directory, exist_ok=True)
    temporary = f"{HEALTH_STATE_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write(source_sha)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, HEALTH_STATE_FILE)


class NativeHostServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address,
        handler_class,
        *,
        user_root: str,
        power_request_path: str,
        network_session_dir: str,
    ):
        super().__init__(server_address, handler_class)
        self.power_token = secrets.token_urlsafe(32)
        self.network_token = secrets.token_urlsafe(32)
        self.diagnostic_token = secrets.token_urlsafe(32)
        self.health_token = secrets.token_urlsafe(32)
        self.power_request_path = power_request_path
        self.supported_actions = supported_power_actions(power_request_path)
        self.network_paths = network_broker_paths(network_session_dir)
        self.network_lock = threading.Lock()
        self.user_root = user_root


class NativeHostHandler(SimpleHTTPRequestHandler):
    server_version = "OrdaXNativeHost/1"

    def end_headers(self) -> None:
        if not urlsplit(self.path).path.startswith("/__ordax/native/"):
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def _write_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _write_download(self, name: str, payload: bytes) -> None:
        encoded_name = quote(name, safe="")
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{encoded_name}")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def _empty(self, status: int) -> None:
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _read_json_body(self, max_bytes: int = MAX_CONTROL_BODY) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > max_bytes:
            return None
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            return None
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def do_OPTIONS(self) -> None:  # noqa: N802
        if self.path.startswith("/__ordax/native/"):
            # Deliberately no CORS headers. Cross-origin callers cannot use the
            # native control/state APIs through browser preflight.
            self._empty(403)
            return
        self._empty(405)

    def do_GET(self) -> None:  # noqa: N802
        parsed_path = urlsplit(self.path).path
        if parsed_path in {SESSION_PATH, FILES_PATH, FILE_CONTENT_PATH, FILE_EXPORT_PATH, METRICS_PATH, POWER_STATUS_PATH, NETWORK_STATUS_PATH, NETWORK_MANAGEMENT_PATH, UPDATE_HISTORY_PATH} and self.client_address[0] != "127.0.0.1":
            self._empty(403)
            return
        if parsed_path == SYNC_STATE_PATH and self.client_address[0] != "127.0.0.1":
            self._empty(403)
            return
        if parsed_path == METRICS_PATH:
            try:
                metrics = read_system_metrics(self.server.user_root)
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not read system metrics: {exc}", file=sys.stderr, flush=True)
                self._empty(503)
                return
            self._write_json(200, metrics)
            return
        if parsed_path == POWER_STATUS_PATH:
            try:
                power_status = read_power_status()
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not read power status: {exc}", file=sys.stderr, flush=True)
                self._empty(503)
                return
            self._write_json(200, power_status)
            return
        if parsed_path == NETWORK_STATUS_PATH:
            try:
                network_status = read_network_status()
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not read network status: {exc}", file=sys.stderr, flush=True)
                self._empty(503)
                return
            self._write_json(200, network_status)
            return
        if parsed_path == NETWORK_MANAGEMENT_PATH:
            supplied_token = self.headers.get(NETWORK_TOKEN_HEADER, "")
            if not hmac.compare_digest(supplied_token, self.server.network_token):
                self._empty(403)
                return
            try:
                with self.server.network_lock:
                    snapshot = queue_network_broker_request(
                        self.server.network_paths,
                        "status",
                        timeout_seconds=4.0,
                    )
            except (FileNotFoundError, PermissionError, TimeoutError, OSError, RuntimeError, ValueError) as exc:
                print(f"ordax-native-host: network management status unavailable: {exc}", file=sys.stderr, flush=True)
                self._empty(503)
                return
            self._write_json(200, snapshot)
            return
        if parsed_path == UPDATE_HISTORY_PATH:
            self._write_json(200, read_update_history())
            return
        if parsed_path == FILE_EXPORT_PATH:
            try:
                logical_path = requested_file_path(self.path, FILE_EXPORT_PATH)
                name, payload = read_user_export_file(self.server.user_root, logical_path)
            except FileSpaceExportTooLargeError:
                self._empty(413)
                return
            except FileSpaceExportChangedError:
                self._empty(412)
                return
            except ValueError:
                self._empty(400)
                return
            except (FileNotFoundError, NotADirectoryError):
                self._empty(404)
                return
            except PermissionError:
                self._empty(403)
                return
            except OSError as exc:
                print(f"ordax-native-host: could not export user file: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._write_download(name, payload)
            return

        if parsed_path == FILE_CONTENT_PATH:
            try:
                logical_path = requested_file_path(self.path, FILE_CONTENT_PATH)
                payload = read_user_text_file(self.server.user_root, logical_path)
            except FileSpaceTextTooLargeError:
                self._empty(413)
                return
            except FileSpaceTextEncodingError:
                self._empty(415)
                return
            except ValueError:
                self._empty(400)
                return
            except (FileNotFoundError, NotADirectoryError):
                self._empty(404)
                return
            except PermissionError:
                self._empty(403)
                return
            except OSError as exc:
                print(f"ordax-native-host: could not read user text file: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._write_json(200, payload)
            return
        if parsed_path == FILES_PATH:
            try:
                logical_path = requested_file_path(self.path)
                listing = list_user_directory(self.server.user_root, logical_path)
            except ValueError:
                self._empty(400)
                return
            except (FileNotFoundError, NotADirectoryError):
                self._empty(404)
                return
            except PermissionError:
                self._empty(403)
                return
            except OSError as exc:
                print(f"ordax-native-host: could not list user files: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._write_json(200, listing)
            return
        if self.path == SESSION_PATH:
            self._write_json(
                200,
                {
                    "token": self.server.power_token,
                    "networkToken": self.server.network_token,
                    "diagnosticToken": self.server.diagnostic_token,
                    "supportedActions": list(self.server.supported_actions),
                },
            )
            return
        if self.path == UPDATE_PATH:
            update_state = read_update_state()
            if update_state is None:
                update_state = {
                    "sourceSha": "unavailable",
                    "targetSha": "",
                    "status": "unavailable",
                    "phase": "error",
                    "applyMode": "none",
                    "attemptId": "",
                    "bootRefreshRequired": False,
                    "checkedAt": "unknown",
                    "lastAppliedSha": "",
                    "lastAppliedAt": "unknown",
                    "rejectedSha": "",
                    "lastError": "update-state-unavailable",
                }
                status = 503
            else:
                update_state = dict(update_state)
                status = 200
            update_state["healthToken"] = self.server.health_token
            self._write_json(status, update_state)
            return
        if self.path == PREFERENCES_PATH:
            self._write_json(200, read_preferences())
            return
        if self.path == SYNC_STATE_PATH:
            self._write_json(200, {"payload": read_sync_state_payload()})
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if self.client_address[0] != "127.0.0.1":
            self._empty(403)
            return

        parsed_path = urlsplit(self.path).path
        if parsed_path == FILE_IMPORT_PATH:
            try:
                logical_path, name = requested_file_import_target(self.path)
                raw_length = self.headers.get("Content-Length")
                if raw_length is None:
                    raise ValueError("file import requires Content-Length")
                length = int(raw_length)
                if length < 0:
                    raise ValueError("invalid file import Content-Length")
                if length > MAX_FILE_IMPORT_BYTES:
                    raise FileSpaceImportTooLargeError("import exceeds size limit")
                content_type = (
                    self.headers.get("Content-Type", "")
                    .split(";", 1)[0]
                    .strip()
                    .lower()
                )
                if content_type != "application/octet-stream":
                    raise ValueError("file import requires application/octet-stream")
                listing = import_user_file(
                    self.server.user_root,
                    logical_path,
                    name,
                    self.rfile,
                    length,
                )
            except FileSpaceImportTooLargeError:
                self._empty(413)
                return
            except FileSpaceImportIncompleteError:
                self._empty(400)
                return
            except ValueError:
                self._empty(400)
                return
            except FileExistsError:
                self._empty(409)
                return
            except (FileNotFoundError, NotADirectoryError):
                self._empty(404)
                return
            except PermissionError:
                self._empty(403)
                return
            except OSError as exc:
                print(f"ordax-native-host: file import failed safely: {exc}", file=sys.stderr, flush=True)
                self._empty(507 if exc.errno == errno.ENOSPC else 503)
                return
            self._write_json(201, listing)
            return

        if self.path == SURFACE_HEARTBEAT_PATH:
            payload = self._read_json_body(MAX_SURFACE_HEARTBEAT_BODY)
            if payload is None or not valid_surface_heartbeat_payload(payload):
                self._empty(400)
                return
            try:
                record_surface_heartbeat(payload["sourceSha"])
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not record Surface heartbeat: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._empty(204)
            return

        if self.path == HEALTH_PATH:
            supplied_token = self.headers.get(HEALTH_TOKEN_HEADER, "")
            if not hmac.compare_digest(supplied_token, self.server.health_token):
                self._empty(403)
                return
            payload = self._read_json_body()
            source_sha = payload.get("sourceSha") if payload else None
            if not valid_commit_sha(source_sha):
                self._empty(400)
                return
            update_state = read_update_state()
            if update_state is None or update_state.get("sourceSha") != source_sha:
                self._empty(409)
                return
            try:
                record_surface_health(source_sha)
            except OSError as exc:
                print(f"ordax-native-host: could not record Surface health: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._empty(204)
            return

        if self.path == CLIENT_DIAGNOSTIC_PATH:
            supplied_token = self.headers.get(DIAGNOSTIC_TOKEN_HEADER, "")
            if not hmac.compare_digest(supplied_token, self.server.diagnostic_token):
                self._empty(403)
                return
            payload = self._read_json_body(MAX_CLIENT_DIAGNOSTIC_BODY)
            if payload is None or not valid_client_diagnostic_payload(payload):
                self._empty(400)
                return
            try:
                record_client_diagnostic(payload)
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not record client diagnostic: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._empty(204)
            return

        if self.path == NETWORK_MANAGEMENT_PATH:
            supplied_token = self.headers.get(NETWORK_TOKEN_HEADER, "")
            if not hmac.compare_digest(supplied_token, self.server.network_token):
                self._empty(403)
                return
            payload = self._read_json_body(MAX_NETWORK_ACTION_BODY)
            if payload is None:
                self._empty(400)
                return
            action = payload.get("action")
            if action not in {"scan", "connect", "disconnect", "forget", "reconnect"}:
                self._empty(400)
                return
            try:
                with self.server.network_lock:
                    snapshot = queue_network_broker_request(
                        self.server.network_paths,
                        action,
                        ssid=payload.get("ssid"),
                        password=payload.get("password"),
                        timeout_seconds=24.0 if action in {"connect", "reconnect"} else 12.0,
                    )
            except ValueError:
                self._empty(400)
                return
            except RuntimeError as exc:
                detail = getattr(exc, "network_detail", "")
                self._empty(409 if detail in {"connect-failed", "reconnect-failed"} else 503)
                return
            except (FileNotFoundError, PermissionError, TimeoutError, OSError) as exc:
                print(f"ordax-native-host: network management action failed safely: {exc}", file=sys.stderr, flush=True)
                self._empty(503)
                return
            self._write_json(200, snapshot)
            return

        if self.path == PREFERENCES_PATH:
            payload = self._read_json_body(MAX_PREFERENCE_BODY)
            if payload is None or not valid_preference_record(payload):
                self._empty(400)
                return
            try:
                write_preferences(payload)
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not persist preferences: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._empty(204)
            return

        if self.path == SYNC_STATE_PATH:
            body = self._read_json_body(MAX_SYNC_STATE_BODY)
            payload = body.get("payload") if body is not None else object()
            if not valid_sync_state_payload(payload):
                self._empty(400)
                return
            try:
                write_sync_state_payload(payload)
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not persist sync state: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._empty(204)
            return

        if self.path == FILES_PATH:
            payload = self._read_json_body(MAX_FILE_ACTION_BODY)
            if payload is None:
                self._empty(400)
                return
            action = payload.get("action")
            try:
                if action == "create-directory":
                    listing = create_user_directory(
                        self.server.user_root,
                        payload.get("path"),
                        payload.get("name"),
                    )
                    status = 201
                elif action == "rename-entry":
                    listing = rename_user_entry(
                        self.server.user_root,
                        payload.get("path"),
                        payload.get("name"),
                        payload.get("newName"),
                    )
                    status = 200
                elif action == "copy-file":
                    listing = copy_user_file(
                        self.server.user_root,
                        payload.get("sourcePath"),
                        payload.get("name"),
                        payload.get("destinationPath"),
                        payload.get("newName"),
                    )
                    status = 201
                elif action == "move-entry":
                    listing = move_user_entry(
                        self.server.user_root,
                        payload.get("sourcePath"),
                        payload.get("name"),
                        payload.get("destinationPath"),
                    )
                    status = 200
                else:
                    self._empty(400)
                    return
            except FileSpaceCopyTooLargeError:
                self._empty(413)
                return
            except FileSpaceCopyChangedError:
                self._empty(412)
                return
            except FileSpaceCrossDeviceMoveError:
                self._empty(422)
                return
            except ValueError:
                self._empty(400)
                return
            except FileExistsError:
                self._empty(409)
                return
            except (FileNotFoundError, NotADirectoryError):
                self._empty(404)
                return
            except PermissionError:
                self._empty(403)
                return
            except OSError as exc:
                print(f"ordax-native-host: file-space mutation failed safely: {exc}", file=sys.stderr, flush=True)
                self._empty(507 if exc.errno == errno.ENOSPC else 503)
                return
            self._write_json(status, listing)
            return

        if self.path != POWER_PATH:
            self._empty(404)
            return

        supplied_token = self.headers.get(TOKEN_HEADER, "")
        if not hmac.compare_digest(supplied_token, self.server.power_token):
            self._empty(403)
            return

        payload = self._read_json_body()
        if payload is None:
            self._empty(400)
            return
        action = payload.get("action")
        if action not in self.server.supported_actions:
            self._empty(409)
            return

        try:
            queue_power_action(self.server.power_request_path, action)
        except (OSError, ValueError) as exc:
            print(
                f"ordax-native-host: could not queue host power action {action}: {exc}",
                file=sys.stderr,
                flush=True,
            )
            self._empty(503)
            return
        self._write_json(202, {"accepted": True, "action": action})

    def log_message(self, fmt: str, *args) -> None:
        print(f"ordax-native-host: {self.address_string()} - {fmt % args}", file=sys.stderr, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--directory", default="/srv/ordax-system")
    parser.add_argument("--user-root", default="/var/lib/ordax-user")
    parser.add_argument("--power-request", default=DEFAULT_POWER_REQUEST_PATH)
    parser.add_argument("--network-session-dir", default=DEFAULT_NETWORK_SESSION_DIR)
    parser.add_argument("--telemetry-config", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        standard_directories = ensure_standard_user_directories(args.user_root)
    except OSError as exc:
        standard_directories = ()
        print(
            f"ordax-native-host: could not provision standard user directories: {exc}",
            file=sys.stderr,
            flush=True,
        )
    if len(standard_directories) != len(STANDARD_USER_DIRECTORIES):
        missing = sorted(set(STANDARD_USER_DIRECTORIES) - set(standard_directories))
        print(
            "ordax-native-host: standard user directories unavailable: %s" % ",".join(missing),
            file=sys.stderr,
            flush=True,
        )
    handler = partial(NativeHostHandler, directory=args.directory)
    server = NativeHostServer(
        (args.bind, args.port),
        handler,
        user_root=args.user_root,
        power_request_path=args.power_request,
        network_session_dir=args.network_session_dir,
    )
    telemetry_started = start_telemetry_heartbeat(args.telemetry_config)
    print(
        "ordax-native-host: serving %s on %s:%d; user root=%s; power actions=%s; recovery-generation=%d; telemetry=%s"
        % (
            args.directory,
            args.bind,
            args.port,
            args.user_root,
            ",".join(server.supported_actions) or "none",
            SURFACE_HOST_RECOVERY_GENERATION,
            "enabled" if telemetry_started else "disabled",
        ),
        file=sys.stderr,
        flush=True,
    )
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
