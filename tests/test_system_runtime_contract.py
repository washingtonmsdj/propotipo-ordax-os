import os
from pathlib import Path
import stat
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SYSTEM_ENTRYPOINT = ROOT / "system" / "entrypoint"
SYSTEM_SUPERVISOR = ROOT / "system" / "supervisor"
SURFACE_ENTRYPOINT = ROOT / "system" / "surface" / "entrypoint"
SURFACE_RUNTIME = ROOT / "system" / "surface" / "bin" / "ordax-surface"
NATIVE_HOST_SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
RESCUE_AGENT = ROOT / "system" / "rescue" / "agent.sh"
BASE_TELEMETRY_AGENT = ROOT / "system" / "services" / "telemetry" / "base-agent.sh"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native"


class SystemRuntimeContractTests(unittest.TestCase):
    def test_runtime_chain_exists_and_is_executable(self):
        for path in (SYSTEM_ENTRYPOINT, SURFACE_ENTRYPOINT, SURFACE_RUNTIME):
            self.assertTrue(path.is_file(), path)
            mode = stat.S_IMODE(path.stat().st_mode)
            self.assertEqual(mode, 0o755, f"{path} mode={mode:o}")
        self.assertTrue(SYSTEM_SUPERVISOR.is_file(), SYSTEM_SUPERVISOR)
        self.assertTrue(NATIVE_HOST_SERVER.is_file(), NATIVE_HOST_SERVER)
        self.assertTrue(RESCUE_AGENT.is_file(), RESCUE_AGENT)
        self.assertTrue(BASE_TELEMETRY_AGENT.is_file(), BASE_TELEMETRY_AGENT)
        self.assertTrue((NATIVE_COMPOSITION / "index.html").is_file())
        self.assertTrue((NATIVE_COMPOSITION / "main.mjs").is_file())

    def test_shell_syntax_is_valid(self):
        for path in (SYSTEM_ENTRYPOINT, SYSTEM_SUPERVISOR, SURFACE_ENTRYPOINT, SURFACE_RUNTIME, RESCUE_AGENT, BASE_TELEMETRY_AGENT):
            subprocess.run(["sh", "-n", str(path)], check=True)

    def test_native_host_user_folder_provisioning_is_fail_soft(self):
        text = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn("except OSError as exc:", text)
        self.assertIn("could not provision standard user directories", text)

    def test_native_host_server_python_syntax_is_valid(self):
        subprocess.run(
            ["python3", "-m", "py_compile", str(NATIVE_HOST_SERVER)],
            check=True,
        )

    def test_system_entrypoint_is_guardian_and_fail_closed(self):
        text = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        supervisor = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("SUPERVISOR=$SYSTEM_ROOT/supervisor", text)
        self.assertIn("/ordax/bootstrap/recovery/entrypoint", text)
        self.assertIn("start_supervisor()", text)
        self.assertIn("terminate_supervisor()", text)
        self.assertIn("supervisor heartbeat stale", text)
        self.assertIn("BASE_HEARTBEAT_FILE=$BASE_UPDATE_STATE_DIR/base-heartbeat.json", text)
        self.assertIn("BASE_BOOT_ID_FILE=$UPDATE_RUN_DIR/base-boot-id", text)
        self.assertIn("ensure_base_boot_id()", text)
        self.assertIn("/dev/urandom", text)
        self.assertIn("write_base_update_heartbeat()", text)
        self.assertIn("ordax.base_candidate", text)
        self.assertIn("ordax.base_slot", text)
        self.assertIn('"$schema":"prototype-ordax.base-heartbeat/1"', text)
        self.assertLess(
            text.index("write_base_update_heartbeat\n"),
            text.index("while :; do\n    start_supervisor"),
        )
        self.assertNotIn("surface/entrypoint", text)
        self.assertNotIn("ls-remote", text)
        self.assertNotIn("http://", text)
        self.assertNotIn("https://", text)
        self.assertIn("SURFACE_ENTRYPOINT=$SYSTEM_ROOT/surface/entrypoint", supervisor)

    def test_surface_entrypoint_owns_only_surface_handoff(self):
        text = SURFACE_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("bin/ordax-surface", text)
        self.assertIn("ORDAX_SURFACE_MODE=native-auto", text)
        for forbidden in ("curl ", "wget ", "udhcpc", "ssh ", "exec sh"):
            self.assertNotIn(forbidden, text)

    def test_native_surface_reuses_shared_surface_through_native_composition(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        native_main = (NATIVE_COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        self.assertIn("composition/native/index.html", text)
        self.assertNotIn("start_uri = http://127.0.0.1:8765/composition/web/index.html", text)
        self.assertIn("../../surface/ui/surface.mjs", native_main)
        self.assertIn("../../surface/ui/power-controls.mjs", native_main)
        self.assertIn("/usr/bin/cage", text)
        self.assertIn("/usr/bin/barkery", text)
        self.assertNotIn("/usr/bin/cog", text)
        self.assertIn("/usr/bin/seatd-launch", text)
        self.assertIn("/dev/dri/card0", text)
        self.assertIn("ORDAX_SURFACE_MODE=native-graphical", text)
        self.assertIn("127.0.0.1:8765", text)
        self.assertIn("console_fallback", text)
        for forbidden in ("curl ", "wget ", "udhcpc", "ssh ", "exec sh"):
            self.assertNotIn(forbidden, text)

    def test_native_graphical_runtime_is_provisioned_from_pulled_system(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("runtime/native-surface", text)
        self.assertIn("/sbin/apk --root", text)
        self.assertIn("--keys-dir /etc/apk/keys", text)
        self.assertIn("alpine/v3.22/main", text)
        self.assertIn("alpine/v3.22/community", text)
        self.assertIn("barkery-browser", text)
        self.assertIn("xwayland", text)
        self.assertIn("eudev", text)
        self.assertIn("libinput-udev", text)
        self.assertNotIn("\n        cog ", text)
        self.assertIn("/bin/busybox chroot", text)
        self.assertIn("mesa-dri-gallium", text)
        self.assertIn("$RUNTIME_ROOT/usr/bin/python3", text)
        self.assertIn("$RUNTIME_ROOT/usr/bin/Xwayland", text)
        self.assertIn("$RUNTIME_ROOT/sbin/udevd", text)
        self.assertIn("$RUNTIME_ROOT/bin/udevadm", text)

    def test_existing_runtime_is_extended_without_full_reprovision(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("runtime_base_is_ready", text)
        self.assertIn("upgrade_existing_runtime", text)
        self.assertIn("xwayland eudev libinput-udev", text)
        self.assertIn("extending existing graphical runtime with input discovery support", text)
        self.assertIn("RUNTIME_ID=alpine-v3.22-cage-barkery-v1", text)

    def test_native_browser_is_configured_for_local_shared_surface(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("/etc/barkery/barkery.conf", text)
        self.assertIn("start_uri = http://127.0.0.1:8765/composition/native/index.html?source=$SOURCE_SHA", text)
        self.assertIn('/usr/bin/git -C "$repo_root" rev-parse HEAD', text)
        self.assertIn("XDG_CACHE_HOME=/tmp/ordax-web-cache-$SOURCE_SHA", text)
        self.assertIn('mkdir -p "$RUNTIME_ROOT/tmp/ordax-web-cache-$SOURCE_SHA"', text)
        self.assertIn("GDK_BACKEND=wayland", text)
        self.assertIn("enabled = 0", text)

    def test_native_surface_bootstraps_persistent_base_telemetry_fail_soft(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("BASE_TELEMETRY_SOURCE=$SYSTEM_ROOT/services/telemetry/base-agent.sh", text)
        self.assertIn("BASE_TELEMETRY_DIR=$STATE_ROOT/telemetry", text)
        self.assertIn("ensure_base_telemetry_agent()", text)
        self.assertIn('/bin/setsid "$BASE_TELEMETRY_AGENT"', text)
        self.assertIn("base telemetry bootstrap failed; continuing Surface startup", text)
        self.assertNotIn('kill "$BASE_TELEMETRY_AGENT"', text)

    def test_native_surface_bootstraps_persistent_rescue_agent_fail_soft(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("RESCUE_SOURCE=$SYSTEM_ROOT/rescue/agent.sh", text)
        self.assertIn("RESCUE_DIR=$STATE_ROOT/rescue", text)
        self.assertIn("ensure_rescue_agent()", text)
        self.assertIn('/bin/setsid "$RESCUE_AGENT"', text)
        self.assertIn("rescue agent bootstrap failed; continuing Surface startup", text)
        self.assertNotIn('kill "$RESCUE', text)

    def test_native_surface_wires_fail_soft_telemetry_config(self):
        launcher = SURFACE_RUNTIME.read_text(encoding="utf-8")
        server = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn("--telemetry-config /srv/ordax-system/services/telemetry/relay.json", launcher)
        self.assertIn("start_telemetry_heartbeat", server)
        self.assertIn("telemetry heartbeat failed safely", server)
        self.assertIn("daemon=True", server)

    def test_native_surface_waits_for_http_and_watches_server_lifetime(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("wait_for_native_server()", text)
        self.assertIn('socket.create_connection(("127.0.0.1", 8765), 0.5)', text)
        self.assertIn('wait_for_native_server 10', text)
        self.assertIn("native HTTP/control server exited while graphics remained active", text)
        self.assertIn('kill -0 "$HTTP_PID"', text)

    def test_native_surface_server_is_runtime_owned_loopback_only_and_control_capable(self):
        launcher = SURFACE_RUNTIME.read_text(encoding="utf-8")
        server = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn('/bin/busybox mount -o bind "$SYSTEM_ROOT"', launcher)
        self.assertIn("$RUNTIME_ROOT/srv/ordax-system", launcher)
        self.assertIn("/usr/bin/python3 /srv/ordax-system/surface/runtime/native_host_server.py", launcher)
        self.assertIn("--bind 127.0.0.1", launcher)
        self.assertIn("--directory /srv/ordax-system", launcher)
        self.assertIn("/sbin/ip link set dev lo up", launcher)
        self.assertIn("/sbin/ip address replace 127.0.0.1/8 dev lo", launcher)
        self.assertNotIn("/usr/bin/python3 -m http.server", launcher)
        self.assertNotIn("/bin/busybox httpd", launcher)
        self.assertNotIn("--bind 0.0.0.0", launcher)
        self.assertIn('SESSION_PATH = "/__ordax/native/session"', server)
        self.assertIn('POWER_PATH = "/__ordax/native/power"', server)
        self.assertIn('TOKEN_HEADER = "X-OrdaX-Power-Token"', server)
        self.assertIn("secrets.token_urlsafe(32)", server)
        self.assertIn("POWER_REQUEST=$SESSION_DIR/power-request", launcher)
        self.assertIn("prepare_power_broker", launcher)
        self.assertIn('exec 9<>"$POWER_REQUEST"', launcher)
        self.assertIn('IFS= read -r action <&9', launcher)
        self.assertIn('/bin/busybox reboot -f', launcher)
        self.assertIn('/bin/busybox poweroff -f', launcher)
        self.assertIn("--power-request /run/ordax-surface/power-request", launcher)
        self.assertIn('DEFAULT_POWER_REQUEST_PATH = "/run/ordax-surface/power-request"', server)
        self.assertIn("queue_power_action", server)
        self.assertNotIn("subprocess.run(command", server)
        self.assertIn("self.client_address[0] != \"127.0.0.1\"", server)
        self.assertIn("hmac.compare_digest", server)
        self.assertIn("Deliberately no CORS headers", server)

    def test_native_restart_has_sync_and_kernel_fallback_without_weakening_shutdown(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("restart_host()", text)
        self.assertIn('echo "ordax-surface: attempting primary reboot syscall"', text)
        self.assertIn('/bin/busybox reboot -f', text)
        self.assertIn('/bin/busybox sync', text)
        self.assertIn('/proc/sysrq-trigger', text)
        self.assertIn("printf 'b' >/proc/sysrq-trigger", text)
        self.assertIn(
            "all host restart methods returned without rebooting",
            text,
        )
        self.assertIn('/bin/busybox poweroff -f', text)
        self.assertNotIn("restart_host || true\n                        shutdown", text)

    def test_power_actions_persist_cross_boot_proof_before_destructive_action(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("POWER_LAST_REQUEST=$POWER_STATE_DIR/last-request", text)
        self.assertIn("record_power_request()", text)
        self.assertIn("record_power_request restart pending", text)
        self.assertIn("record_power_request restart failed", text)
        self.assertIn("record_power_request shutdown pending", text)
        self.assertIn("record_power_request shutdown failed", text)
        self.assertIn("printf '%s|%s|%s|%s\\n'", text)
        self.assertIn('/bin/busybox sync', text)
        self.assertIn('host poweroff command returned without shutting down', text)
        self.assertLess(
            text.index("record_power_request restart pending"),
            text.index("if ! restart_host; then"),
        )
        self.assertLess(
            text.index("record_power_request shutdown pending"),
            text.index('/bin/busybox poweroff -f'),
        )

    def test_stale_same_boot_power_request_is_reconciled_as_failed(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("POWER_PENDING_STALE_SECONDS=120", text)
        self.assertIn("write_power_request_record()", text)
        self.assertIn("current_power_boot_id()", text)
        self.assertIn("reconcile_stale_power_request()", text)
        self.assertIn('[ "$request_boot_id" = "$current_boot_id" ] || return 0', text)
        self.assertIn(
            'write_power_request_record "$action" "$request_boot_id" "$request_epoch" failed',
            text,
        )
        self.assertIn(
            "different boot id is positive cross-boot evidence",
            text,
        )
        self.assertLess(
            text.index("reconcile_stale_power_request ||"),
            text.index("ensure_base_telemetry_agent ||"),
        )

    def test_graphical_runtime_receives_bounded_host_dns_configuration(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("sync_runtime_resolver()", text)
        self.assertIn("host_resolver=/etc/resolv.conf", text)
        self.assertIn("runtime_resolver=$RUNTIME_ROOT/etc/resolv.conf", text)
        self.assertIn("resolver_size=", text)
        self.assertIn("[ \"$resolver_size\" -gt 16384 ]", text)
        self.assertIn("/bin/busybox grep -Eq", text)
        self.assertIn("nameserver", text)
        self.assertIn('/bin/busybox mv -f "$temporary" "$runtime_resolver"', text)
        self.assertIn(
            "external DNS unavailable inside graphical runtime; continuing local Surface",
            text,
        )
        self.assertLess(
            text.index('ensure_runtime || fallback_with_reason'),
            text.index('sync_runtime_resolver ||'),
        )
        self.assertLess(
            text.index('sync_runtime_resolver ||'),
            text.index('ensure_base_update_agent ||'),
        )
        self.assertNotIn('mount -o bind /etc "$RUNTIME_ROOT/etc"', text)

    def test_wlroots_physical_prerequisites_are_prepared(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("ensure_shared_memory", text)
        self.assertIn("mkdir -p /dev/shm", text)
        self.assertIn("chmod 1777 /dev/shm", text)
        self.assertIn("failed to prepare /dev/shm for wlroots/Xwayland", text)
        self.assertIn("failed to configure IPv4 loopback for local Surface HTTP", text)

    def test_physical_input_is_classified_with_runtime_owned_eudev(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("prepare_input_stack", text)
        self.assertIn("/dev/input/event*", text)
        self.assertIn("/sbin/udevd --daemon", text)
        self.assertIn("/bin/udevadm control --reload-rules", text)
        self.assertIn("/bin/udevadm trigger --subsystem-match=input --action=add", text)
        self.assertIn("/bin/udevadm settle --timeout=5", text)
        self.assertIn("eudev input classification complete", text)
        self.assertNotIn("WLR_LIBINPUT_NO_DEVICES=1", text)
        self.assertIn("failed to prepare physical keyboard/touchpad input devices", text)

    def test_native_surface_restart_reaps_only_runtime_root_orphans(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("terminate_child()", text)
        self.assertIn("runtime_root_processes()", text)
        self.assertIn("reap_stale_runtime_processes()", text)
        self.assertIn("clear_stale_runtime_mounts()", text)
        self.assertIn('root_target=$(/bin/busybox readlink "$root_link"', text)
        self.assertIn('[ "$root_target" = "$RUNTIME_ROOT" ] || continue', text)
        self.assertIn('kill -KILL "$pid"', text)
        self.assertIn('terminate_child "$GRAPHICS_PID" "graphics host"', text)
        self.assertIn('terminate_child "$HTTP_PID" "native HTTP host"', text)
        self.assertLess(
            text.index("reap_stale_runtime_processes\nclear_stale_runtime_mounts"),
            text.index('ensure_runtime || fallback_with_reason'),
        )
        self.assertNotIn("pkill ", text)
        self.assertNotIn("killall ", text)

    def test_native_host_clears_only_stale_seatd_socket(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("SEATD_SOCKET=/run/seatd.sock", text)
        self.assertIn("seatd_process_running", text)
        self.assertIn("remove_stale_seatd_socket", text)
        self.assertIn("seatd path exists but is not a UNIX socket", text)
        self.assertIn("seatd socket is owned by a running seatd process; refusing to remove it", text)
        self.assertIn("removing stale seatd socket", text)
        self.assertIn("failed to clear stale seatd socket before native host startup", text)

    def test_native_surface_fallback_exposes_physical_diagnostics(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("fallback_with_reason", text)
        self.assertIn("Diagnostic:", text)
        self.assertIn("HTTP diagnostic:", text)
        self.assertIn("HTTP log:", text)
        self.assertIn("DRM device /dev/dri/card0 is unavailable", text)
        self.assertIn("graphical runtime is unavailable after provisioning attempt", text)
        self.assertIn("failed to bind host resources into graphical runtime", text)
        self.assertIn("native Surface HTTP/control server failed readiness check", text)
        self.assertIn("native Cage/Barkery host exited with status", text)


if __name__ == "__main__":
    unittest.main()
