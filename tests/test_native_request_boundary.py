from email.message import Message
from functools import partial
import http.client
import importlib.util
from pathlib import Path
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "system" / "surface" / "runtime" / "native_request_boundary.py"

spec = importlib.util.spec_from_file_location("ordax_native_request_boundary_test", POLICY)
boundary = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(boundary)

HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
host_spec = importlib.util.spec_from_file_location("ordax_native_boundary_integration", HOST)
native_host = importlib.util.module_from_spec(host_spec)
assert host_spec.loader is not None
host_spec.loader.exec_module(native_host)


class NativeRequestBoundaryPolicyTests(unittest.TestCase):
    def headers(self, *pairs):
        headers = Message()
        for name, value in pairs:
            headers.add_header(name, value)
        return headers

    def test_authority_is_exact_ipv4_loopback_with_concrete_port(self):
        self.assertEqual(
            boundary.expected_surface_authority(("127.0.0.1", 8765)),
            "127.0.0.1:8765",
        )
        self.assertEqual(
            boundary.expected_surface_origin(("127.0.0.1", 8765)),
            "http://127.0.0.1:8765",
        )

        invalid = (
            ("0.0.0.0", 8765),
            ("localhost", 8765),
            ("::1", 8765),
            ("127.0.0.1", 0),
            ("127.0.0.1", 65536),
            ("127.0.0.1", True),
        )
        for address in invalid:
            with self.subTest(address=address):
                with self.assertRaises(ValueError):
                    boundary.expected_surface_authority(address)

    def test_host_header_is_unique_and_matches_canonical_authority(self):
        trusted = "127.0.0.1:8765"
        self.assertTrue(
            boundary.host_header_is_trusted(
                self.headers(("Host", trusted)),
                trusted,
            )
        )

        rejected = (
            "attacker.example:8765",
            "localhost:8765",
            "127.0.0.1",
            "127.0.0.1:9999",
            "127.0.0.1:8765.evil.example",
            "１２７.０.０.１:8765",
        )
        for value in rejected:
            with self.subTest(value=value):
                self.assertFalse(
                    boundary.host_header_is_trusted(
                        self.headers(("Host", value)),
                        trusted,
                    )
                )

        duplicate = self.headers(("Host", trusted), ("Host", trusted))
        self.assertFalse(boundary.host_header_is_trusted(duplicate, trusted))
        self.assertFalse(boundary.host_header_is_trusted(Message(), trusted))

    def test_explicit_foreign_browser_context_fails_closed(self):
        trusted = "http://127.0.0.1:8765"
        self.assertTrue(boundary.browser_context_is_trusted(Message(), trusted))
        self.assertTrue(
            boundary.browser_context_is_trusted(
                self.headers(
                    ("Origin", trusted),
                    ("Referer", f"{trusted}/composition/native/index.html"),
                    ("Sec-Fetch-Site", "same-origin"),
                ),
                trusted,
            )
        )
        self.assertTrue(
            boundary.browser_context_is_trusted(
                self.headers(("Sec-Fetch-Site", "none")),
                trusted,
            )
        )

        rejected_headers = (
            self.headers(("Origin", "https://attacker.example")),
            self.headers(("Origin", "null")),
            self.headers(("Referer", "https://attacker.example/page")),
            self.headers(("Referer", "http://127.0.0.1:9999/page")),
            self.headers(("Sec-Fetch-Site", "cross-site")),
            self.headers(("Sec-Fetch-Site", "same-site")),
            self.headers(("Origin", trusted), ("Origin", trusted)),
            self.headers(("Referer", f"{trusted}/"), ("Referer", f"{trusted}/")),
            self.headers(("Sec-Fetch-Site", "same-origin"), ("Sec-Fetch-Site", "same-origin")),
        )
        for headers in rejected_headers:
            with self.subTest(headers=list(headers.items())):
                self.assertFalse(boundary.browser_context_is_trusted(headers, trusted))

    def test_every_request_is_host_pinned_and_native_api_adds_context_check(self):
        address = ("127.0.0.1", 8765)
        host = "127.0.0.1:8765"
        origin = "http://127.0.0.1:8765"

        self.assertTrue(
            boundary.request_is_trusted(
                self.headers(("Host", host)),
                address,
                "/composition/native/index.html",
            )
        )
        self.assertFalse(
            boundary.request_is_trusted(
                self.headers(("Host", "attacker.example:8765")),
                address,
                "/composition/native/index.html",
            )
        )
        self.assertTrue(
            boundary.request_is_trusted(
                self.headers(
                    ("Host", host),
                    ("Origin", origin),
                    ("Sec-Fetch-Site", "same-origin"),
                ),
                address,
                boundary.NATIVE_API_PREFIX + "session",
            )
        )
        self.assertFalse(
            boundary.request_is_trusted(
                self.headers(
                    ("Host", host),
                    ("Origin", "https://attacker.example"),
                    ("Sec-Fetch-Site", "cross-site"),
                ),
                address,
                boundary.NATIVE_API_PREFIX + "session",
            )
        )


class NativeRequestBoundaryIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        (root / "index.html").write_text("<!doctype html><title>OrdaX</title>", encoding="utf-8")
        handler = partial(native_host.NativeHostHandler, directory=str(root))
        self.server = native_host.NativeHostServer(
            ("127.0.0.1", 0),
            handler,
            user_root=str(root),
            power_request_path=str(root / "power-request"),
            network_session_dir=str(root),
            component_slots=native_host.ComponentSlotBroker(
                root=str(root / "components"),
                release_agent=str(root / "missing-release-agent"),
                trust_path=str(root / "missing-release-trust"),
            ),
        )
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def request(self, path, *, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        try:
            connection.request("GET", path, headers=headers or {})
            response = connection.getresponse()
            body = response.read()
            return response.status, body
        finally:
            connection.close()

    def test_static_surface_requires_exact_bound_authority(self):
        status, _body = self.request("/index.html")
        self.assertEqual(status, 200)

        status, _body = self.request(
            "/index.html",
            headers={"Host": f"attacker.example:{self.port}"},
        )
        self.assertEqual(status, 403)

    def test_native_api_rejects_foreign_browser_provenance(self):
        origin = f"http://127.0.0.1:{self.port}"
        status, body = self.request(
            native_host.SESSION_PATH,
            headers={
                "Origin": origin,
                "Sec-Fetch-Site": "same-origin",
            },
        )
        self.assertEqual(status, 200)
        self.assertIn(b'"token"', body)

        status, _body = self.request(
            native_host.SESSION_PATH,
            headers={
                "Origin": "https://attacker.example",
                "Sec-Fetch-Site": "cross-site",
            },
        )
        self.assertEqual(status, 403)

    def test_dns_rebinding_style_host_alias_cannot_reach_native_api(self):
        status, _body = self.request(
            native_host.SESSION_PATH,
            headers={
                "Host": f"public-name.example:{self.port}",
                "Origin": f"http://public-name.example:{self.port}",
                "Sec-Fetch-Site": "same-origin",
            },
        )
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
