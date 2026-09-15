import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "verify" / "module_boundaries.py"
SPEC = importlib.util.spec_from_file_location("ordax_module_boundaries", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)
CONTRACT = json.loads(
    (ROOT / "docs" / "contracts" / "module-boundaries.json").read_text(encoding="utf-8")
)


class ModuleBoundaryVerifierTests(unittest.TestCase):
    def write(self, root: Path, rel: str, content: str):
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def seed_roots(self, root: Path):
        for rel in (
            "system/contracts",
            "system/services",
            "system/apps",
            "system/surface",
            "system/adapters/web",
            "system/adapters/mobile",
            "system/adapters/desktop",
            "system/adapters/native",
            "bootstrap",
            "tools/creator",
        ):
            (root / rel).mkdir(parents=True, exist_ok=True)

    def test_current_repository_has_no_import_boundary_violations(self):
        self.assertEqual(MODULE.find_violations(ROOT, CONTRACT), [])

    def test_relative_surface_import_of_adapter_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/surface/view.ts",
                'import { camera } from "../adapters/mobile/camera";\n',
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("surface may not import adapters" in item for item in violations))

    def test_allowed_surface_import_of_app_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(root, "system/surface/view.ts", 'import "../apps/files";\n')
            self.assertEqual(MODULE.find_violations(root, CONTRACT), [])

    def test_service_import_of_surface_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(root, "system/services/sync/client.ts", 'import "../../surface/view";\n')
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("services may not import surface" in item for item in violations))

    def test_adapter_modes_cannot_import_each_other(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/adapters/web/runtime.ts",
                'import "../mobile/runtime";\n',
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("adapter mode web may not import mobile" in item for item in violations))

    def test_ordax_alias_is_resolved_to_shared_layer(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/apps/files/index.ts",
                'import { sync } from "@ordax/services/sync";\n',
            )
            self.assertEqual(MODULE.find_violations(root, CONTRACT), [])

    def test_creator_source_cannot_import_shared_product_implementation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "tools/creator/client.ts",
                'import "../../system/surface/view";\n',
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("Creator source may not import shared system" in item for item in violations))


if __name__ == "__main__":
    unittest.main()
