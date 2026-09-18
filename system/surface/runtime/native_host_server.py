#!/usr/bin/env python3
"""Serve the checked-out OrdaX system and a narrow loopback-only native control API."""

from __future__ import annotations

import argparse
import hmac
import json
import math
import os
import re
import secrets
import stat
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

SESSION_PATH = "/__ordax/native/session"
POWER_PATH = "/__ordax/native/power"
UPDATE_PATH = "/__ordax/native/update"
HEALTH_PATH = "/__ordax/native/health"
PREFERENCES_PATH = "/__ordax/native/preferences"
SYNC_STATE_PATH = "/__ordax/native/sync-state"
FILES_PATH = "/__ordax/native/files"
METRICS_PATH = "/__ordax/native/metrics"
UPDATE_STATE_FILE = "/run/ordax-update/state.json"
HEALTH_STATE_FILE = "/run/ordax-update/healthy-sha"
PREFERENCES_FILE = "/var/lib/ordax/preferences.json"
SYNC_STATE_FILE = "/var/lib/ordax/sync-state.json"
TOKEN_HEADER = "X-OrdaX-Power-Token"
HEALTH_TOKEN_HEADER = "X-OrdaX-Health-Token"
MAX_CONTROL_BODY = 512
MAX_PREFERENCE_BODY = 8192
MAX_SYNC_STATE_PAYLOAD = 65536
MAX_SYNC_STATE_BODY = 393216
MAX_FILE_ACTION_BODY = 2048
MAX_FILE_ENTRIES = 1000
STANDARD_USER_DIRECTORIES = ("Documentos", "Imagens", "Downloads")
PREFERENCE_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$")
POWER_ACTIONS = ("restart", "shutdown")
DEFAULT_POWER_REQUEST_PATH = "/run/ordax-surface/power-request"


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
                    if entry.is_dir(follow_symlinks=False):
                        kind = "directory"
                        size = 0
                    elif entry.is_file(follow_symlinks=False):
                        kind = "file"
                        size = entry.stat(follow_symlinks=False).st_size
                    else:
                        continue
                except OSError:
                    continue
                entries.append({"name": entry.name, "kind": kind, "size": max(0, int(size))})
        entries.sort(key=lambda item: (item["kind"] != "directory", item["name"].casefold(), item["name"]))
        return {"path": logical_path, "entries": entries[:MAX_FILE_ENTRIES]}
    finally:
        os.close(descriptor)


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


def requested_file_path(request_target: str) -> str:
    parsed = urlsplit(request_target)
    if parsed.path != FILES_PATH:
        raise ValueError("not a file-space request")
    query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
    if set(query) != {"path"} or len(query["path"]) != 1:
        raise ValueError("file-space request requires exactly one path")
    logical_path = query["path"][0]
    if not valid_logical_file_path(logical_path):
        raise ValueError("invalid file-space path")
    return logical_path


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

    def __init__(self, server_address, handler_class, *, user_root: str, power_request_path: str):
        super().__init__(server_address, handler_class)
        self.power_token = secrets.token_urlsafe(32)
        self.health_token = secrets.token_urlsafe(32)
        self.power_request_path = power_request_path
        self.supported_actions = supported_power_actions(power_request_path)
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
        if parsed_path in {FILES_PATH, METRICS_PATH} and self.client_address[0] != "127.0.0.1":
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
                    "supportedActions": list(self.server.supported_actions),
                },
            )
            return
        if self.path == UPDATE_PATH:
            update_state = read_update_state()
            if update_state is None:
                update_state = {
                    "sourceSha": "unavailable",
                    "status": "unavailable",
                    "applyMode": "none",
                    "bootRefreshRequired": False,
                    "checkedAt": "unknown",
                    "lastAppliedSha": "",
                    "lastAppliedAt": "unknown",
                    "rejectedSha": "",
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
            try:
                record_surface_health(source_sha)
            except OSError as exc:
                print(f"ordax-native-host: could not record Surface health: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._empty(204)
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
            if payload is None or payload.get("action") != "create-directory":
                self._empty(400)
                return
            try:
                listing = create_user_directory(
                    self.server.user_root,
                    payload.get("path"),
                    payload.get("name"),
                )
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
                print(f"ordax-native-host: could not create user directory: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._write_json(201, listing)
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
    )
    print(
        "ordax-native-host: serving %s on %s:%d; user root=%s; power actions=%s"
        % (
            args.directory,
            args.bind,
            args.port,
            args.user_root,
            ",".join(server.supported_actions) or "none",
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
