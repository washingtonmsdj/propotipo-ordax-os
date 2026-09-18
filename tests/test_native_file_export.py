import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
ADAPTER = ROOT / "system" / "adapters" / "native" / "file-space.mjs"
CONTROLS = ROOT / "system" / "surface" / "ui" / "file-space-controls.mjs"
CONTRACT = ROOT / "system" / "contracts" / "file-space.mjs"

spec = importlib.util.spec_from_file_location("ordax_native_host_export_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class NativeFileExportTests(unittest.TestCase):
    def test_regular_file_export_returns_exact_bytes_and_name(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            payload = b"\x00OrdaX\xff\n"
            (user_root / "arquivo.bin").write_bytes(payload)

            name, exported = native_host.read_user_export_file(
                str(user_root), "/arquivo.bin"
            )
            self.assertEqual(name, "arquivo.bin")
            self.assertEqual(exported, payload)

    def test_export_is_bounded_and_rejects_non_regular_or_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            user_root = base / "home"
            outside = base / "outside"
            user_root.mkdir()
            outside.mkdir()
            (user_root / "large.bin").write_bytes(b"12345")
            (user_root / "folder").mkdir()
            (outside / "secret.bin").write_bytes(b"secret")
            os.symlink(outside / "secret.bin", user_root / "link.bin")

            with self.assertRaises(native_host.FileSpaceExportTooLargeError):
                native_host.read_user_export_file(
                    str(user_root), "/large.bin", max_bytes=4
                )
            with self.assertRaises(ValueError):
                native_host.read_user_export_file(str(user_root), "/folder")
            with self.assertRaises(OSError):
                native_host.read_user_export_file(str(user_root), "/link.bin")

    def test_adapter_exports_through_same_origin_fetch_and_browser_download(self):
        adapter = ADAPTER.read_text(encoding="utf-8")
        contract = CONTRACT.read_text(encoding="utf-8")
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn('ordax.file-space/8', contract)
        self.assertIn("MAX_FILE_EXPORT_BYTES = 64 * 1024 * 1024", contract)
        self.assertIn("exportFile()", contract)
        self.assertIn('FILE_EXPORT_ENDPOINT = "/__ordax/native/file-export"', adapter)
        self.assertIn('credentials: "same-origin"', adapter)
        self.assertIn("response.blob()", adapter)
        self.assertIn("createObjectURL", adapter)
        self.assertIn("anchor.download = fileNameFromPath(path)", adapter)
        self.assertIn("revokeObjectURL", adapter)
        self.assertIn("exportSelected", controls)
        self.assertIn("limite de exportação de 64 MiB", controls)

    def test_native_server_marks_download_as_attachment_and_nosniff(self):
        server = SERVER.read_text(encoding="utf-8")
        self.assertIn('Content-Type", "application/octet-stream"', server)
        self.assertIn("attachment; filename*=UTF-8''", server)
        self.assertIn('Content-Length", str(len(payload))', server)
        self.assertIn('X-Content-Type-Options", "nosniff"', server)
        self.assertIn('Cache-Control", "no-store"', server)


if __name__ == "__main__":
    unittest.main()
