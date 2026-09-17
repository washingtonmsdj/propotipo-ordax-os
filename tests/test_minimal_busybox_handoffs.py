import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INIT = (ROOT / "bootstrap/initramfs/root/init").read_text(encoding="utf-8")
DEV_BOOTSTRAP = (ROOT / "bootstrap/dev/entrypoint").read_text(encoding="utf-8")


class MinimalBusyBoxHandoffTests(unittest.TestCase):
    def test_pid1_does_not_depend_on_optional_ash_command_builtin(self):
        self.assertNotIn("command -v", INIT)
        self.assertIn('GROW_HELPER=/sbin/ordax-grow-ext4', INIT)
        self.assertIn('if ! "$GROW_HELPER" "$ORDAX_DEVICE" /ordax; then', INIT)
        self.assertIn('cat "$BOOTSTRAP_PATH" >/dev/null 2>&1', INIT)
        self.assertIn('exec "$BOOTSTRAP_PATH"', INIT)
        self.assertIn('cat "$RECOVERY_BOOTSTRAP_PATH" >/dev/null 2>&1', INIT)
        self.assertIn('exec "$RECOVERY_BOOTSTRAP_PATH"', INIT)

    def test_owner_dev_bootstrap_uses_only_fixed_capsule_primitives(self):
        self.assertNotIn("command -v", DEV_BOOTSTRAP)
        self.assertNotIn("[ -", DEV_BOOTSTRAP)
        self.assertNotIn("test -", DEV_BOOTSTRAP)
        self.assertIn('cat "$DEV_INIT_SOURCE" >/dev/null 2>&1', DEV_BOOTSTRAP)
        self.assertIn('exec switch_root "$DEV_ROOT" "$DEV_INIT"', DEV_BOOTSTRAP)


if __name__ == "__main__":
    unittest.main()
