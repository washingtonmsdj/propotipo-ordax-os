from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "bootstrap" / "base-update" / "prove_fat32_staging.sh"
SIGNED_PROOF = ROOT / "bootstrap" / "base-update" / "prove_signed_fat32_staging.sh"
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


    def test_signed_proof_uses_real_cli_and_disposable_ci_trust_only(self):
        proof = SIGNED_PROOF.read_text(encoding="utf-8")
        self.assertIn('stage.py" \\', proof)
        self.assertIn('--envelope "$ENVELOPE"', proof)
        self.assertIn('/ordax/bootstrap/release-acquisition/ordax-release-agent', proof)
        self.assertIn('/ordax/bootstrap/trust/release-ed25519.json', proof)
        self.assertIn('"/ordax/releases/$RELEASE_SHA/artifacts/system.tar"', proof)
        self.assertIn('"release_signature_verification_exercised": True', proof)
        self.assertIn('"test_key_scope": "ci-ephemeral-only"', proof)
        self.assertIn('"canonical_release_trust_exercised": False', proof)
        self.assertIn('"canonical_public_anchor_promoted": False', proof)
        self.assertIn('"physical_write_authorized": False', proof)
        self.assertIn('rm -f "$PRIVATE_KEY"', proof)
        self.assertIn('test ! -e "$PRIVATE_KEY"', proof)

    def test_signed_proof_exercises_real_legacy_to_ab_transition(self):
        proof = SIGNED_PROOF.read_text(encoding="utf-8")
        self.assertIn('--active-slot legacy', proof)
        self.assertIn('"active_slot": "legacy"', proof)
        self.assertIn('"previous_slot": "a"', proof)
        self.assertIn('"candidate_slot": "b"', proof)
        self.assertIn('"legacy_default_preserved": True', proof)
        self.assertIn(
            '"legacy_known_good_enrolled_as_slot_a": True',
            proof,
        )
        self.assertIn(
            'linux /ordax/vmlinuz',
            proof,
        )
        self.assertIn(
            'test "$(sudo sha256sum "$MOUNT/ordax/base/a/vmlinuz"',
            proof,
        )
        self.assertIn(
            'test "$(sudo sha256sum "$MOUNT/ordax/base/b/vmlinuz"',
            proof,
        )

    def test_signed_proof_refuses_preexisting_ordax_root(self):
        proof = SIGNED_PROOF.read_text(encoding="utf-8")
        self.assertIn("if [ -e /ordax ]; then", proof)
        self.assertIn("refusing to reuse or remove pre-existing /ordax", proof)
        self.assertIn('if [[ "$ORDAX_CREATED" -eq 1 ]]; then', proof)

    def test_workflow_uploads_only_proof_metadata(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("out/base-update/fat32-staging-proof.json", workflow)
        self.assertIn("out/base-update/signed-fat32-staging-proof.json", workflow)
        self.assertIn("Prove signed release verification through product CLI on FAT32", workflow)
        self.assertIn('boundary["canonical_release_trust_exercised"] is False', workflow)
        self.assertIn('boundary["physical_write_authorized"] is False', workflow)
        self.assertNotIn("esp.raw", workflow)
        self.assertNotIn("*.raw", workflow)
        self.assertIn('proof["physical_write_authorized"] is False', workflow)
        self.assertIn('proof["trust_boundary"]["canonical_release_trust_exercised"] is False', workflow)


if __name__ == "__main__":
    unittest.main()
