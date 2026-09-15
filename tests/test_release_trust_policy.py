import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = ROOT / "docs" / "contracts" / "release-trust-policy.json"
TRUST_PATH = ROOT / "bootstrap" / "trust" / "release-ed25519.json"


class ReleaseTrustPolicyTests(unittest.TestCase):
    def load_policy(self):
        return json.loads(POLICY_PATH.read_text(encoding="utf-8"))

    def test_policy_resolves_custody_without_faking_key_material(self):
        policy = self.load_policy()
        self.assertEqual(policy["$schema"], "prototype-ordax.release-trust-policy/1")
        self.assertEqual(policy["status"], "policy-resolved-key-material-pending")
        self.assertEqual(policy["algorithm"], "ed25519")
        self.assertEqual(policy["canonical_key_id"], "ordax-prototype-release-v1")
        self.assertEqual(policy["private_key"]["custody_owner"], "repository-owner-developer")
        self.assertTrue(policy["private_key"]["offline_encrypted_backup_required"])
        self.assertEqual(policy["recovery"]["minimum_offline_backups"], 1)
        self.assertFalse(policy["recovery"]["silent_key_replacement_allowed"])
        self.assertTrue(policy["rotation"]["signed_trust_transition_required_for_production"])
        self.assertFalse(policy["rotation"]["production_rotation_implemented"])

    def test_private_key_locations_explicitly_forbid_repository_and_usb(self):
        forbidden = set(self.load_policy()["private_key"]["forbidden_locations"])
        for location in {"git", "usb-bootstrap", "github-actions-artifacts", "logs", "chat"}:
            self.assertIn(location, forbidden)

    def test_public_anchor_path_matches_runtime_contract(self):
        anchor = self.load_policy()["public_anchor"]
        self.assertEqual(anchor["schema"], "prototype-ordax.release-trust/1")
        self.assertEqual(anchor["repository_path"], "bootstrap/trust/release-ed25519.json")
        self.assertEqual(anchor["runtime_path"], "/ordax/bootstrap/trust/release-ed25519.json")
        self.assertTrue(anchor["pin_only_after_private_custody_ready"])

    def test_pending_policy_keeps_all_promotion_gates_closed(self):
        policy = self.load_policy()
        gates = policy["gates"]
        self.assertFalse(gates["key_material_generated"])
        self.assertFalse(gates["public_anchor_pinned"])
        self.assertFalse(gates["minimal_bootstrap_resolved"])
        self.assertFalse(gates["physical_write_allowed"])
        if policy["status"] == "policy-resolved-key-material-pending":
            self.assertFalse(TRUST_PATH.exists(), "pending policy must not ship placeholder canonical trust")


if __name__ == "__main__":
    unittest.main()
