import importlib.util
import os
from pathlib import Path
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"

spec = importlib.util.spec_from_file_location("ordax_native_power_broker_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class NativePowerBrokerTests(unittest.TestCase):
    def test_supported_actions_require_private_fifo_boundary(self):
        with tempfile.TemporaryDirectory() as temporary:
            request_path = Path(temporary) / "power-request"
            self.assertEqual(native_host.supported_power_actions(str(request_path)), ())
            os.mkfifo(request_path, 0o600)
            self.assertEqual(
                native_host.supported_power_actions(str(request_path)),
                ("restart", "shutdown"),
            )

    def test_power_action_is_queued_to_fifo_not_executed_in_chroot(self):
        with tempfile.TemporaryDirectory() as temporary:
            request_path = Path(temporary) / "power-request"
            os.mkfifo(request_path, 0o600)
            received = []

            def read_request():
                with open(request_path, "r", encoding="ascii") as handle:
                    received.append(handle.readline().strip())

            reader = threading.Thread(target=read_request, daemon=True)
            reader.start()
            native_host.queue_power_action(str(request_path), "restart")
            reader.join(timeout=2)

            self.assertFalse(reader.is_alive())
            self.assertEqual(received, ["restart"])

    def test_unknown_power_action_is_rejected_before_queue(self):
        with tempfile.TemporaryDirectory() as temporary:
            request_path = Path(temporary) / "power-request"
            os.mkfifo(request_path, 0o600)
            with self.assertRaises(ValueError):
                native_host.queue_power_action(str(request_path), "hibernate")


if __name__ == "__main__":
    unittest.main()
