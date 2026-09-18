#!/usr/bin/env python3
"""Regress the autonomous low-level base-update runtime owner boundary."""

import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

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
            self.assertEqual(first["phase"], "waiting-for-signed-base-orchestrator")
            self.assertFalse(first["rebootRequested"])
            persisted = json.loads(
                (state / "base-update/owner-status.json").read_text(encoding="utf-8")
            )
            self.assertEqual(persisted["sourceSha"], "b" * 40)
            self.assertTrue(persisted["physicalTrustEnrolled"])

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
        self.assertNotIn("stage.py", orchestrator)
        self.assertNotIn("activate.py", orchestrator)
        self.assertNotIn("promote.py", orchestrator)
        self.assertNotIn("LoaderEntryOneShot", orchestrator)
        self.assertNotIn("/sys/firmware/efi/efivars", orchestrator)
        self.assertNotIn("power-request", orchestrator)
        self.assertNotIn("reboot", agent)
        self.assertNotIn("sysrq", agent)

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
