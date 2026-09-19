import errno
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
CONTRACT = ROOT / "system" / "contracts" / "file-space.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "file-space.mjs"
NATIVE_RUNTIME = ROOT / "system" / "adapters" / "native" / "runtime.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
CONTROLS = ROOT / "system" / "surface" / "ui" / "file-space-controls.mjs"
APP_ACTIVATION_CONTRACT = ROOT / "system" / "contracts" / "app-activation.mjs"
APP_ACTIVATION_SERVICE = ROOT / "system" / "services" / "apps" / "activation.mjs"
DESKTOP_SHELL = ROOT / "system" / "surface" / "ui" / "desktop-shell.mjs"
FILES_CSS = ROOT / "system" / "surface" / "ui" / "files.css"
SURFACE_LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"
FILES_APP = ROOT / "system" / "apps" / "files" / "app.mjs"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"

spec = importlib.util.spec_from_file_location("ordax_native_host_files_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class NativeUserFilesTests(unittest.TestCase):
    def test_file_space_contract_and_native_adapter_are_narrow(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        self.assertIn('ordax.file-space/10', contract)
        self.assertIn(
            "list(), createDirectory(), readTextFile(), renameEntry(), copyFile(), moveEntry(), exportFile(), and importFile()",
            contract,
        )
        self.assertIn("MAX_TEXT_FILE_BYTES = 256 * 1024", contract)
        self.assertIn("MAX_FILE_COPY_BYTES = 64 * 1024 * 1024", contract)
        self.assertIn("MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024", contract)
        self.assertIn("validateTextFile", contract)
        self.assertIn("validateImagePreview", contract)
        self.assertIn('/__ordax/native/files', adapter)
        self.assertIn('/__ordax/native/file-content', adapter)
        self.assertIn("validateFileListing", adapter)
        self.assertIn("validateTextFile", adapter)
        self.assertIn("readTextFile", adapter)
        self.assertIn("renameEntry", adapter)
        self.assertIn('"rename-entry"', adapter)
        self.assertIn("copyFile", adapter)
        self.assertIn('"copy-file"', adapter)
        self.assertIn("sourcePath", adapter)
        self.assertIn("destinationPath", adapter)
        self.assertIn("moveEntry", adapter)
        self.assertIn('"move-entry"', adapter)
        self.assertIn("exportFile", adapter)
        self.assertIn('/__ordax/native/file-export', adapter)
        self.assertIn('IMAGE_PREVIEW_ENDPOINT = "/__ordax/native/image-preview"', adapter)
        self.assertIn("readImagePreview", adapter)
        self.assertIn("validateImagePreview", adapter)
        self.assertIn("MAX_IMAGE_PREVIEW_BYTES", adapter)
        self.assertIn("importFile", adapter)
        self.assertIn('/__ordax/native/file-import', adapter)
        self.assertIn("FileSpaceOperationError", adapter)
        self.assertNotIn("surface/ui", adapter)
        self.assertNotIn("innerHTML", adapter)

    def test_native_file_root_lists_and_creates_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            (user_root / "notes.txt").write_text("ordax", encoding="utf-8")

            listing = native_host.list_user_directory(str(user_root), "/")
            self.assertEqual(listing["path"], "/")
            note = next(entry for entry in listing["entries"] if entry["name"] == "notes.txt")
            self.assertEqual(note["kind"], "file")
            self.assertEqual(note["size"], 5)
            self.assertIsInstance(note["modifiedAt"], int)
            self.assertGreaterEqual(note["modifiedAt"], 0)

            created = native_host.create_user_directory(str(user_root), "/", "Documentos")
            self.assertTrue((user_root / "Documentos").is_dir())
            documents = next(entry for entry in created["entries"] if entry["name"] == "Documentos")
            self.assertEqual(documents["kind"], "directory")
            self.assertEqual(documents["size"], 0)
            self.assertIsInstance(documents["modifiedAt"], int)

    def test_text_preview_reads_only_bounded_utf8_regular_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            text_path = user_root / "notes.txt"
            text_path.write_text("Olá OrdaX\nsegunda linha", encoding="utf-8")

            preview = native_host.read_user_text_file(str(user_root), "/notes.txt")
            self.assertEqual(preview["path"], "/notes.txt")
            self.assertEqual(preview["text"], "Olá OrdaX\nsegunda linha")
            self.assertEqual(preview["size"], len(text_path.read_bytes()))

            (user_root / "binary.bin").write_bytes(b"\xff\xfe\x00")
            with self.assertRaises(native_host.FileSpaceTextEncodingError):
                native_host.read_user_text_file(str(user_root), "/binary.bin")

            (user_root / "nul.txt").write_bytes(b"hello\x00world")
            with self.assertRaises(native_host.FileSpaceTextEncodingError):
                native_host.read_user_text_file(str(user_root), "/nul.txt")

            (user_root / "large.txt").write_bytes(b"a" * (native_host.MAX_TEXT_FILE_BYTES + 1))
            with self.assertRaises(native_host.FileSpaceTextTooLargeError):
                native_host.read_user_text_file(str(user_root), "/large.txt")

            (user_root / "folder").mkdir()
            with self.assertRaises(ValueError):
                native_host.read_user_text_file(str(user_root), "/folder")

    def test_image_preview_reads_only_bounded_supported_raster_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            user_root = base / "home"
            outside = base / "outside"
            user_root.mkdir()
            outside.mkdir()

            png_bytes = b"\x89PNG\r\n\x1a\npreview"
            (user_root / "preview.png").write_bytes(png_bytes)
            name, mime, payload = native_host.read_user_image_preview(
                str(user_root),
                "/preview.png",
            )
            self.assertEqual(name, "preview.png")
            self.assertEqual(mime, "image/png")
            self.assertEqual(payload, png_bytes)

            (user_root / "vector.svg").write_text("<svg/>", encoding="utf-8")
            with self.assertRaises(native_host.FileSpaceImagePreviewTypeError):
                native_host.read_user_image_preview(str(user_root), "/vector.svg")

            (user_root / "large.jpg").write_bytes(b"x" * 9)
            with self.assertRaises(native_host.FileSpaceExportTooLargeError):
                native_host.read_user_image_preview(
                    str(user_root),
                    "/large.jpg",
                    max_bytes=8,
                )

            (outside / "secret.png").write_bytes(png_bytes)
            os.symlink(outside / "secret.png", user_root / "escape.png")
            with self.assertRaises(OSError):
                native_host.read_user_image_preview(str(user_root), "/escape.png")

    def test_rename_is_atomic_no_clobber_and_symlink_safe(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            user_root = base / "home"
            outside = base / "outside"
            user_root.mkdir()
            outside.mkdir()

            (user_root / "alpha.txt").write_text("alpha", encoding="utf-8")
            renamed = native_host.rename_user_entry(
                str(user_root),
                "/",
                "alpha.txt",
                "beta.txt",
            )
            self.assertFalse((user_root / "alpha.txt").exists())
            self.assertEqual((user_root / "beta.txt").read_text(encoding="utf-8"), "alpha")
            beta = next(entry for entry in renamed["entries"] if entry["name"] == "beta.txt")
            self.assertEqual(beta["kind"], "file")
            self.assertEqual(beta["size"], 5)
            self.assertIsInstance(beta["modifiedAt"], int)

            (user_root / "folder-a").mkdir()
            native_host.rename_user_entry(str(user_root), "/", "folder-a", "folder-b")
            self.assertTrue((user_root / "folder-b").is_dir())

            (user_root / "source.txt").write_text("source", encoding="utf-8")
            (user_root / "occupied.txt").write_text("keep", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                native_host.rename_user_entry(
                    str(user_root),
                    "/",
                    "source.txt",
                    "occupied.txt",
                )
            self.assertEqual((user_root / "source.txt").read_text(encoding="utf-8"), "source")
            self.assertEqual((user_root / "occupied.txt").read_text(encoding="utf-8"), "keep")

            (outside / "secret.txt").write_text("blocked", encoding="utf-8")
            os.symlink(outside / "secret.txt", user_root / "link.txt")
            with self.assertRaises(ValueError):
                native_host.rename_user_entry(str(user_root), "/", "link.txt", "moved.txt")
            self.assertTrue((user_root / "link.txt").is_symlink())
            self.assertFalse((user_root / "moved.txt").exists())

            with self.assertRaises(ValueError):
                native_host.rename_user_entry(str(user_root), "/", "beta.txt", "../escape")

    def test_copy_is_bounded_no_clobber_and_cleans_partial_destination(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            user_root = base / "home"
            outside = base / "outside"
            user_root.mkdir()
            outside.mkdir()
            (user_root / "Documentos").mkdir()

            source = user_root / "source.txt"
            source.write_text("copy me", encoding="utf-8")
            listing = native_host.copy_user_file(
                str(user_root),
                "/",
                "source.txt",
                "/Documentos",
                "copy.txt",
            )
            self.assertEqual(source.read_text(encoding="utf-8"), "copy me")
            self.assertEqual(
                (user_root / "Documentos" / "copy.txt").read_text(encoding="utf-8"),
                "copy me",
            )
            copied = next(entry for entry in listing["entries"] if entry["name"] == "copy.txt")
            self.assertEqual(listing["path"], "/Documentos")
            self.assertEqual(copied["kind"], "file")
            self.assertEqual(copied["size"], 7)
            self.assertIsInstance(copied["modifiedAt"], int)

            (user_root / "Documentos" / "occupied.txt").write_text("keep", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                native_host.copy_user_file(
                    str(user_root),
                    "/",
                    "source.txt",
                    "/Documentos",
                    "occupied.txt",
                )
            self.assertEqual(
                (user_root / "Documentos" / "occupied.txt").read_text(encoding="utf-8"),
                "keep",
            )
            self.assertEqual(source.read_text(encoding="utf-8"), "copy me")

            (user_root / "large.bin").write_bytes(b"12345")
            with self.assertRaises(native_host.FileSpaceCopyTooLargeError):
                native_host.copy_user_file(
                    str(user_root),
                    "/",
                    "large.bin",
                    "/Documentos",
                    "large-copy.bin",
                    max_bytes=4,
                )
            self.assertFalse((user_root / "Documentos" / "large-copy.bin").exists())

            (outside / "secret.txt").write_text("blocked", encoding="utf-8")
            os.symlink(outside / "secret.txt", user_root / "copy-link.txt")
            with self.assertRaises(OSError):
                native_host.copy_user_file(
                    str(user_root),
                    "/",
                    "copy-link.txt",
                    "/Documentos",
                    "escaped.txt",
                )
            self.assertFalse((user_root / "Documentos" / "escaped.txt").exists())

            with mock.patch.object(
                native_host.os,
                "write",
                side_effect=OSError(errno.EIO, "simulated write failure"),
            ):
                with self.assertRaises(OSError):
                    native_host.copy_user_file(
                        str(user_root),
                        "/",
                        "source.txt",
                        "/Documentos",
                        "partial.txt",
                    )
            self.assertFalse((user_root / "Documentos" / "partial.txt").exists())
            self.assertEqual(source.read_text(encoding="utf-8"), "copy me")

            same_folder = native_host.copy_user_file(
                str(user_root),
                "/",
                "source.txt",
                "/",
                "source - cópia.txt",
            )
            self.assertEqual(same_folder["path"], "/")
            self.assertEqual(
                (user_root / "source - cópia.txt").read_text(encoding="utf-8"),
                "copy me",
            )

    def test_standard_user_directories_are_idempotent_and_symlink_safe(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            user_root = base / "home"
            outside = base / "outside"
            user_root.mkdir()
            outside.mkdir()
            os.symlink(outside, user_root / "Documentos")

            first = native_host.ensure_standard_user_directories(str(user_root))
            second = native_host.ensure_standard_user_directories(str(user_root))

            self.assertNotIn("Documentos", first)
            self.assertNotIn("Documentos", second)
            self.assertIn("Imagens", first)
            self.assertIn("Downloads", first)
            self.assertTrue((user_root / "Imagens").is_dir())
            self.assertTrue((user_root / "Downloads").is_dir())
            self.assertEqual(list(outside.iterdir()), [])

    def test_path_traversal_and_symlink_escape_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            user_root = base / "home"
            outside = base / "outside"
            user_root.mkdir()
            outside.mkdir()
            (outside / "secret.txt").write_text("blocked", encoding="utf-8")
            os.symlink(outside, user_root / "escape")
            os.symlink(outside / "secret.txt", user_root / "secret-link.txt")

            with self.assertRaises(ValueError):
                native_host.list_user_directory(str(user_root), "/../outside")
            with self.assertRaises(ValueError):
                native_host.create_user_directory(str(user_root), "/", "../outside")
            with self.assertRaises(OSError):
                native_host.list_user_directory(str(user_root), "/escape")
            with self.assertRaises(ValueError):
                native_host.read_user_text_file(str(user_root), "/../outside/secret.txt")
            with self.assertRaises(OSError):
                native_host.read_user_text_file(str(user_root), "/secret-link.txt")

            root_listing = native_host.list_user_directory(str(user_root), "/")
            self.assertNotIn("escape", {entry["name"] for entry in root_listing["entries"]})

    def test_native_runtime_keeps_user_data_separate_from_device_state(self):
        launcher = SURFACE_LAUNCHER.read_text(encoding="utf-8")
        self.assertIn('PERSISTENT_NATIVE_STATE=$STATE_ROOT/native-state', launcher)
        self.assertIn('PERSISTENT_USER_HOME=$STATE_ROOT/home', launcher)
        self.assertIn('$RUNTIME_ROOT/var/lib/ordax-user', launcher)
        self.assertIn('--user-root /var/lib/ordax-user', launcher)
        self.assertIn('mount -o bind "$PERSISTENT_USER_HOME"', launcher)
        self.assertIn('umount "$RUNTIME_ROOT/var/lib/ordax-user"', launcher)

    def test_shared_files_controls_consume_only_neutral_port(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        composition = COMPOSITION.read_text(encoding="utf-8")
        activation_contract = APP_ACTIVATION_CONTRACT.read_text(encoding="utf-8")
        activation_service = APP_ACTIVATION_SERVICE.read_text(encoding="utf-8")
        shell = DESKTOP_SHELL.read_text(encoding="utf-8")
        files_css = FILES_CSS.read_text(encoding="utf-8")
        files_app = FILES_APP.read_text(encoding="utf-8")
        self.assertIn("contracts/file-space.mjs", controls)
        self.assertIn("contracts/app-activation.mjs", controls)
        self.assertIn('ordax.app-activation/1', activation_contract)
        self.assertIn("createAppActivationChannel", activation_service)
        self.assertIn('data-app-target="${target}"', shell)
        self.assertIn('data-requires-capability="filesystem.user-space"', shell)
        self.assertIn('[data-window-id="files"]', controls)
        self.assertIn('[data-app-extension="file-space"]', controls)
        self.assertIn("ordax-files-view", controls)
        self.assertIn("ordax-files-breadcrumb", controls)
        self.assertIn("ordax-files-list", controls)
        self.assertIn("createDirectory", controls)
        self.assertIn("readTextFile", controls)
        self.assertIn("data-file-select-path", controls)
        self.assertIn("data-file-activate-selected", controls)
        self.assertIn("data-file-rename-toggle", controls)
        self.assertIn("data-file-rename-confirm", controls)
        self.assertIn("data-file-rename-name", controls)
        self.assertIn("renameSelected", controls)
        self.assertIn("copySelected", controls)
        self.assertIn("transferToCurrentDirectory", controls)
        self.assertIn("data-file-move-toggle", controls)
        self.assertIn("data-file-copy-to-toggle", controls)
        self.assertIn("data-file-transfer-confirm", controls)
        self.assertIn("data-file-transfer-cancel", controls)
        self.assertIn("data-file-copy-toggle", controls)
        self.assertIn("data-file-copy-confirm", controls)
        self.assertIn("data-file-copy-name", controls)
        self.assertIn("MAX_FILE_COPY_BYTES", controls)
        self.assertIn("MAX_FILE_EXPORT_BYTES", controls)
        self.assertIn("MAX_FILE_IMPORT_BYTES", controls)
        self.assertIn("importSelectedFile", controls)
        self.assertIn("data-file-import-toggle", controls)
        self.assertIn("data-file-import-picker", controls)
        self.assertIn("exportSelected", controls)
        self.assertIn("data-file-export", controls)
        self.assertIn("selectedPath", controls)
        self.assertIn("renderSelectionDetails", controls)
        self.assertIn("ordax-files-details", controls)
        self.assertIn("event.key === \"ArrowDown\"", controls)
        self.assertIn("event.key === \"ArrowUp\"", controls)
        self.assertIn("event.key === \"Home\"", controls)
        self.assertIn("event.key === \"End\"", controls)
        self.assertIn("event.key === \"Enter\"", controls)
        self.assertIn('selectedPath === selected.dataset.fileSelectPath', controls)
        self.assertIn("activateSelectedPath()", controls)
        self.assertIn('selectPath(selected.dataset.fileSelectPath, { focus: true })', controls)
        self.assertIn("ordax-files-preview-content", controls)
        self.assertIn("Visualização segura de texto UTF-8", controls)
        self.assertNotIn("innerHTML", controls)
        self.assertNotIn("📁", controls)
        self.assertNotIn("📄", controls)
        self.assertIn(".ordax-files-view", files_css)
        self.assertIn(".ordax-files-preview", files_css)
        self.assertIn(".ordax-files-preview-content", files_css)
        self.assertIn(".ordax-files-details", files_css)
        self.assertIn(".ordax-files-rename", files_css)
        self.assertIn(".ordax-files-copy", files_css)
        self.assertIn('[data-selected="true"]', files_css)
        self.assertIn('kind: "extension"', files_app)
        self.assertIn('extensionId: "file-space"', files_app)
        self.assertIn("./surface-lifecycle.mjs", controls)
        self.assertIn("assertSurfaceRenderLifecycle", controls)
        self.assertNotIn("MutationObserver", controls)
        self.assertNotIn("adapters/native", controls)
        self.assertNotIn("/__ordax/native/", controls)
        self.assertIn("createNativeFileSpace", composition)
        self.assertIn("createNativeRecentFilesStore", composition)
        self.assertIn("createRecentFilesRuntime", composition)
        self.assertIn(
            "{ recentFiles, projects }",
            composition,
        )
        self.assertIn("createAppActivationChannel", composition)
        self.assertIn("appActivation", composition)
        self.assertIn("userFileSpaceAvailable", composition)

        server = SERVER.read_text(encoding="utf-8")
        self.assertIn('FILE_CONTENT_PATH = "/__ordax/native/file-content"', server)
        self.assertIn('FILE_EXPORT_PATH = "/__ordax/native/file-export"', server)
        self.assertIn('IMAGE_PREVIEW_PATH = "/__ordax/native/image-preview"', server)
        self.assertIn('FILE_IMPORT_PATH = "/__ordax/native/file-import"', server)
        self.assertIn("MAX_TEXT_FILE_BYTES = 256 * 1024", server)
        self.assertIn("read_user_text_file", server)
        self.assertIn("FileSpaceTextTooLargeError", server)
        self.assertIn("FileSpaceTextEncodingError", server)
        self.assertIn("RENAME_NOREPLACE = 1", server)
        self.assertIn("_renameat2_noreplace", server)
        self.assertIn("rename_user_entry", server)
        self.assertIn('action == "rename-entry"', server)
        self.assertIn("MAX_FILE_COPY_BYTES = 64 * 1024 * 1024", server)
        self.assertIn("MAX_FILE_EXPORT_BYTES = 64 * 1024 * 1024", server)
        self.assertIn("MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024", server)
        self.assertIn("read_user_image_preview", server)
        self.assertIn("FileSpaceImagePreviewTypeError", server)
        self.assertIn("_write_image_preview", server)
        self.assertIn("MAX_FILE_IMPORT_BYTES = 64 * 1024 * 1024", server)
        self.assertIn("import_user_file", server)
        self.assertIn("FileSpaceImportTooLargeError", server)
        self.assertIn("FileSpaceImportIncompleteError", server)
        self.assertIn("read_user_export_file", server)
        self.assertIn("FileSpaceExportTooLargeError", server)
        self.assertIn("FileSpaceExportChangedError", server)
        self.assertIn("_write_download", server)
        self.assertIn("copy_user_file", server)
        self.assertIn("FileSpaceCopyTooLargeError", server)
        self.assertIn("FileSpaceCopyChangedError", server)
        self.assertIn('action == "copy-file"', server)
        self.assertIn("FileSpaceCrossDeviceMoveError", server)
        self.assertIn("move_user_entry", server)
        self.assertIn('action == "move-entry"', server)
        self.assertIn("self._empty(422)", server)
        self.assertIn("self._empty(412)", server)
        self.assertIn("self._empty(409)", server)
        self.assertIn("self._empty(413)", server)
        self.assertIn("self._empty(415)", server)
        self.assertRegex(
            server,
            r'parsed_path in \{[^}]*FILES_PATH[^}]*\} and self\.client_address\[0\] != "127\.0\.0\.1"',
        )

    def test_user_file_space_capability_is_additive_and_native(self):
        contract = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        capabilities = {entry["id"]: entry for entry in contract["capabilities"]}
        self.assertEqual(
            capabilities["filesystem.user-space"]["security_boundary"],
            "bounded-user-root",
        )
        modes = {mode["id"]: mode for mode in contract["modes"]}
        self.assertIn("filesystem.user-space", modes["usb"]["baseline_capabilities"])
        self.assertIn("filesystem.user-space", modes["native-disk"]["baseline_capabilities"])
        self.assertNotIn("filesystem.user-space", modes["web"]["baseline_capabilities"])

        runtime = NATIVE_RUNTIME.read_text(encoding="utf-8")
        files_app = FILES_APP.read_text(encoding="utf-8")
        self.assertIn('"filesystem.user-space"', runtime)
        self.assertIn("userFileSpaceAvailable", runtime)
        self.assertIn('kind: "extension"', files_app)
        self.assertIn('extensionId: "file-space"', files_app)


if __name__ == "__main__":
    unittest.main()
