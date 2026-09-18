#!/usr/bin/env python3
"""Keep the signed A/B candidate descriptor bound to resolved bootstrap bytes."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
DESCRIPTOR_PATH = ROOT / "system" / "base-update" / "candidate.json"
BOOTSTRAP_PATH = ROOT / "docs" / "contracts" / "minimal-bootstrap.json"


class BaseUpdateSignedCandidateTests(unittest.TestCase):
    def test_descriptor_matches_resolved_kernel_and_initramfs_hashes(self):
        descriptor = json.loads(DESCRIPTOR_PATH.read_text(encoding="utf-8"))
        bootstrap = json.loads(BOOTSTRAP_PATH.read_text(encoding="utf-8"))

        self.assertEqual(
            set(descriptor),
            {"$schema", "kernel_sha256", "initramfs_sha256"},
        )
        self.assertEqual(
            descriptor["$schema"],
            "prototype-ordax.base-update-candidate/1",
        )

        groups = {group["id"]: group for group in bootstrap["artifact_groups"]}
        kernel = groups["kernel"]["artifacts"]
        initramfs = groups["initramfs"]["artifacts"]
        self.assertEqual(len(kernel), 1)
        self.assertEqual(len(initramfs), 1)
        self.assertTrue(groups["kernel"]["resolved"])
        self.assertTrue(groups["initramfs"]["resolved"])
        self.assertEqual(descriptor["kernel_sha256"], kernel[0]["sha256"])
        self.assertEqual(descriptor["initramfs_sha256"], initramfs[0]["sha256"])


if __name__ == "__main__":
    unittest.main()
