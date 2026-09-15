import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "kernel-build-environment.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


class KernelBuildEnvironmentContractTests(unittest.TestCase):
    def load(self):
        return json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_environment_identity_is_immutable_source_plus_snapshot(self):
        value = self.load()
        self.assertEqual(value["$schema"], "prototype-ordax.kernel-build-environment/1")
        self.assertEqual(value["architecture"], "linux/amd64")
        digest = value["base_image"]["manifest_digest"]
        self.assertRegex(digest, r"^sha256:[0-9a-f]{64}$")
        self.assertRegex(value["apt"]["snapshot_id"], r"^20[0-9]{6}T[0-9]{6}Z$")
        self.assertIn("gcc", value["apt"]["packages"])
        self.assertIn("gcc-13", value["apt"]["packages"])
        self.assertIn("python3", value["apt"]["packages"])

    def test_promotion_requires_pinned_versions_and_repeat_digest_proof(self):
        value = self.load()
        proof = value["proof"]
        if not proof["package_versions_pinned"] or not proof["repeat_build_digest_match"]:
            self.assertFalse(proof["promotable_to_physical"])

        if value["status"] == "candidate-observation-required":
            self.assertEqual(value["apt"]["expected_versions"], {})
            self.assertFalse(proof["first_observation_complete"])
            self.assertFalse(proof["package_versions_pinned"])

        if value["status"] == "pinned-repeat-proof-required":
            self.assertTrue(proof["first_observation_complete"])
            self.assertTrue(proof["package_versions_pinned"])
            self.assertFalse(proof["repeat_build_digest_match"])
            self.assertFalse(proof["promotable_to_physical"])

        if value["status"] == "pinned-repeat-proof-complete":
            self.assertTrue(proof["first_observation_complete"])
            self.assertTrue(proof["package_versions_pinned"])
            self.assertTrue(proof["repeat_build_digest_match"])
            self.assertTrue(proof["promotable_to_physical"])

    def test_package_list_is_sorted_and_unique(self):
        packages = self.load()["apt"]["packages"]
        self.assertEqual(packages, sorted(set(packages)))

    def test_pinned_versions_cover_exact_package_set(self):
        value = self.load()
        packages = value["apt"]["packages"]
        expected = value["apt"]["expected_versions"]
        proof = value["proof"]
        if proof["package_versions_pinned"]:
            self.assertEqual(set(expected), set(packages))
            for package in packages:
                self.assertIsInstance(expected[package], str)
                self.assertTrue(expected[package].strip())

    def test_reference_observation_is_complete_once_first_measurement_is_promoted(self):
        value = self.load()
        if not value["proof"]["first_observation_complete"]:
            return

        reference = value["reference_observation"]
        self.assertRegex(reference["source_commit"], COMMIT_RE)
        self.assertRegex(reference["ca_bundle_sha256"], SHA256_RE)
        self.assertEqual(
            set(reference["artifacts"]),
            {
                "kernel-6.6.52.config",
                "kernel-modules-6.6.52.tar",
                "vmlinuz-6.6.52",
            },
        )
        for digest in reference["artifacts"].values():
            self.assertRegex(digest, SHA256_RE)


if __name__ == "__main__":
    unittest.main()
