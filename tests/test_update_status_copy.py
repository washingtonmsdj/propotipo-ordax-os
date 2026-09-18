from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
UPDATE_PRESENTATION = ROOT / "system" / "services" / "update" / "presentation.mjs"
SYSTEM_OVERVIEW = ROOT / "system" / "surface" / "ui" / "system-overview-controls.mjs"


class UpdateStatusCopyTests(unittest.TestCase):
    def test_boot_refresh_does_not_claim_manual_reboot_will_apply_update(self):
        presentation = UPDATE_PRESENTATION.read_text(encoding="utf-8")
        overview = SYSTEM_OVERVIEW.read_text(encoding="utf-8")
        self.assertIn('"Atualização de base pendente"', presentation)
        self.assertIn("Reiniciar manualmente agora não conclui esta atualização", presentation)
        self.assertIn("Base pendente de ativação", presentation)
        self.assertIn("updateSummaryLabel(updateSnapshot)", overview)
        self.assertIn("updateBootLabel(updateSnapshot)", overview)
        self.assertNotIn('"Reinício necessário"', overview)
        self.assertNotIn("Mudança pendente de reinício físico", overview)

    def test_running_does_not_claim_latest_remote_delivery(self):
        presentation = UPDATE_PRESENTATION.read_text(encoding="utf-8")
        overview = SYSTEM_OVERVIEW.read_text(encoding="utf-8")
        self.assertIn('running: "Em execução"', presentation)
        self.assertIn("updateStatusLabel(updateSnapshot.status)", overview)
        self.assertNotIn('running: "Atualizado"', presentation)
        self.assertNotIn('"Atualizado"', overview)


if __name__ == "__main__":
    unittest.main()
