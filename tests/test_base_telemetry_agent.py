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
        self.assertIn("runtimeSurfaceSha", text)
        self.assertIn('runtime_surface_sha=$(json_field runtimeSurfaceSha "$UPDATE_STATE")', text)
        self.assertIn('"runtimeSurfaceSha":"%s"', text)
        self.assertIn("phase", text)
        self.assertIn("supervisorCheckedAt", text)
        self.assertIn('supervisor_checked_at=$(json_field checkedAt "$UPDATE_STATE")', text)
        self.assertIn('supervisor_state_epoch=$(/bin/busybox stat -c %Y "$UPDATE_STATE"', text)
        self.assertIn('"supervisorStateEpoch":%s', text)
        self.assertIn("SURFACE_HEARTBEAT_FILE=$STATE_DIR/native-state/surface-heartbeat.json", text)
        self.assertIn('"surfaceSourceSha":"%s"', text)
        self.assertIn('"surfaceHeartbeatEpoch":%s', text)
        self.assertIn("CLIENT_DIAGNOSTIC_FILE=$STATE_DIR/native-state/client-diagnostic.json", text)
        self.assertIn('"clientDiagnosticSha":"%s"', text)
        self.assertIn('"clientDiagnosticStage":"%s"', text)
        self.assertIn('"clientDiagnosticName":"%s"', text)
        self.assertIn('"clientDiagnosticSource":"%s"', text)
        self.assertIn('"clientDiagnosticEpoch":%s', text)
        self.assertIn('"powerSupplyClassAvailable":%s', text)
        self.assertIn('"batteryDetected":%s', text)
        self.assertIn('"kernelSysrqRestartAvailable":%s', text)
        self.assertIn("power_supply_class_available=false", text)
        self.assertIn("battery_detected=false", text)
        self.assertIn("kernel_sysrq_restart_available=false", text)
        self.assertIn("[ -w /proc/sysrq-trigger ] && kernel_sysrq_restart_available=true", text)
        self.assertIn("[ -d /sys/class/power_supply ]", text)
        self.assertIn('[ "$supply_type" = "Battery" ]', text)
        self.assertIn('[ "$present" = "0" ] && continue', text)
        self.assertIn('client_diagnostic_stage=$(json_field stage "$CLIENT_DIAGNOSTIC_FILE")', text)
        self.assertIn('client_diagnostic_name=$(json_field errorName "$CLIENT_DIAGNOSTIC_FILE")', text)
        self.assertIn('client_diagnostic_source=$(json_field source "$CLIENT_DIAGNOSTIC_FILE")', text)
        self.assertIn("surface_state=running", text)
        self.assertIn("surface_state=stopped", text)
        self.assertIn("attemptId", text)
        self.assertIn("stagedReleaseSha", text)
        self.assertIn("lastApplyDurationSeconds", text)
        self.assertIn("lastStageDurationSeconds", text)
        self.assertIn("json_number_field()", text)
        self.assertIn('"relayVersion":2', text)
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

    def test_changed_base_agent_restarts_persistent_process_safely(self):
        launcher = LAUNCHER.read_text(encoding="utf-8")
        self.assertIn('/bin/busybox cmp "$BASE_TELEMETRY_SOURCE" "$BASE_TELEMETRY_AGENT"', launcher)
        self.assertIn("base_agent_changed=1", launcher)
        self.assertIn('terminate_child "$pid" "base telemetry agent"', launcher)
        self.assertIn("refreshed persistent base telemetry agent", launcher)
        self.assertIn('persistent_agent_pid_matches "$pid" "$BASE_TELEMETRY_AGENT"', launcher)
        self.assertIn('temporary=$BASE_TELEMETRY_AGENT.tmp.$', launcher)

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
