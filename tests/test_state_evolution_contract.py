import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "state-evolution.json"
STATE_OWNER = ROOT / "system" / "services" / "state"


class StateEvolutionContractTests(unittest.TestCase):
    def load(self):
        return json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_state_and_user_data_roots_remain_distinct(self):
        contract = self.load()
        scope = contract["scope"]
        self.assertEqual(scope["device_state_root"], "/ordax/state")
        self.assertEqual(scope["user_data_root"], "/ordax/home")
        self.assertEqual(scope["device_state_owner"], "system/services/state")
        self.assertTrue(STATE_OWNER.is_dir())
        self.assertTrue(scope["user_data_migration_is_separate_policy"])
        self.assertTrue(scope["sync_state_is_separate_from_device_state"])

    def test_unknown_or_malformed_state_never_triggers_destructive_reset(self):
        rules = self.load()["schema_rules"]
        self.assertTrue(rules["explicit_schema_version_required"])
        self.assertTrue(rules["schema_version_monotonic"])
        self.assertEqual(rules["unknown_newer_schema"], "fail-closed-to-recovery")
        self.assertEqual(rules["missing_schema_metadata"], "fail-closed-no-reset")
        self.assertFalse(rules["automatic_destructive_reset_allowed"])
        self.assertTrue(rules["release_must_declare_readable_state_range"])
        self.assertTrue(rules["release_must_declare_writable_state_version"])
        self.assertTrue(rules["state_schema_is_not_derived_from_app_version"])

    def test_migrations_are_transactional_and_replay_safe(self):
        rules = self.load()["migration_rules"]
        self.assertTrue(rules["verified_release_only"])
        self.assertTrue(rules["ordered_stepwise_migrations"])
        self.assertTrue(rules["migration_ids_are_stable"])
        self.assertTrue(rules["published_migration_semantics_are_immutable"])
        self.assertTrue(rules["migration_inputs_are_validated"])
        self.assertTrue(rules["migration_outputs_are_validated"])
        self.assertTrue(rules["idempotent_or_resume_safe_required"])
        self.assertTrue(rules["crash_consistency_required"])
        self.assertTrue(rules["partial_migration_must_not_become_active_state"])
        self.assertTrue(rules["migration_history_recorded"])
        self.assertTrue(rules["migration_history_contains_no_secrets"])

    def test_activation_checks_rollback_before_mutating_state(self):
        contract = self.load()
        steps = contract["activation_order"]
        self.assertLess(steps.index("verify-release"), steps.index("run-migrations-transactionally"))
        self.assertLess(steps.index("prove-rollback-strategy"), steps.index("run-migrations-transactionally"))
        self.assertLess(steps.index("run-migrations-transactionally"), steps.index("activate-release"))
        rollback = contract["rollback"]
        self.assertTrue(rollback["known_good_release_must_not_be_invalidated_silently"])
        self.assertTrue(rollback["candidate_must_prove_previous_release_state_compatibility_or_checkpoint_restore"])
        self.assertTrue(rollback["irreversible_migration_requires_restorable_checkpoint"])
        self.assertTrue(rollback["failed_activation_restores_previous_release_and_compatible_state"])
        self.assertTrue(rollback["rollback_may_not_guess_downgrade_transform"])

    def test_expand_migrate_contract_preserves_rollback_horizon(self):
        pattern = self.load()["evolution_pattern"]
        self.assertEqual(pattern["preferred_pattern"], "expand-migrate-contract")
        self.assertFalse(pattern["destructive_contract_same_release_as_expand_allowed"])
        self.assertIn("rollback horizon", pattern["contract"])

    def test_user_data_is_not_treated_as_disposable_state(self):
        user_data = self.load()["user_data"]
        self.assertFalse(user_data["silent_data_loss_allowed"])
        self.assertFalse(user_data["release_activation_may_delete_unknown_user_files"])
        self.assertTrue(user_data["user_data_format_change_requires_explicit_versioned_policy"])
        self.assertTrue(user_data["irreversible_user_data_change_requires_recovery_or_backup_strategy"])
        self.assertTrue(user_data["device_state_checkpoint_is_not_user_data_backup"])

    def test_state_contract_does_not_lock_storage_engine(self):
        compatibility = self.load()["compatibility"]
        self.assertTrue(compatibility["additive_optional_state_field_is_preferred"])
        self.assertTrue(compatibility["new_required_state_field_requires_migration"])
        self.assertTrue(compatibility["changing_existing_field_meaning_requires_new_schema_version"])
        self.assertTrue(compatibility["removing_state_field_requires_rollback_horizon_review"])
        self.assertFalse(compatibility["platform_adapter_may_change_state_schema_semantics"])
        self.assertFalse(compatibility["backend_provider_change_requires_state_schema_change"])


if __name__ == "__main__":
    unittest.main()
