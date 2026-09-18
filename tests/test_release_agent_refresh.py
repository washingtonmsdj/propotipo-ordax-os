#!/usr/bin/env python3
"""Regress the one-way hash-pinned release-agent compatibility migration."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
DESCRIPTOR = ROOT / "system/services/base-update/release-agent-refresh.json"
MINIMAL = ROOT / "docs/contracts/minimal-bootstrap.json"
BASE = ROOT / "docs/contracts/base-update.json"
WORKFLOW = ROOT / ".github/workflows/release-agent-refresh.yml"
OWNER = ROOT / "system/services/base-update/orchestrator.py"


class ReleaseAgentRefreshTests(unittest.TestCase):
    def test_descriptor_is_one_way_hash_addressed_and_non_destructive(self):
        descriptor = json.loads(DESCRIPTOR.read_text(encoding="utf-8"))
        target = descriptor["target_sha256"]
        self.assertEqual(
            descriptor["$schema"],
            "prototype-ordax.release-agent-refresh/1",
        )
        self.assertEqual(descriptor["status"], "development-git-migration")
        self.assertTrue(descriptor["allow_absent_enrollment"])
        self.assertEqual(
            descriptor["target_path"],
            "/ordax/bootstrap/release-acquisition/ordax-release-agent",
        )
        self.assertEqual(len(target), 64)
        self.assertEqual(descriptor["mode"], "0755")
        self.assertFalse(descriptor["physical_media_rewrite_required"])
        self.assertFalse(descriptor["raw_device_write_allowed"])
        self.assertEqual(descriptor["unknown_installed_hash_policy"], "block")
        self.assertNotIn(target, descriptor["allowed_from_sha256"])
        self.assertEqual(
            descriptor["download_url"],
            (
                "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/"
                f"ordax-release-agent-{target}/ordax-release-agent"
            ),
        )

    def test_refresh_target_is_same_byte_pinned_by_minimal_bootstrap(self):
        descriptor = json.loads(DESCRIPTOR.read_text(encoding="utf-8"))
        minimal = json.loads(MINIMAL.read_text(encoding="utf-8"))
        groups = {group["id"]: group for group in minimal["artifact_groups"]}
        artifact = groups["bootstrap-release-acquisition"]["artifacts"][0]
        self.assertEqual(artifact["sha256"], descriptor["target_sha256"])
        self.assertEqual(artifact["target_path"], descriptor["target_path"])
        self.assertEqual(artifact["mode"], descriptor["mode"])
        self.assertFalse(minimal["physical_write_allowed"])

    def test_base_contract_does_not_create_generic_bootstrap_updater(self):
        contract = json.loads(BASE.read_text(encoding="utf-8"))
        refresh = contract["release_agent_refresh"]
        self.assertEqual(
            refresh["authority"],
            "git-checkout-pinned-sha256-and-size",
        )
        self.assertEqual(refresh["unknown_installed_hash"], "block")
        self.assertTrue(refresh["absent_agent_enrollment"])
        self.assertTrue(
            refresh["absent_agent_enrollment_requires_explicit_descriptor_gate"]
        )
        self.assertTrue(refresh["existing_unknown_hash_still_blocks"])
        self.assertTrue(refresh["occurs_before_canonical_trust_enrollment"])
        self.assertFalse(refresh["physical_media_rewrite_required"])
        self.assertFalse(refresh["raw_device_write_allowed"])
        self.assertFalse(refresh["generic_bootstrap_updater_created"])

    def test_publisher_never_mutably_overwrites_hash_addressed_asset(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("if: github.event_name == 'push'", workflow)
        self.assertIn("contents: write", workflow)
        self.assertIn("contents: read", workflow)
        self.assertIn('tag="ordax-release-agent-$digest"', workflow)
        self.assertIn("gh release download", workflow)
        self.assertIn("test \"$published\" = \"$digest\"", workflow)
        self.assertNotIn("--clobber", workflow)
        self.assertIn("RELEASE_AGENT_REFRESH_MUTABLE_OVERWRITE=NO", workflow)

    def test_owner_refreshes_before_trust_and_has_no_raw_or_reboot_path(self):
        owner = OWNER.read_text(encoding="utf-8")
        self.assertLess(
            owner.index("_refresh_release_agent_if_needed("),
            owner.index("_validate_repository_authority(repo_root)"),
        )
        self.assertIn("unknown installed hash", owner)
        self.assertIn("os.replace(temporary, target)", owner)
        self.assertNotIn("/dev/sd", owner)
        self.assertNotIn("sysrq", owner)
        self.assertNotIn("LoaderEntryOneShot", owner)


if __name__ == "__main__":
    unittest.main()
