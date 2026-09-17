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
import subprocess
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

SESSION_PATH = "/__ordax/native/session"
POWER_PATH = "/__ordax/native/power"
UPDATE_PATH = "/__ordax/native/update"
HEALTH_PATH = "/__ordax/native/health"
PREFERENCES_PATH = "/__ordax/native/preferences"
UPDATE_STATE_FILE = "/run/ordax-update/state.json"
HEALTH_STATE_FILE = "/run/ordax-update/healthy-sha"
PREFERENCES_FILE = "/var/lib/ordax/preferences.json"
TOKEN_HEADER = "X-OrdaX-Power-Token"
HEALTH_TOKEN_HEADER = "X-OrdaX-Health-Token"
MAX_CONTROL_BODY = 512
MAX_PREFERENCE_BODY = 8192
PREFERENCE_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$")
POWER_COMMANDS = {
    "restart": ("/bin/busybox", "reboot", "-f"),
    "shutdown": ("/bin/busybox", "poweroff", "-f"),
}


def busybox_applets() -> set[str]:
    completed = subprocess.run(
        ["/bin/busybox", "--list"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    if completed.returncode != 0:
        return set()
    return {line.strip() for line in completed.stdout.splitlines() if line.strip()}


def supported_power_actions() -> tuple[str, ...]:
    applets = busybox_applets()
    actions = []
    if "reboot" in applets:
        actions.append("restart")
    if "poweroff" in applets:
        actions.append("shutdown")
    return tuple(actions)


def perform_power_action(action: str) -> None:
    command = POWER_COMMANDS[action]
    try:
        completed = subprocess.run(command, check=False)
        if completed.returncode != 0:
            print(
                f"ordax-native-host: power action {action} exited with status {completed.returncode}",
                file=sys.stderr,
                flush=True,
            )
    except Exception as exc:  # pragma: no cover - physical-host diagnostic path
        print(f"ordax-native-host: power action {action} failed: {exc}", file=sys.stderr, flush=True)


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

    def __init__(self, server_address, handler_class):
        super().__init__(server_address, handler_class)
        self.power_token = secrets.token_urlsafe(32)
        self.health_token = secrets.token_urlsafe(32)
        self.supported_actions = supported_power_actions()


class NativeHostHandler(SimpleHTTPRequestHandler):
    server_version = "OrdaXNativeHost/1"

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

        self._write_json(202, {"accepted": True, "action": action})
        timer = threading.Timer(0.35, perform_power_action, args=(action,))
        timer.daemon = True
        timer.start()

    def log_message(self, fmt: str, *args) -> None:
        print(f"ordax-native-host: {self.address_string()} - {fmt % args}", file=sys.stderr, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--directory", default="/srv/ordax-system")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    handler = partial(NativeHostHandler, directory=args.directory)
    server = NativeHostServer((args.bind, args.port), handler)
    print(
        "ordax-native-host: serving %s on %s:%d; power actions=%s"
        % (args.directory, args.bind, args.port, ",".join(server.supported_actions) or "none"),
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
