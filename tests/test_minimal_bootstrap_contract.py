#!/usr/bin/env python3
"""Fail-closed regressions for the initial physical USB manifest."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "docs" / "contracts" / "minimal-bootstrap.json"


class MinimalBootstrapContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    def test_media_policy_is_minimum_git_acquisition_first(self):
        self.assertEqual(self.manifest["policy"], "minimum-git-acquisition-first")
        self.assertEqual(
            [partition["name"] for partition in self.manifest["partitions"]],
            ["ORDAX-ESP", "ORDAX"],
        )

    def test_full_system_and_remote_stack_are_forbidden_from_initial_payload(self):
        forbidden = set(self.manifest["forbidden_initial_payload"])
        self.assertIn("system/surface", forbidden)
        self.assertIn("system/apps", forbidden)
        self.assertIn("complete-source-checkout", forbidden)
        self.assertIn("build-toolchain", forbidden)
        self.assertIn("legacy-repository-dump", forbidden)
        self.assertIn("wsl-runtime", forbidden)
        self.assertIn("qemu-runtime", forbidden)
        self.assertIn("ssh-runtime", forbidden)
        self.assertIn("bootstrap/remote", forbidden)
        self.assertIn("bootstrap/control-plane", forbidden)
        self.assertIn("bootstrap/identity", forbidden)

    def test_runtime_roots_start_without_a_release(self):
        self.assertEqual(
            self.manifest["runtime_roots_created_empty"],
            ["/ordax/releases", "/ordax/state", "/ordax/home"],
        )
        self.assertEqual(self.manifest["current_pointer_initial_state"], "unset")

    def test_unresolved_manifest_fails_closed(self):
        if not self.manifest["all_artifacts_resolved"]:
            self.assertFalse(self.manifest["physical_write_allowed"])

    def test_write_permission_requires_complete_hashed_artifacts(self):
        if not self.manifest["physical_write_allowed"]:
            return

        self.assertTrue(self.manifest["all_artifacts_resolved"])
        required = set(self.manifest["resolution_requirements_per_artifact"])
        for group in self.manifest["artifact_groups"]:
            self.assertTrue(group["resolved"], group["id"])
            self.assertTrue(group["artifacts"], group["id"])
            for artifact in group["artifacts"]:
                self.assertTrue(required.issubset(artifact), artifact)
                self.assertRegex(artifact["sha256"], r"^[0-9a-f]{64}$")

    def test_bootstrap_contains_only_required_network_release_path(self):
        capabilities = set(self.manifest["required_capabilities_before_first_release"])
        self.assertIn("uefi-boot", capabilities)
        self.assertIn("kernel", capabilities)
        self.assertIn("initramfs", capabilities)
        self.assertIn("minimal-network", capabilities)
        self.assertIn("release-acquisition", capabilities)
        self.assertIn("recovery-maintenance", capabilities)
        self.assertNotIn("ordax-remote-core", capabilities)
        self.assertNotIn("minimal-control-plane-and-trust", capabilities)
        self.assertNotIn("stable-device-identity", capabilities)

    def test_remote_control_remains_optional_after_first_release(self):
        optional = set(self.manifest["optional_after_first_release"])
        self.assertIn("ordax-remote-core", optional)
        self.assertIn("control-plane", optional)
        self.assertIn("stable-device-identity", optional)


if __name__ == "__main__":
    unittest.main()
