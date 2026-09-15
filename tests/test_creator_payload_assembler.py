#!/usr/bin/env python3
"""Regressions for the source-controlled Creator payload assembler."""

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "creator" / "assemble.py"
SPEC = importlib.util.spec_from_file_location("ordax_creator_assemble", MODULE_PATH)
ASSEMBLER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(ASSEMBLER)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def manifest_for(data: bytes, *, unresolved=True):
    groups = [
        {
            "id": "resolved-owner",
            "partition": "ORDAX",
            "source_owner": "fixture",
            "resolved": True,
            "artifacts": [
                {
                    "source_path": "payload/example.bin",
                    "target_path": "/ordax/bootstrap/example.bin",
                    "sha256": digest(data),
                    "mode": "0755",
                    "logical_owner": "fixture",
                    "reason": "fixture",
                }
            ],
        }
    ]
    if unresolved:
        groups.append(
            {
                "id": "pending-owner",
                "partition": "ORDAX",
                "source_owner": "pending",
                "resolved": False,
                "artifacts": [],
            }
        )
    return {
        "$schema": "prototype-ordax.minimal-bootstrap/4",
        "physical_write_allowed": False,
        "all_artifacts_resolved": not unresolved,
        "artifact_groups": groups,
    }


class CreatorPayloadAssemblerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        generated = self.root / "generated" / "example.bin"
        generated.parent.mkdir(parents=True)
        self.data = b"creator-payload-fixture"
        generated.write_bytes(self.data)
        self.generated_map = {"payload/example.bin": "generated/example.bin"}

    def tearDown(self):
        self.temp.cleanup()

    def test_unresolved_groups_require_explicit_candidate_mode(self):
        out = self.root / "payload"
        with self.assertRaisesRegex(ASSEMBLER.AssembleError, "unresolved groups"):
            ASSEMBLER.assemble(
                self.root,
                manifest_for(self.data),
                out,
                allow_unresolved=False,
                generated_sources=self.generated_map,
            )

    def test_resolved_subset_is_assembled_and_reverified(self):
        out = self.root / "payload"
        manifest = manifest_for(self.data)
        provenance = ASSEMBLER.assemble(
            self.root,
            manifest,
            out,
            allow_unresolved=True,
            generated_sources=self.generated_map,
        )
        self.assertEqual(provenance["status"], "resolved-subset-candidate")
        self.assertEqual(provenance["unresolved_groups"], ["pending-owner"])
        self.assertFalse(provenance["physical_write_authorized"])
        copied = out / "payload" / "example.bin"
        self.assertEqual(copied.read_bytes(), self.data)
        self.assertEqual(hashlib.sha256(copied.read_bytes()).hexdigest(), digest(self.data))

        verified = ASSEMBLER.verify(
            self.root,
            manifest,
            out,
            allow_unresolved=True,
        )
        self.assertEqual(verified["artifact_count"], 1)
        self.assertEqual(verified["unresolved_groups"], ["pending-owner"])
        self.assertFalse(verified["physical_write_authorized"])

    def test_source_hash_mismatch_fails(self):
        out = self.root / "payload"
        manifest = manifest_for(b"different")
        with self.assertRaisesRegex(ASSEMBLER.AssembleError, "SHA-256 mismatch"):
            ASSEMBLER.assemble(
                self.root,
                manifest,
                out,
                allow_unresolved=True,
                generated_sources=self.generated_map,
            )

    def test_unresolved_group_may_not_hide_candidate_bytes(self):
        manifest = manifest_for(self.data)
        manifest["artifact_groups"][1]["artifacts"] = [
            {
                "source_path": "payload/hidden.bin",
                "target_path": "/ordax/hidden.bin",
                "sha256": "0" * 64,
                "mode": "0644",
                "logical_owner": "pending",
                "reason": "must remain absent",
            }
        ]
        with self.assertRaisesRegex(ASSEMBLER.AssembleError, "may not carry candidate payload bytes"):
            ASSEMBLER.assemble(
                self.root,
                manifest,
                self.root / "payload",
                allow_unresolved=True,
                generated_sources=self.generated_map,
            )

    def test_physical_authorization_is_refused_by_candidate_assembler(self):
        manifest_path = self.root / "manifest.json"
        manifest = manifest_for(self.data, unresolved=False)
        manifest["physical_write_allowed"] = True
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ASSEMBLER.AssembleError, "physically authorized"):
            ASSEMBLER.load_manifest(manifest_path)


if __name__ == "__main__":
    unittest.main()
