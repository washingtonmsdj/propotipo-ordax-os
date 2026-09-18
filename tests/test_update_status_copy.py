from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
UPDATE_CONTROLS = ROOT / "system" / "surface" / "ui" / "update-controls.mjs"
SYSTEM_OVERVIEW = ROOT / "system" / "surface" / "ui" / "system-overview-controls.mjs"


class UpdateStatusCopyTests(unittest.TestCase):
    def test_running_does_not_claim_latest_remote_delivery(self):
        update = UPDATE_CONTROLS.read_text(encoding="utf-8")
        overview = SYSTEM_OVERVIEW.read_text(encoding="utf-8")
        self.assertIn('running: ["Em execução"', update)
        self.assertIn("verifica novas entregas automaticamente", update)
        self.assertIn('running: "Em execução"', overview)
        self.assertNotIn('running: ["Atualizado"', update)
        self.assertNotIn('running: "Atualizado"', overview)


if __name__ == "__main__":
    unittest.main()
