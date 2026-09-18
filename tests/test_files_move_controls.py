from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "surface" / "ui" / "file-space-controls.mjs"
CSS = ROOT / "system" / "surface" / "ui" / "files.css"
ADAPTER = ROOT / "system" / "adapters" / "native" / "file-space.mjs"
CONTRACT = ROOT / "system" / "contracts" / "file-space.mjs"


class FilesMoveControlsTests(unittest.TestCase):
    def test_contract_and_adapter_expose_move_with_structured_errors(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        self.assertIn('ordax.file-space/5', contract)
        self.assertIn("moveEntry()", contract)
        self.assertIn("FileSpaceOperationError", adapter)
        self.assertIn("this.status = status", adapter)
        self.assertIn('action: "move-entry"', adapter)
        self.assertIn("destinationPath", adapter)

    def test_move_flow_requires_destination_navigation_and_confirmation(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn("movingEntry = null", controls)
        self.assertIn("moveDestinationState", controls)
        self.assertIn("moveToCurrentDirectory", controls)
        self.assertIn("data-file-move-toggle", controls)
        self.assertIn("data-file-move-confirm", controls)
        self.assertIn("data-file-move-cancel", controls)
        self.assertIn("Mover para esta pasta", controls)
        self.assertIn("Navegue até a pasta de destino", controls)

    def test_move_rejects_same_folder_and_directory_descendants(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn("listing.path === movingEntry.sourcePath", controls)
        self.assertIn("listing.path === movingEntry.sourceFullPath", controls)
        self.assertIn("listing.path.startsWith(`${movingEntry.sourceFullPath}/`)", controls)
        self.assertIn("Uma pasta não pode ser movida para dentro dela mesma.", controls)

    def test_move_errors_are_specific_and_origin_preserving(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn("operationStatus", controls)
        self.assertIn("status === 409", controls)
        self.assertIn("status === 422", controls)
        self.assertIn("movimento seguro ainda não está disponível", controls)
        self.assertIn("A origem foi preservada.", controls)

    def test_move_panel_is_responsive(self):
        css = CSS.read_text(encoding="utf-8")
        self.assertIn(".ordax-files-move {", css)
        self.assertIn(".ordax-files-move-actions", css)
        self.assertIn(".ordax-files-move-guidance", css)


if __name__ == "__main__":
    unittest.main()
