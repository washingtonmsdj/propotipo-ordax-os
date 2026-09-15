import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "runtime-configuration.json"
CONFIG_OWNER = ROOT / "system" / "services" / "config"


class RuntimeConfigurationContractTests(unittest.TestCase):
    def load(self):
        return json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_configuration_has_one_domain_owner_without_global_override_magic(self):
        authority = self.load()["authority"]
        self.assertEqual(authority["domain_owner"], "system/services/config")
        self.assertTrue(CONFIG_OWNER.is_dir())
        self.assertEqual(authority["platform_secret_storage_owner"], "system/adapters")
        self.assertFalse(authority["bootstrap_config_is_product_config_authority"])
        self.assertFalse(authority["environment_variables_are_global_override_authority"])
        self.assertFalse(authority["configuration_source_precedence_is_universal"])
        self.assertTrue(authority["each_key_declares_its_authority_chain"])

    def test_key_contract_is_typed_versionable_and_fail_closed(self):
        key = self.load()["key_contract"]
        for field in (
            "stable_key_id_required",
            "type_required",
            "scope_required",
            "authority_chain_required",
            "default_or_required_marker_required",
            "sensitivity_required",
            "runtime_mutability_required",
            "restart_semantics_required",
            "validation_required",
        ):
            self.assertTrue(key[field], field)
        self.assertEqual(key["unknown_required_key"], "fail-closed")
        self.assertEqual(key["invalid_value"], "reject-with-last-known-good-when-available")
        self.assertFalse(key["implicit_string_coercion_allowed"])

    def test_feature_flags_cannot_become_a_privilege_backdoor(self):
        flags = self.load()["feature_flags"]
        self.assertTrue(flags["stable_flag_id_required"])
        self.assertTrue(flags["safe_default_required"])
        self.assertTrue(flags["owner_required"])
        self.assertTrue(flags["temporary_flag_requires_expiry_or_removal_condition"])
        self.assertTrue(flags["flag_may_select_behavior_within_existing_capability"])
        for field in (
            "flag_may_grant_new_capability",
            "flag_may_bypass_authorization",
            "flag_may_change_release_trust",
            "flag_may_enable_physical_write",
            "flag_may_disable_safety_gate",
            "experiment_may_change_security_semantics",
            "kill_switch_may_grant_privilege",
        ):
            self.assertFalse(flags[field], field)
        self.assertTrue(flags["kill_switch_may_disable_feature"])

    def test_remote_configuration_cannot_cross_security_boundaries(self):
        boundary = self.load()["privilege_boundary"]
        for field, value in boundary.items():
            if field == "capability_contract_remains_authority":
                self.assertTrue(value)
            else:
                self.assertFalse(value, field)

    def test_secrets_never_become_normal_configuration_or_diagnostics(self):
        secrets = self.load()["secrets"]
        self.assertFalse(secrets["secret_values_are_configuration_values"])
        self.assertTrue(secrets["secret_reference_or_handle_allowed"])
        self.assertFalse(secrets["plaintext_secret_in_repository_allowed"])
        self.assertFalse(secrets["plaintext_secret_in_sync_allowed"])
        self.assertFalse(secrets["plaintext_secret_in_diagnostics_allowed"])
        self.assertFalse(secrets["plaintext_secret_in_provenance_allowed"])
        self.assertFalse(secrets["canonical_release_private_key_is_runtime_config"])
        self.assertFalse(secrets["canonical_public_trust_anchor_is_runtime_toggle"])
        self.assertFalse(secrets["destructive_authorization_token_is_persistent_config"])

    def test_resolution_is_atomic_deterministic_and_last_known_good(self):
        resolution = self.load()["resolution"]
        self.assertTrue(resolution["deterministic"])
        self.assertTrue(resolution["resolved_value_records_non_secret_source"])
        self.assertTrue(resolution["last_known_good_supported"])
        self.assertFalse(resolution["partial_invalid_update_may_replace_valid_snapshot"])
        self.assertTrue(resolution["configuration_update_is_atomic_snapshot"])
        self.assertTrue(resolution["server_unavailable_preserves_safe_last_known_good"])
        self.assertTrue(resolution["missing_server_config_must_not_escalate_privilege"])

    def test_evolution_is_additive_without_provider_lock_in(self):
        compatibility = self.load()["compatibility"]
        self.assertTrue(compatibility["additive_optional_key_is_backward_compatible"])
        self.assertTrue(compatibility["new_required_key_requires_schema_or_migration"])
        self.assertTrue(compatibility["changing_key_meaning_requires_new_key_or_contract_major"])
        self.assertTrue(compatibility["changing_key_type_is_breaking"])
        self.assertTrue(compatibility["temporary_flag_removal_requires_removal_condition_satisfied"])
        self.assertFalse(compatibility["storage_provider_change_requires_product_config_migration"])
        self.assertFalse(compatibility["platform_adapter_may_redefine_configuration_authority"])


if __name__ == "__main__":
    unittest.main()
