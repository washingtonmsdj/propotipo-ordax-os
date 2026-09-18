from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SYSTEM_ENTRYPOINT = ROOT / "system" / "entrypoint"
SYSTEM_SUPERVISOR = ROOT / "system" / "supervisor"
SURFACE_RUNTIME = ROOT / "system" / "surface" / "bin" / "ordax-surface"
NATIVE_HOST_SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
NATIVE_UPDATE_ADAPTER = ROOT / "system" / "adapters" / "native" / "update-runtime.mjs"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
UPDATE_CONTROLS = ROOT / "system" / "surface" / "ui" / "update-controls.mjs"


class HotUpdateSupervisorContractTests(unittest.TestCase):
    def test_supervisor_shell_is_syntactically_valid(self):
        subprocess.run(["sh", "-n", str(SYSTEM_ENTRYPOINT)], check=True)
        subprocess.run(["sh", "-n", str(SYSTEM_SUPERVISOR)], check=True)
        subprocess.run(["sh", "-n", str(SURFACE_RUNTIME)], check=True)
        subprocess.run(["python3", "-m", "py_compile", str(NATIVE_HOST_SERVER)], check=True)

    def test_supervisor_polls_git_without_rebooting_for_normal_updates(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('UPDATE_INTERVAL=${ORDAX_UPDATE_INTERVAL_SECONDS:-5}', text)
        self.assertIn('REMOTE_TIMEOUT=${ORDAX_REMOTE_TIMEOUT_SECONDS:-20}', text)
        self.assertIn('FETCH_TIMEOUT=${ORDAX_FETCH_TIMEOUT_SECONDS:-45}', text)
        self.assertIn('STAGE_TIMEOUT=${ORDAX_STAGE_TIMEOUT_SECONDS:-8}', text)
        self.assertIn('GIT_LOW_SPEED_TIME=${ORDAX_GIT_LOW_SPEED_SECONDS:-15}', text)
        self.assertIn('SURFACE_HEALTH_TIMEOUT=${ORDAX_SURFACE_HEALTH_TIMEOUT_SECONDS:-30}', text)
        self.assertIn('RELOAD_HEALTH_TIMEOUT=${ORDAX_RELOAD_HEALTH_TIMEOUT_SECONDS:-8}', text)
        self.assertIn('RELOAD_FALLBACK_HEALTH_TIMEOUT=${ORDAX_RELOAD_FALLBACK_HEALTH_TIMEOUT_SECONDS:-12}', text)
        self.assertIn('GIT_TERMINAL_PROMPT=0', text)
        self.assertIn('run_bounded_git "$REMOTE_TIMEOUT" -C "$WORKTREE" ls-remote', text)
        self.assertIn('apply_remote_checkout "$old_sha" "$remote_sha"', text)
        self.assertNotIn('ORDAX_PULL_BIN', text)
        self.assertIn("classify_changes", text)
        self.assertIn("APPLY_MODE=reload", text)
        self.assertIn("APPLY_MODE=surface-restart", text)
        self.assertIn("APPLY_MODE=supervisor-restart", text)
        self.assertNotIn("reboot -f", text)
        self.assertNotIn("poweroff -f", text)

    def test_git_update_operations_are_bounded(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('/bin/busybox timeout -k 5 "$timeout_seconds"', text)
        self.assertIn('-c http.lowSpeedLimit=1', text)
        self.assertIn('-c "http.lowSpeedTime=$GIT_LOW_SPEED_TIME"', text)
        self.assertIn('remote check failed or timed out after ${REMOTE_TIMEOUT}s', text)
        self.assertIn('Git fetch failed or timed out after ${FETCH_TIMEOUT}s', text)
        self.assertIn('write_update_state "$current" network-error none', text)
        self.assertIn('write_update_state "$old_sha" pull-error none', text)

    def test_hot_update_checkout_is_owned_by_supervisor(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("apply_remote_checkout()", text)
        self.assertIn('fetch --no-tags origin', text)
        self.assertIn('merge-base --is-ancestor "$previous_sha" "$expected_sha"', text)
        self.assertIn('reset --hard "$expected_sha"', text)
        self.assertIn('sparse-checkout set --no-cone /system/', text)
        self.assertIn('PREVIOUS_FILE=$STATE_DIR/previous-commit', text)
        self.assertIn('CURRENT_FILE=$STATE_DIR/current-commit', text)
        self.assertNotIn('/usr/local/bin/ordax-pull', text)

    def test_candidate_is_preflighted_before_live_checkout_switch(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("validate_candidate_tree()", text)
        self.assertIn('show "$candidate_sha:$candidate_path"', text)
        self.assertIn('cat-file -e "$candidate_sha:$candidate_path"', text)
        self.assertIn('ls-tree "$candidate_sha" -- "$candidate_path"', text)
        self.assertIn('candidate_shell_is_valid "$candidate_sha" system/supervisor', text)
        self.assertIn("candidate-preflight-failed", text)
        self.assertIn('reason=${CHECKOUT_ERROR:-checkout-failed}', text)
        self.assertIn('temporary=$UPDATE_RUN_DIR/candidate-shell.tmp', text)
        self.assertLess(
            text.index('validate_candidate_tree "$expected_sha"'),
            text.index('reset --hard "$expected_sha"'),
        )

    def test_common_reload_path_uses_fast_staged_preflight(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('classify_changes "$previous_sha" "$expected_sha"', text)
        self.assertIn('validate_candidate_tree "$expected_sha" "$APPLY_MODE"', text)
        self.assertLess(
            text.index('classify_changes "$previous_sha" "$expected_sha"'),
            text.index('reset --hard "$expected_sha"'),
        )
        candidate = text.split("validate_candidate_tree() {", 1)[1].split(
            "surface-restart|supervisor-restart)", 1
        )[0]
        self.assertIn("reload)", candidate)
        self.assertIn(
            'candidate_path_exists "$candidate_sha" system/composition/native/main.mjs',
            candidate,
        )
        self.assertNotIn("candidate_shell_is_valid", candidate)
        self.assertIn(
            'wait_for_surface_health "$new_sha" "$RELOAD_HEALTH_TIMEOUT"',
            text,
        )
        self.assertIn('validate_updated_tree "$APPLY_MODE"', text)

    def test_candidate_release_is_staged_before_live_checkout_switch(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('RELEASES_DIR=${ORDAX_RELEASES_DIR:-$STATE_DIR/releases}', text)
        self.assertIn('STAGED_RELEASE_FILE=$STATE_DIR/staged-release-sha', text)
        self.assertIn('STAGE_TIMEOUT=${ORDAX_STAGE_TIMEOUT_SECONDS:-8}', text)
        self.assertIn("stage_candidate_release()", text)
        self.assertIn("staged_release_tree_is_valid()", text)
        self.assertIn(
            'archive --format=tar "$candidate_sha" system >"$stage_archive"',
            text,
        )
        self.assertIn(
            '/bin/busybox timeout -k 2 "$STAGE_TIMEOUT" /bin/busybox tar -xf',
            text,
        )
        self.assertIn('write_state_value "$STAGED_RELEASE_FILE" "$candidate_sha"', text)
        self.assertIn('CHECKOUT_ERROR=candidate-stage-failed', text)
        self.assertLess(
            text.index('stage_candidate_release "$expected_sha" "$APPLY_MODE"'),
            text.index('reset --hard "$expected_sha"'),
        )

    def test_runtime_neutral_update_does_not_materialize_a_release_slot(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        staging = text.split("stage_candidate_release() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn('if [ "$candidate_mode" = none ]; then', staging)
        self.assertIn('write_state_value "$LAST_STAGE_DURATION_FILE" "0"', staging)
        self.assertIn("return 0", staging)
        self.assertNotIn("fetch --no-tags", staging)
        self.assertNotIn("ls-remote", staging)

    def test_runtime_neutral_main_change_is_not_recorded_as_notebook_application(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        none_block = text.split('        none)\n', 1)[1].split('            ;;', 1)[0]
        self.assertNotIn('record_applied "$new_sha"', none_block)
        self.assertIn('rm -f "$ATTEMPT_STARTED_EPOCH_FILE"', none_block)
        self.assertIn('refresh_release_history', none_block)
        self.assertIn("repository update has no device delivery effect", none_block)
        self.assertIn("low-level delivery observed; application remains pending boot refresh", none_block)

    def test_live_reload_uses_lightweight_git_object_staging(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        staging = text.split("stage_candidate_release() {", 1)[1].split("\n}\n", 1)[0]
        reload_fast_path = staging.split('if [ "$candidate_mode" = reload ]; then', 1)[1].split("fi", 1)[0]
        self.assertIn('write_state_value "$STAGED_RELEASE_FILE" "$candidate_sha"', reload_fast_path)
        self.assertIn('write_state_value "$LAST_STAGE_DURATION_FILE" "0"', reload_fast_path)
        self.assertIn("live-safe candidate staged in fetched Git objects", reload_fast_path)
        self.assertIn("return 0", reload_fast_path)
        self.assertNotIn("archive --format=tar", reload_fast_path)
        self.assertNotIn("tar -xf", reload_fast_path)


    def test_update_latency_is_recorded_without_external_timing(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("LAST_APPLY_DURATION_FILE=$STATE_DIR/last-apply-duration-seconds", text)
        self.assertIn("LAST_STAGE_DURATION_FILE=$STATE_DIR/last-stage-duration-seconds", text)
        self.assertIn("ATTEMPT_STARTED_EPOCH_FILE=$UPDATE_RUN_DIR/attempt-started-epoch", text)
        self.assertIn("record_elapsed_seconds()", text)
        self.assertIn('write_state_value "$ATTEMPT_STARTED_EPOCH_FILE" "$(epoch_now)"', text)
        self.assertIn('record_elapsed_seconds "$attempt_started" "$LAST_APPLY_DURATION_FILE"', text)
        self.assertIn('record_elapsed_seconds "$stage_started" "$LAST_STAGE_DURATION_FILE"', text)
        self.assertIn('"lastApplyDurationSeconds":%s', text)
        self.assertIn('"lastStageDurationSeconds":%s', text)
        self.assertIn('"stagedReleaseSha":"%s"', text)

    def test_delivery_numbers_are_pr_independent_and_history_is_bounded(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        host = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        controls = UPDATE_CONTROLS.read_text(encoding="utf-8")
        self.assertIn("delivery_number_for_sha()", text)
        self.assertIn('rev-list --first-parent --count "$source_sha"', text)
        self.assertIn("system boot bootstrap", text)
        self.assertIn(":(exclude)system/*.md", text)
        self.assertNotIn("Merge pull request #", text)
        self.assertNotIn("version_number_for_sha()", text)
        self.assertIn("UPDATE_HISTORY_FILE=$STATE_DIR/native-state/update-history.tsv", text)
        self.assertIn("RELEASE_HISTORY_FILE=$STATE_DIR/native-state/release-history.tsv", text)
        self.assertIn("UPDATE_HISTORY_MAX_ENTRIES=200", text)
        self.assertIn("RELEASE_HISTORY_MAX_ENTRIES=80", text)
        self.assertIn("refresh_release_history()", text)
        self.assertIn("append_application_history()", text)
        self.assertIn('/bin/busybox tail -n "$UPDATE_HISTORY_MAX_ENTRIES"', text)
        self.assertIn('"deliveryNumber":%s', text)
        self.assertIn('"versionNumber":%s', text)
        self.assertIn('record_applied "$guard_current" supervisor-restart', text)
        self.assertIn("rolled-back", text)
        self.assertIn('UPDATE_HISTORY_PATH = "/__ordax/native/update-history"', host)
        self.assertIn('"deliveryNumber": version', host)
        self.assertIn("deliveryLabel(snapshot?.deliveryNumber)", controls)

    def test_surface_runs_continuous_fail_soft_ntp_sync(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("start_time_sync_agent()", text)
        self.assertIn("/bin/busybox ntpd -n", text)
        self.assertIn("-p time.cloudflare.com", text)
        self.assertIn("-p time.google.com", text)
        self.assertIn("-p pool.ntp.org", text)
        self.assertIn("TIME_SYNC_PID=$!", text)
        self.assertIn('terminate_child "$TIME_SYNC_PID" "time sync agent"', text)
        self.assertIn("automatic time synchronization unavailable; continuing Surface startup", text)

    def test_system_markdown_is_runtime_neutral_before_system_fallback(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        markdown = text.index("system/*.md)")
        next_case = text.index("boot/*|bootstrap/*)", markdown + 1)
        broad_system = text.index("system/*)", next_case + 1)
        self.assertLess(markdown, next_case)
        self.assertLess(next_case, broad_system)
        markdown_block = text[markdown:next_case]
        self.assertIn(";;", markdown_block)
        self.assertNotIn("surface_host_changed=1", markdown_block)
        self.assertNotIn("live_surface_changed=1", markdown_block)

    def test_live_safe_and_host_changes_have_distinct_apply_modes(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
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
        self.assertIn("exit 75", text)

    def test_low_level_changes_are_marked_not_auto_rebooted(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("boot/*|bootstrap/*", text)
        self.assertIn("BOOT_REFRESH_FILE=$STATE_DIR/boot-refresh-required", text)
        self.assertIn("mark_boot_refresh_required", text)
        self.assertIn("boot refresh is marked pending", text)

    def test_rollback_pin_disables_automatic_pull(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("PINNED_FILE=$STATE_DIR/pinned-commit", text)
        self.assertIn('if [ -s "$PINNED_FILE" ]', text)
        self.assertIn('write_update_state "$current" pinned none', text)

    def test_failed_update_is_rolled_back_and_rejected(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("REJECTED_FILE=$STATE_DIR/rejected-commit", text)
        self.assertIn("rollback_update()", text)
        self.assertIn('reset --hard "$previous_sha"', text)
        self.assertIn('write_update_state "$previous_sha" rolled-back "$failed_mode"', text)
        self.assertIn('if [ -n "$rejected_sha" ] && [ "$remote_sha" = "$rejected_sha" ]', text)
        self.assertIn('write_update_state "$current" rejected none', text)
        self.assertIn("validate_updated_tree", text)

    def test_healthy_current_checkout_clears_stale_rejection(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('healthy_sha=$(read_state_value "$HEALTH_FILE")', text)
        self.assertIn('[ "$rejected_sha" = "$current" ] && [ "$healthy_sha" = "$current" ]', text)
        self.assertIn('rm -f "$REJECTED_FILE"', text)
        self.assertIn('cleared stale rejected state for healthy current checkout', text)

    def test_host_base_telemetry_changes_restart_surface(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("system/services/telemetry/base-agent.sh", text)
        self.assertIn("system/services/telemetry/relay.json", text)
        self.assertIn("surface_host_changed=1", text)

    def test_surface_health_is_bound_to_rendered_ui_sha(self):
        supervisor = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        host = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        adapter = NATIVE_UPDATE_ADAPTER.read_text(encoding="utf-8")
        self.assertIn("SURFACE_HEARTBEAT_FILE=$STATE_DIR/native-state/surface-heartbeat.json", supervisor)
        self.assertIn("surface_heartbeat_sha()", supervisor)
        self.assertIn('rendered_sha=$(surface_heartbeat_sha)', supervisor)
        self.assertIn('[ "$healthy_sha" = "$expected_sha" ] && [ "$rendered_sha" = "$expected_sha" ]', supervisor)
        self.assertIn("clear_surface_health()", supervisor)
        self.assertIn('snapshot.sourceSha !== renderedSourceSha', adapter)
        self.assertIn('JSON.stringify({ sourceSha: renderedSourceSha })', adapter)
        self.assertIn('update_state.get("sourceSha") != source_sha', host)
        self.assertIn("self._empty(409)", host)

    def test_live_reload_requires_surface_health_acknowledgement(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("HEALTH_FILE=$UPDATE_RUN_DIR/healthy-sha", text)
        self.assertIn("wait_for_surface_health", text)
        self.assertIn('wait_for_surface_health "$new_sha" "$SURFACE_HEALTH_TIMEOUT"', text)
        self.assertIn('wait_for_surface_health "$guard_current" "$SURFACE_HEALTH_TIMEOUT"', text)
        self.assertIn('rollback_update "$old_sha" "$new_sha" reload', text)
        self.assertIn('wait_for_surface_health "$new_sha" "$SURFACE_HEALTH_TIMEOUT"', text)
        self.assertIn('wait_for_surface_health "$new_sha" "$RELOAD_HEALTH_TIMEOUT"', text)
        self.assertIn("recover_reload_with_surface_restart()", text)
        self.assertIn('wait_for_surface_health "$expected_sha" "$RELOAD_FALLBACK_HEALTH_TIMEOUT"', text)
        self.assertIn("live reload health acknowledgement timed out; restarting Surface once", text)
        self.assertIn("Surface restart fallback acknowledged healthy state", text)
        self.assertIn("Surface did not acknowledge healthy state after reload and one Surface restart", text)
        recovery = text.split("recover_reload_with_surface_restart() {", 1)[1].split("\n}\n", 1)[0]
        self.assertEqual(recovery.count("stop_surface"), 1)
        self.assertEqual(recovery.count("start_surface"), 1)
        self.assertLess(
            text.index('recover_reload_with_surface_restart "$new_sha"'),
            text.index('rollback_update "$old_sha" "$new_sha" reload'),
        )
        self.assertIn("updated native Surface host did not render and acknowledge healthy state", text)
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
        self.assertIn("const DEFAULT_INTERVAL_MS = 750;", adapter)
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

    def test_stale_rendered_surface_heartbeat_recovers_once_without_restart_storm(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('SURFACE_STALE_SECONDS=${ORDAX_SURFACE_STALE_SECONDS:-90}', text)
        self.assertIn('[ "$SURFACE_STALE_SECONDS" -ge 45 ]', text)
        self.assertIn("surface_heartbeat_epoch()", text)
        self.assertIn("surface_heartbeat_is_fresh()", text)
        self.assertIn("surface_start_grace_active()", text)
        self.assertIn("recover_stale_surface_if_needed()", text)
        self.assertIn('expected_sha=$(read_state_value "$RUNTIME_SURFACE_SHA_FILE")', text)
        self.assertIn('[ "$rendered_sha" = "$expected_sha" ] || return 1', text)
        self.assertIn('SURFACE_STARTED_AT=$(epoch_now)', text)
        self.assertIn('SURFACE_STALE_RECOVERY_ARMED=0', text)
        self.assertIn('SURFACE_STALE_RECOVERY_ARMED=1', text)
        self.assertIn("Surface heartbeat stale or mismatched", text)
        self.assertIn('clear_surface_health', text)
        self.assertIn('stop_surface', text)
        self.assertIn('start_surface || fail_closed "Surface heartbeat recovery restart failed"', text)
        self.assertIn("recover_stale_surface_if_needed\n    check_for_update", text)

        recovery = text.split("recover_stale_surface_if_needed() {", 1)[1].split("\n}\n", 1)[0]
        self.assertEqual(recovery.count('stop_surface'), 1)
        self.assertEqual(recovery.count('start_surface'), 1)
        self.assertIn('[ "$SURFACE_STALE_RECOVERY_ARMED" -eq 1 ] || return 0', recovery)

    def test_runtime_surface_sha_tracks_only_runtime_effective_updates(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("RUNTIME_SURFACE_SHA_FILE=$STATE_DIR/runtime-surface-sha", text)
        self.assertIn("record_runtime_surface_sha()", text)
        self.assertIn('"runtimeSurfaceSha":"%s"', text)
        self.assertIn('record_runtime_surface_sha "$previous_sha"', text)
        self.assertGreaterEqual(text.count('record_runtime_surface_sha "$new_sha"'), 2)
        self.assertIn('record_runtime_surface_sha "$guard_current"', text)
        self.assertIn('record_runtime_surface_sha "$(current_sha)"', text)
        none_block = text.split('        none)\n', 1)[1].split('            ;;', 1)[0]
        self.assertNotIn("record_runtime_surface_sha", none_block)

    def test_update_state_carries_operator_visible_metadata(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('"targetSha":"%s"', text)
        self.assertIn('"phase":"%s"', text)
        self.assertIn('"attemptId":"%s"', text)
        self.assertIn('"checkedAt":"%s"', text)
        self.assertIn('"lastAppliedSha":"%s"', text)
        self.assertIn('"lastAppliedAt":"%s"', text)
        self.assertIn('"rejectedSha":"%s"', text)
        self.assertIn('"lastError":"%s"', text)
        self.assertIn("set_update_context()", text)
        self.assertIn("clear_update_context()", text)
        self.assertIn("record_applied", text)

    def test_update_transaction_phases_are_explicit_and_bounded(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('set_update_context fetching "$remote_sha" "$attempt_id" ""', text)
        self.assertIn('set_update_context validating "$new_sha" "$attempt_id" ""', text)
        self.assertIn('set_update_context health-wait "$new_sha" "$attempt_id" ""', text)
        self.assertIn('set_update_context activating "$new_sha" "$attempt_id" ""', text)
        self.assertIn('set_update_context rollback "$failed_sha" "$UPDATE_ATTEMPT_ID" "$reason"', text)
        self.assertIn('printf \'%s %s %s\\n\' "$old_sha" "$new_sha" "$attempt_id"', text)
        self.assertIn('guard_attempt=${3:-}', text)

    def test_update_center_surfaces_transaction_diagnostics(self):
        controls = UPDATE_CONTROLS.read_text(encoding="utf-8")
        self.assertIn("readablePhase", controls)
        self.assertIn("targetSha", controls)
        self.assertIn('"Tentativa"', controls)
        self.assertIn('"Diagnóstico"', controls)
        self.assertIn("lastError", controls)

    def test_guardian_owns_supervisor_lifetime_without_git_or_network(self):
        guardian = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        supervisor = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("SUPERVISOR=$SYSTEM_ROOT/supervisor", guardian)
        self.assertIn("ORDAX_SUPERVISOR_STALE_SECONDS:-120", guardian)
        self.assertIn('/bin/busybox stat -c %Y "$UPDATE_STATE"', guardian)
        self.assertIn("supervisor heartbeat stale", guardian)
        self.assertIn('exec "$SYSTEM_ENTRYPOINT"', guardian)
        self.assertIn("supervisor requested guardian refresh", guardian)
        self.assertNotIn("ls-remote", guardian)
        self.assertNotIn("fetch --no-tags", guardian)
        self.assertNotIn("reset --hard", guardian)
        self.assertNotIn("surface/entrypoint", guardian)
        self.assertIn("SURFACE_ENTRYPOINT=$SYSTEM_ROOT/surface/entrypoint", supervisor)

    def test_supervisor_updates_refresh_guardian_through_exit_75(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("system/entrypoint|system/supervisor)", text)
        self.assertIn("SUPERVISOR_SCRIPT=$SYSTEM_ROOT/supervisor", text)
        self.assertIn('/bin/sh -n "$SUPERVISOR_SCRIPT"', text)
        self.assertIn("asking guardian to restart supervisor without reboot", text)
        self.assertIn("exit 75", text)
        self.assertNotIn('exec "$SYSTEM_ENTRYPOINT"', text)

    def test_surface_launcher_is_gracefully_restartable(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn('GRAPHICS_PID=""', text)
        self.assertIn('terminate_child "$GRAPHICS_PID" "graphics host"', text)
        self.assertIn('kill -KILL "$pid"', text)
        self.assertIn('wait "$pid"', text)
        self.assertIn("trap terminate HUP INT TERM", text)
        self.assertIn("GRAPHICS_PID=$!", text)


if __name__ == "__main__":
    unittest.main()
