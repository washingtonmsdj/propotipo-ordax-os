from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / "system" / "services" / "telemetry" / "base-agent.sh"
CONFIG = ROOT / "system" / "services" / "telemetry" / "relay.json"
LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"


class BaseTelemetryAgentContractTests(unittest.TestCase):
    def test_agent_is_shell_valid_and_observation_only(self):
        subprocess.run(["sh", "-n", str(AGENT)], check=True)
        text = AGENT.read_text(encoding="utf-8")
        self.assertIn("/bin/busybox wget", text)
        self.assertIn("device_id=$device_root:base", text)
        self.assertIn('source_sha=$candidate', text)
        self.assertIn('UPDATE_STATE=/run/ordax-update/state.json', text)
        self.assertIn('RESCUE_ACTION_FILE=$STATE_DIR/rescue/last-action', text)
        self.assertIn("targetSha", text)
        self.assertIn("phase", text)
        self.assertIn("supervisorCheckedAt", text)
        self.assertIn('supervisor_checked_at=$(json_field checkedAt "$UPDATE_STATE")', text)
        self.assertIn("attemptId", text)
        self.assertIn("lastError", text)
        for forbidden in (
            "kill ",
            "pkill ",
            "killall ",
            "reboot",
            "poweroff",
            "reset --hard",
            "checkout ",
            "rm -f \"$REJECTED_FILE\"",
            "curl ",
            "ssh ",
            "eval ",
            "sh -c",
        ):
            self.assertNotIn(forbidden, text)

    def test_agent_pid_guard_uses_real_shell_pid(self):
        text = AGENT.read_text(encoding="utf-8")
        self.assertIn('[ "$existing_pid" != "$$" ]', text)
        self.assertNotIn('[ "$existing_pid" != "$" ]', text)

    def test_agent_reuses_native_device_identity_and_separates_base_row(self):
        text = AGENT.read_text(encoding="utf-8")
        self.assertIn(
            "DEVICE_ID_FILE=$STATE_DIR/native-state/telemetry-device-id",
            text,
        )
        self.assertIn("device_id=$device_root:base", text)
        self.assertIn("/proc/sys/kernel/random/uuid", text)

    def test_relay_config_is_copied_into_persistent_state(self):
        launcher = LAUNCHER.read_text(encoding="utf-8")
        self.assertIn(
            "BASE_TELEMETRY_SOURCE=$SYSTEM_ROOT/services/telemetry/base-agent.sh",
            launcher,
        )
        self.assertIn(
            "BASE_TELEMETRY_CONFIG_SOURCE=$SYSTEM_ROOT/services/telemetry/relay.json",
            launcher,
        )
        self.assertIn("BASE_TELEMETRY_DIR=$STATE_ROOT/telemetry", launcher)
        self.assertIn('chmod 600 "$temporary"', launcher)
        self.assertIn('/bin/setsid "$BASE_TELEMETRY_AGENT"', launcher)

    def test_base_telemetry_starts_before_graphical_runtime(self):
        launcher = LAUNCHER.read_text(encoding="utf-8")
        self.assertLess(
            launcher.index("ensure_base_telemetry_agent ||"),
            launcher.index('ensure_runtime || fallback_with_reason'),
        )
        self.assertIn(
            "base telemetry bootstrap failed; continuing Surface startup",
            launcher,
        )

    def test_agent_reads_public_relay_configuration_instead_of_secret_material(self):
        text = AGENT.read_text(encoding="utf-8")
        config = CONFIG.read_text(encoding="utf-8")
        self.assertIn("publishableKey", config)
        self.assertIn("sb_publishable_", config)
        self.assertNotIn("service_role", config)
        self.assertNotIn("sb_secret_", config)
        self.assertNotIn("service_role", text)
        self.assertNotIn("sb_secret_", text)


if __name__ == "__main__":
    unittest.main()
