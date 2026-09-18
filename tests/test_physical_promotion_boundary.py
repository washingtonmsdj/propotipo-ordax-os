#!/usr/bin/env python3
"""Regress separation between payload description and destructive authorization."""

import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "creator" / "physical_promotion.py"
spec = importlib.util.spec_from_file_location("ordax_physical_promotion_test", MODULE_PATH)
promotion = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(promotion)


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PhysicalPromotionBoundaryTests(unittest.TestCase):
    def make_ready_fixture(self, root: Path) -> None:
        trust = {
            "$schema": "prototype-ordax.release-trust/1",
            "key_id": "ordax-prototype-release-v1",
            "public_key_base64": base64.b64encode(bytes(range(32))).decode("ascii"),
        }
        trust_path = root / "bootstrap/trust/release-ed25519.json"
        write_json(trust_path, trust)
        trust_sha = sha256(trust_path)

        minimal = {
            "$schema": "prototype-ordax.minimal-bootstrap/4",
            "status": "canonical-bytes-resolved",
            "physical_write_allowed": False,
            "all_artifacts_resolved": True,
            "artifact_groups": [
                {
                    "id": "bootstrap-release-trust",
                    "partition": "ORDAX",
                    "source_owner": "bootstrap/trust",
                    "resolved": True,
                    "artifacts": [
                        {
                            "source_path": "bootstrap/trust/release-ed25519.json",
                            "target_path": "/ordax/bootstrap/trust/release-ed25519.json",
                            "sha256": trust_sha,
                            "mode": "0644",
                            "logical_owner": "bootstrap-release-trust",
                            "reason": "Canonical public Ed25519 release trust anchor",
                        }
                    ],
                }
            ],
        }
        minimal_path = root / "docs/contracts/minimal-bootstrap.json"
        write_json(minimal_path, minimal)

        media = {
            "$schema": "prototype-ordax.physical-media/1",
            "physical_write_allowed": False,
            "partition_table": "gpt",
            "partitions": [
                {"name": "ORDAX-ESP", "filesystem": "fat32"},
                {"name": "ORDAX", "filesystem": "ext4"},
            ],
        }
        media_path = root / "docs/contracts/physical-media.json"
        write_json(media_path, media)

        policy = {
            "$schema": "prototype-ordax.release-trust-policy/1",
            "consumer_creator": {
                "generates_publisher_private_keys": False,
                "stores_publisher_private_keys": False,
                "requests_private_key_backup_from_end_user": False,
                "runs_release_trust_ceremony": False,
                "signature_verification_is_automatic": True,
            },
            "gates": {
                "key_material_generated": True,
                "public_anchor_pinned": True,
                "minimal_bootstrap_resolved": True,
                "physical_authorization_eligible": True,
            },
        }
        write_json(root / "docs/contracts/release-trust-policy.json", policy)

        requirements = {
            "canonical_public_trust_pinned": True,
            "minimal_bootstrap_all_artifacts_resolved": True,
            "minimal_bootstrap_remains_non_destructive": True,
            "disposable_media_proof_required": True,
            "writer_binds_generated_seed_sha256_and_size": True,
            "writer_binds_manifest_sha256": True,
            "writer_binds_public_trust_sha256": True,
            "signed_release_sequence_must_never_decrease": True,
            "live_usb_reenumeration_required": True,
            "end_user_destructive_confirmation_required": True,
            "windows_uac_required": True,
            "post_write_readback_required": True,
        }
        auth = {
            "$schema": "prototype-ordax.physical-write-authorization/1",
            "status": "authorized",
            "physical_write_allowed": True,
            "explicit_owner_authorization": True,
            "source_repository": "washingtonmsdj/prototipo-ordax-os",
            "release_sequence": 1,
            "requirements": requirements,
            "bindings": {
                "minimal_bootstrap_sha256": sha256(minimal_path),
                "release_trust_sha256": trust_sha,
                "physical_media_sha256": sha256(media_path),
            },
        }
        write_json(root / "docs/contracts/physical-write-authorization.json", auth)

    def test_ready_promotion_keeps_payload_manifest_non_destructive(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)

            status = promotion.evaluate(root)

            self.assertTrue(status["ready"], status["blockers"])
            minimal = json.loads(
                (root / "docs/contracts/minimal-bootstrap.json").read_text(encoding="utf-8")
            )
            self.assertFalse(minimal["physical_write_allowed"])

    def test_trust_policy_rejects_duplicate_destructive_authority(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            policy_path = root / "docs/contracts/release-trust-policy.json"

            policy = json.loads(policy_path.read_text(encoding="utf-8"))
            policy["gates"]["physical_write_allowed"] = False
            write_json(policy_path, policy)

            status = promotion.evaluate(root)

            self.assertFalse(status["ready"])
            self.assertIn(
                "release-trust-policy-gates-not-authorized",
                status["blockers"],
            )

    def test_payload_level_destructive_flag_is_rejected_even_with_valid_bindings(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            minimal_path = root / "docs/contracts/minimal-bootstrap.json"
            auth_path = root / "docs/contracts/physical-write-authorization.json"

            minimal = json.loads(minimal_path.read_text(encoding="utf-8"))
            minimal["physical_write_allowed"] = True
            write_json(minimal_path, minimal)

            auth = json.loads(auth_path.read_text(encoding="utf-8"))
            auth["bindings"]["minimal_bootstrap_sha256"] = sha256(minimal_path)
            write_json(auth_path, auth)

            status = promotion.evaluate(root)

            self.assertFalse(status["ready"])
            self.assertIn(
                "minimal-bootstrap-must-remain-non-destructive",
                status["blockers"],
            )


if __name__ == "__main__":
    unittest.main()
