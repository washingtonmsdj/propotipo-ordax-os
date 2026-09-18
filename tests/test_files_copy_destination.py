import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
ADAPTER = ROOT / "system" / "adapters" / "native" / "file-space.mjs"
CONTROLS = ROOT / "system" / "surface" / "ui" / "file-space-controls.mjs"
CONTRACT = ROOT / "system" / "contracts" / "file-space.mjs"
CSS = ROOT / "system" / "surface" / "ui" / "files.css"

spec = importlib.util.spec_from_file_location("ordax_native_copy_destination_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class FilesCopyDestinationTests(unittest.TestCase):
    def test_backend_copies_between_authorized_directories_and_preserves_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            (user_root / "Documentos").mkdir()
            (user_root / "Downloads").mkdir()
            source = user_root / "Documentos" / "relatorio.txt"
            source.write_text("conteudo", encoding="utf-8")

            listing = native_host.copy_user_file(
                str(user_root),
                "/Documentos",
                "relatorio.txt",
                "/Downloads",
                "relatorio.txt",
            )

            self.assertEqual(listing["path"], "/Downloads")
            self.assertEqual(source.read_text(encoding="utf-8"), "conteudo")
            self.assertEqual(
                (user_root / "Downloads" / "relatorio.txt").read_text(encoding="utf-8"),
                "conteudo",
            )

    def test_contract_and_adapter_use_explicit_source_and_destination(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        self.assertIn('ordax.file-space/10', contract)
        self.assertIn(
            "async copyFile(sourcePath, name, destinationPath, newName)",
            adapter,
        )
        self.assertIn("sourcePath,", adapter)
        self.assertIn("destinationPath,", adapter)
        self.assertNotIn(
            'JSON.stringify({ action: "copy-file", path, name, newName })',
            adapter,
        )

    def test_surface_distinguishes_duplicate_from_copy_to_destination(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn('"Duplicar"', controls)
        self.assertIn('"Copiar para…"', controls)
        self.assertIn("data.fileCopyToToggle", controls.replace("dataset", "data"))
        self.assertIn('mode: "copy"', controls)
        self.assertIn("transferToCurrentDirectory", controls)
        self.assertIn('"Copiar para esta pasta"', controls)
        self.assertIn(
            "port.copyFile(listing.path, selected.name, listing.path, newName)",
            controls,
        )
        self.assertIn(
            "source.sourcePath,\n              source.name,\n              destinationPath,\n              source.name",
            controls,
        )

    def test_copy_and_move_share_one_destination_panel(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        self.assertIn("renderTransferOperation", controls)
        self.assertIn("transferDestinationState", controls)
        self.assertIn("data-file-transfer-confirm", controls)
        self.assertIn("data-file-transfer-cancel", controls)
        self.assertNotIn("renderMoveOperation", controls)
        self.assertNotIn("moveDestinationState", controls)
        self.assertIn(".ordax-files-transfer {", css)
        self.assertNotIn(".ordax-files-move {", css)


if __name__ == "__main__":
    unittest.main()
