#!/usr/bin/env python3
"""Fail-closed regressions for the local release-trust recovery proof."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WINDOWS = ROOT / "tools" / "release-signing" / "windows"
INITIALIZER = WINDOWS / "Initialize-OrdaXReleaseTrust.ps1"
FINALIZER = WINDOWS / "Complete-OrdaXReleaseTrust.ps1"
WRAPPER = WINDOWS / "3-Verify-OrdaXTrustRecovery.cmd"
TOOLKIT_WORKFLOW = ROOT / ".github" / "workflows" / "windows-prototype-toolkit.yml"


class ReleaseTrustRecoveryProofTests(unittest.TestCase):
    def test_finalizer_requires_distinct_recovered_private_file(self):
        text = FINALIZER.read_text(encoding="utf-8")
        self.assertIn("[Parameter(Mandatory = $true)]", text)
        self.assertIn("$RecoveredPrivateKeyPath", text)
        self.assertIn("Recovered private key must be a distinct restored file", text)
        self.assertIn("Assert-PrivateOutsideToolkit $RecoveredPrivateKeyPath", text)

    def test_recovery_is_proven_by_public_derivation_and_signing(self):
        text = FINALIZER.read_text(encoding="utf-8")
        self.assertIn("derive-trust --private-key $RecoveredPrivateKeyPath", text)
        self.assertIn("--out $RecoveryDerivedPath", text)
        self.assertIn("Recovered backup derives different public trust", text)
        self.assertIn("sign --manifest $ProofManifestPath --private-key $RecoveredPrivateKeyPath", text)
        self.assertIn("--trust $TrustPath", text)
        self.assertIn("verify-envelope --envelope $RecoveryEnvelopePath --trust $TrustPath", text)
        self.assertIn("RECOVERED_SIGNING_PROOF=YES", text)
        self.assertIn("RECOVERED_ENVELOPE_VERIFIED=YES", text)
        self.assertNotIn("PrimaryPrivateHash", text)
        self.assertNotIn("RecoveredPrivateHash", text)

    def test_finalizer_requires_initial_fail_closed_ceremony_result(self):
        text = FINALIZER.read_text(encoding="utf-8")
        self.assertIn("ceremony-result.json", text)
        self.assertIn("prototype-ordax.release-trust-ceremony-result/1", text)
        self.assertIn("offline_encrypted_backup_required -ne $true", text)
        self.assertIn("ready_to_pin_public_anchor -ne $false", text)

    def test_public_promotion_contains_only_public_outputs(self):
        text = FINALIZER.read_text(encoding="utf-8")
        self.assertIn("public-promotion", text)
        self.assertIn("Copy-Item -LiteralPath $TrustPath -Destination $PromotionTrustPath", text)
        self.assertIn("Copy-Item -LiteralPath $PublicEvidencePath -Destination $PromotionEvidencePath", text)
        self.assertIn("Copy-Item -LiteralPath $ProofManifestPath -Destination $PromotionProofManifestPath", text)
        self.assertIn("Copy-Item -LiteralPath $RecoveryEnvelopePath -Destination $PromotionRecoveryEnvelopePath", text)
        self.assertIn("PRIVATE_KEY_COPIED_TO_PUBLIC_PROMOTION=NO", text)
        self.assertIn("READY_TO_PIN_PUBLIC_ANCHOR=YES", text)
        self.assertNotIn("Copy-Item -LiteralPath $PrimaryPrivateKeyPath", text)
        self.assertNotIn("Copy-Item -LiteralPath $RecoveredPrivateKeyPath", text)

    def test_recovery_finalizer_emits_single_public_handoff_zip(self):
        text = FINALIZER.read_text(encoding="utf-8")
        self.assertIn("OrdaX-Public-Trust-Handoff.zip", text)
        self.assertIn("Compress-Archive -LiteralPath", text)
        self.assertIn("PUBLIC_TRUST_HANDOFF_ZIP=", text)
        self.assertIn("PUBLIC_TRUST_HANDOFF_ZIP_SHA256=", text)
        self.assertIn("PUBLIC_HANDOFF_SECRET_MATERIAL=NO", text)
        self.assertIn("PUBLIC_HANDOFF_CONTENTS_VERIFIED=YES", text)
        self.assertIn("Expand-Archive -LiteralPath $PublicHandoffZipPath", text)
        self.assertIn("Public handoff ZIP changed bytes for $name.", text)
        for name in (
            "release-ed25519.json",
            "ceremony-public-evidence.json",
            "trust-proof-manifest.json",
            "trust-proof-recovery-envelope.json",
        ):
            self.assertIn(name, text)
        for forbidden in (
            "PromotionPrivate",
            "Copy-Item -LiteralPath $PrimaryPrivateKeyPath",
            "Copy-Item -LiteralPath $RecoveredPrivateKeyPath",
        ):
            self.assertNotIn(forbidden, text)
        self.assertIn("(pem|key|p12|pfx|dpapi)", text)
        self.assertIn("(private|secret|seed)", text)

    def test_windows_handoff_is_present_and_toolkit_ships_it(self):
        wrapper = WRAPPER.read_text(encoding="utf-8")
        workflow = TOOLKIT_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("Complete-OrdaXReleaseTrust.ps1", wrapper)
        self.assertIn("RECUPERACAO_OFFLINE=VERIFICADA", wrapper)
        self.assertIn("Complete-OrdaXReleaseTrust.ps1", workflow)
        self.assertIn("3-Verify-OrdaXTrustRecovery.cmd", workflow)
        self.assertIn("trust_recovery_finalizer", workflow)
        self.assertIn("promote_public_trust.py", workflow)
        self.assertIn("public_trust_promoter", workflow)

    def test_initializer_still_stops_before_public_anchor_promotion(self):
        text = INITIALIZER.read_text(encoding="utf-8")
        self.assertIn("ready_to_pin_public_anchor = $false", text)
        self.assertIn("READY_TO_PIN_PUBLIC_ANCHOR=NO", text)


if __name__ == "__main__":
    unittest.main()
