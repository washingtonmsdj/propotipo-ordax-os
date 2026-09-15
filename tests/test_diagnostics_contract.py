import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "diagnostics.json"
OWNER = ROOT / "system" / "services" / "diagnostics"


class DiagnosticsContractTests(unittest.TestCase):
    def load(self):
        return json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_diagnostics_are_local_first_and_provider_neutral(self):
        authority = self.load()["authority"]
        self.assertEqual(authority["domain_owner"], "system/services/diagnostics")
        self.assertTrue(OWNER.is_dir())
        self.assertFalse(authority["sink_provider_is_protocol_authority"])
        self.assertFalse(authority["remote_telemetry_required_for_operation"])
        self.assertFalse(authority["bootstrap_remote_telemetry_required"])
        self.assertTrue(authority["local_diagnostics_available_offline"])

    def test_event_and_error_identity_is_stable_and_machine_readable(self):
        contract = self.load()
        event = contract["event_contract"]
        error = contract["error_contract"]
        self.assertTrue(event["schema_version_required"])
        self.assertTrue(event["stable_event_code_required"])
        self.assertTrue(event["component_required"])
        self.assertTrue(event["severity_required"])
        self.assertFalse(event["human_message_is_machine_identity"])
        self.assertTrue(error["stable_error_code_required_for_actionable_failure"])
        self.assertTrue(error["error_code_is_separate_from_localized_message"])
        self.assertFalse(error["raw_secret_or_token_in_error_allowed"])
        self.assertTrue(error["retryability_must_not_be_inferred_from_message_text"])

    def test_sensitive_material_is_forbidden_from_diagnostics(self):
        privacy = self.load()["privacy"]
        self.assertFalse(privacy["secret_values_allowed"])
        self.assertFalse(privacy["access_tokens_allowed"])
        self.assertFalse(privacy["private_keys_allowed"])
        self.assertFalse(privacy["destructive_authorization_tokens_allowed"])
        self.assertFalse(privacy["user_content_included_by_default"])
        self.assertTrue(privacy["personally_identifying_fields_require_explicit_classification"])
        self.assertTrue(privacy["diagnostic_export_requires_redaction"])

    def test_logs_are_bounded_and_cannot_crowd_out_user_data(self):
        storage = self.load()["local_storage"]
        self.assertFalse(storage["unbounded_log_growth_allowed"])
        self.assertTrue(storage["bounded_retention_required"])
        self.assertTrue(storage["rotation_or_bounded_ring_required"])
        self.assertTrue(storage["disk_pressure_must_not_block_boot"])
        self.assertTrue(storage["old_diagnostics_may_be_evicted_before_user_data"])
        self.assertFalse(storage["logs_are_source_authority"])

    def test_supervised_services_have_health_and_backoff_semantics(self):
        health = self.load()["service_health"]
        self.assertTrue(health["liveness_and_readiness_are_distinct"])
        self.assertFalse(health["fixed_sleep_is_readiness_probe"])
        self.assertTrue(health["crash_loop_detection_required_for_supervised_services"])
        self.assertTrue(health["restart_backoff_required"])
        self.assertFalse(health["tight_infinite_restart_loop_allowed"])
        self.assertTrue(health["dependency_failure_may_surface_degraded_state"])

    def test_remote_export_is_optional_and_never_a_boot_dependency(self):
        export = self.load()["remote_export"]
        self.assertTrue(export["optional"])
        self.assertTrue(export["asynchronous"])
        self.assertFalse(export["failure_blocks_boot"])
        self.assertFalse(export["failure_blocks_release_activation"])
        self.assertFalse(export["failure_blocks_recovery"])
        self.assertTrue(export["provider_neutral"])
        self.assertTrue(export["bounded_queue_required"])

    def test_diagnostic_bundle_is_explicit_and_redacted(self):
        bundle = self.load()["diagnostic_bundle"]
        self.assertTrue(bundle["explicit_user_or_support_action_required"])
        self.assertTrue(bundle["redaction_before_export_required"])
        self.assertTrue(bundle["manifest_of_included_files_required"])
        self.assertFalse(bundle["private_key_material_allowed"])
        self.assertFalse(bundle["raw_user_home_export_allowed_by_default"])


if __name__ == "__main__":
    unittest.main()
