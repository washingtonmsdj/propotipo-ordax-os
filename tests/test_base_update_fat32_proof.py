from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "bootstrap" / "base-update" / "prove_fat32_staging.sh"
WORKFLOW = ROOT / ".github" / "workflows" / "base-update-fat32-proof.yml"
STAGE = ROOT / "bootstrap" / "base-update" / "stage.py"


class BaseUpdateFat32ProofTests(unittest.TestCase):
    def test_filesystem_proof_does_not_weaken_product_trust_boundary(self):
        proof = PROOF.read_text(encoding="utf-8")
        stage = STAGE.read_text(encoding="utf-8")
        self.assertIn('"scope": "filesystem-staging-only"', proof)
        self.assertIn('"canonical_release_trust_exercised": False', proof)
        self.assertIn('"release_signature_verification_exercised": False', proof)
        self.assertIn('"product_cli_trust_requirement_changed": False', proof)
        self.assertIn("module.stage(", proof)
        self.assertIn('parser.add_argument("--envelope", type=Path, required=True)', stage)
        self.assertIn("verified_candidate_from_release(", stage)

    def test_proof_never_claims_hardware_or_write_authorization(self):
        proof = PROOF.read_text(encoding="utf-8")
        self.assertIn('"real_hardware_touched": False', proof)
        self.assertIn('"physical_hardware_proven": False', proof)
        self.assertIn('"physical_write_authorized": False', proof)
        self.assertIn('"activation_not_performed": True', proof)
        self.assertIn('"reboot_not_requested": True', proof)

    def test_workflow_uploads_only_proof_metadata(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("out/base-update/fat32-staging-proof.json", workflow)
        self.assertNotIn("esp.raw", workflow)
        self.assertNotIn("*.raw", workflow)
        self.assertIn('proof["physical_write_authorized"] is False', workflow)
        self.assertIn('proof["trust_boundary"]["canonical_release_trust_exercised"] is False', workflow)


if __name__ == "__main__":
    unittest.main()
