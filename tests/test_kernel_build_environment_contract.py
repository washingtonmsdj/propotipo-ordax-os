import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "kernel-build-environment.json"


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
        self.assertIn("gcc-13", value["apt"]["packages"])
        self.assertIn("python3", value["apt"]["packages"])

    def test_candidate_contract_cannot_claim_physical_promotion_before_repeat_proof(self):
        value = self.load()
        proof = value["proof"]
        if not proof["package_versions_pinned"] or not proof["repeat_build_digest_match"]:
            self.assertFalse(proof["promotable_to_physical"])
        if value["status"] == "candidate-observation-required":
            self.assertEqual(value["apt"]["expected_versions"], {})
            self.assertFalse(proof["first_observation_complete"])

    def test_package_list_is_sorted_and_unique(self):
        packages = self.load()["apt"]["packages"]
        self.assertEqual(packages, sorted(set(packages)))


if __name__ == "__main__":
    unittest.main()
