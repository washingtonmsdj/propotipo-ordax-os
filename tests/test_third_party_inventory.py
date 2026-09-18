import ast
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = ROOT / "platform" / "compliance" / "declared-inputs.json"
KERNEL_SOURCE = ROOT / "bootstrap" / "kernel" / "source.json"
DEV_CORE = ROOT / "bootstrap" / "dev-base" / "_build_core.py"
DEV_BUILD = ROOT / "bootstrap" / "dev-base" / "build.py"
SURFACE = ROOT / "system" / "surface" / "bin" / "ordax-surface"


def assignment_literals(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    values = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if isinstance(target, ast.Name):
            try:
                values[target.id] = ast.literal_eval(node.value)
            except (ValueError, TypeError):
                pass
    return values


class ThirdPartyInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
        cls.by_id = {item["id"]: item for item in cls.inventory["inputs"]}

    def test_inventory_is_explicitly_not_a_release_sbom(self):
        self.assertEqual(self.inventory["status"], "declared-inputs-not-sbom")
        self.assertFalse(self.inventory["limitations"]["full_transitive_dependency_inventory"])
        self.assertFalse(self.inventory["limitations"]["final_shipped_bytes_inventory"])
        self.assertFalse(self.inventory["limitations"]["usable_as_release_sbom"])

    def test_kernel_input_matches_canonical_source_file(self):
        source = json.loads(KERNEL_SOURCE.read_text(encoding="utf-8"))
        item = self.by_id["linux-kernel"]
        self.assertEqual(item["version"], source["version"])
        self.assertEqual(item["archive_url"], source["archive_url"])
        self.assertEqual(item["archive_sha256"], source["archive_sha256"])

    def test_development_base_input_matches_selected_packages(self):
        core = assignment_literals(DEV_CORE)
        build = assignment_literals(DEV_BUILD)
        item = self.by_id["alpine-development-base"]
        self.assertEqual(item["version"], core["ALPINE_VERSION"])
        self.assertEqual(item["branch"], core["ALPINE_BRANCH"])
        self.assertEqual(item["arch"], core["ARCH"])
        self.assertEqual(item["packages"], core["PACKAGES"])
        self.assertEqual(item["build_only_packages"], list(build["BUILD_ONLY_PACKAGES"]))

    def test_native_surface_runtime_matches_apk_request(self):
        text = SURFACE.read_text(encoding="utf-8")
        match = re.search(
            r"--initdb add \\\n\s+([^\n]+) \\\n\s+([^\n]+) \\\n\s+([^\n]+) >>\"\$HOST_LOG\"",
            text,
        )
        self.assertIsNotNone(match)
        packages = []
        for group in match.groups():
            packages.extend(group.split())
        item = self.by_id["alpine-native-surface-runtime"]
        self.assertEqual(item["packages"], packages)
        self.assertIn("https://dl-cdn.alpinelinux.org/alpine/v3.22/main", text)
        self.assertIn("https://dl-cdn.alpinelinux.org/alpine/v3.22/community", text)

    def test_unresolved_license_records_do_not_invent_spdx_ids(self):
        for item in self.inventory["inputs"]:
            with self.subTest(component=item["id"]):
                license_info = item["license"]
                self.assertEqual(license_info["status"], "unresolved-in-this-inventory")
                self.assertIsNone(license_info["spdx"])


if __name__ == "__main__":
    unittest.main()
