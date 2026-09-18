#!/usr/bin/env python3
"""Regress the autonomous low-level base-update runtime owner boundary."""

import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "system" / "services" / "base-update" / "orchestrator.py"
AGENT = ROOT / "system" / "services" / "base-update" / "agent.sh"
SURFACE = ROOT / "system" / "surface" / "bin" / "ordax-surface"

spec = importlib.util.spec_from_file_location("ordax_base_update_owner_test", MODULE_PATH)
owner = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(owner)


def write_json(path: Path, value: dict) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(value, indent=2) + "\n").encode("utf-8")
    path.write_bytes(payload)
    return payload


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


class BaseUpdateRuntimeOwnerTests(unittest.TestCase):
    def fixture(self, root: Path, promoted: bool = True):
        repo = root / "repo"
        state = root / "state"
        physical = root / "physical"
        repo.mkdir()
        state.mkdir()
        (physical / "bootstrap").mkdir(parents=True)

        fixture_agent_bytes = b"fixture-current-materialize-agent"
        fixture_agent = physical / "bootstrap/release-acquisition/ordax-release-agent"
        fixture_agent.parent.mkdir(parents=True)
        fixture_agent.write_bytes(fixture_agent_bytes)
        fixture_agent.chmod(0o755)
        fixture_agent_sha = sha256(fixture_agent_bytes)
        write_json(
            repo / "system/services/base-update/release-agent-refresh.json",
            {
                "$schema": "prototype-ordax.release-agent-refresh/1",
                "status": "development-git-migration",
                "component": "bootstrap-release-acquisition",
                "artifact": "ordax-release-agent",
                "allowed_from_sha256": [sha256(b"fixture-legacy-agent")],
                "target_sha256": fixture_agent_sha,
                "target_size": len(fixture_agent_bytes),
                "download_url": (
                    "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/"
                    f"ordax-release-agent-{fixture_agent_sha}/ordax-release-agent"
                ),
                "target_path": "/ordax/bootstrap/release-acquisition/ordax-release-agent",
                "mode": "0755",
                "physical_media_rewrite_required": False,
                "raw_device_write_allowed": False,
                "unknown_installed_hash_policy": "block",
                "replacement": "same-directory-temp-fsync-atomic-replace",
            },
        )

        if not promoted:
            policy = {
                "$schema": "prototype-ordax.release-trust-policy/1",
                "status": "policy-resolved-key-material-pending",
                "canonical_key_id": "ordax-prototype-release-v1",
                "gates": {
                    "key_material_generated": False,
                    "public_anchor_pinned": False,
                    "minimal_bootstrap_resolved": False,
                    "physical_authorization_eligible": False,
                },
            }
            minimal = {
                "$schema": "prototype-ordax.minimal-bootstrap/4",
                "status": "candidate-bytes-resolved-trust-pending",
                "physical_write_allowed": False,
                "all_artifacts_resolved": False,
                "artifact_groups": [],
            }
            write_json(repo / "docs/contracts/release-trust-policy.json", policy)
            write_json(repo / "docs/contracts/minimal-bootstrap.json", minimal)
            return repo, state, physical, None

        trust = {
            "$schema": "prototype-ordax.release-trust/1",
            "key_id": "ordax-prototype-release-v1",
            "public_key_base64": base64.b64encode(bytes(range(32))).decode("ascii"),
        }
        trust_bytes = write_json(repo / "bootstrap/trust/release-ed25519.json", trust)
        trust_sha = sha256(trust_bytes)

        evidence_paths = {}
        for relative, payload in (
            ("docs/evidence/release-trust-ceremony.json", b'{"evidence":true}\n'),
            ("docs/evidence/release-trust-proof-manifest.json", b'{"proof":true}\n'),
            ("docs/evidence/release-trust-recovery-envelope.json", b'{"envelope":true}\n'),
        ):
            path = repo / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
            evidence_paths[relative] = sha256(payload)

        policy = {
            "$schema": "prototype-ordax.release-trust-policy/1",
            "status": "canonical-public-trust-pinned",
            "canonical_key_id": "ordax-prototype-release-v1",
            "public_anchor": {
                "sha256": trust_sha,
                "ceremony_evidence_repository_path": "docs/evidence/release-trust-ceremony.json",
                "ceremony_evidence_sha256": evidence_paths[
                    "docs/evidence/release-trust-ceremony.json"
                ],
                "proof_manifest_repository_path": "docs/evidence/release-trust-proof-manifest.json",
                "proof_manifest_sha256": evidence_paths[
                    "docs/evidence/release-trust-proof-manifest.json"
                ],
                "recovery_envelope_repository_path": "docs/evidence/release-trust-recovery-envelope.json",
                "recovery_envelope_sha256": evidence_paths[
                    "docs/evidence/release-trust-recovery-envelope.json"
                ],
            },
            "gates": {
                "key_material_generated": True,
                "public_anchor_pinned": True,
                "minimal_bootstrap_resolved": True,
                "physical_authorization_eligible": True,
            },
        }
        write_json(repo / "docs/contracts/release-trust-policy.json", policy)

        minimal = {
            "$schema": "prototype-ordax.minimal-bootstrap/4",
            "status": "canonical-bytes-resolved",
            "physical_write_allowed": False,
            "all_artifacts_resolved": True,
            "artifact_groups": [
                {
                    "id": "kernel",
                    "resolved": True,
                    "artifacts": [{"source_path": "bootstrap/kernel/vmlinuz"}],
                },
                {
                    "id": "bootstrap-release-trust",
                    "resolved": True,
                    "artifacts": [
                        {
                            "source_path": "bootstrap/trust/release-ed25519.json",
                            "target_path": "/ordax/bootstrap/trust/release-ed25519.json",
                            "sha256": trust_sha,
                            "mode": "0644",
                        }
                    ],
                },
            ],
        }
        write_json(repo / "docs/contracts/minimal-bootstrap.json", minimal)
        return repo, state, physical, trust_bytes

    def test_pending_repository_trust_keeps_owner_dormant(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo, state, physical, _trust = self.fixture(Path(temporary), promoted=False)

            status = owner.run_once(
                repo,
                state,
                physical,
                "a" * 40,
            )

            self.assertEqual(status["status"], "blocked")
            self.assertEqual(status["blocker"], "canonical-trust-not-pinned")
            self.assertEqual(status["releaseAgentRefreshState"], "already-current")
            self.assertTrue(status["releaseAgentSha256"])
            self.assertFalse(status["canonicalTrustPinned"])
            self.assertFalse(status["physicalTrustEnrolled"])
            self.assertFalse(status["kernelStaged"])
            self.assertFalse(status["candidateArmed"])
            self.assertFalse(status["rebootRequested"])
            self.assertFalse(status["promotionAttempted"])
            self.assertFalse(
                (physical / "bootstrap/trust/release-ed25519.json").exists()
            )

    def test_promoted_public_trust_is_enrolled_exactly_and_idempotently(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo, state, physical, trust_bytes = self.fixture(Path(temporary))

            first = owner.run_once(repo, state, physical, "b" * 40)
            second = owner.run_once(repo, state, physical, "b" * 40)

            target = physical / "bootstrap/trust/release-ed25519.json"
            self.assertEqual(target.read_bytes(), trust_bytes)
            self.assertTrue(first["physicalTrustEnrolled"])
            self.assertEqual(first["trustEnrollmentState"], "enrolled")
            self.assertEqual(second["trustEnrollmentState"], "already-enrolled")
            self.assertEqual(first["phase"], "no-base-update-pending")
            self.assertEqual(first["releaseMaterializationState"], "not-required")
            self.assertFalse(first["signedReleaseMaterialized"])
            self.assertFalse(first["rebootRequested"])
            persisted = json.loads(
                (state / "base-update/owner-status.json").read_text(encoding="utf-8")
            )
            self.assertEqual(persisted["sourceSha"], "b" * 40)
            self.assertTrue(persisted["physicalTrustEnrolled"])

    def test_pending_base_update_materializes_exact_current_signed_release_without_activation(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = "f" * 40
            repo, state, physical, _trust = self.fixture(Path(temporary))
            (state / "boot-refresh-required").write_text(source + "\n", encoding="ascii")

            channel = physical / "bootstrap/config/release-envelope-url"
            channel.parent.mkdir(parents=True, exist_ok=True)
            channel.write_text(
                "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/latest/download/release-envelope.json\n",
                encoding="ascii",
            )
            old = "a" * 40
            (physical / "releases" / old).mkdir(parents=True)
            (physical / "current").symlink_to(Path("releases") / old)
            expected_release = physical / "releases" / source
            expected_release.mkdir(parents=True)
            receipt = {
                "status": "materialized",
                "source_commit": source,
                "release_path": str(expected_release),
                "artifacts": ["system.tar"],
                "idempotent": False,
            }

            completed = subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=(json.dumps(receipt) + "\n").encode("utf-8"),
                stderr=b"",
            )
            with mock.patch.object(owner.subprocess, "run", return_value=completed) as run:
                status = owner.run_once(repo, state, physical, source)

            self.assertEqual(status["status"], "idle")
            self.assertEqual(status["phase"], "waiting-for-base-staging-owner")
            self.assertTrue(status["signedReleaseMaterialized"])
            self.assertEqual(status["materializedReleaseSha"], source)
            self.assertEqual(status["releaseMaterializationState"], "materialized")
            command = run.call_args.args[0]
            self.assertEqual(command[1], "materialize")
            self.assertIn("--expected-commit", command)
            self.assertEqual(command[command.index("--expected-commit") + 1], source)
            self.assertNotIn("install", command)
            self.assertEqual((physical / "current").readlink(), Path("releases") / old)
            self.assertFalse(status["kernelStaged"])
            self.assertFalse(status["candidateArmed"])
            self.assertFalse(status["rebootRequested"])
            self.assertFalse(status["promotionAttempted"])

    def test_hash_pinned_release_agent_refresh_is_atomic_and_idempotent(self):
        class FakeResponse:
            status = 200

            def __init__(self, payload):
                self._stream = io.BytesIO(payload)
                self.headers = {"Content-Length": str(len(payload))}

            def read(self, size=-1):
                return self._stream.read(size)

            def geturl(self):
                return "https://objects.githubusercontent.com/ordax/agent"

            def close(self):
                self._stream.close()

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo, state, physical, _trust = self.fixture(root, promoted=False)
            legacy = b"fixture-legacy-agent"
            target = b"fixture-upgraded-materialize-agent"
            agent = physical / "bootstrap/release-acquisition/ordax-release-agent"
            agent.write_bytes(legacy)
            agent.chmod(0o755)
            target_sha = sha256(target)
            write_json(
                repo / "system/services/base-update/release-agent-refresh.json",
                {
                    "$schema": "prototype-ordax.release-agent-refresh/1",
                    "status": "development-git-migration",
                    "component": "bootstrap-release-acquisition",
                    "artifact": "ordax-release-agent",
                    "allowed_from_sha256": [sha256(legacy)],
                    "target_sha256": target_sha,
                    "target_size": len(target),
                    "download_url": (
                        "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/"
                        f"ordax-release-agent-{target_sha}/ordax-release-agent"
                    ),
                    "target_path": "/ordax/bootstrap/release-acquisition/ordax-release-agent",
                    "mode": "0755",
                    "physical_media_rewrite_required": False,
                    "raw_device_write_allowed": False,
                    "unknown_installed_hash_policy": "block",
                    "replacement": "same-directory-temp-fsync-atomic-replace",
                },
            )

            with mock.patch.object(
                owner,
                "urlopen",
                return_value=FakeResponse(target),
            ) as download:
                first = owner.run_once(repo, state, physical, "e" * 40)

            self.assertEqual(first["blocker"], "canonical-trust-not-pinned")
            self.assertEqual(first["releaseAgentRefreshState"], "refreshed")
            self.assertEqual(first["releaseAgentSha256"], target_sha)
            self.assertEqual(agent.read_bytes(), target)
            self.assertEqual(agent.stat().st_mode & 0o777, 0o755)
            download.assert_called_once()

            with mock.patch.object(
                owner,
                "urlopen",
                side_effect=AssertionError("already-current refresh must not redownload"),
            ):
                second = owner.run_once(repo, state, physical, "e" * 40)
            self.assertEqual(second["releaseAgentRefreshState"], "already-current")
            self.assertEqual(agent.read_bytes(), target)

    def test_unknown_release_agent_hash_blocks_without_download_or_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo, state, physical, _trust = self.fixture(root, promoted=False)
            agent = physical / "bootstrap/release-acquisition/ordax-release-agent"
            unknown = b"unexpected-local-agent"
            agent.write_bytes(unknown)
            agent.chmod(0o755)

            with mock.patch.object(
                owner,
                "urlopen",
                side_effect=AssertionError("unknown installed bytes must never trigger download"),
            ):
                status = owner.run_once(repo, state, physical, "e" * 40)

            self.assertEqual(status["status"], "blocked")
            self.assertEqual(
                status["blocker"],
                "release-agent-installed-hash-unrecognized",
            )
            self.assertEqual(agent.read_bytes(), unknown)
            self.assertFalse(status["canonicalTrustPinned"])

    def test_bad_refresh_download_preserves_known_legacy_agent(self):
        class FakeResponse:
            status = 200

            def __init__(self, payload):
                self._stream = io.BytesIO(payload)
                self.headers = {"Content-Length": str(len(payload))}

            def read(self, size=-1):
                return self._stream.read(size)

            def geturl(self):
                return "https://objects.githubusercontent.com/ordax/agent"

            def close(self):
                self._stream.close()

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo, state, physical, _trust = self.fixture(root, promoted=False)
            legacy = b"fixture-legacy-agent"
            target = b"fixture-upgraded-materialize-agent"
            corrupt = b"fixture-corrupt-materialize-agent!"
            agent = physical / "bootstrap/release-acquisition/ordax-release-agent"
            agent.write_bytes(legacy)
            agent.chmod(0o755)
            target_sha = sha256(target)
            write_json(
                repo / "system/services/base-update/release-agent-refresh.json",
                {
                    "$schema": "prototype-ordax.release-agent-refresh/1",
                    "status": "development-git-migration",
                    "component": "bootstrap-release-acquisition",
                    "artifact": "ordax-release-agent",
                    "allowed_from_sha256": [sha256(legacy)],
                    "target_sha256": target_sha,
                    "target_size": len(corrupt),
                    "download_url": (
                        "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/"
                        f"ordax-release-agent-{target_sha}/ordax-release-agent"
                    ),
                    "target_path": "/ordax/bootstrap/release-acquisition/ordax-release-agent",
                    "mode": "0755",
                    "physical_media_rewrite_required": False,
                    "raw_device_write_allowed": False,
                    "unknown_installed_hash_policy": "block",
                    "replacement": "same-directory-temp-fsync-atomic-replace",
                },
            )

            with mock.patch.object(
                owner,
                "urlopen",
                return_value=FakeResponse(corrupt),
            ):
                status = owner.run_once(repo, state, physical, "e" * 40)

            self.assertEqual(status["status"], "blocked")
            self.assertEqual(
                status["blocker"],
                "release-agent-refresh-validation-failed",
            )
            self.assertEqual(agent.read_bytes(), legacy)
            self.assertEqual(
                list(agent.parent.glob(".ordax-release-agent.ordax-refresh-*")),
                [],
            )

    def test_existing_different_physical_trust_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo, state, physical, _trust = self.fixture(Path(temporary))
            trust_dir = physical / "bootstrap/trust"
            trust_dir.mkdir(parents=True)
            (trust_dir / "release-ed25519.json").write_text(
                '{"different":true}\n',
                encoding="utf-8",
            )

            status = owner.run_once(repo, state, physical, "c" * 40)

            self.assertEqual(status["status"], "blocked")
            self.assertEqual(status["blocker"], "physical-trust-conflict")
            self.assertFalse(status["physicalTrustEnrolled"])
            self.assertEqual(
                (trust_dir / "release-ed25519.json").read_text(encoding="utf-8"),
                '{"different":true}\n',
            )

    def test_public_evidence_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo, state, physical, _trust = self.fixture(Path(temporary))
            policy_path = repo / "docs/contracts/release-trust-policy.json"
            policy = json.loads(policy_path.read_text(encoding="utf-8"))
            policy["public_anchor"][
                "ceremony_evidence_repository_path"
            ] = "../outside.json"
            write_json(policy_path, policy)

            status = owner.run_once(repo, state, physical, "d" * 40)

            self.assertEqual(status["status"], "blocked")
            self.assertEqual(status["blocker"], "trust-enrollment-validation-failed")
            self.assertFalse(status["physicalTrustEnrolled"])

    def test_unresolved_group_blocks_public_trust_enrollment(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo, state, physical, _trust = self.fixture(Path(temporary))
            minimal_path = repo / "docs/contracts/minimal-bootstrap.json"
            minimal = json.loads(minimal_path.read_text(encoding="utf-8"))
            minimal["artifact_groups"][0]["resolved"] = False
            write_json(minimal_path, minimal)

            status = owner.run_once(repo, state, physical, "e" * 40)

            self.assertEqual(status["status"], "blocked")
            self.assertFalse(status["physicalTrustEnrolled"])

    def test_runtime_owner_has_no_stage_activate_or_reboot_path_yet(self):
        orchestrator = MODULE_PATH.read_text(encoding="utf-8")
        agent = AGENT.read_text(encoding="utf-8")
        self.assertIn('"materialize",', orchestrator)
        self.assertNotIn('"install",', orchestrator)
        self.assertIn("release-agent-refresh.json", orchestrator)
        self.assertIn("unknown_installed_hash_policy", orchestrator)
        self.assertIn("os.replace(temporary, target)", orchestrator)
        self.assertNotIn("stage.py", orchestrator)
        self.assertNotIn("activate.py", orchestrator)
        self.assertNotIn("promote.py", orchestrator)
        self.assertNotIn("LoaderEntryOneShot", orchestrator)
        self.assertNotIn("/sys/firmware/efi/efivars", orchestrator)
        self.assertNotIn("power-request", orchestrator)
        self.assertNotIn("reboot -f", agent)
        self.assertNotIn("busybox reboot", agent)
        self.assertNotIn("sysrq", agent)

    def test_agent_maps_development_root_to_real_physical_ordax_root(self):
        subprocess.run(["sh", "-n", str(AGENT)], check=True)
        agent = AGENT.read_text(encoding="utf-8")
        self.assertIn("MOUNTINFO_FILE=${ORDAX_BASE_MOUNTINFO_FILE:-/proc/self/mountinfo}", agent)
        self.assertIn("MOUNT_STAGE_HOST=${ORDAX_BASE_MOUNT_STAGE_ROOT:-/run/ordax-base-owner}", agent)
        self.assertIn("PHYSICAL_MOUNT_CHROOT=/mnt/ordax-device", agent)
        self.assertIn('root_mount_record()', agent)
        self.assertIn('ensure_mount_stage()', agent)
        self.assertIn('mount -t tmpfs -o mode=0700,size=1m tmpfs "$MOUNT_STAGE_HOST"', agent)
        self.assertIn('PHYSICAL_MOUNT_HOST=$MOUNT_STAGE_HOST/physical', agent)
        self.assertIn('mount -o bind "$PHYSICAL_MOUNT_HOST" "$PHYSICAL_BIND_HOST"', agent)
        self.assertIn('$5 == "/"', agent)
        self.assertIn('[ "$root_fstype" = "ext4" ]', agent)
        self.assertIn('/dev/*)', agent)
        self.assertIn('mount -t ext4 -o rw "$root_source" "$PHYSICAL_MOUNT_HOST"', agent)
        self.assertIn(
            'release_agent=$PHYSICAL_MOUNT_HOST/bootstrap/release-acquisition/ordax-release-agent',
            agent,
        )
        self.assertIn(
            'release_channel=$PHYSICAL_MOUNT_HOST/bootstrap/config/release-envelope-url',
            agent,
        )
        self.assertIn('host_state=$PHYSICAL_MOUNT_HOST$root_subpath/state/ordax', agent)
        self.assertIn(
            'OWNER_STATE_CHROOT=$PHYSICAL_MOUNT_CHROOT$root_subpath/state/ordax',
            agent,
        )
        self.assertIn('--state-root "$OWNER_STATE_CHROOT"', agent)
        self.assertIn('--physical-root "$PHYSICAL_MOUNT_CHROOT"', agent)
        self.assertNotIn("--state-root /var/lib/ordax", agent)
        self.assertNotIn("--physical-root /ordax", agent)
        self.assertIn("write_preflight_status()", agent)
        self.assertIn('"$schema":"ordax.base-update-owner-status/1"', agent)
        self.assertIn("temporary=$status_dir/.owner-status.json.preflight.$", agent)
        self.assertIn('"phase":"physical-root-preflight"', agent)
        self.assertIn("physical-mount-failed", agent)
        self.assertIn("release-agent-missing", agent)
        self.assertNotIn(r'\\$schema', agent)

    def test_surface_binds_repo_and_ordax_before_starting_owner(self):
        text = SURFACE.read_text(encoding="utf-8")
        self.assertIn('BASE_UPDATE_SOURCE=$SYSTEM_ROOT/services/base-update/agent.sh', text)
        self.assertIn('mount -o bind "$repo_root" "$RUNTIME_ROOT/srv/ordax-repo"', text)
        self.assertIn('mount -o bind /ordax "$RUNTIME_ROOT/ordax"', text)
        self.assertIn("ensure_base_update_agent()", text)
        self.assertIn("REPO_BOUND=0", text)
        self.assertIn("ORDAX_BOUND=0", text)
        self.assertLess(
            text.index("bind_runtime_mounts ||"),
            text.index("ensure_base_update_agent ||"),
        )
        self.assertLess(
            text.index("prepare_power_broker ||"),
            text.index("ensure_base_update_agent ||"),
        )


if __name__ == "__main__":
    unittest.main()
