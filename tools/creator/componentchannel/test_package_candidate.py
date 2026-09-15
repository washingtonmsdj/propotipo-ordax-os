import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import package_candidate as pack


class PackageCandidateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.exe = self.root / "inspection.exe"
        self.exe.write_bytes(b"ordax-read-only-inspection\n" * 100)
        self.commit = "0123456789abcdef0123456789abcdef01234567"

    def tearDown(self):
        self.temp.cleanup()

    def build(self, name: str, sequence: int = 1):
        out = self.root / name
        manifest = pack.package_candidate(self.exe, out, "0.1.0", sequence, self.commit)
        return out, manifest

    def test_package_is_byte_deterministic(self):
        first, first_manifest = self.build("first")
        second, second_manifest = self.build("second")
        self.assertEqual(first_manifest, second_manifest)
        self.assertEqual(
            (first / pack.BUNDLE_NAME).read_bytes(),
            (second / pack.BUNDLE_NAME).read_bytes(),
        )
        self.assertEqual(
            (first / pack.MANIFEST_NAME).read_bytes(),
            (second / pack.MANIFEST_NAME).read_bytes(),
        )

    def test_manifest_binds_exact_bundle_and_component(self):
        out, manifest = self.build("release", sequence=7)
        bundle = out / pack.BUNDLE_NAME
        component_sha = hashlib.sha256(self.exe.read_bytes()).hexdigest()
        bundle_sha = hashlib.sha256(bundle.read_bytes()).hexdigest()
        self.assertEqual(manifest["$schema"], pack.MANIFEST_SCHEMA)
        self.assertEqual(manifest["purpose"], pack.PURPOSE)
        self.assertEqual(manifest["source_repository"], pack.SOURCE_REPOSITORY)
        self.assertEqual(manifest["source_commit"], self.commit)
        self.assertEqual(manifest["release_sequence"], 7)
        self.assertEqual(manifest["bundle"]["url"], pack.BUNDLE_URL)
        self.assertEqual(manifest["bundle"]["sha256"], bundle_sha)
        self.assertEqual(manifest["bundle"]["size"], bundle.stat().st_size)
        self.assertEqual(manifest["file"]["name"], pack.COMPONENT_NAME)
        self.assertEqual(manifest["file"]["sha256"], component_sha)
        self.assertEqual(manifest["file"]["size"], self.exe.stat().st_size)
        on_disk = json.loads((out / pack.MANIFEST_NAME).read_text(encoding="utf-8"))
        self.assertEqual(on_disk, manifest)

        with zipfile.ZipFile(bundle, "r") as archive:
            self.assertEqual(archive.namelist(), [pack.COMPONENT_NAME])
            info = archive.getinfo(pack.COMPONENT_NAME)
            self.assertEqual(info.date_time, (1980, 1, 1, 0, 0, 0))
            self.assertEqual(info.compress_type, zipfile.ZIP_STORED)
            self.assertEqual(archive.read(pack.COMPONENT_NAME), self.exe.read_bytes())

    def test_existing_outputs_are_never_overwritten(self):
        out, _ = self.build("once")
        original_bundle = (out / pack.BUNDLE_NAME).read_bytes()
        with self.assertRaisesRegex(pack.PackagingError, "refusing to replace"):
            pack.package_candidate(self.exe, out, "0.1.0", 2, self.commit)
        self.assertEqual((out / pack.BUNDLE_NAME).read_bytes(), original_bundle)

    def test_invalid_identity_fields_fail_before_output(self):
        cases = [
            ("bad", "0.1.0", 1),
            (self.commit, "bad version", 1),
            (self.commit, "0.1.0", 0),
        ]
        for index, (commit, version, sequence) in enumerate(cases):
            out = self.root / f"invalid-{index}"
            with self.assertRaises(pack.PackagingError):
                pack.package_candidate(self.exe, out, version, sequence, commit)
            self.assertFalse((out / pack.BUNDLE_NAME).exists())
            self.assertFalse((out / pack.MANIFEST_NAME).exists())

    def test_symlink_component_is_rejected_when_supported(self):
        link = self.root / "component-link.exe"
        try:
            link.symlink_to(self.exe)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable")
        with self.assertRaisesRegex(pack.PackagingError, "symlinks or junctions"):
            pack.package_candidate(link, self.root / "linked", "0.1.0", 1, self.commit)

    def test_symlink_parent_traversal_is_rejected_when_supported(self):
        real_parent = self.root / "real-parent"
        real_parent.mkdir()
        nested_exe = real_parent / "inspection.exe"
        nested_exe.write_bytes(b"read-only")
        parent_link = self.root / "parent-link"
        output_real = self.root / "output-real"
        output_real.mkdir()
        output_link = self.root / "output-link"
        try:
            parent_link.symlink_to(real_parent, target_is_directory=True)
            output_link.symlink_to(output_real, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("directory symlinks unavailable")

        with self.assertRaisesRegex(pack.PackagingError, "symlinks or junctions"):
            pack.package_candidate(parent_link / "inspection.exe", self.root / "safe-out", "0.1.0", 1, self.commit)
        with self.assertRaisesRegex(pack.PackagingError, "symlinks or junctions"):
            pack.package_candidate(self.exe, output_link / "nested", "0.1.0", 1, self.commit)


if __name__ == "__main__":
    unittest.main()
