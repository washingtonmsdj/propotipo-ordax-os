#!/usr/bin/env python3
"""Serve the checked-out OrdaX system and a narrow loopback-only native control API."""

from __future__ import annotations

import argparse
import hmac
import json
import secrets
import subprocess
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

SESSION_PATH = "/__ordax/native/session"
POWER_PATH = "/__ordax/native/power"
UPDATE_PATH = "/__ordax/native/update"
UPDATE_STATE_FILE = "/run/ordax-update/state.json"
TOKEN_HEADER = "X-OrdaX-Power-Token"
MAX_CONTROL_BODY = 512
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


class NativeHostServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, server_address, handler_class):
        super().__init__(server_address, handler_class)
        self.power_token = secrets.token_urlsafe(32)
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

    def do_OPTIONS(self) -> None:  # noqa: N802
        if self.path.startswith("/__ordax/native/"):
            # Deliberately no CORS headers. Cross-origin callers cannot obtain or
            # submit the session token using the custom request header.
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
                self._write_json(
                    503,
                    {
                        "sourceSha": "unavailable",
                        "status": "unavailable",
                        "applyMode": "none",
                        "bootRefreshRequired": False,
                    },
                )
                return
            self._write_json(200, update_state)
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != POWER_PATH:
            self._empty(404)
            return
        if self.client_address[0] != "127.0.0.1":
            self._empty(403)
            return

        supplied_token = self.headers.get(TOKEN_HEADER, "")
        if not hmac.compare_digest(supplied_token, self.server.power_token):
            self._empty(403)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._empty(400)
            return
        if length <= 0 or length > MAX_CONTROL_BODY:
            self._empty(400)
            return

        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self._empty(415)
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._empty(400)
            return
        action = payload.get("action") if isinstance(payload, dict) else None
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
