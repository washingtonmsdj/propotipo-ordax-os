#!/usr/bin/env python3
"""Regressions for fail-closed canonical public release-trust promotion."""

import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "release-signing" / "promote_public_trust.py"
spec = importlib.util.spec_from_file_location(
    "ordax_public_trust_promotion_test", MODULE_PATH
)
promotion = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(promotion)


def write_json(path: Path, value: dict) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(value, indent=2) + "\n").encode("utf-8")
    path.write_bytes(payload)
    return payload


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


class PublicReleaseTrustPromotionTests(unittest.TestCase):
    def fixture(self, root: Path):
        for relative in (
            "docs/contracts/minimal-bootstrap.json",
            "docs/contracts/release-trust-policy.json",
            "docs/contracts/physical-write-authorization.json",
            "docs/contracts/physical-media.json",
        ):
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)

        (root / "bootstrap/trust").mkdir(parents=True, exist_ok=True)
        (root / "docs/evidence").mkdir(parents=True, exist_ok=True)

        promotion_dir = root / "promotion"
        promotion_dir.mkdir()
        trust = {
            "$schema": "prototype-ordax.release-trust/1",
            "key_id": "ordax-prototype-release-v1",
            "public_key_base64": base64.b64encode(bytes(range(32))).decode("ascii"),
        }
        trust_bytes = write_json(promotion_dir / "release-ed25519.json", trust)

        proof_manifest = {
            "$schema": "prototype-ordax.release-manifest/1",
            "source_repository": "washingtonmsdj/prototipo-ordax-os",
            "source_commit": "1" * 40,
            "release_id": "1" * 40,
            "created_from_ci_recipe": "trust/recovery-proof/1",
            "artifacts": [
                {
                    "name": "system.tar",
                    "role": "system",
                    "url": "https://example.invalid/trust-proof/system.tar",
                    "sha256": "2" * 64,
                    "size": 1,
                }
            ],
        }
        proof_bytes = write_json(
            promotion_dir / "trust-proof-manifest.json",
            proof_manifest,
        )
        envelope = {
            "$schema": "prototype-ordax.release-envelope/1",
            "payload": base64.b64encode(proof_bytes).decode("ascii"),
            "signature": base64.b64encode(bytes(64)).decode("ascii"),
            "key_id": "ordax-prototype-release-v1",
        }
        envelope_bytes = write_json(
            promotion_dir / "trust-proof-recovery-envelope.json",
            envelope,
        )
        evidence = {
            "$schema": "prototype-ordax.release-trust-ceremony-evidence/1",
            "status": "pass",
            "key_id": "ordax-prototype-release-v1",
            "public_trust_sha256": sha256(trust_bytes),
            "proof_manifest_sha256": sha256(proof_bytes),
            "recovery_envelope_sha256": sha256(envelope_bytes),
            "primary_public_derivation_match": True,
            "recovered_public_derivation_match": True,
            "recovered_private_path_distinct": True,
            "recovered_signing_proof": True,
            "offline_encrypted_backup_recovery_verified": True,
            "private_key_in_public_evidence": False,
            "ready_to_pin_public_anchor": True,
        }
        write_json(
            promotion_dir / "ceremony-public-evidence.json",
            evidence,
        )

        verifier = root / "ordax-release-signing"
        verifier.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        verifier.chmod(0o755)
        return promotion_dir, verifier

    @staticmethod
    def verified_process():
        return subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=(
                "RELEASE_ENVELOPE_VERIFIED=YES\n"
                "SOURCE_COMMIT=" + "1" * 40 + "\n"
                "KEY_ID_VERIFIED=YES\n"
                "SIGNATURE_VERIFIED=YES\n"
            ),
            stderr="",
        )

    @mock.patch.object(promotion.subprocess, "run")
    def test_check_requires_crypto_proof_but_never_authorizes_write(self, run):
        run.return_value = self.verified_process()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            promotion_dir, verifier = self.fixture(root)

            result = promotion.prepare_repository_promotion(
                root,
                promotion_dir,
                verifier,
            )

            self.assertTrue(result["ready"])
            self.assertTrue(result["physical_authorization_eligible"])
            self.assertFalse(result["physical_write_allowed"])
            self.assertIn(
                "bootstrap/trust/release-ed25519.json",
                result["outputs"],
            )
            self.assertIn(
                "docs/evidence/release-trust-recovery-envelope.json",
                result["outputs"],
            )
            run.assert_called_once()

    @mock.patch.object(promotion.subprocess, "run")
    def test_apply_resolves_public_trust_and_keeps_destructive_gate_closed(self, run):
        run.return_value = self.verified_process()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            promotion_dir, verifier = self.fixture(root)

            result = promotion.apply_repository_promotion(
                root,
                promotion_dir,
                verifier,
            )

            self.assertEqual(result["status"], "promoted")
            self.assertFalse(result["physical_write_allowed"])
            self.assertTrue(
                (root / "bootstrap/trust/release-ed25519.json").is_file()
            )
            self.assertTrue(
                (root / "docs/evidence/release-trust-ceremony.json").is_file()
            )
            self.assertTrue(
                (
                    root
                    / "docs/evidence/release-trust-proof-manifest.json"
                ).is_file()
            )
            self.assertTrue(
                (
                    root
                    / "docs/evidence/release-trust-recovery-envelope.json"
                ).is_file()
            )

            minimal = json.loads(
                (root / "docs/contracts/minimal-bootstrap.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertTrue(minimal["all_artifacts_resolved"])
            self.assertFalse(minimal["physical_write_allowed"])
            trust_group = next(
                group
                for group in minimal["artifact_groups"]
                if group["id"] == "bootstrap-release-trust"
            )
            self.assertTrue(trust_group["resolved"])
            self.assertEqual(len(trust_group["artifacts"]), 1)

            policy = json.loads(
                (root / "docs/contracts/release-trust-policy.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(
                policy["status"],
                "canonical-public-trust-pinned",
            )
            self.assertEqual(
                policy["gates"],
                {
                    "key_material_generated": True,
                    "public_anchor_pinned": True,
                    "minimal_bootstrap_resolved": True,
                    "physical_authorization_eligible": True,
                },
            )
            self.assertNotIn(
                "physical_write_allowed",
                policy["gates"],
            )

            authorization = json.loads(
                (
                    root
                    / "docs/contracts/physical-write-authorization.json"
                ).read_text(encoding="utf-8")
            )
            self.assertFalse(authorization["physical_write_allowed"])
            self.assertEqual(
                authorization["status"],
                "blocked-explicit-physical-authorization-pending",
            )
            self.assertTrue(
                all(authorization["bindings"].values())
            )
            self.assertGreaterEqual(run.call_count, 2)

    @mock.patch.object(promotion.subprocess, "run")
    def test_extra_public_promotion_file_is_rejected(self, run):
        run.return_value = self.verified_process()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            promotion_dir, verifier = self.fixture(root)
            (promotion_dir / "private.pem").write_text(
                "forbidden",
                encoding="utf-8",
            )

            with self.assertRaises(promotion.PromotionError):
                promotion.prepare_repository_promotion(
                    root,
                    promotion_dir,
                    verifier,
                )

            run.assert_not_called()

    @mock.patch.object(promotion.subprocess, "run")
    def test_hash_mismatch_is_rejected_before_crypto_verifier(self, run):
        run.return_value = self.verified_process()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            promotion_dir, verifier = self.fixture(root)
            evidence_path = promotion_dir / "ceremony-public-evidence.json"
            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            evidence["proof_manifest_sha256"] = "f" * 64
            write_json(evidence_path, evidence)

            with self.assertRaisesRegex(
                promotion.PromotionError,
                "proof manifest hash does not match",
            ):
                promotion.prepare_repository_promotion(
                    root,
                    promotion_dir,
                    verifier,
                )

            run.assert_not_called()

    @mock.patch.object(promotion.subprocess, "run")
    def test_crypto_verifier_failure_blocks_promotion(self, run):
        run.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="signature verification failed",
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            promotion_dir, verifier = self.fixture(root)

            with self.assertRaisesRegex(
                promotion.PromotionError,
                "did not verify",
            ):
                promotion.prepare_repository_promotion(
                    root,
                    promotion_dir,
                    verifier,
                )

            self.assertFalse(
                (root / "bootstrap/trust/release-ed25519.json").exists()
            )

    @mock.patch.object(promotion.subprocess, "run")
    def test_envelope_payload_must_equal_public_proof_manifest(self, run):
        run.return_value = self.verified_process()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            promotion_dir, verifier = self.fixture(root)
            envelope_path = (
                promotion_dir / "trust-proof-recovery-envelope.json"
            )
            envelope = json.loads(envelope_path.read_text(encoding="utf-8"))
            envelope["payload"] = base64.b64encode(b"different").decode("ascii")
            envelope_bytes = write_json(envelope_path, envelope)
            evidence_path = promotion_dir / "ceremony-public-evidence.json"
            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            evidence["recovery_envelope_sha256"] = sha256(envelope_bytes)
            write_json(evidence_path, evidence)

            with self.assertRaisesRegex(
                promotion.PromotionError,
                "payload differs",
            ):
                promotion.prepare_repository_promotion(
                    root,
                    promotion_dir,
                    verifier,
                )

            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
