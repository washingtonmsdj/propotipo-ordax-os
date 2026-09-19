#!/usr/bin/env python3
"""Native OrdaX graphical host with an isolated WebKit browser plane.

The privileged OrdaX Surface lives in one WebView that alone owns the native
message bridge. Arbitrary Internet content lives in separate WebViews created
from a separate persistent WebContext and never receives that bridge.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import math
import os
import re
import socket
import sys
from dataclasses import dataclass
from urllib.parse import urlsplit

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2  # type: ignore  # noqa: E402

BRIDGE_NAME = "ordaxBrowser"
TAB_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
MAX_TABS = 16
MAX_URI_LENGTH = 8192
MAX_VIEWPORT_DIMENSION = 16384
TOP_LEVEL_NETWORK_SCHEMES = frozenset({"http", "https"})
RESOURCE_NETWORK_SCHEMES = frozenset({"http", "https", "ws", "wss"})
INTERNAL_RESOURCE_SCHEMES = frozenset({"about", "blob", "data"})
LOCAL_HOST_SUFFIXES = (".localhost", ".local", ".home.arpa")


def public_network_uri(uri: str, schemes: frozenset[str]) -> bool:
    if not isinstance(uri, str) or not uri or len(uri) > MAX_URI_LENGTH:
        return False
    try:
        parsed = urlsplit(uri)
        # Accessing .port validates malformed/out-of-range explicit ports.
        _port = parsed.port
    except ValueError:
        return False
    if parsed.scheme.lower() not in schemes or not parsed.hostname:
        return False

    host = parsed.hostname.rstrip(".").lower()
    if (
        host == "localhost"
        or host.endswith(LOCAL_HOST_SUFFIXES)
        or ("." not in host and ":" not in host)
    ):
        return False

    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        # Browsers and libc can accept legacy numeric IPv4 spellings that
        # ipaddress deliberately rejects (for example 0177.0.0.1 or 127.1).
        # Parse those forms without DNS so they cannot masquerade as a name.
        try:
            address = ipaddress.ip_address(socket.inet_aton(host))
        except OSError:
            # DNS names still require server-side Host/origin hardening before
            # the native loopback control plane can be considered rebinding-proof.
            return True
    return address.is_global


def allowed_external_uri(uri: str) -> bool:
    return public_network_uri(uri, TOP_LEVEL_NETWORK_SCHEMES)


def allowed_external_resource_uri(uri: str) -> bool:
    if not isinstance(uri, str) or not uri or len(uri) > MAX_URI_LENGTH:
        return False
    try:
        scheme = urlsplit(uri).scheme.lower()
    except ValueError:
        return False
    if scheme in INTERNAL_RESOURCE_SCHEMES:
        return True
    return public_network_uri(uri, RESOURCE_NETWORK_SCHEMES)


def bounded_int(value: object, minimum: int, maximum: int) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    integer = int(round(value))
    if integer < minimum or integer > maximum:
        return None
    return integer


@dataclass
class BrowserTab:
    tab_id: str
    view: WebKit2.WebView
    url: str = ""
    title: str = ""
    loading: bool = False

    def snapshot(self) -> dict:
        return {
            "id": self.tab_id,
            "url": self.url,
            "title": self.title,
            "loading": bool(self.loading),
            "canGoBack": bool(self.view.can_go_back()),
            "canGoForward": bool(self.view.can_go_forward()),
        }


class OrdaXBrowserHost:
    def __init__(self, start_uri: str, profile_root: str) -> None:
        self.start_uri = start_uri
        self.profile_root = os.path.abspath(profile_root)
        self.tabs: dict[str, BrowserTab] = {}
        self.active_tab_id: str | None = None
        self.viewport = {"visible": False, "x": 0, "y": 0, "width": 0, "height": 0}

        os.makedirs(self.profile_root, mode=0o700, exist_ok=True)
        profile_data = os.path.join(self.profile_root, "default", "data")
        profile_cache = os.path.join(self.profile_root, "default", "cache")
        os.makedirs(profile_data, mode=0o700, exist_ok=True)
        os.makedirs(profile_cache, mode=0o700, exist_ok=True)

        data_manager = WebKit2.WebsiteDataManager(
            base_data_directory=profile_data,
            base_cache_directory=profile_cache,
        )
        self.external_context = WebKit2.WebContext.new_with_website_data_manager(data_manager)
        self.external_context.set_preferred_languages(["pt-BR", "en-US"])
        self.external_context.connect("download-started", self.on_download_started)

        self.manager = WebKit2.UserContentManager.new()
        self.manager.connect(f"script-message-received::{BRIDGE_NAME}", self.on_surface_message)
        if not self.manager.register_script_message_handler(BRIDGE_NAME):
            raise RuntimeError("failed to register OrdaX browser bridge")

        self.surface_view = WebKit2.WebView.new_with_user_content_manager(self.manager)
        self.surface_view.set_hexpand(True)
        self.surface_view.set_vexpand(True)
        self.surface_view.load_uri(self.start_uri)

        self.overlay = Gtk.Overlay()
        self.overlay.add(self.surface_view)

        self.window = Gtk.Window(title="OrdaX")
        self.window.set_default_size(1366, 768)
        self.window.add(self.overlay)
        self.window.connect("destroy", Gtk.main_quit)
        self.window.fullscreen()
        self.window.show_all()

    def emit_snapshot(self) -> None:
        snapshot = {
            "supported": True,
            "reason": "",
            "activeTabId": self.active_tab_id,
            "tabs": [tab.snapshot() for tab in self.tabs.values()],
        }
        payload = json.dumps({"type": "snapshot", "snapshot": snapshot}, ensure_ascii=False, separators=(",", ":"))
        script = (
            "window.dispatchEvent(new CustomEvent('ordax-browser-host',{detail:"
            + payload
            + "}));"
        )
        try:
            self.surface_view.run_javascript(script, None, None, None)
        except Exception as exc:  # pragma: no cover - native runtime diagnostic
            print(f"ordax-browser-host: failed to emit snapshot: {exc}", file=sys.stderr, flush=True)

    def decode_message(self, result: object) -> dict | None:
        try:
            js_value = result.get_js_value()
            raw = js_value.to_string()
            payload = json.loads(raw)
        except Exception as exc:
            print(f"ordax-browser-host: rejected malformed bridge message: {exc}", file=sys.stderr, flush=True)
            return None
        return payload if isinstance(payload, dict) else None

    def on_surface_message(self, _manager: object, result: object) -> None:
        payload = self.decode_message(result)
        if payload is None:
            return
        command = payload.get("type")
        try:
            if command == "snapshot.request":
                self.emit_snapshot()
            elif command == "tab.open":
                self.open_tab(payload.get("tabId"), payload.get("url", ""))
            elif command == "tab.close":
                self.close_tab(payload.get("tabId"))
            elif command == "tab.activate":
                self.activate_tab(payload.get("tabId"))
            elif command == "tab.navigate":
                self.navigate(payload.get("tabId"), payload.get("url"))
            elif command == "tab.back":
                self.history_action(payload.get("tabId"), "back")
            elif command == "tab.forward":
                self.history_action(payload.get("tabId"), "forward")
            elif command == "tab.reload":
                self.history_action(payload.get("tabId"), "reload")
            elif command == "viewport.set":
                self.set_viewport(payload.get("viewport"))
        except (TypeError, ValueError) as exc:
            print(f"ordax-browser-host: rejected {command!r}: {exc}", file=sys.stderr, flush=True)

    def valid_tab_id(self, tab_id: object) -> str:
        if not isinstance(tab_id, str) or TAB_ID_RE.fullmatch(tab_id) is None:
            raise ValueError("invalid tab id")
        return tab_id

    def create_external_view(self, tab_id: str) -> WebKit2.WebView:
        view = WebKit2.WebView.new_with_context(self.external_context)
        view.set_hexpand(False)
        view.set_vexpand(False)
        view.set_halign(Gtk.Align.START)
        view.set_valign(Gtk.Align.START)
        view.connect("notify::uri", self.on_view_state, tab_id)
        view.connect("notify::title", self.on_view_state, tab_id)
        view.connect("notify::estimated-load-progress", self.on_view_state, tab_id)
        view.connect("load-changed", self.on_load_changed, tab_id)
        view.connect("load-failed", self.on_load_failed, tab_id)
        view.connect("decide-policy", self.on_decide_policy, tab_id)
        view.connect("permission-request", self.on_permission_request, tab_id)
        view.connect("resource-load-started", self.on_resource_load_started, tab_id)
        self.overlay.add_overlay(view)
        self.overlay.set_overlay_pass_through(view, False)
        view.hide()
        return view

    def open_tab(self, tab_id_value: object, url_value: object) -> None:
        tab_id = self.valid_tab_id(tab_id_value)
        if tab_id in self.tabs:
            self.activate_tab(tab_id)
            return
        if len(self.tabs) >= MAX_TABS:
            raise ValueError("tab limit reached")
        view = self.create_external_view(tab_id)
        tab = BrowserTab(tab_id=tab_id, view=view)
        self.tabs[tab_id] = tab
        self.active_tab_id = tab_id
        self.update_visibility()
        if url_value:
            self.navigate(tab_id, url_value)
        else:
            self.emit_snapshot()

    def close_tab(self, tab_id_value: object) -> None:
        tab_id = self.valid_tab_id(tab_id_value)
        tab = self.tabs.pop(tab_id, None)
        if tab is None:
            return
        self.overlay.remove(tab.view)
        if self.active_tab_id == tab_id:
            self.active_tab_id = next(reversed(self.tabs), None) if self.tabs else None
        self.update_visibility()
        self.emit_snapshot()

    def activate_tab(self, tab_id_value: object) -> None:
        tab_id = self.valid_tab_id(tab_id_value)
        if tab_id not in self.tabs:
            raise ValueError("unknown tab")
        self.active_tab_id = tab_id
        self.update_visibility()
        self.emit_snapshot()

    def navigate(self, tab_id_value: object, url_value: object) -> None:
        tab_id = self.valid_tab_id(tab_id_value)
        if tab_id not in self.tabs:
            raise ValueError("unknown tab")
        if not isinstance(url_value, str) or not allowed_external_uri(url_value):
            raise ValueError("only public external http/https addresses are allowed")
        tab = self.tabs[tab_id]
        tab.url = url_value
        tab.loading = True
        tab.view.load_uri(url_value)
        self.update_visibility()
        self.emit_snapshot()

    def history_action(self, tab_id_value: object, action: str) -> None:
        tab_id = self.valid_tab_id(tab_id_value)
        tab = self.tabs.get(tab_id)
        if tab is None:
            raise ValueError("unknown tab")
        if action == "back" and tab.view.can_go_back():
            tab.view.go_back()
        elif action == "forward" and tab.view.can_go_forward():
            tab.view.go_forward()
        elif action == "reload" and tab.url:
            tab.view.reload()

    def set_viewport(self, value: object) -> None:
        if not isinstance(value, dict) or not isinstance(value.get("visible"), bool):
            raise ValueError("invalid viewport")
        x = bounded_int(value.get("x", 0), 0, MAX_VIEWPORT_DIMENSION)
        y = bounded_int(value.get("y", 0), 0, MAX_VIEWPORT_DIMENSION)
        width = bounded_int(value.get("width", 0), 0, MAX_VIEWPORT_DIMENSION)
        height = bounded_int(value.get("height", 0), 0, MAX_VIEWPORT_DIMENSION)
        if None in {x, y, width, height}:
            raise ValueError("invalid viewport geometry")
        self.viewport = {
            "visible": value["visible"],
            "x": x,
            "y": y,
            "width": width,
            "height": height,
        }
        self.update_visibility()

    def update_visibility(self) -> None:
        for tab_id, tab in self.tabs.items():
            visible = (
                tab_id == self.active_tab_id
                and bool(tab.url)
                and bool(self.viewport["visible"])
                and self.viewport["width"] > 1
                and self.viewport["height"] > 1
            )
            if visible:
                tab.view.set_margin_start(self.viewport["x"])
                tab.view.set_margin_top(self.viewport["y"])
                tab.view.set_size_request(self.viewport["width"], self.viewport["height"])
                tab.view.show()
            else:
                tab.view.hide()

    def on_view_state(self, view: WebKit2.WebView, _spec: object, tab_id: str) -> None:
        tab = self.tabs.get(tab_id)
        if tab is None:
            return
        uri = view.get_uri() or ""
        if uri and uri != "about:blank":
            tab.url = uri
        tab.title = view.get_title() or tab.title
        self.emit_snapshot()

    def on_load_changed(self, view: WebKit2.WebView, event: WebKit2.LoadEvent, tab_id: str) -> None:
        tab = self.tabs.get(tab_id)
        if tab is None:
            return
        tab.loading = event != WebKit2.LoadEvent.FINISHED
        uri = view.get_uri() or ""
        if uri and uri != "about:blank":
            tab.url = uri
        tab.title = view.get_title() or tab.title
        self.emit_snapshot()

    def on_load_failed(
        self,
        _view: WebKit2.WebView,
        _event: WebKit2.LoadEvent,
        _failing_uri: str,
        _error: object,
        tab_id: str,
    ) -> bool:
        tab = self.tabs.get(tab_id)
        if tab is not None:
            tab.loading = False
            self.emit_snapshot()
        return False

    def on_decide_policy(
        self,
        _view: WebKit2.WebView,
        decision: WebKit2.PolicyDecision,
        decision_type: WebKit2.PolicyDecisionType,
        _tab_id: str,
    ) -> bool:
        if decision_type not in {
            WebKit2.PolicyDecisionType.NAVIGATION_ACTION,
            WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION,
        }:
            return False
        try:
            action = decision.get_navigation_action()
            uri = action.get_request().get_uri()
        except Exception:
            decision.ignore()
            return True
        if not allowed_external_uri(uri):
            decision.ignore()
            return True
        if decision_type == WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION:
            decision.ignore()
            return True
        return False

    def on_resource_load_started(
        self,
        _view: WebKit2.WebView,
        resource: WebKit2.WebResource,
        request: WebKit2.URIRequest,
        tab_id: str,
    ) -> None:
        resource.connect("send-request", self.on_resource_send_request, tab_id)
        try:
            uri = request.get_uri()
        except Exception:
            return
        if not allowed_external_resource_uri(uri):
            # The first request exists before WebResource::send-request. Rewrite
            # it to a non-network URI; redirects are rejected by the callback.
            try:
                request.set_uri("about:blank")
            except Exception:
                pass

    def on_resource_send_request(
        self,
        _resource: WebKit2.WebResource,
        request: WebKit2.URIRequest,
        _redirected_response: object,
        _tab_id: str,
    ) -> bool:
        try:
            uri = request.get_uri()
        except Exception:
            return True
        return not allowed_external_resource_uri(uri)

    def on_permission_request(self, _view: WebKit2.WebView, request: object, _tab_id: str) -> bool:
        try:
            request.deny()
        except Exception:
            pass
        return True

    def on_download_started(self, _context: WebKit2.WebContext, download: object) -> None:
        try:
            download.cancel()
        except Exception:
            pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OrdaX native Surface/browser host")
    parser.add_argument("--start-uri", required=True)
    parser.add_argument("--profile-root", default="/var/lib/ordax-user/browser")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.start_uri.startswith("http://127.0.0.1:"):
        print("ordax-browser-host: Surface start URI must stay on loopback", file=sys.stderr)
        return 2
    try:
        OrdaXBrowserHost(args.start_uri, args.profile_root)
    except Exception as exc:
        print(f"ordax-browser-host: startup failed: {exc}", file=sys.stderr, flush=True)
        return 1
    Gtk.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
