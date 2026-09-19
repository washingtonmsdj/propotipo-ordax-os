import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import threading
import unittest
from functools import partial
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"

spec = importlib.util.spec_from_file_location("ordax_native_diagnostic_journal_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class NativeDiagnosticJournalTests(unittest.TestCase):
    def setUp(self):
        self.original_file = native_host.DIAGNOSTIC_JOURNAL_FILE

    def tearDown(self):
        native_host.DIAGNOSTIC_JOURNAL_FILE = self.original_file

    def test_diagnostic_journal_has_dedicated_endpoint_file_and_byte_limit(self):
        self.assertEqual(
            native_host.DIAGNOSTIC_JOURNAL_PATH,
            "/__ordax/native/diagnostic-journal",
        )
        self.assertEqual(
            native_host.DIAGNOSTIC_JOURNAL_FILE,
            "/var/lib/ordax/diagnostic-journal.json",
        )
        self.assertEqual(native_host.MAX_DIAGNOSTIC_JOURNAL_PAYLOAD, 4 * 1024 * 1024)
        self.assertNotEqual(native_host.DIAGNOSTIC_JOURNAL_PATH, native_host.SYNC_STATE_PATH)
        self.assertNotEqual(native_host.DIAGNOSTIC_JOURNAL_FILE, native_host.SYNC_STATE_FILE)

    def test_private_payload_round_trip_is_atomic_private_and_nullable(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "state" / "diagnostic-journal.json"
            native_host.DIAGNOSTIC_JOURNAL_FILE = str(target)
            payload = '{"$schema":"ordax.diagnostic-journal-state/1","events":[]}'

            native_host.write_diagnostic_journal_payload(payload)
            self.assertEqual(native_host.read_diagnostic_journal_payload(), payload)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(target.parent.stat().st_mode), 0o700)
            self.assertEqual(list(target.parent.glob("*.tmp.*")), [])

            native_host.write_diagnostic_journal_payload(None)
            self.assertIsNone(native_host.read_diagnostic_journal_payload())
            self.assertFalse(target.exists())

    def test_payload_limit_is_utf8_bytes_and_failed_write_preserves_last_good(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "diagnostic-journal.json"
            native_host.DIAGNOSTIC_JOURNAL_FILE = str(target)
            native_host.write_diagnostic_journal_payload("good")

            exact_multibyte = "é" * (native_host.MAX_DIAGNOSTIC_JOURNAL_PAYLOAD // 2)
            self.assertTrue(native_host.valid_diagnostic_journal_payload(exact_multibyte))
            self.assertFalse(native_host.valid_diagnostic_journal_payload(exact_multibyte + "é"))

            with self.assertRaises(ValueError):
                native_host.write_diagnostic_journal_payload(
                    "x" * (native_host.MAX_DIAGNOSTIC_JOURNAL_PAYLOAD + 1)
                )
            self.assertEqual(native_host.read_diagnostic_journal_payload(), "good")

    def test_invalid_utf8_or_oversized_file_is_not_silently_treated_as_empty(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "diagnostic-journal.json"
            native_host.DIAGNOSTIC_JOURNAL_FILE = str(target)
            target.write_bytes(b"\xff\xfe")
            with self.assertRaises(UnicodeError):
                native_host.read_diagnostic_journal_payload()

            target.write_bytes(b"x" * (native_host.MAX_DIAGNOSTIC_JOURNAL_PAYLOAD + 1))
            with self.assertRaises(ValueError):
                native_host.read_diagnostic_journal_payload()

    def test_loopback_http_endpoint_round_trips_exact_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "state" / "diagnostic-journal.json"
            native_host.DIAGNOSTIC_JOURNAL_FILE = str(target)
            handler = partial(native_host.NativeHostHandler, directory=str(root))
            server = native_host.NativeHostServer(
                ("127.0.0.1", 0),
                handler,
                user_root=str(root / "user"),
                power_request_path=str(root / "missing-power-fifo"),
                network_session_dir=str(root / "network"),
                component_slots=native_host.ComponentSlotBroker(
                    root=str(root / "components"),
                    release_agent=str(root / "missing-release-agent"),
                    trust_path=str(root / "missing-release-trust"),
                ),
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            endpoint = (
                f"http://127.0.0.1:{server.server_address[1]}"
                f"{native_host.DIAGNOSTIC_JOURNAL_PATH}"
            )
            try:
                with urlopen(endpoint, timeout=3) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(json.loads(response.read()), {"payload": None})

                payload = '{"$schema":"ordax.diagnostic-journal-state/1","events":[]}'
                request = Request(
                    endpoint,
                    data=json.dumps({"payload": payload}).encode("utf-8"),
                    method="POST",
                    headers={"Content-Type": "application/json"},
                )
                with urlopen(request, timeout=3) as response:
                    self.assertEqual(response.status, 204)

                with urlopen(endpoint, timeout=3) as response:
                    self.assertEqual(json.loads(response.read()), {"payload": payload})
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)

    def test_http_endpoint_rejects_extra_fields_and_oversized_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            native_host.DIAGNOSTIC_JOURNAL_FILE = str(root / "diagnostic-journal.json")
            handler = partial(native_host.NativeHostHandler, directory=str(root))
            server = native_host.NativeHostServer(
                ("127.0.0.1", 0),
                handler,
                user_root=str(root / "user"),
                power_request_path=str(root / "missing-power-fifo"),
                network_session_dir=str(root / "network"),
                component_slots=native_host.ComponentSlotBroker(
                    root=str(root / "components"),
                    release_agent=str(root / "missing-release-agent"),
                    trust_path=str(root / "missing-release-trust"),
                ),
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            endpoint = (
                f"http://127.0.0.1:{server.server_address[1]}"
                f"{native_host.DIAGNOSTIC_JOURNAL_PATH}"
            )
            try:
                bad_body = json.dumps({"payload": "ok", "unexpected": True}).encode("utf-8")
                with self.assertRaises(HTTPError) as error:
                    urlopen(
                        Request(
                            endpoint,
                            data=bad_body,
                            method="POST",
                            headers={"Content-Type": "application/json"},
                        ),
                        timeout=3,
                    )
                self.assertEqual(error.exception.code, 400)

                too_large = "x" * (native_host.MAX_DIAGNOSTIC_JOURNAL_PAYLOAD + 1)
                oversized_body = json.dumps({"payload": too_large}).encode("utf-8")
                with self.assertRaises(HTTPError) as error:
                    urlopen(
                        Request(
                            endpoint,
                            data=oversized_body,
                            method="POST",
                            headers={"Content-Type": "application/json"},
                        ),
                        timeout=3,
                    )
                self.assertEqual(error.exception.code, 400)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
