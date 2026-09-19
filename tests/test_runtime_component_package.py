from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import json
import shutil
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "tools" / "component-package" / "build.py"
POLICY = ROOT / "docs" / "contracts" / "runtime-component-package.json"


def load_builder():
    spec = spec_from_file_location("ordax_runtime_component_package_test", BUILDER_PATH)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class RuntimeComponentPackageTests(unittest.TestCase):
    def test_policy_is_candidate_only_and_fail_closed(self):
        policy = json.loads(POLICY.read_text(encoding="utf-8"))
        self.assertEqual(
            policy["$schema"],
            "prototype-ordax.runtime-component-package-policy/1",
        )
        self.assertEqual(policy["status"], "candidate-packaging")
        self.assertEqual(policy["supported_components"], ["internet"])
        self.assertTrue(policy["self_contained_source_graph_required"])
        self.assertFalse(policy["remote_runtime_dependencies_allowed"])
        self.assertFalse(policy["native_adapters_may_be_packaged"])
        self.assertFalse(policy["composition_may_be_packaged"])
        self.assertTrue(policy["signature_required_before_activation"])
        self.assertFalse(policy["activation_allowed_from_unsigned_candidate"])
        self.assertFalse(policy["publish_allowed"])
        self.assertFalse(policy["rollback_slot_activation_available"])

    def test_internet_metadata_comes_from_canonical_component_manifest(self):
        builder = load_builder()
        metadata = builder.load_component_metadata("internet")
        component = metadata["component"]
        self.assertEqual(component["id"], "internet")
        self.assertEqual(component["version"], "0.3.0")
        self.assertEqual(component["releaseMode"], "git-app")
        self.assertEqual(component["restartScope"], "component")
        self.assertEqual(component["healthMode"], "runtime")
        self.assertEqual(
            metadata["entrypoint"].as_posix(),
            "system/apps/internet/runtime.mjs",
        )

    def test_internet_candidate_graph_is_self_contained_and_excludes_platform_code(self):
        builder = load_builder()
        metadata, graph = builder.component_graph("internet")
        paths = {path.as_posix() for path in graph}
        self.assertIn(metadata["entrypoint"].as_posix(), paths)
        self.assertIn("system/apps/internet/internet.css", paths)
        self.assertIn("system/contracts/browser-session.mjs", paths)
        self.assertIn("system/apps/internet/services/history.mjs", paths)
        self.assertIn("system/apps/internet/ui/browser-controls.mjs", paths)
        self.assertFalse(any(path.startswith("system/adapters/") for path in paths))
        self.assertFalse(any(path.startswith("system/composition/") for path in paths))
        self.assertFalse(any(path.startswith("system/surface/runtime/") for path in paths))

    def test_package_build_is_byte_deterministic_and_verifiable(self):
        builder = load_builder()
        source_commit = "1" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "internet-a.zip"
            second = root / "internet-b.zip"

            first_manifest = builder.build_package(
                "internet",
                source_commit,
                first,
            )
            second_manifest = builder.build_package(
                "internet",
                source_commit,
                second,
            )

            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(
                hashlib.sha256(first.read_bytes()).hexdigest(),
                hashlib.sha256(second.read_bytes()).hexdigest(),
            )
            verified = builder.verify_package(first)
            self.assertEqual(verified, first_manifest)
            self.assertEqual(verified, second_manifest)
            self.assertEqual(verified["component"]["version"], "0.3.0")
            self.assertFalse(verified["activation_allowed"])
            self.assertTrue(verified["signature_required_before_activation"])
            self.assertFalse(verified["native_adapters_packaged"])
            self.assertFalse(verified["composition_packaged"])

    def test_tampered_file_is_rejected(self):
        builder = load_builder()
        source_commit = "2" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "internet.zip"
            tampered = root / "tampered.zip"
            builder.build_package("internet", source_commit, original)

            with zipfile.ZipFile(original, "r") as source:
                entries = {
                    info.filename: source.read(info.filename)
                    for info in source.infolist()
                }
            runtime = "system/apps/internet/runtime.mjs"
            entries[runtime] += b"\n// tampered\n"

            with zipfile.ZipFile(tampered, "w", compression=zipfile.ZIP_STORED) as target:
                for name in sorted(entries):
                    target.writestr(builder.zip_info(name), entries[name])

            with self.assertRaisesRegex(
                builder.ComponentPackageError,
                "integrity mismatch",
            ):
                builder.verify_package(tampered)

    def test_archive_traversal_and_unreachable_payload_are_rejected(self):
        builder = load_builder()
        source_commit = "3" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "internet.zip"
            malicious = root / "malicious.zip"
            builder.build_package("internet", source_commit, original)

            with zipfile.ZipFile(original, "r") as source:
                entries = [
                    (info.filename, source.read(info.filename))
                    for info in source.infolist()
                ]
            with zipfile.ZipFile(malicious, "w", compression=zipfile.ZIP_STORED) as target:
                for name, payload in entries:
                    target.writestr(builder.zip_info(name), payload)
                target.writestr(builder.zip_info("../escape.mjs"), b"export {};\n")

            with self.assertRaisesRegex(
                builder.ComponentPackageError,
                "unsafe package path",
            ):
                builder.verify_package(malicious)

    def test_shared_source_graph_detects_import_meta_assets(self):
        builder = load_builder()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = root / "system" / "components" / "sample" / "runtime.mjs"
            style = root / "system" / "components" / "sample" / "style.css"
            helper = root / "system" / "contracts" / "sample.mjs"
            entry.parent.mkdir(parents=True)
            helper.parent.mkdir(parents=True)
            entry.write_text(
                'import "../../contracts/sample.mjs";\n'
                'export const style = new URL("./style.css", import.meta.url).href;\n',
                encoding="utf-8",
            )
            style.write_text(".sample { display: block; }\n", encoding="utf-8")
            helper.write_text("export const sample = true;\n", encoding="utf-8")

            graph = builder.discover_graph(
                root,
                builder.PurePosixPath("system/components/sample/runtime.mjs"),
                allowed_prefixes=("system",),
            )
            self.assertEqual(
                {path.as_posix() for path in graph},
                {
                    "system/components/sample/runtime.mjs",
                    "system/components/sample/style.css",
                    "system/contracts/sample.mjs",
                },
            )


if __name__ == "__main__":
    unittest.main()
