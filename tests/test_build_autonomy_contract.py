#!/usr/bin/env python3
"""Regression tests for repository-owned autonomous builds."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads(
    (ROOT / "docs" / "contracts" / "build-autonomy.json").read_text(encoding="utf-8")
)


class BuildAutonomyContractTest(unittest.TestCase):
    def test_contract_schema_is_current(self):
        self.assertEqual(CONTRACT["$schema"], "prototype-ordax.build-autonomy/2")

    def test_codex_and_local_toolchains_are_not_required(self):
        independence = CONTRACT["required_independence"]
        self.assertFalse(independence["codex_required"])
        self.assertFalse(independence["developer_local_toolchain_required"])
        self.assertFalse(independence["wsl_required"])
        self.assertFalse(independence["qemu_required"])
        self.assertFalse(independence["manual_kernel_build_required"])
        self.assertFalse(independence["specific_developer_host_os_required"])

    def test_build_recipe_and_artifact_provenance_are_canonical(self):
        build = CONTRACT["canonical_build"]
        self.assertTrue(build["repository_recipe_required"])
        self.assertTrue(build["ci_build_required"])
        self.assertTrue(build["pinned_build_environment_required"])
        self.assertTrue(build["immutable_environment_identity_required"])
        self.assertTrue(build["upstream_source_hash_verification_required"])
        self.assertTrue(build["artifact_sha256_required"])
        self.assertTrue(build["artifact_provenance_required"])
        self.assertTrue(build["portable_build_entrypoint_required"])
        self.assertTrue(build["github_actions_is_current_executor_not_source_authority"])

    def test_kernel_is_built_by_ci_not_developer_machine(self):
        kernel = CONTRACT["kernel"]
        self.assertEqual(kernel["baseline_version"], "6.6.52")
        self.assertRegex(kernel["source_archive_sha256"], r"^[0-9a-f]{64}$")
        self.assertTrue(kernel["canonical_config_required"])
        self.assertTrue(kernel["pinned_toolchain_required"])
        self.assertTrue(kernel["ci_compilation_required"])
        self.assertFalse(kernel["developer_machine_compilation_required"])
        self.assertTrue(kernel["provenance_manifest_required"])

    def test_artifact_graph_covers_all_product_delivery_modes(self):
        graph = CONTRACT["artifact_graph"]
        classes = set(graph["independent_artifact_classes"])
        for artifact_class in {
            "kernel",
            "initramfs",
            "minimal-bootstrap",
            "shared-system-bundle",
            "web-client",
            "mobile-client",
            "desktop-client",
            "native-system-release",
            "creator",
            "manifests",
        }:
            self.assertIn(artifact_class, classes)
        self.assertNotIn("surface-web", classes)

    def test_artifact_graph_avoids_unrelated_rebuilds(self):
        graph = CONTRACT["artifact_graph"]
        self.assertFalse(graph["surface_change_rebuilds_kernel"])
        self.assertFalse(graph["kernel_change_rebuilds_unrelated_surface"])
        self.assertFalse(graph["kernel_change_rebuilds_client_modes"])
        self.assertFalse(graph["mode_adapter_change_rebuilds_unrelated_modes"])
        self.assertFalse(graph["creator_change_rebuilds_kernel"])
        self.assertFalse(graph["bootstrap_change_rebuilds_client_modes"])
        self.assertTrue(graph["shared_surface_change_may_rebuild_all_applicable_product_modes"])
        self.assertTrue(graph["shared_contract_change_runs_cross_mode_validation"])
        self.assertTrue(graph["affected_build_selection_must_be_dependency_driven"])
        self.assertTrue(graph["ci_path_filters_are_optimization_not_dependency_authority"])

    def test_target_relationships_have_no_unknown_nodes(self):
        classes = set(CONTRACT["artifact_graph"]["independent_artifact_classes"])
        relationships = CONTRACT["target_relationships"]
        for target, dependencies in relationships.items():
            self.assertIn(target, classes)
            self.assertTrue(dependencies)
            for dependency in dependencies:
                self.assertIn(dependency, classes)
                self.assertNotEqual(target, dependency)

    def test_graph_rules_keep_growth_incremental(self):
        rules = CONTRACT["graph_rules"]
        self.assertFalse(rules["dependency_cycle_allowed"])
        self.assertTrue(rules["unrelated_rebuild_is_architectural_regression"])
        self.assertTrue(rules["missing_required_dependency_build_is_architectural_regression"])
        self.assertTrue(rules["new_product_mode_requires_explicit_artifact_class_or_documented_shared_target"])
        self.assertTrue(rules["new_artifact_class_requires_provenance_owner"])
        self.assertTrue(rules["build_cache_may_accelerate_but_may_not_replace_verification"])

    def test_codex_is_optional_and_not_an_authority(self):
        model = CONTRACT["ai_operating_model"]
        self.assertTrue(model["any_repository_agent_may_edit_source"])
        self.assertTrue(model["any_repository_agent_may_fix_ci"])
        self.assertTrue(model["codex_is_optional_partner"])
        self.assertFalse(model["codex_is_release_authority"])
        self.assertFalse(model["codex_is_build_authority"])

    def test_end_user_never_compiles_kernel_for_install(self):
        physical = CONTRACT["physical_boundary"]
        self.assertTrue(physical["creator_consumes_prebuilt_verified_artifacts"])
        self.assertFalse(physical["end_user_compiles_kernel"])
        self.assertTrue(physical["physical_action_requires_authorized_local_execution"])


if __name__ == "__main__":
    unittest.main()
