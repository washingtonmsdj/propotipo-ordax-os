import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
CONTRACT = ROOT / "system" / "contracts" / "file-space.mjs"
CONTROLS = ROOT / "system" / "surface" / "ui" / "file-space-controls.mjs"
CSS = ROOT / "system" / "surface" / "ui" / "files.css"

spec = importlib.util.spec_from_file_location("ordax_native_host_modified_time_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class FilesModifiedTimeTests(unittest.TestCase):
    def test_native_listing_exposes_real_epoch_milliseconds(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            path = user_root / "note.txt"
            path.write_text("ordax", encoding="utf-8")
            expected_ns = 1_700_000_000_123_000_000
            os.utime(path, ns=(expected_ns, expected_ns))

            listing = native_host.list_user_directory(str(user_root), "/")
            entry = next(item for item in listing["entries"] if item["name"] == "note.txt")
            self.assertEqual(entry["modifiedAt"], expected_ns // 1_000_000)
            self.assertEqual(entry["size"], 5)

    def test_contract_requires_safe_non_negative_modified_at(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        self.assertIn('ordax.file-space/10', contract)
        self.assertIn("Number.isSafeInteger(value.modifiedAt)", contract)
        self.assertIn("value.modifiedAt < 0", contract)
        self.assertIn("modifiedAt: value.modifiedAt", contract)

    def test_surface_displays_and_sorts_modified_time_without_inventing_it(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn("formatModifiedAt", controls)
        self.assertIn("Intl.DateTimeFormat", controls)
        self.assertIn('sortKey === "modified"', controls)
        self.assertIn("left.modifiedAt - right.modifiedAt", controls)
        self.assertIn('sortButton("Modificado", "modified")', controls)
        self.assertIn("formatModifiedAt(entry.modifiedAt)", controls)
        self.assertIn("formatModifiedAt(selected.modifiedAt)", controls)

    def test_modified_column_is_part_of_real_list_layout(self):
        css = CSS.read_text(encoding="utf-8")
        self.assertIn("minmax(180px, 1fr) 90px 86px 132px", css)
        self.assertIn("nth-child(3)", css)


if __name__ == "__main__":
    unittest.main()
