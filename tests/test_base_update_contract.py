#!/usr/bin/env python3
"""Contract regressions for transactional OrdaX base updates."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads(
    (ROOT / "docs" / "contracts" / "base-update.json").read_text(encoding="utf-8")
)


class BaseUpdateContractTests(unittest.TestCase):
    def test_base_update_is_separate_from_daily_git_hot_update(self):
        self.assertEqual(CONTRACT["$schema"], "prototype-ordax.base-update/1")
        self.assertFalse(CONTRACT["normal_git_hot_update_owns_this"])
        self.assertTrue(CONTRACT["requires_reboot_to_activate"])
        self.assertEqual(CONTRACT["esp"]["filesystem_label"], "ORDAX-ESP")

    def test_candidate_can_only_touch_inactive_slot(self):
        slots = CONTRACT["slots"]
        self.assertEqual(slots["names"], ["a", "b"])
        self.assertTrue(slots["active_slot_must_not_be_modified_during_stage"])
        self.assertTrue(slots["inactive_slot_only_for_candidate"])
        self.assertIn("{slot}", slots["paths"]["kernel"])
        self.assertIn("{slot}", slots["paths"]["initramfs"])

    def test_activation_is_one_shot_and_keeps_known_good_default(self):
        activation = CONTRACT["activation"]
        self.assertEqual(activation["selector"], "LoaderEntryOneShot")
        self.assertEqual(activation["entry_id"], "ordax-candidate.conf")
        self.assertEqual(activation["bootloader"], "systemd-boot")
        self.assertTrue(activation["boot_counting_required"])
        self.assertEqual(activation["candidate_tries_left"], 1)
        self.assertTrue(activation["default_entry_unchanged_before_health"])
        self.assertEqual(activation["automatic_fallback"], "existing-current-entry")

    def test_promotion_requires_base_and_surface_health(self):
        health = CONTRACT["health"]
        for key in (
            "candidate_cmdline_identity_required",
            "base_heartbeat_required",
            "surface_health_required",
            "same_release_sha_required",
            "promotion_only_after_all_checks",
            "boot_id_must_match_across_base_and_surface",
        ):
            self.assertTrue(health[key], key)
        self.assertEqual(
            health["local_evidence"],
            {
                "base_heartbeat": "/state/ordax/base-update/base-heartbeat.json",
                "surface_health": "/run/ordax-update/healthy-sha",
                "surface_heartbeat": "/state/ordax/native-state/surface-heartbeat.json",
                "boot_id": "/run/ordax-update/base-boot-id",
                "cmdline": "/proc/cmdline",
            },
        )

    def test_promotion_writes_recovery_before_current_commit_point(self):
        promotion = CONTRACT["promotion"]
        self.assertTrue(promotion["current_entry_written_after_recovery_entry"])
        self.assertTrue(promotion["current_entry_is_promotion_commit_point"])
        self.assertTrue(promotion["atomic_replace_required"])
        self.assertTrue(promotion["previous_slot_preserved"])

    def test_failure_never_overwrites_current_kernel_in_place(self):
        failure = CONTRACT["failure"]
        self.assertTrue(failure["current_entry_remains_unchanged"])
        self.assertTrue(failure["previous_slot_remains_bootable"])
        self.assertTrue(failure["candidate_never_promoted_without_health"])
        self.assertTrue(failure["no_whole_esp_rewrite"])
        self.assertTrue(failure["no_kernel_in_place_overwrite"])
        self.assertTrue(failure["no_remote_shell_required"])

    def test_staging_reuses_canonical_signed_release_trust(self):
        staging = CONTRACT["staging"]
        self.assertTrue(staging["signed_manifest_required"])
        self.assertTrue(staging["signed_system_artifact_required"])
        self.assertFalse(staging["unsigned_candidate_cli_allowed"])
        self.assertEqual(
            staging["release_envelope_schema"],
            "prototype-ordax.release-envelope/1",
        )
        self.assertEqual(
            staging["release_manifest_schema"],
            "prototype-ordax.release-manifest/1",
        )
        self.assertEqual(
            staging["canonical_trust_path"],
            "/ordax/bootstrap/trust/release-ed25519.json",
        )
        self.assertEqual(
            staging["signed_candidate_descriptor"],
            "system/base-update/candidate.json",
        )
        self.assertIn(" verify-envelope", staging["verifier"])
        self.assertNotIn("verify-base-update-envelope", staging["verifier"])

    def test_promotion_commit_and_boot_refresh_lifecycle_are_explicit(self):
        promotion = CONTRACT["promotion"]
        self.assertTrue(promotion["candidate_entry_removed_before_current_commit"])
        self.assertTrue(promotion["current_entry_is_promotion_commit_point"])
        self.assertTrue(
            promotion[
                "post_commit_metadata_may_not_reclassify_promotion_as_precommit_failure"
            ]
        )
        self.assertEqual(
            promotion["boot_refresh_marker"],
            "/ordax/state/boot-refresh-required",
        )
        self.assertEqual(
            promotion["boot_refresh_marker_development_alias"],
            "/state/ordax/boot-refresh-required",
        )
        self.assertTrue(
            promotion["boot_refresh_marker_cleared_only_after_healthy_promotion"]
        )
        self.assertTrue(promotion["normal_reboot_must_not_clear_boot_refresh_marker"])
        self.assertTrue(promotion["current_entry_durability_reported"])

    def test_candidate_entry_uses_fixed_width_single_try_counter(self):
        entry = CONTRACT["entries"]["candidate_template"]
        self.assertEqual(entry, "/loader/entries/ordax-candidate+01-00.conf")
        self.assertTrue(
            CONTRACT["entries"]["current_and_recovery_are_never_replaced_before_candidate_health"]
        )

    def test_implementation_requires_disposable_and_physical_proof(self):
        gates = CONTRACT["implementation_gates"]
        for gate in (
            "disposable-fat32-esp-proof",
            "one-shot-selection-proof",
            "failed-candidate-fallback-proof",
            "successful-candidate-promotion-proof",
            "physical-notebook-proof",
        ):
            self.assertIn(gate, gates)


if __name__ == "__main__":
    unittest.main()
