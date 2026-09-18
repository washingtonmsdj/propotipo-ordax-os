import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "update-nomenclature.json"
SUPERVISOR = ROOT / "system" / "supervisor"
UPDATE_STATUS = ROOT / "system" / "contracts" / "update-status.mjs"
UPDATE_HISTORY = ROOT / "system" / "contracts" / "update-history.mjs"
UPDATE_CONTROLS = ROOT / "system" / "surface" / "ui" / "update-controls.mjs"
SYSTEM_OVERVIEW = ROOT / "system" / "surface" / "ui" / "system-overview-controls.mjs"


class UpdateNomenclatureTests(unittest.TestCase):
    def test_contract_separates_pr_delivery_update_and_product_version(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["status"], "canonical-prototype-contract")
        self.assertFalse(contract["development"]["pull_request"]["user_facing_update_identity"])
        self.assertTrue(contract["delivery"]["independent_from_pull_request_number"])
        self.assertFalse(contract["update"]["is_pull_request"])
        self.assertFalse(contract["product_version"]["currently_assigned"])
        self.assertFalse(contract["component_version"]["currently_independent"])

    def test_supervisor_delivery_sequence_does_not_parse_pull_request_numbers(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("delivery_number_for_sha()", text)
        self.assertIn('rev-list --first-parent --count "$source_sha"', text)
        self.assertIn("system boot bootstrap", text)
        self.assertIn(":(exclude)system/*.md", text)
        self.assertNotIn("Merge pull request #", text)
        self.assertNotIn("version_number_for_sha()", text)

    def test_contracts_expose_delivery_number_with_legacy_alias_only(self):
        status = UPDATE_STATUS.read_text(encoding="utf-8")
        history = UPDATE_HISTORY.read_text(encoding="utf-8")
        self.assertIn("value.deliveryNumber ?? value.versionNumber", status)
        self.assertIn("deliveryNumber,", status)
        self.assertIn("versionNumber: deliveryNumber", status)
        self.assertIn("value.deliveryNumber ?? value.versionNumber", history)
        self.assertIn("deliveryNumber:", history)
        self.assertIn("versionNumber:", history)

    def test_surface_uses_delivery_language_not_fake_component_versions(self):
        update = UPDATE_CONTROLS.read_text(encoding="utf-8")
        overview = SYSTEM_OVERVIEW.read_text(encoding="utf-8")
        self.assertIn("deliveryLabel(snapshot?.deliveryNumber)", update)
        self.assertIn("SHA técnico", update)
        self.assertIn("Entrega observada", overview)
        self.assertIn("Identidade da entrega", overview)
        self.assertIn("não é número de PR nem versão comercial do OrdaX", overview)
        self.assertIn("Distribuição conjunta · sem versão própria", overview)
        self.assertNotIn("Versão global", overview)
        self.assertNotIn("Incluído nesta entrega", overview)


if __name__ == "__main__":
    unittest.main()
