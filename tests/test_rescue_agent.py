from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / "system" / "rescue" / "agent.sh"
LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"


class RescueAgentContractTests(unittest.TestCase):
    def test_agent_is_shell_valid_and_provider_read_only(self):
        subprocess.run(["sh", "-n", str(AGENT)], check=True)
        text = AGENT.read_text(encoding="utf-8")
        self.assertIn('RESCUE_BRANCH=${ORDAX_RESCUE_BRANCH:-ordax-rescue}', text)
        self.assertIn('ls-remote --heads origin "refs/heads/$RESCUE_BRANCH"', text)
        self.assertIn('"refs/heads/$RESCUE_BRANCH:refs/remotes/origin/$RESCUE_BRANCH"', text)
        self.assertIn('"$rescue_sha:rescue/command.txt"', text)
        self.assertIn("GIT_TERMINAL_PROMPT=0", text)
        for forbidden in ("curl ", "wget ", "ssh ", "eval ", "source ", "sh -c"):
            self.assertNotIn(forbidden, text)

    def test_protocol_is_closed_and_target_bound_to_current_main(self):
        text = AGENT.read_text(encoding="utf-8")
        self.assertIn("ORDAX_RESCUE_COMMAND_V1", text)
        self.assertIn("noop|clear-rejected|retry-main", text)
        self.assertIn('remote_main_sha()', text)
        self.assertIn('if [ "$remote_sha" != "$target_sha" ]', text)
        self.assertIn('generation=', text)
        self.assertIn('target_sha=', text)
        self.assertNotIn("reset --hard", text)
        self.assertNotIn("checkout ", text)

    def test_retry_main_can_only_clear_rejection_and_cycle_surface(self):
        text = AGENT.read_text(encoding="utf-8")
        self.assertIn('rm -f "$REJECTED_FILE"', text)
        self.assertIn('find_surface_pid()', text)
        self.assertIn('kill "$surface_pid"', text)
        self.assertIn('$WORKTREE/system/surface/bin/ordax-surface', text)
        self.assertNotIn("/bin/busybox reboot", text)
        self.assertNotIn("/bin/busybox poweroff", text)

    def test_surface_copies_agent_into_persistent_state_and_does_not_own_its_lifetime(self):
        text = LAUNCHER.read_text(encoding="utf-8")
        self.assertIn("RESCUE_DIR=$STATE_ROOT/rescue", text)
        self.assertIn("RESCUE_AGENT=$RESCUE_DIR/agent.sh", text)
        self.assertIn('cp "$RESCUE_SOURCE" "$temporary"', text)
        self.assertIn('chmod 700 "$temporary"', text)
        self.assertIn('/bin/setsid "$RESCUE_AGENT"', text)
        self.assertNotIn('kill "$RESCUE_AGENT"', text)


if __name__ == "__main__":
    unittest.main()
