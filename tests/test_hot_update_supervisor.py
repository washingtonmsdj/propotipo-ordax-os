from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SYSTEM_ENTRYPOINT = ROOT / "system" / "entrypoint"
SURFACE_RUNTIME = ROOT / "system" / "surface" / "bin" / "ordax-surface"
NATIVE_HOST_SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
NATIVE_UPDATE_ADAPTER = ROOT / "system" / "adapters" / "native" / "update-runtime.mjs"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"


class HotUpdateSupervisorContractTests(unittest.TestCase):
    def test_supervisor_shell_is_syntactically_valid(self):
        subprocess.run(["sh", "-n", str(SYSTEM_ENTRYPOINT)], check=True)
        subprocess.run(["sh", "-n", str(SURFACE_RUNTIME)], check=True)

    def test_supervisor_polls_git_without_rebooting_for_normal_updates(self):
        text = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn('UPDATE_INTERVAL=${ORDAX_UPDATE_INTERVAL_SECONDS:-20}', text)
        self.assertIn('ls-remote --heads origin "refs/heads/$BRANCH"', text)
        self.assertIn('PULL_BIN=${ORDAX_PULL_BIN:-/usr/local/bin/ordax-pull}', text)
        self.assertIn('if ! "$PULL_BIN"', text)
        self.assertIn("classify_changes", text)
        self.assertIn("APPLY_MODE=reload", text)
        self.assertIn("APPLY_MODE=surface-restart", text)
        self.assertIn("APPLY_MODE=supervisor-restart", text)
        self.assertNotIn("reboot -f", text)
        self.assertNotIn("poweroff -f", text)

    def test_live_safe_and_host_changes_have_distinct_apply_modes(self):
        text = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn(
            "system/apps/*|system/adapters/*|system/contracts/*|system/services/*|system/composition/*|system/surface/ui/*",
            text,
        )
        self.assertIn(
            "system/surface/bin/*|system/surface/runtime/*|system/surface/entrypoint",
            text,
        )
        self.assertIn('log "live-safe system update applied; native Surface will reload itself"', text)
        self.assertIn('log "native host update applied; restarting Surface only"', text)
        self.assertIn('exec "$SYSTEM_ENTRYPOINT"', text)

    def test_low_level_changes_are_marked_not_auto_rebooted(self):
        text = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("boot/*|bootstrap/*", text)
        self.assertIn("BOOT_REFRESH_FILE=$STATE_DIR/boot-refresh-required", text)
        self.assertIn("mark_boot_refresh_required", text)
        self.assertIn("boot refresh is marked pending", text)

    def test_rollback_pin_disables_automatic_pull(self):
        text = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("PINNED_FILE=$STATE_DIR/pinned-commit", text)
        self.assertIn('if [ -s "$PINNED_FILE" ]', text)
        self.assertIn('write_update_state "$current" pinned none', text)

    def test_native_server_exposes_loopback_update_state(self):
        text = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn('UPDATE_PATH = "/__ordax/native/update"', text)
        self.assertIn('UPDATE_STATE_FILE = "/run/ordax-update/state.json"', text)
        self.assertIn("read_update_state", text)
        self.assertIn("bootRefreshRequired", text)

    def test_native_composition_owns_reload_watcher(self):
        adapter = NATIVE_UPDATE_ADAPTER.read_text(encoding="utf-8")
        composition = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertIn('UPDATE_STATE_PATH = "/__ordax/native/update"', adapter)
        self.assertIn('state.applyMode === "reload"', adapter)
        self.assertIn("windowRef.location.reload()", adapter)
        self.assertIn("Network/update polling must never take the running Surface down", adapter)
        self.assertIn("createNativeUpdateWatcher", composition)
        self.assertIn("updateWatcher.dispose()", composition)

    def test_surface_launcher_is_gracefully_restartable(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn('GRAPHICS_PID=""', text)
        self.assertIn('kill "$GRAPHICS_PID"', text)
        self.assertIn('wait "$GRAPHICS_PID"', text)
        self.assertIn("trap terminate HUP INT TERM", text)
        self.assertIn("GRAPHICS_PID=$!", text)


if __name__ == "__main__":
    unittest.main()
