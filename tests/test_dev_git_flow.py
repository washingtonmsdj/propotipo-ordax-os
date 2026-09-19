#!/usr/bin/env python3
"""End-to-end regressions for the owner development Git-first workflow."""

from __future__ import annotations

import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PULL = ROOT / "bootstrap/dev-base/ordax-pull"
ROLLBACK = ROOT / "bootstrap/dev-base/ordax-rollback"
RUN = ROOT / "bootstrap/dev-base/ordax-run"
DEV_INIT = ROOT / "bootstrap/dev-base/ordax-dev-init"
NETWORK = ROOT / "bootstrap/dev-base/ordax-network"


class DevelopmentGitFlowTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.remote = self.root / "origin.git"
        self.source = self.root / "source"
        self.worktree = self.root / "workspace/ordax"
        self.state = self.root / "state/ordax"

        self._run(["git", "init", "--bare", "--initial-branch=main", str(self.remote)])
        self._run(["git", "-C", str(self.remote), "config", "uploadpack.allowFilter", "true"])
        self._run(["git", "init", "--initial-branch=main", str(self.source)])
        self._run(["git", "-C", str(self.source), "config", "user.name", "OrdaX Test"])
        self._run(["git", "-C", str(self.source), "config", "user.email", "ordax-test@example.invalid"])
        self._run(["git", "-C", str(self.source), "remote", "add", "origin", self.remote.as_uri()])

        self.commit_v1 = self._commit_runtime("runtime-v1")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _run(
        self,
        argv: list[str],
        *,
        env: dict[str, str] | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            argv,
            check=check,
            capture_output=True,
            text=True,
            env=env,
        )

    def _commit_runtime(self, marker: str) -> str:
        system = self.source / "system"
        docs = self.source / "docs"
        system.mkdir(parents=True, exist_ok=True)
        docs.mkdir(parents=True, exist_ok=True)
        entrypoint = system / "entrypoint"
        entrypoint.write_text(f"#!/bin/sh\nprintf '%s\\n' '{marker}'\n", encoding="utf-8")
        entrypoint.chmod(entrypoint.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        (docs / "not-runtime.txt").write_text(marker + "\n", encoding="utf-8")

        trust = self.source / "bootstrap/trust/release-ed25519.json"
        trust.parent.mkdir(parents=True, exist_ok=True)
        trust.write_text('{"public":"fixture"}\n', encoding="utf-8")
        channel = self.source / "bootstrap/config/release-envelope-url"
        channel.parent.mkdir(parents=True, exist_ok=True)
        channel.write_text(
            "https://example.invalid/release-envelope.json\n",
            encoding="ascii",
        )
        contracts = docs / "contracts"
        contracts.mkdir(parents=True, exist_ok=True)
        (contracts / "release-trust-policy.json").write_text(
            '{"policy":"fixture"}\n',
            encoding="utf-8",
        )
        (contracts / "minimal-bootstrap.json").write_text(
            '{"bootstrap":"fixture"}\n',
            encoding="utf-8",
        )
        (contracts / "base-update.json").write_text(
            '{"base_update":"fixture"}\n',
            encoding="utf-8",
        )
        base_update = self.source / "bootstrap/base-update"
        base_update.mkdir(parents=True, exist_ok=True)
        for name in ("plan.py", "stage.py", "activate.py", "promote.py"):
            script = base_update / name
            script.write_text(
                f"# fixture {name} for {marker}\n",
                encoding="utf-8",
            )
        dev_base = self.source / "bootstrap/dev-base"
        dev_base.mkdir(parents=True, exist_ok=True)
        for name in (
            "ordax-dev-init",
            "ordax-network",
            "ordax-pull",
            "ordax-rollback",
            "ordax-run",
        ):
            script = dev_base / name
            script.write_text(
                f"#!/bin/sh\nprintf '%s\\n' 'fixture {name} {marker}'\n",
                encoding="utf-8",
            )
            script.chmod(0o755)
        recovery = self.source / "bootstrap/recovery/entrypoint"
        recovery.parent.mkdir(parents=True, exist_ok=True)
        recovery.write_text(
            f"#!/bin/sh\nprintf '%s\\n' 'fixture recovery {marker}'\n",
            encoding="utf-8",
        )
        recovery.chmod(0o755)
        evidence = docs / "evidence"
        evidence.mkdir(parents=True, exist_ok=True)
        for name in (
            "release-trust-ceremony.json",
            "release-trust-proof-manifest.json",
            "release-trust-recovery-envelope.json",
        ):
            (evidence / name).write_text(
                '{"evidence":"fixture"}\n',
                encoding="utf-8",
            )

        self._run(["git", "-C", str(self.source), "add", "system", "docs", "bootstrap"])
        self._run(["git", "-C", str(self.source), "commit", "-m", marker])
        self._run(["git", "-C", str(self.source), "push", "origin", "main"])
        return self._run(
            ["git", "-C", str(self.source), "rev-parse", "HEAD"]
        ).stdout.strip()

    def _env(self) -> dict[str, str]:
        env = os.environ.copy()
        env.update(
            {
                "ORDAX_REPO_URL": self.remote.as_uri(),
                "ORDAX_REPO_BRANCH": "main",
                "ORDAX_WORKTREE": str(self.worktree),
                "ORDAX_STATE_DIR": str(self.state),
            }
        )
        return env

    def _script(
        self,
        script: Path,
        *,
        env: dict[str, str] | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        return self._run(["/bin/sh", str(script)], env=env or self._env(), check=check)

    def test_clone_pull_rollback_pin_and_explicit_unpin(self) -> None:
        first = self._script(PULL)
        self.assertIn(self.commit_v1, first.stdout)
        self.assertEqual(
            self._run(["git", "-C", str(self.worktree), "rev-parse", "HEAD"]).stdout.strip(),
            self.commit_v1,
        )
        sparse_paths = set(
            self._run(
                ["git", "-C", str(self.worktree), "sparse-checkout", "list"]
            ).stdout.splitlines()
        )
        self.assertEqual(
            sparse_paths,
            {
                "/system/",
                "/bootstrap/base-update/",
                "/bootstrap/dev-base/ordax-dev-init",
                "/bootstrap/dev-base/ordax-network",
                "/bootstrap/dev-base/ordax-pull",
                "/bootstrap/dev-base/ordax-rollback",
                "/bootstrap/dev-base/ordax-run",
                "/bootstrap/recovery/entrypoint",
                "/bootstrap/trust/",
                "/bootstrap/config/release-envelope-url",
                "/docs/contracts/base-update.json",
                "/docs/contracts/release-trust-policy.json",
                "/docs/contracts/minimal-bootstrap.json",
                "/docs/evidence/release-trust-ceremony.json",
                "/docs/evidence/release-trust-proof-manifest.json",
                "/docs/evidence/release-trust-recovery-envelope.json",
            },
        )
        self.assertTrue((self.worktree / "system/entrypoint").is_file())
        self.assertTrue(
            (self.worktree / "bootstrap/trust/release-ed25519.json").is_file()
        )
        self.assertTrue(
            (self.worktree / "bootstrap/config/release-envelope-url").is_file()
        )
        self.assertTrue(
            (self.worktree / "bootstrap/base-update/stage.py").is_file()
        )
        self.assertTrue(
            (self.worktree / "bootstrap/base-update/activate.py").is_file()
        )
        for helper in (
            "bootstrap/dev-base/ordax-dev-init",
            "bootstrap/dev-base/ordax-network",
            "bootstrap/dev-base/ordax-pull",
            "bootstrap/dev-base/ordax-rollback",
            "bootstrap/dev-base/ordax-run",
            "bootstrap/recovery/entrypoint",
        ):
            self.assertTrue((self.worktree / helper).is_file(), helper)
        self.assertTrue(
            (self.worktree / "docs/contracts/base-update.json").is_file()
        )
        self.assertTrue(
            (self.worktree / "docs/contracts/release-trust-policy.json").is_file()
        )
        self.assertTrue(
            (self.worktree / "docs/contracts/minimal-bootstrap.json").is_file()
        )
        self.assertTrue(
            (self.worktree / "docs/evidence/release-trust-ceremony.json").is_file()
        )
        self.assertFalse((self.worktree / "docs/not-runtime.txt").exists())
        self.assertEqual((self.state / "current-commit").read_text().strip(), self.commit_v1)
        self.assertFalse((self.state / "previous-commit").exists())
        self.assertFalse((self.state / "pinned-commit").exists())

        self.commit_v2 = self._commit_runtime("runtime-v2")
        self._script(PULL)
        self.assertEqual((self.state / "previous-commit").read_text().strip(), self.commit_v1)
        self.assertEqual((self.state / "current-commit").read_text().strip(), self.commit_v2)

        rollback = self._script(ROLLBACK)
        self.assertIn(f"ORDAX_ROLLBACK_SHA={self.commit_v1}", rollback.stdout)
        self.assertIn(f"ORDAX_PINNED_SHA={self.commit_v1}", rollback.stdout)
        self.assertEqual((self.state / "pinned-commit").read_text().strip(), self.commit_v1)
        self.assertEqual(
            self._run(["git", "-C", str(self.worktree), "rev-parse", "HEAD"]).stdout.strip(),
            self.commit_v1,
        )
        self.assertIn("runtime-v1", self._script(RUN).stdout)

        # A boot while pinned must not touch network/pull and must run the pinned checkout.
        # The real dev-base builder installs these scripts as executable files. Mirror that
        # installation boundary here instead of relying on the source-tree executable bit.
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        (bin_dir / "ordax-run").write_text(
            f"#!/bin/sh\nexec /bin/sh '{RUN}'\n", encoding="utf-8"
        )
        network_marker = self.root / "network-called"
        pull_marker = self.root / "pull-called"
        (bin_dir / "ordax-network").write_text(
            f"#!/bin/sh\ntouch '{network_marker}'\nexit 99\n", encoding="utf-8"
        )
        (bin_dir / "ordax-pull").write_text(
            f"#!/bin/sh\ntouch '{pull_marker}'\nexit 99\n", encoding="utf-8"
        )
        for path in (bin_dir / "ordax-run", bin_dir / "ordax-network", bin_dir / "ordax-pull"):
            path.chmod(0o755)

        boot_env = self._env()
        boot_env.update(
            {
                "ORDAX_BIN_DIR": str(bin_dir),
                "ORDAX_WORKSPACE_DIR": str(self.worktree.parent),
                "ORDAX_NETWORK_STATE_DIR": str(self.root / "state/network"),
            }
        )
        boot = self._script(DEV_INIT, env=boot_env)
        self.assertIn("Rollback fixado", boot.stdout)
        self.assertIn("runtime-v1", boot.stdout)
        self.assertNotIn("OrdaX fixado encerrou ou falhou", boot.stdout)
        self.assertFalse(pull_marker.exists())

        # The explicit pull is the only normal action that releases the sticky rollback.
        self._script(PULL)
        self.assertFalse((self.state / "pinned-commit").exists())
        self.assertEqual((self.state / "current-commit").read_text().strip(), self.commit_v2)
        self.assertEqual(
            self._run(["git", "-C", str(self.worktree), "rev-parse", "HEAD"]).stdout.strip(),
            self.commit_v2,
        )

    def test_failed_boot_rolls_back_without_putting_remote_update_on_boot_path(self) -> None:
        self._script(PULL)
        self.commit_v2 = self._commit_runtime("runtime-v2")
        self._script(PULL)

        bin_dir = self.root / "auto-recovery-bin"
        bin_dir.mkdir()
        network_marker = self.root / "auto-network-called"
        pull_marker = self.root / "auto-pull-called"
        (bin_dir / "ordax-network").write_text(
            f"#!/bin/sh\ntouch '{network_marker}'\nexit 0\n",
            encoding="utf-8",
        )
        (bin_dir / "ordax-pull").write_text(
            f"#!/bin/sh\ntouch '{pull_marker}'\nexec /bin/sh '{PULL}'\n",
            encoding="utf-8",
        )
        (bin_dir / "ordax-rollback").write_text(
            f"#!/bin/sh\nexec /bin/sh '{ROLLBACK}'\n",
            encoding="utf-8",
        )
        (bin_dir / "ordax-run").write_text(
            "#!/bin/sh\n"
            "if grep -q runtime-v2 \"$ORDAX_WORKTREE/system/entrypoint\"; then\n"
            "  exit 42\n"
            "fi\n"
            "exec /bin/sh \"$ORDAX_WORKTREE/system/entrypoint\"\n",
            encoding="utf-8",
        )
        for helper in bin_dir.iterdir():
            helper.chmod(0o755)

        boot_env = self._env()
        boot_env.update(
            {
                "ORDAX_BIN_DIR": str(bin_dir),
                "ORDAX_WORKSPACE_DIR": str(self.worktree.parent),
                "ORDAX_NETWORK_STATE_DIR": str(self.root / "state/network"),
            }
        )

        recovered = self._script(DEV_INIT, env=boot_env)
        self.assertIn("Boot rapido", recovered.stdout)
        self.assertIn("Rollback automatico ativado", recovered.stdout)
        self.assertIn("runtime-v1", recovered.stdout)
        self.assertEqual((self.state / "boot-rejected-commit").read_text().strip(), self.commit_v2)
        self.assertEqual((self.state / "pinned-commit").read_text().strip(), self.commit_v1)
        self.assertFalse(pull_marker.exists())
        self.assertEqual(
            self._run(["git", "-C", str(self.worktree), "rev-parse", "HEAD"]).stdout.strip(),
            self.commit_v1,
        )

        # Even when main advances, the next boot must stay fast/local. The
        # running supervisor owns the automatic unpin/retry after connectivity.
        self._commit_runtime("runtime-v3")
        pinned_boot = self._script(DEV_INIT, env=boot_env)
        self.assertIn("Rollback fixado", pinned_boot.stdout)
        self.assertIn("runtime-v1", pinned_boot.stdout)
        self.assertFalse(pull_marker.exists())
        self.assertTrue((self.state / "boot-rejected-commit").exists())
        self.assertTrue((self.state / "pinned-commit").exists())

    def test_healthy_local_checkout_starts_before_network_or_git_update(self) -> None:
        self._script(PULL)

        bin_dir = self.root / "fast-boot-bin"
        bin_dir.mkdir()
        pull_marker = self.root / "fast-pull-called"
        (bin_dir / "ordax-network").write_text(
            "#!/bin/sh\nsleep 1\nexit 0\n",
            encoding="utf-8",
        )
        (bin_dir / "ordax-pull").write_text(
            f"#!/bin/sh\ntouch '{pull_marker}'\nexit 99\n",
            encoding="utf-8",
        )
        (bin_dir / "ordax-run").write_text(
            f"#!/bin/sh\nexec /bin/sh '{RUN}'\n",
            encoding="utf-8",
        )
        (bin_dir / "ordax-rollback").write_text(
            f"#!/bin/sh\nexec /bin/sh '{ROLLBACK}'\n",
            encoding="utf-8",
        )
        for helper in bin_dir.iterdir():
            helper.chmod(0o755)

        env = self._env()
        env.update(
            {
                "ORDAX_BIN_DIR": str(bin_dir),
                "ORDAX_WORKSPACE_DIR": str(self.worktree.parent),
                "ORDAX_NETWORK_STATE_DIR": str(self.root / "state/network"),
            }
        )
        result = self._script(DEV_INIT, env=env)

        self.assertIn("Checkout local saudavel", result.stdout)
        self.assertIn("Boot rapido", result.stdout)
        self.assertIn("runtime-v1", result.stdout)
        self.assertFalse(pull_marker.exists())
        boot_metrics = (self.state / "boot-last.tsv").read_text(encoding="utf-8")
        self.assertTrue(boot_metrics.startswith("fast-local\t"))

    def test_seed_boot_does_not_require_or_create_version_store(self) -> None:
        self._script(PULL)

        bin_dir = self.root / "seed-boot-bin"
        bin_dir.mkdir()
        (bin_dir / "ordax-network").write_text(
            "#!/bin/sh\nexit 0\n",
            encoding="utf-8",
        )
        (bin_dir / "ordax-run").write_text(
            f"#!/bin/sh\nexec /bin/sh '{RUN}'\n",
            encoding="utf-8",
        )
        (bin_dir / "ordax-rollback").write_text(
            f"#!/bin/sh\nexec /bin/sh '{ROLLBACK}'\n",
            encoding="utf-8",
        )
        for helper in bin_dir.iterdir():
            helper.chmod(0o755)

        versions = self.root / "versions"
        cmdline = self.root / "cmdline"
        cmdline.write_text("quiet splash\n", encoding="utf-8")
        env = self._env()
        env.update(
            {
                "ORDAX_BIN_DIR": str(bin_dir),
                "ORDAX_WORKSPACE_DIR": str(self.worktree.parent),
                "ORDAX_NETWORK_STATE_DIR": str(self.root / "state/network"),
                "ORDAX_DEV_VERSION_ROOT": str(versions),
                "ORDAX_CMDLINE_FILE": str(cmdline),
            }
        )

        result = self._script(DEV_INIT, env=env)

        self.assertIn("runtime-v1", result.stdout)
        self.assertFalse(versions.exists())

    def test_unmapped_ab_slot_falls_back_to_seed_rootfs(self) -> None:
        self._script(PULL)

        bin_dir = self.root / "slot-fallback-bin"
        bin_dir.mkdir()
        (bin_dir / "ordax-network").write_text(
            "#!/bin/sh\nexit 0\n",
            encoding="utf-8",
        )
        (bin_dir / "ordax-run").write_text(
            f"#!/bin/sh\nexec /bin/sh '{RUN}'\n",
            encoding="utf-8",
        )
        (bin_dir / "ordax-rollback").write_text(
            f"#!/bin/sh\nexec /bin/sh '{ROLLBACK}'\n",
            encoding="utf-8",
        )
        for helper in bin_dir.iterdir():
            helper.chmod(0o755)

        versions = self.root / "versions"
        cmdline = self.root / "cmdline"
        cmdline.write_text("quiet ordax.base_slot=a\n", encoding="utf-8")
        env = self._env()
        env.update(
            {
                "ORDAX_BIN_DIR": str(bin_dir),
                "ORDAX_WORKSPACE_DIR": str(self.worktree.parent),
                "ORDAX_NETWORK_STATE_DIR": str(self.root / "state/network"),
                "ORDAX_DEV_VERSION_ROOT": str(versions),
                "ORDAX_CMDLINE_FILE": str(cmdline),
            }
        )

        result = self._script(DEV_INIT, env=env)

        self.assertIn("runtime-v1", result.stdout)
        self.assertTrue(versions.is_dir())
        self.assertFalse((self.state / "base-update/rootfs/slot-a").exists())

    def test_bootstrap_network_and_git_fail_soft_but_bounded(self) -> None:
        network = NETWORK.read_text(encoding="utf-8")
        pull = PULL.read_text(encoding="utf-8")
        dev_init = DEV_INIT.read_text(encoding="utf-8")

        self.assertIn("if ! sync_clock; then", network)
        self.assertIn("continuando com IP disponivel", network)
        self.assertIn('CLOCK_SYNC_TIMEOUT=${ORDAX_CLOCK_SYNC_TIMEOUT_SECONDS:-5}', network)
        self.assertIn('DHCP_TIMEOUT=${ORDAX_DHCP_TIMEOUT_SECONDS:-6}', network)
        self.assertIn('WIFI_LINK_TIMEOUT=${ORDAX_WIFI_LINK_TIMEOUT_SECONDS:-8}', network)
        self.assertIn('/bin/busybox timeout -k 1 "$CLOCK_SYNC_TIMEOUT"', network)
        self.assertIn('/bin/busybox timeout -k 1 "$DHCP_TIMEOUT"', network)
        self.assertIn('[ "$carrier" = 1 ] || continue', network)
        self.assertIn('while [ "$attempts" -lt "$WIFI_LINK_TIMEOUT" ]', network)
        finish_network = network.split("finish_network() {", 1)[1].split("\\n}", 1)[0]
        self.assertIn("return 0", finish_network)

        self.assertIn('GIT_TIMEOUT_SECONDS=${ORDAX_BOOT_GIT_TIMEOUT_SECONDS:-45}', pull)
        self.assertIn('GIT_LOW_SPEED_TIME=${ORDAX_BOOT_GIT_LOW_SPEED_SECONDS:-15}', pull)
        self.assertIn("GIT_TERMINAL_PROMPT=0", pull)
        self.assertIn('timeout -k 5 "$GIT_TIMEOUT_SECONDS"', pull)
        self.assertIn("run_bounded_git clone", pull)
        self.assertIn("remote_main_sha()", pull)
        self.assertIn("replace_runtime_checkout()", pull)
        self.assertIn('STAGING_PREFIX=$WORKSPACE_ROOT/.ordax-staging', pull)
        self.assertIn('RETIRED_PREFIX=$WORKSPACE_ROOT/.ordax-retired', pull)
        self.assertIn('mv "$stage" "$WORKTREE"', pull)
        self.assertNotIn('pull --ff-only', pull)

        self.assertIn('BOOT_PULL_ATTEMPTS=${ORDAX_BOOT_PULL_ATTEMPTS:-2}', dev_init)
        self.assertIn("BOOT_REJECTED_FILE=$STATE_DIR/boot-rejected-commit", dev_init)
        self.assertIn("BOOT_METRICS_FILE=$STATE_DIR/boot-last.tsv", dev_init)
        self.assertIn("local_checkout_bootable()", dev_init)
        self.assertIn("start_network_background()", dev_init)
        self.assertIn("record_boot_handoff()", dev_init)
        self.assertIn("recover_previous_checkout()", dev_init)
        self.assertIn("Boot rapido: rede e atualizacoes iniciam em paralelo.", dev_init)
        self.assertLess(
            dev_init.index("if local_checkout_bootable; then"),
            dev_init.index("network_ok=0"),
        )
        fast_block = dev_init.split("if local_checkout_bootable; then", 1)[1].split(
            "Primeiro boot ou checkout local inconsistente",
            1,
        )[0]
        self.assertNotIn("ordax-pull", fast_block)
        self.assertIn('while [ "$attempt" -le "$BOOT_PULL_ATTEMPTS" ]', dev_init)
        self.assertIn("repetindo uma vez apos pausa curta", dev_init)
        self.assertIn("sleep 2", dev_init)

    def test_pull_replaces_dirty_or_invalid_runtime_checkout_atomically(self) -> None:
        self._script(PULL)

        entrypoint = self.worktree / "system/entrypoint"
        entrypoint.write_text("#!/bin/sh\nprintf '%s\\n' 'locally-corrupted'\n", encoding="utf-8")
        dirty = self.worktree / "system/local-change.txt"
        dirty.write_text("local\n", encoding="utf-8")

        self.commit_v2 = self._commit_runtime("runtime-v2")
        result = self._script(PULL)

        self.assertIn("checkout local alterado", result.stderr)
        self.assertIn("substituindo cache por clone limpo validado", result.stderr)
        self.assertIn("checkout atomico ativado", result.stdout)
        self.assertFalse(dirty.exists())
        self.assertIn("runtime-v2", entrypoint.read_text(encoding="utf-8"))
        self.assertEqual(
            self._run(["git", "-C", str(self.worktree), "status", "--porcelain"]).stdout,
            "",
        )
        self.assertEqual(
            (self.state / "current-commit").read_text().strip(),
            self.commit_v2,
        )
        diagnostic = self.state / "dirty-checkout/last-status.txt"
        patch = self.state / "dirty-checkout/last-tracked-changes.patch"
        self.assertTrue(diagnostic.is_file())
        self.assertIn("system/entrypoint", diagnostic.read_text(encoding="utf-8"))
        self.assertIn("system/local-change.txt", diagnostic.read_text(encoding="utf-8"))
        self.assertTrue(patch.is_file())
        self.assertIn("locally-corrupted", patch.read_text(encoding="utf-8"))

        # Even broken local Git metadata is disposable. A valid remote is cloned
        # and swapped into place only after validation.
        self._run(
            [
                "git",
                "-C",
                str(self.worktree),
                "remote",
                "set-url",
                "origin",
                (self.root / "unexpected.git").as_uri(),
            ]
        )
        result = self._script(PULL)
        self.assertIn("checkout ausente ou inconsistente", result.stderr)
        self.assertEqual(
            self._run(["git", "-C", str(self.worktree), "remote", "get-url", "origin"]).stdout.strip(),
            self.remote.as_uri(),
        )
        self.assertEqual(
            self._run(["git", "-C", str(self.worktree), "rev-parse", "HEAD"]).stdout.strip(),
            self.commit_v2,
        )

    def test_remote_failure_preserves_last_local_checkout(self) -> None:
        self._script(PULL)
        before = self._run(["git", "-C", str(self.worktree), "rev-parse", "HEAD"]).stdout.strip()
        marker = self.worktree / "system/local-only.txt"
        marker.write_text("keep-me\n", encoding="utf-8")

        env = self._env()
        env["ORDAX_REPO_URL"] = (self.root / "offline.git").as_uri()
        result = self._script(PULL, env=env, check=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("main remota indisponivel", result.stderr)
        self.assertTrue(marker.is_file())
        self.assertEqual(
            self._run(["git", "-C", str(self.worktree), "rev-parse", "HEAD"]).stdout.strip(),
            before,
        )


if __name__ == "__main__":
    unittest.main()
