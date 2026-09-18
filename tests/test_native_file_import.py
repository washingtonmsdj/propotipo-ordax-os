import importlib.util
import io
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
ADAPTER = ROOT / "system" / "adapters" / "native" / "file-space.mjs"
CONTROLS = ROOT / "system" / "surface" / "ui" / "file-space-controls.mjs"
CONTRACT = ROOT / "system" / "contracts" / "file-space.mjs"

spec = importlib.util.spec_from_file_location("ordax_native_host_import_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class NativeFileImportTests(unittest.TestCase):
    def test_binary_import_is_no_clobber_and_returns_real_listing(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            payload = b"\x00OrdaX\xff\n"

            listing = native_host.import_user_file(
                str(user_root),
                "/",
                "importado.bin",
                io.BytesIO(payload),
                len(payload),
            )
            self.assertEqual((user_root / "importado.bin").read_bytes(), payload)
            entry = next(item for item in listing["entries"] if item["name"] == "importado.bin")
            self.assertEqual(entry["kind"], "file")
            self.assertEqual(entry["size"], len(payload))
            self.assertIsInstance(entry["modifiedAt"], int)

            with self.assertRaises(FileExistsError):
                native_host.import_user_file(
                    str(user_root),
                    "/",
                    "importado.bin",
                    io.BytesIO(b"replacement"),
                    len(b"replacement"),
                )
            self.assertEqual((user_root / "importado.bin").read_bytes(), payload)

    def test_import_limit_and_short_body_remove_partial_destination(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()

            with self.assertRaises(native_host.FileSpaceImportTooLargeError):
                native_host.import_user_file(
                    str(user_root),
                    "/",
                    "large.bin",
                    io.BytesIO(b"12345"),
                    5,
                    max_bytes=4,
                )
            self.assertFalse((user_root / "large.bin").exists())

            with self.assertRaises(native_host.FileSpaceImportIncompleteError):
                native_host.import_user_file(
                    str(user_root),
                    "/",
                    "partial.bin",
                    io.BytesIO(b"abc"),
                    8,
                )
            self.assertFalse((user_root / "partial.bin").exists())

    def test_import_target_query_is_strict_and_bounded_to_logical_root(self):
        path, name = native_host.requested_file_import_target(
            "/__ordax/native/file-import?path=%2FDocumentos&name=relat%C3%B3rio.txt"
        )
        self.assertEqual(path, "/Documentos")
        self.assertEqual(name, "relatório.txt")

        for target in (
            "/__ordax/native/file-import?path=%2FDocumentos",
            "/__ordax/native/file-import?path=%2F..%2Foutside&name=x.txt",
            "/__ordax/native/file-import?path=%2F&name=..%2Fescape",
            "/__ordax/native/file-import?path=%2F&name=x.txt&extra=1",
        ):
            with self.subTest(target=target):
                with self.assertRaises(ValueError):
                    native_host.requested_file_import_target(target)

    def test_contract_adapter_and_surface_require_explicit_user_selected_bytes(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn('ordax.file-space/8', contract)
        self.assertIn("MAX_FILE_IMPORT_BYTES = 64 * 1024 * 1024", contract)
        self.assertIn("importFile()", contract)
        self.assertIn('FILE_IMPORT_ENDPOINT = "/__ordax/native/file-import"', adapter)
        self.assertIn("bytes instanceof Uint8Array", adapter)
        self.assertIn('"Content-Type": "application/octet-stream"', adapter)
        self.assertIn('credentials: "same-origin"', adapter)
        self.assertIn('importPicker.type = "file"', controls)
        self.assertIn("importPicker.multiple = false", controls)
        self.assertIn("file.arrayBuffer()", controls)
        self.assertIn("new Uint8Array(buffer)", controls)
        self.assertIn("MAX_FILE_IMPORT_BYTES", controls)

    def test_server_streams_import_and_requires_binary_content_type(self):
        server = SERVER.read_text(encoding="utf-8")
        self.assertIn("source.read(min(65536, remaining))", server)
        self.assertIn("os.O_EXCL", server)
        self.assertIn('getattr(os, "O_NOFOLLOW", 0)', server)
        self.assertIn("os.fsync(destination_fd)", server)
        self.assertIn("os.unlink(name, dir_fd=directory_fd)", server)
        self.assertIn('content_type != "application/octet-stream"', server)
        self.assertIn("FileSpaceImportIncompleteError", server)
        self.assertIn("self._write_json(201, listing)", server)


if __name__ == "__main__":
    unittest.main()
