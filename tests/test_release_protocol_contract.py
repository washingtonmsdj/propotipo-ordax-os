import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "release-protocol.json"
ACQUISITION = ROOT / "bootstrap" / "release-acquisition" / "main.go"
SIGNING = ROOT / "tools" / "release-signing" / "main.go"
MANIFEST_TOOL = ROOT / "tools" / "release-manifest" / "main.go"


class ReleaseProtocolContractTests(unittest.TestCase):
    def load_contract(self):
        return json.loads(CONTRACT.read_text(encoding="utf-8"))

    def read_source(self, path):
        return path.read_text(encoding="utf-8")

    def test_current_schema_registry_matches_all_protocol_owners(self):
        contract = self.load_contract()
        current = contract["current"]
        acquisition = self.read_source(ACQUISITION)
        signing = self.read_source(SIGNING)
        generator = self.read_source(MANIFEST_TOOL)

        self.assertIn(current["envelope_schema"], acquisition)
        self.assertIn(current["manifest_schema"], acquisition)
        self.assertIn(current["trust_schema"], acquisition)

        self.assertIn(current["envelope_schema"], signing)
        self.assertIn(current["manifest_schema"], signing)
        self.assertIn(current["trust_schema"], signing)

        self.assertIn(current["manifest_schema"], generator)

    def assert_v1_validator_semantics(self, source):
        self.assertRegex(source, r"len\([A-Za-z_][A-Za-z0-9_]*\.Artifacts\)\s*!=\s*1")
        self.assertRegex(source, r'[A-Za-z_][A-Za-z0-9_]*\.Name\s*!=\s*"system\.tar"')
        self.assertRegex(source, r'[A-Za-z_][A-Za-z0-9_]*\.Role\s*!=\s*"system"')
        self.assertRegex(
            source,
            r"[A-Za-z_][A-Za-z0-9_]*\.ReleaseID\s*!=\s*[A-Za-z_][A-Za-z0-9_]*\.SourceCommit",
        )
        self.assertIn("release-manifest/1 requires exactly one system.tar artifact", source)
        self.assertIn("release-manifest/1 artifact must be system.tar with role=system", source)

    def test_manifest_v1_single_full_system_semantics_cannot_drift_silently(self):
        contract = self.load_contract()
        manifest = contract["current"]["manifest_v1"]
        self.assertEqual(manifest["artifact_count"], 1)
        self.assertEqual(manifest["artifact_name"], "system.tar")
        self.assertEqual(manifest["artifact_role"], "system")
        self.assertTrue(manifest["release_id_equals_source_commit"])

        acquisition = self.read_source(ACQUISITION)
        signing = self.read_source(SIGNING)
        generator = self.read_source(MANIFEST_TOOL)

        self.assert_v1_validator_semantics(acquisition)
        self.assert_v1_validator_semantics(signing)

        self.assertIn('filepath.Base(absolute) != "system.tar"', generator)
        self.assertIn('Name:   "system.tar"', generator)
        self.assertIn('Role:   "system"', generator)
        self.assertIn("ReleaseID:           sourceCommit", generator)

    def test_breaking_release_evolution_requires_new_schema(self):
        compatibility = self.load_contract()["compatibility"]
        self.assertTrue(compatibility["published_schema_semantics_are_immutable"])
        self.assertTrue(compatibility["breaking_change_requires_new_schema_major"])
        self.assertTrue(compatibility["future_schema_versions_may_coexist"])
        self.assertEqual(compatibility["unknown_required_schema"], "fail-closed")
        self.assertFalse(compatibility["silent_schema_upgrade_allowed"])
        self.assertFalse(compatibility["manifest_v1_may_gain_multiple_artifacts"])
        self.assertFalse(compatibility["manifest_v1_may_gain_delta_semantics"])
        self.assertFalse(compatibility["manifest_v1_may_change_release_addressing"])
        self.assertTrue(compatibility["old_schema_removal_requires_explicit_migration_policy"])

    def test_future_delta_and_multi_artifact_paths_preserve_compatibility(self):
        rules = self.load_contract()["future_release_rules"]
        self.assertTrue(rules["delta_update_requires_new_manifest_schema"])
        self.assertTrue(rules["multiple_artifacts_require_new_manifest_schema"])
        self.assertTrue(rules["new_required_manifest_fields_require_new_manifest_schema"])
        self.assertTrue(rules["optional_delta_must_preserve_verified_full_release_fallback"])
        self.assertTrue(rules["new_release_schema_requires_explicit_consumer_support"])
        self.assertTrue(rules["new_release_schema_requires_signer_support"])
        self.assertTrue(rules["new_release_schema_requires_generator_support"])
        self.assertTrue(rules["new_release_schema_requires_acquisition_agent_support"])
        self.assertTrue(rules["new_release_schema_requires_cross_component_regression"])
        self.assertTrue(rules["new_trust_transition_requires_explicit_protocol"])

    def test_protocol_owners_are_single_named_boundaries(self):
        owners = self.load_contract()["owners"]
        self.assertEqual(owners["generator"], "tools/release-manifest")
        self.assertEqual(owners["signer"], "tools/release-signing")
        self.assertEqual(owners["consumer"], "bootstrap/release-acquisition")
        for key in ("generator", "signer", "consumer"):
            self.assertTrue((ROOT / owners[key]).exists())


if __name__ == "__main__":
    unittest.main()
