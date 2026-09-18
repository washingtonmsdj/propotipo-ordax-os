import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
CONFIG = ROOT / "system" / "services" / "telemetry" / "relay.json"


def load_host():
    spec = importlib.util.spec_from_file_location("ordax_native_host_telemetry", HOST)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class NativeTelemetryTests(unittest.TestCase):
    def test_relay_config_is_https_publishable_and_bounded(self):
        host = load_host()
        config = host.read_telemetry_config(str(CONFIG))
        self.assertIsNotNone(config)
        self.assertTrue(config["endpoint"].startswith("https://"))
        self.assertTrue(config["publishableKey"].startswith("sb_publishable_"))
        self.assertGreaterEqual(config["intervalSeconds"], 15)
        self.assertLessEqual(config["timeoutSeconds"], 15)

    def test_device_id_is_persistent_and_contains_no_user_identity(self):
        host = load_host()
        with tempfile.TemporaryDirectory() as directory:
            host.TELEMETRY_DEVICE_ID_FILE = str(Path(directory) / "device-id")
            first = host.persistent_telemetry_device_id()
            second = host.persistent_telemetry_device_id()
            self.assertEqual(first, second)
            self.assertRegex(first, r"^ordax-[0-9a-f]{32}$")

    def test_payload_uses_only_operational_state(self):
        host = load_host()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            host.UPDATE_STATE_FILE = str(root / "state.json")
            host.HEALTH_STATE_FILE = str(root / "healthy-sha")
            host.RESCUE_STATUS_FILE = str(root / "rescue-status.json")
            host.BOOT_ID_FILE = str(root / "boot-id")
            sha = "a" * 40
            (root / "state.json").write_text(json.dumps({
                "sourceSha": sha,
                "targetSha": "b" * 40,
                "status": "running",
                "phase": "activating",
                "applyMode": "surface-restart",
                "attemptId": "2026-09-18T03:00:00Z",
                "lastError": "test-diagnostic",
                "lastAppliedSha": sha,
                "lastAppliedAt": "2026-09-18T03:00:00Z",
                "rejectedSha": "",
            }), encoding="utf-8")
            (root / "healthy-sha").write_text(sha + "\n", encoding="utf-8")
            (root / "rescue-status.json").write_text(
                '{"generation":2,"action":"retry-main"}\n',
                encoding="utf-8",
            )
            (root / "boot-id").write_text("boot-12345678\n", encoding="utf-8")

            payload = host.build_telemetry_payload("ordax-" + "1" * 32)
            self.assertEqual(payload["sourceSha"], sha)
            self.assertEqual(payload["targetSha"], "b" * 40)
            self.assertEqual(payload["phase"], "activating")
            self.assertEqual(payload["attemptId"], "2026-09-18T03:00:00Z")
            self.assertEqual(payload["lastError"], "test-diagnostic")
            self.assertEqual(payload["healthySha"], sha)
            self.assertEqual(payload["rescueGeneration"], 2)
            self.assertEqual(payload["rescueAction"], "retry-main")
            self.assertNotIn("email", payload)
            self.assertNotIn("name", payload)
            self.assertNotIn("user", payload)

    def test_surface_heartbeat_is_bounded_atomic_and_sha_only(self):
        host = load_host()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            host.SURFACE_HEARTBEAT_FILE = str(root / "surface-heartbeat.json")
            sha = "c" * 40
            self.assertTrue(host.valid_surface_heartbeat_payload({"sourceSha": sha}))
            self.assertFalse(host.valid_surface_heartbeat_payload({"sourceSha": "bad"}))
            self.assertFalse(host.valid_surface_heartbeat_payload({"sourceSha": sha, "extra": True}))
            host.record_surface_heartbeat(sha)
            payload = json.loads((root / "surface-heartbeat.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["sourceSha"], sha)
            self.assertIsInstance(payload["observedEpoch"], int)
            self.assertGreaterEqual(payload["observedEpoch"], 0)
            self.assertFalse(list(root.glob("*.tmp.*")))

    def test_telemetry_submission_failure_is_fail_soft(self):
        host = load_host()
        config = {
            "endpoint": "https://example.invalid/telemetry",
            "publishableKey": "sb_publishable_test",
            "intervalSeconds": 30,
            "timeoutSeconds": 1,
        }
        with mock.patch.object(host, "urlopen", side_effect=host.URLError("offline")):
            self.assertFalse(host.submit_telemetry(config, {"deviceId": "ordax-" + "2" * 32}))


if __name__ == "__main__":
    unittest.main()
