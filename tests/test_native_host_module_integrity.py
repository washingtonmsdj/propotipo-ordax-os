from pathlib import Path
import ast
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
REQUEST_BOUNDARY = ROOT / "system" / "surface" / "runtime" / "native_request_boundary.py"
SPLIT_CORE = ROOT / "system" / "surface" / "runtime" / "native_host_server_core.py"


class NativeHostModuleIntegrityTests(unittest.TestCase):
    def test_native_host_keeps_one_canonical_runtime_module(self):
        source = HOST.read_text(encoding="utf-8")
        tree = ast.parse(source)

        classes = {
            node.name: node
            for node in tree.body
            if isinstance(node, ast.ClassDef)
        }
        functions = {
            node.name: node
            for node in tree.body
            if isinstance(node, ast.FunctionDef)
        }

        self.assertIn("NativeHostServer", classes)
        self.assertIn("NativeHostHandler", classes)
        self.assertIn("main", functions)

        handler_methods = {
            node.name
            for node in classes["NativeHostHandler"].body
            if isinstance(node, ast.FunctionDef)
        }
        self.assertIn("do_GET", handler_methods)
        self.assertIn("do_POST", handler_methods)
        self.assertIn("do_OPTIONS", handler_methods)

        self.assertFalse(
            SPLIT_CORE.exists(),
            "native host state/functions must not be split behind a wildcard wrapper",
        )
        self.assertNotIn("native_host_server_core", source)
        self.assertNotIn("import *", source)
        self.assertTrue(REQUEST_BOUNDARY.is_file(), REQUEST_BOUNDARY)
        self.assertIn("from native_request_boundary import expected_surface_authority, request_is_trusted", source)
        self.assertIn("def _request_is_trusted(self)", source)
        for method in ("do_GET", "do_POST", "do_OPTIONS"):
            method_node = next(
                node
                for node in classes["NativeHostHandler"].body
                if isinstance(node, ast.FunctionDef) and node.name == method
            )
            method_source = ast.get_source_segment(source, method_node) or ""
            self.assertIn("self._request_is_trusted()", method_source)


if __name__ == "__main__":
    unittest.main()
