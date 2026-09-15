import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "verify" / "json_contracts.py"
SPEC = importlib.util.spec_from_file_location("ordax_json_contracts", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class JsonContractDiscoveryTests(unittest.TestCase):
    def write(self, root: Path, rel: str, content: str):
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def valid(self, schema="prototype-ordax.example/1"):
        return json.dumps({"$schema": schema, "status": "test"}) + "\n"

    def test_current_repository_contracts_and_sources_are_strict_json(self):
        errors, contract_count, manifest_count = MODULE.validate_repository(ROOT)
        self.assertEqual(errors, [])
        self.assertGreater(contract_count, 0)
        self.assertGreater(manifest_count, 0)

    def test_new_nested_contract_is_discovered_without_ci_edit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(root, "docs/contracts/nested/new-feature.json", self.valid())
            paths = [path.relative_to(root).as_posix() for path in MODULE.discover_contracts(root)]
            self.assertEqual(paths, ["docs/contracts/nested/new-feature.json"])

    def test_duplicate_keys_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = self.write(
                root,
                "docs/contracts/duplicate.json",
                '{"$schema":"prototype-ordax.duplicate/1","status":"a","status":"b"}\n',
            )
            errors = MODULE.validate_document(path, root)
            self.assertTrue(any("duplicate JSON key" in error for error in errors))

    def test_missing_or_malformed_schema_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            missing = self.write(root, "docs/contracts/missing.json", '{"status":"test"}\n')
            malformed = self.write(
                root,
                "docs/contracts/malformed.json",
                '{"$schema":"anything/1","status":"test"}\n',
            )
            self.assertTrue(MODULE.validate_document(missing, root))
            self.assertTrue(MODULE.validate_document(malformed, root))

    def test_boot_and_bootstrap_source_manifests_are_discovered(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(root, "boot/esp/source.json", self.valid("prototype-ordax.esp-source/1"))
            self.write(
                root,
                "bootstrap/network/source.json",
                self.valid("prototype-ordax.network-source/1"),
            )
            paths = [
                path.relative_to(root).as_posix()
                for path in MODULE.discover_source_manifests(root)
            ]
            self.assertEqual(
                paths,
                ["boot/esp/source.json", "bootstrap/network/source.json"],
            )

    def test_non_object_contract_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = self.write(root, "docs/contracts/list.json", '[]\n')
            errors = MODULE.validate_document(path, root)
            self.assertTrue(any("top-level JSON value must be an object" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
