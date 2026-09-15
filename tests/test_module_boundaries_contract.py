import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "module-boundaries.json"
SHARED_ROOTS = [
    ROOT / "system" / "surface",
    ROOT / "system" / "apps",
    ROOT / "system" / "services",
]
FORBIDDEN_IMPLEMENTATION_MARKERS = (
    "adapters/web",
    "adapters/mobile",
    "adapters/desktop",
    "adapters/native",
    "tools/creator/host",
)


class ModuleBoundariesContractTests(unittest.TestCase):
    def load(self):
        return json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_contract_schema_is_current(self):
        self.assertEqual(self.load()["$schema"], "prototype-ordax.module-boundaries/2")

    def test_layer_roots_exist_and_ids_are_unique(self):
        contract = self.load()
        layers = contract["layers"]
        ids = [layer["id"] for layer in layers]
        self.assertEqual(len(ids), len(set(ids)))
        for layer in layers:
            self.assertTrue((ROOT / layer["root"]).is_dir(), layer["root"])

    def test_dependency_graph_is_acyclic_and_references_known_layers(self):
        contract = self.load()
        layers = {layer["id"]: layer for layer in contract["layers"]}
        for layer in layers.values():
            allowed = set(layer["allowed_dependencies"])
            forbidden = set(layer["forbidden_dependencies"])
            self.assertFalse(allowed & forbidden, layer["id"])
            self.assertTrue((allowed | forbidden) <= set(layers), layer["id"])
            self.assertNotIn(layer["id"], allowed)

        visiting = set()
        visited = set()

        def visit(layer_id):
            if layer_id in visiting:
                self.fail(f"dependency cycle contains {layer_id}")
            if layer_id in visited:
                return
            visiting.add(layer_id)
            for dependency in layers[layer_id]["allowed_dependencies"]:
                visit(dependency)
            visiting.remove(layer_id)
            visited.add(layer_id)

        for layer_id in layers:
            visit(layer_id)

    def test_shared_product_source_does_not_import_specific_adapter_implementations(self):
        for shared_root in SHARED_ROOTS:
            for path in shared_root.rglob("*"):
                if not path.is_file() or path.suffix.lower() in {".md", ".txt"}:
                    continue
                text = path.read_text(encoding="utf-8", errors="ignore").replace("\\", "/")
                for marker in FORBIDDEN_IMPLEMENTATION_MARKERS:
                    self.assertNotIn(marker, text, f"{path} bypasses contract boundary via {marker}")

    def test_outer_adapters_cannot_own_shared_ui_or_app_policy(self):
        contract = self.load()
        adapters = next(layer for layer in contract["layers"] if layer["id"] == "adapters")
        self.assertIn("surface", adapters["forbidden_dependencies"])
        self.assertIn("apps", adapters["forbidden_dependencies"])
        surface = next(layer for layer in contract["layers"] if layer["id"] == "surface")
        apps = next(layer for layer in contract["layers"] if layer["id"] == "apps")
        services = next(layer for layer in contract["layers"] if layer["id"] == "services")
        self.assertIn("adapters", surface["forbidden_dependencies"])
        self.assertIn("adapters", apps["forbidden_dependencies"])
        self.assertIn("adapters", services["forbidden_dependencies"])

    def test_composition_is_thin_outer_wiring_layer(self):
        contract = self.load()
        composition = next(layer for layer in contract["layers"] if layer["id"] == "composition")
        self.assertIn("surface", composition["allowed_dependencies"])
        self.assertIn("adapters", composition["allowed_dependencies"])
        self.assertIn("apps", composition["forbidden_dependencies"])
        self.assertFalse(contract["principles"]["composition_owns_product_policy"])
        self.assertFalse(contract["principles"]["composition_owns_shared_visual_assets"])
        self.assertFalse(contract["evolution"]["composition_specific_ui_fork_allowed"])
        self.assertTrue(contract["evolution"]["new_execution_target_adds_wiring_not_shared_product_copy"])

    def test_creator_and_bootstrap_stay_outside_shared_product_policy(self):
        external = self.load()["external_boundaries"]
        self.assertFalse(external["creator"]["shared_surface_direct_dependency_allowed"])
        self.assertFalse(external["creator"]["shared_apps_direct_dependency_allowed"])
        self.assertEqual(external["creator"]["desktop_access"], "explicit creator capability contract only")
        self.assertFalse(external["bootstrap"]["shared_product_source_dependency_allowed"])
        self.assertTrue(external["bootstrap"]["verified_runtime_handoff_allowed"])

    def test_evolution_prefers_contracts_over_permanent_bridges(self):
        evolution = self.load()["evolution"]
        self.assertTrue(evolution["adding_public_contract_is_preferred_over_cross_layer_shortcut"])
        self.assertTrue(evolution["changing_public_contract_semantics_requires_versioned_migration"])
        self.assertTrue(evolution["temporary_bridge_requires_owner_and_removal_condition"])
        self.assertFalse(evolution["permanent_compatibility_bridge_without_owner_allowed"])
        self.assertFalse(evolution["adapter_specific_ui_fork_allowed"])
        self.assertTrue(evolution["backend_provider_may_change_without_domain_layer_rewrite"])


if __name__ == "__main__":
    unittest.main()
