from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ENTRYPOINT = ROOT / "system" / "entrypoint"


class GuardianBootSessionStartupTests(unittest.TestCase):
    def test_boot_session_id_is_initialized_before_candidate_heartbeat(self):
        text = ENTRYPOINT.read_text(encoding="utf-8")
        initializer = 'ensure_base_boot_id || fail_closed "boot session id could not be initialized"'
        heartbeat = "write_base_update_heartbeat\n"

        self.assertEqual(text.count(initializer), 1)
        self.assertLess(text.index(initializer), text.index(heartbeat))
        self.assertLess(text.index(initializer), text.index("while :; do\n    start_supervisor"))


if __name__ == "__main__":
    unittest.main()
