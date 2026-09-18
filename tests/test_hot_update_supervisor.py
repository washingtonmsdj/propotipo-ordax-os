from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SYSTEM_ENTRYPOINT = ROOT / "system" / "entrypoint"
SURFACE_RUNTIME = ROOT / "system" / "surface" / "bin" / "ordax-surface"
NATIVE_HOST_SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
NATIVE_UPDATE_ADAPTER = ROOT / "system" / "adapters" / "native" / "update-runtime.mjs"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
UPDATE_CONTROLS = ROOT / "system" / "surface" / "ui" / "update-controls.mjs"


class HotUpdateSupervisorContractTests(unittest.TestCase):
    def test_supervisor_shell_is_syntactically_valid(self):
        subprocess.run(["sh", "-n", str(SYSTEM_ENTRYPOINT)], check=True)
        subprocess.run(["sh", "-n", str(SURFACE_RUNTIME)], check=True)
        subprocess.run(["python3", "-m", "py_compile", str(NATIVE_HOST_SERVER)], check=True)

    def test_supervisor_polls_git_without_rebooting_for_normal_updates(self):
        text = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn('UPDATE_INTERVAL=${ORDAX_UPDATE_INTERVAL_SECONDS:-5}', text)
        self.assertIn('REMOTE_TIMEOUT=${ORDAX_REMOTE_TIMEOUT_SECONDS:-20}', text)
        self.assertIn('PULL_TIMEOUT=${ORDAX_PULL_TIMEOUT_SECONDS:-45}', text)
        self.assertIn('GIT_TERMINAL_PROMPT=0', text)
        self.assertIn('run_bounded "$REMOTE_TIMEOUT" "$GIT_BIN" -C "$WORKTREE" ls-remote', text)
        self.assertIn('PULL_BIN=${ORDAX_PULL_BIN:-/usr/local/bin/ordax-pull}', text)
        self.assertIn('run_bounded "$PULL_TIMEOUT" "$PULL_BIN"', text)
        self.assertIn("classify_changes", text)
        self.assertIn("APPLY_MODE=reload", text)
        self.assertIn("APPLY_MODE=surface-restart", text)
        self.assertIn("APPLY_MODE=supervisor-restart", text)
        self.assertNotIn("reboot -f", text)
        self.assertNotIn("poweroff -f", text)

    def test_git_update_operations_are_bounded(self):
        text = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn('/bin/busybox timeout -k 5 "$timeout_seconds" "$@"', text)
        self.assertIn('failed or timed out after ${REMOTE_TIMEOUT}s', text)
        self.assertIn('failed or timed out after ${PULL_TIMEOUT}s', text)
        self.assertIn('write_update_state "$current" network-error none', text)
        self.assertIn('write_update_state "$old_sha" pull-error none', text)

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
        self.assertIn('log "live-safe system update applied; waiting for Surface health acknowledgement"', text)
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

    def test_failed_update_is_rolled_back_and_rejected(self):
        text = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("REJECTED_FILE=$STATE_DIR/rejected-commit", text)
        self.assertIn("rollback_update()", text)
        self.assertIn('reset --hard "$previous_sha"', text)
        self.assertIn('write_update_state "$previous_sha" rolled-back "$failed_mode"', text)
        self.assertIn('if [ -n "$rejected_sha" ] && [ "$remote_sha" = "$rejected_sha" ]', text)
        self.assertIn('write_update_state "$current" rejected none', text)
        self.assertIn("validate_updated_tree", text)

    def test_healthy_current_checkout_clears_stale_rejection(self):
        text = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn('healthy_sha=$(read_state_value "$HEALTH_FILE")', text)
        self.assertIn('[ "$rejected_sha" = "$current" ] && [ "$healthy_sha" = "$current" ]', text)
        self.assertIn('rm -f "$REJECTED_FILE"', text)
        self.assertIn('cleared stale rejected state for healthy current checkout', text)

    def test_live_reload_requires_surface_health_acknowledgement(self):
        text = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("HEALTH_FILE=$UPDATE_RUN_DIR/healthy-sha", text)
        self.assertIn("wait_for_surface_health", text)
        self.assertIn('wait_for_surface_health "$new_sha" 12', text)
        self.assertIn('rollback_update "$old_sha" "$new_sha" reload', text)
        self.assertIn("SUPERVISOR_GUARD_FILE=$STATE_DIR/pending-supervisor-update", text)

    def test_native_server_exposes_loopback_update_state_and_health_endpoint(self):
        text = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn('UPDATE_PATH = "/__ordax/native/update"', text)
        self.assertIn('HEALTH_PATH = "/__ordax/native/health"', text)
        self.assertIn('UPDATE_STATE_FILE = "/run/ordax-update/state.json"', text)
        self.assertIn('HEALTH_STATE_FILE = "/run/ordax-update/healthy-sha"', text)
        self.assertIn('HEALTH_TOKEN_HEADER = "X-OrdaX-Health-Token"', text)
        self.assertIn("record_surface_health", text)
        self.assertIn("bootRefreshRequired", text)
        self.assertNotIn("Access-Control-Allow-Origin", text)

    def test_native_server_disables_static_surface_cache(self):
        text = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn('self.send_header("Cache-Control", "no-store, max-age=0")', text)
        self.assertIn('self.send_header("Pragma", "no-cache")', text)
        self.assertIn('not urlsplit(self.path).path.startswith("/__ordax/native/")', text)

    def test_native_composition_owns_reload_watcher_and_update_center(self):
        adapter = NATIVE_UPDATE_ADAPTER.read_text(encoding="utf-8")
        composition = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        controls = UPDATE_CONTROLS.read_text(encoding="utf-8")
        self.assertIn('UPDATE_STATE_PATH = "/__ordax/native/update"', adapter)
        self.assertIn('UPDATE_HEALTH_PATH = "/__ordax/native/health"', adapter)
        self.assertIn('state.applyMode === "reload"', adapter)
        self.assertIn("windowRef.location.reload()", adapter)
        self.assertIn("markHealthy()", adapter)
        self.assertIn("subscribe(listener)", adapter)
        self.assertIn("Network/update polling must never take the running Surface down", adapter)
        self.assertIn("createNativeUpdateWatcher", composition)
        self.assertIn("mountUpdateControls", composition)
        self.assertIn("updateWatcher.markHealthy()", composition)
        self.assertIn("updateControls.destroy()", composition)
        self.assertIn('"Atualização revertida"', controls)
        self.assertIn('"Reinício necessário"', controls)
        self.assertIn("lastAppliedAt", controls)
        self.assertIn("rejectedSha", controls)

    def test_update_state_carries_operator_visible_metadata(self):
        text = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn('"checkedAt":"%s"', text)
        self.assertIn('"lastAppliedSha":"%s"', text)
        self.assertIn('"lastAppliedAt":"%s"', text)
        self.assertIn('"rejectedSha":"%s"', text)
        self.assertIn("record_applied", text)

    def test_surface_launcher_is_gracefully_restartable(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn('GRAPHICS_PID=""', text)
        self.assertIn('kill "$GRAPHICS_PID"', text)
        self.assertIn('wait "$GRAPHICS_PID"', text)
        self.assertIn("trap terminate HUP INT TERM", text)
        self.assertIn("GRAPHICS_PID=$!", text)


if __name__ == "__main__":
    unittest.main()
