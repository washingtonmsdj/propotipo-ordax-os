import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
FOUNDATION = ROOT / "docs" / "contracts" / "foundation.json"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"
ADAPTERS = ROOT / "system" / "adapters"
CAPABILITY_ID = re.compile(r"^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$")


class ProductCapabilitiesContractTests(unittest.TestCase):
    def load(self, path):
        return json.loads(path.read_text(encoding="utf-8"))

    def test_modes_track_foundation_without_product_forks(self):
        foundation = self.load(FOUNDATION)
        contract = self.load(CAPABILITIES)
        expected_modes = foundation["product_modes"]["modes"]
        modes = contract["modes"]
        self.assertEqual([mode["id"] for mode in modes], expected_modes)
        self.assertEqual(len(expected_modes), len(set(expected_modes)))
        self.assertTrue(foundation["product_modes"]["single_product"])
        self.assertTrue(foundation["product_modes"]["same_surface_source"])
        self.assertTrue(foundation["product_modes"]["same_application_source"])

    def test_every_registered_adapter_exists_and_native_is_shared(self):
        contract = self.load(CAPABILITIES)
        by_mode = {mode["id"]: mode for mode in contract["modes"]}
        for mode in contract["modes"]:
            adapter = ROOT / mode["adapter"]
            self.assertTrue(adapter.is_dir(), f"missing adapter for {mode['id']}: {adapter}")
            self.assertTrue((adapter / "README.md").is_file(), f"adapter boundary must be documented: {adapter}")
        self.assertEqual(by_mode["usb"]["adapter"], "system/adapters/native")
        self.assertEqual(by_mode["native-disk"]["adapter"], "system/adapters/native")
        self.assertNotEqual(by_mode["web"]["adapter"], by_mode["mobile"]["adapter"])
        self.assertNotEqual(by_mode["mobile"]["adapter"], by_mode["desktop"]["adapter"])

    def test_capability_ids_are_unique_and_all_references_are_defined(self):
        contract = self.load(CAPABILITIES)
        capability_ids = [entry["id"] for entry in contract["capabilities"]]
        self.assertEqual(len(capability_ids), len(set(capability_ids)))
        for capability_id in capability_ids:
            self.assertRegex(capability_id, CAPABILITY_ID)
        defined = set(capability_ids)
        for mode in contract["modes"]:
            groups = [
                set(mode["baseline_capabilities"]),
                set(mode["privileged_capabilities"]),
                set(mode["forbidden_capabilities"]),
            ]
            self.assertFalse(groups[0] & groups[1], mode["id"])
            self.assertFalse(groups[0] & groups[2], mode["id"])
            self.assertFalse(groups[1] & groups[2], mode["id"])
            referenced = set().union(*groups)
            self.assertTrue(referenced <= defined, f"undefined capability in {mode['id']}")

    def test_privilege_boundaries_fail_closed(self):
        contract = self.load(CAPABILITIES)
        by_mode = {mode["id"]: mode for mode in contract["modes"]}
        for mode_id in ("web", "mobile"):
            forbidden = set(by_mode[mode_id]["forbidden_capabilities"])
            self.assertIn("host.raw-disk", forbidden)
            self.assertIn("creator.usb-media", forbidden)
            self.assertEqual(by_mode[mode_id]["privileged_capabilities"], [])
        desktop = by_mode["desktop"]
        self.assertEqual(
            set(desktop["privileged_capabilities"]),
            {"creator.usb-media", "host.raw-disk"},
        )
        self.assertEqual(desktop["privileged_boundary"], "creator-only-explicit-user-authorization")

    def test_extension_policy_is_additive_and_versioned(self):
        contract = self.load(CAPABILITIES)
        self.assertEqual(contract["$schema"], "prototype-ordax.product-capabilities/1")
        compatibility = contract["compatibility"]
        self.assertTrue(compatibility["capability_ids_are_stable"])
        self.assertTrue(compatibility["additive_capability_definition_is_backward_compatible"])
        self.assertTrue(compatibility["adding_optional_capability_to_mode_is_backward_compatible"])
        self.assertTrue(compatibility["adding_required_capability_to_existing_mode_requires_explicit_migration"])
        self.assertTrue(compatibility["changing_existing_capability_semantics_requires_new_id_or_schema_major"])
        self.assertTrue(compatibility["removing_capability_is_breaking"])
        self.assertEqual(compatibility["unknown_optional_capability"], "ignore")
        self.assertEqual(compatibility["unknown_required_capability"], "fail-closed")
        self.assertFalse(compatibility["shared_surface_may_branch_on_platform_id"])
        self.assertTrue(compatibility["shared_surface_may_branch_on_capability_presence"])
        self.assertFalse(compatibility["platform_specific_policy_forks_allowed"])


if __name__ == "__main__":
    unittest.main()
