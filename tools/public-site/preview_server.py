#!/usr/bin/env python3
"""Local loopback preview server for the built OrdaX public portal.

This is a test/development adapter, not a production deployment server.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import mimetypes
import posixpath
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
GATEWAY_PATH = ROOT / "services" / "public-identity" / "gateway.py"
DEPLOYMENT_CONTRACT = ROOT / "docs" / "contracts" / "public-site-deployment.json"
ALLOWED_BINDS = {"127.0.0.1", "::1", "localhost"}


def _load_gateway_module():
    spec = importlib.util.spec_from_file_location("ordax_public_identity_gateway_preview", GATEWAY_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load public identity gateway")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


GATEWAY = _load_gateway_module()
DEPLOYMENT = json.loads(DEPLOYMENT_CONTRACT.read_text(encoding="utf-8"))
SECURITY_HEADERS = DEPLOYMENT["security_headers"]


def _safe_static_path(root: Path, request_path: str) -> Path | None:
    decoded = unquote(request_path)
    normalized = posixpath.normpath(decoded)
    if not normalized.startswith("/"):
        return None
    relative = normalized.lstrip("/")
    if relative.startswith("../") or relative == "..":
        return None
    candidate = root / relative
    try:
        candidate.resolve().relative_to(root.resolve())
    except ValueError:
        return None
    if request_path.endswith("/") or candidate.is_dir():
        candidate = candidate / "index.html"
    return candidate


class PublicPortalPreviewServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, server_address, handler_class, site_root: Path):
        self.site_root = site_root
        self.identity_gateway = GATEWAY.PublicIdentityGateway()
        super().__init__(server_address, handler_class)


class PublicPortalPreviewHandler(BaseHTTPRequestHandler):
    server_version = "OrdaXPublicPreview/1"
    sys_version = ""

    @property
    def portal_server(self) -> PublicPortalPreviewServer:
        return self.server  # type: ignore[return-value]

    def log_message(self, format, *args):
        return

    def _security_headers(self) -> None:
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)

    def _send_gateway(self, method: str) -> None:
        headers = {
            key: value
            for key, value in self.headers.items()
        }
        response = self.portal_server.identity_gateway.handle(method, self.path, headers)
        self.send_response(response.status)
        existing = {name.lower() for name, _ in response.headers}
        for name, value in response.headers:
            self.send_header(name, value)
        for name, value in SECURITY_HEADERS.items():
            if name.lower() not in existing:
                self.send_header(name, value)
        self.end_headers()
        if method != "HEAD":
            self.wfile.write(response.body)

    def _send_static(self, method: str) -> None:
        split = urlsplit(self.path)
        path = _safe_static_path(self.portal_server.site_root, split.path)
        if path is None or not path.is_file():
            body = b"Not Found\n"
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._security_headers()
            self.end_headers()
            if method != "HEAD":
                self.wfile.write(body)
            return

        payload = path.read_bytes()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in {"application/json", "application/javascript"}:
            content_type += "; charset=utf-8"

        relative = path.relative_to(self.portal_server.site_root).as_posix()
        if relative.endswith(".html"):
            cache_control = "no-cache"
        elif relative == "config/public-site.json" or relative == "releases/catalog.json":
            cache_control = "no-store"
        else:
            cache_control = "public, max-age=300"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", cache_control)
        self._security_headers()
        self.end_headers()
        if method != "HEAD":
            self.wfile.write(payload)

    def do_GET(self):  # noqa: N802
        if urlsplit(self.path).path.startswith("/auth/"):
            self._send_gateway("GET")
            return
        self._send_static("GET")

    def do_HEAD(self):  # noqa: N802
        if urlsplit(self.path).path.startswith("/auth/"):
            self._send_gateway("HEAD")
            return
        self._send_static("HEAD")

    def do_POST(self):  # noqa: N802
        if urlsplit(self.path).path.startswith("/auth/"):
            self._send_gateway("POST")
            return
        body = b"Method Not Allowed\n"
        self.send_response(405)
        self.send_header("Allow", "GET, HEAD")
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._security_headers()
        self.end_headers()
        self.wfile.write(body)


def make_server(site_root: Path, host: str = "127.0.0.1", port: int = 0) -> PublicPortalPreviewServer:
    if host not in ALLOWED_BINDS:
        raise ValueError("preview server may bind only to loopback")
    if not site_root.is_dir():
        raise ValueError(f"site root does not exist: {site_root}")
    return PublicPortalPreviewServer((host, port), PublicPortalPreviewHandler, site_root)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site-root", default="out/public-site")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args(argv)

    server = make_server(Path(args.site_root), args.bind, args.port)
    host, port = server.server_address[:2]
    print(f"PUBLIC_SITE_PREVIEW=http://{host}:{port}", flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
