import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
FOUNDATION = ROOT / "docs" / "contracts" / "foundation.json"
SYNC = ROOT / "docs" / "contracts" / "sync-model.json"
SYNC_OWNER = ROOT / "system" / "services" / "sync"


class SyncModelContractTests(unittest.TestCase):
    def load(self, path):
        return json.loads(path.read_text(encoding="utf-8"))

    def test_syncable_classes_track_foundation(self):
        foundation = self.load(FOUNDATION)
        sync = self.load(SYNC)
        expected = foundation["account_sync"]["syncable_categories"]
        actual = [entry["id"] for entry in sync["syncable_data_classes"]]
        self.assertEqual(actual, expected)
        self.assertEqual(len(actual), len(set(actual)))

    def test_never_sync_boundary_contains_foundation_security_classes(self):
        foundation = self.load(FOUNDATION)
        sync = self.load(SYNC)
        expected = set(foundation["account_sync"]["never_sync_categories"])
        actual = set(sync["never_sync_data_classes"])
        self.assertTrue(expected <= actual)
        self.assertFalse(sync["identity"]["device_private_keys_are_account_sync_data"])
        self.assertFalse(sync["security"]["private_device_material_inside_sync_payload_allowed"])
        self.assertFalse(sync["security"]["tokens_inside_sync_objects_allowed"])

    def test_offline_retry_and_conflict_model_is_scalable(self):
        sync = self.load(SYNC)
        objects = sync["object_protocol"]
        conflicts = sync["conflicts"]
        offline = sync["offline"]
        self.assertTrue(objects["stable_object_id_required"])
        self.assertTrue(objects["object_schema_version_required"])
        self.assertTrue(objects["server_revision_required"])
        self.assertFalse(objects["client_wall_clock_is_conflict_authority"])
        self.assertTrue(objects["idempotency_key_required_for_mutations"])
        self.assertTrue(objects["deletion_uses_explicit_tombstone"])
        self.assertTrue(objects["opaque_incremental_cursor"])
        self.assertTrue(objects["full_resync_supported"])
        self.assertFalse(conflicts["universal_last_writer_wins_allowed"])
        self.assertTrue(conflicts["resolver_must_be_deterministic"])
        self.assertTrue(conflicts["resolver_must_be_versioned"])
        self.assertTrue(offline["mutation_queue_must_be_idempotent"])
        self.assertTrue(offline["server_may_require_safe_full_resync"])

    def test_backend_and_platform_choices_do_not_own_domain_semantics(self):
        sync = self.load(SYNC)
        authority = sync["authority"]
        compatibility = sync["compatibility"]
        self.assertEqual(authority["domain_owner"], "system/services/sync")
        self.assertEqual(authority["platform_integration_owner"], "system/adapters")
        self.assertTrue(SYNC_OWNER.is_dir())
        self.assertFalse(authority["storage_backend_is_protocol_authority"])
        self.assertFalse(authority["database_vendor_visible_to_clients"])
        self.assertFalse(compatibility["backend_provider_change_requires_client_migration"])
        self.assertFalse(compatibility["platform_adapter_change_may_change_domain_sync_semantics"])

    def test_schema_evolution_is_additive_and_fail_closed(self):
        sync = self.load(SYNC)
        objects = sync["object_protocol"]
        compatibility = sync["compatibility"]
        self.assertEqual(objects["unknown_optional_fields"], "ignore")
        self.assertEqual(objects["unknown_required_object_schema"], "fail-closed")
        self.assertTrue(compatibility["data_class_ids_are_stable"])
        self.assertTrue(compatibility["additive_optional_object_field_is_backward_compatible"])
        self.assertTrue(compatibility["new_required_object_field_requires_new_object_schema_version"])
        self.assertTrue(compatibility["changing_data_class_meaning_requires_new_id_or_contract_major"])
        self.assertTrue(compatibility["changing_conflict_semantics_requires_new_resolver_version"])
        self.assertTrue(compatibility["removing_syncable_data_class_requires_explicit_migration"])

    def test_plans_do_not_fragment_identity_or_destroy_data(self):
        foundation = self.load(FOUNDATION)
        sync = self.load(SYNC)
        plans = sync["plans_and_quota"]
        self.assertFalse(sync["identity"]["account_identity_is_plan_gated"])
        self.assertFalse(plans["basic_cross_device_sync_is_plan_gated"])
        self.assertFalse(plans["downgrade_may_silently_delete_data"])
        self.assertTrue(plans["entitlements_are_server_authoritative"])
        self.assertEqual(
            plans["basic_cross_device_sync_is_plan_gated"],
            foundation["plans"]["basic_cross_device_sync_is_plan_gated"],
        )
        self.assertEqual(
            plans["entitlements_are_server_authoritative"],
            foundation["plans"]["entitlements_are_server_authoritative"],
        )


if __name__ == "__main__":
    unittest.main()
