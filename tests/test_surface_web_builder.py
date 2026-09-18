import importlib.util
from pathlib import Path, PurePosixPath
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "surface-web" / "build.py"
SPEC = importlib.util.spec_from_file_location("ordax_surface_web_builder", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class SurfaceWebBuilderTests(unittest.TestCase):
    def test_current_source_graph_discovers_shared_surface_apps_services_adapter_and_contract(self):
        graph = {path.as_posix() for path in MODULE.discover_graph(ROOT)}
        for expected in (
            "system/composition/web/index.html",
            "system/composition/web/main.mjs",
            "system/surface/ui/surface.mjs",
            "system/surface/ui/surface-state.mjs",
            "system/apps/catalog.mjs",
            "system/apps/app-contract.mjs",
            "system/apps/files/app.mjs",
            "system/apps/settings/app.mjs",
            "system/apps/account/app.mjs",
            "system/apps/system/app.mjs",
            "system/services/preferences/appearance.mjs",
            "system/services/preferences/catalog.mjs",
            "system/services/apps/activation.mjs",
            "system/adapters/web/runtime.mjs",
            "system/adapters/web/preferences.mjs",
            "system/contracts/surface-host.mjs",
            "system/contracts/preference-store.mjs",
            "system/contracts/app-activation.mjs",
            "system/surface/ui/tokens.css",
            "system/surface/ui/surface.css",
            "system/surface/ui/files.css",
            "system/surface/ui/system.css",
            "system/surface/ui/system-overview-controls.mjs",
        ):
            self.assertIn(expected, graph)

    def test_multiline_es_module_import_is_discovered(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            composition = root / "system" / "composition" / "web"
            composition.mkdir(parents=True)
            (composition / "index.html").write_text(
                '<script type="module" src="./main.mjs"></script>', encoding="utf-8"
            )
            (composition / "main.mjs").write_text(
                'import {\n  value,\n} from "../../services/preferences/value.mjs";\nconsole.log(value);\n',
                encoding="utf-8",
            )
            dependency = root / "system" / "services" / "preferences" / "value.mjs"
            dependency.parent.mkdir(parents=True)
            dependency.write_text('export const value = "ok";\n', encoding="utf-8")
            graph = {
                path.as_posix()
                for path in MODULE.discover_graph(
                    root, PurePosixPath("system/composition/web/index.html")
                )
            }
            self.assertIn("system/services/preferences/value.mjs", graph)

    def test_build_is_byte_reproducible_for_same_commit(self):
        commit = "1" * 40
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out_a = root / "a"
            out_b = root / "b"
            MODULE.build_bundle(out_a, commit, ROOT)
            MODULE.build_bundle(out_b, commit, ROOT)
            files_a = {
                p.relative_to(out_a).as_posix(): p.read_bytes()
                for p in out_a.rglob("*")
                if p.is_file()
            }
            files_b = {
                p.relative_to(out_b).as_posix(): p.read_bytes()
                for p in out_b.rglob("*")
                if p.is_file()
            }
            self.assertEqual(files_a, files_b)
            MODULE.verify_bundle(out_a)
            MODULE.verify_bundle(out_b)

    def test_nonempty_output_is_never_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "bundle"
            out.mkdir()
            marker = out / "keep.txt"
            marker.write_text("keep", encoding="utf-8")
            with self.assertRaises(MODULE.BundleError):
                MODULE.build_bundle(out, "2" * 40, ROOT)
            self.assertEqual(marker.read_text(encoding="utf-8"), "keep")

    def test_remote_dependency_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            entry = root / "system" / "composition" / "web" / "index.html"
            entry.parent.mkdir(parents=True)
            entry.write_text('<script src="https://example.invalid/app.js"></script>', encoding="utf-8")
            with self.assertRaises(MODULE.BundleError):
                MODULE.discover_graph(root, PurePosixPath("system/composition/web/index.html"))

    def test_path_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            entry = root / "system" / "composition" / "web" / "index.html"
            entry.parent.mkdir(parents=True)
            entry.write_text('<script src="../../../../outside.js"></script>', encoding="utf-8")
            with self.assertRaises(MODULE.BundleError):
                MODULE.discover_graph(root, PurePosixPath("system/composition/web/index.html"))

    def test_generated_root_index_has_deployable_local_paths(self):
        rendered = MODULE.render_root_index(ROOT).decode("utf-8")
        self.assertNotIn("../", rendered)
        self.assertIn("./system/surface/ui/tokens.css", rendered)
        self.assertIn("./system/surface/ui/files.css", rendered)
        self.assertIn("./system/surface/ui/system.css", rendered)
        self.assertIn("./system/composition/web/main.mjs", rendered)
        self.assertNotIn("https://", rendered)


if __name__ == "__main__":
    unittest.main()
