from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOME = ROOT / "system" / "surface" / "ui" / "home-continuation.mjs"


class HomeContinuationContractTests(unittest.TestCase):
    def source(self):
        return HOME.read_text(encoding="utf-8")

    def test_home_consumes_existing_owners_without_becoming_another_store(self):
        source = self.source()
        self.assertIn("assertProjectCatalogPort", source)
        self.assertIn("assertRecentFilesPort", source)
        self.assertIn("projectPort?.getSnapshot()", source)
        self.assertIn("recentPort?.getSnapshot()", source)
        self.assertIn("projectPort?.subscribe", source)
        self.assertIn("recentPort?.subscribe", source)
        self.assertNotIn("projectPort.create", source)
        self.assertNotIn("projectPort.recordOpened", source)
        self.assertNotIn("recentPort.recordOpened", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("sessionStorage", source)
        self.assertNotIn("fetch(", source)

    def test_home_routes_back_to_files_and_does_not_claim_to_open_recent_file(self):
        source = self.source()
        self.assertIn('appId: "files"', source)
        self.assertIn("target: project.path", source)
        self.assertIn("target: folder", source)
        self.assertIn("Mostrar ${entry.name} em Arquivos", source)
        self.assertNotIn("Abrir arquivo recente", source)
        self.assertNotIn("openFile", source)

    def test_home_uses_safe_dom_and_disappears_when_there_is_no_context(self):
        source = self.source()
        self.assertIn("createElement", source)
        self.assertIn("textContent", source)
        self.assertIn("section?.remove()", source)
        self.assertNotIn("innerHTML", source)
        self.assertIn("Continuar trabalho", source)
        self.assertIn("data-home-continuation-key", source.replace("dataset.homeContinuationKey", "data-home-continuation-key"))

    def test_home_mount_is_disposable_and_unsubscribes_both_sources(self):
        source = self.source()
        self.assertIn("dispose()", source)
        self.assertIn("unsubscribeRecent?.()", source)
        self.assertIn("unsubscribeProjects?.()", source)
        self.assertIn("destroyed = true", source)


if __name__ == "__main__":
    unittest.main()
