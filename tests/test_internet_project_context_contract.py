from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "surface" / "ui" / "internet-browser-controls.mjs"
NATIVE_MAIN = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.mjs"


class InternetProjectContextContractTests(unittest.TestCase):
    def text(self, path):
        return path.read_text(encoding="utf-8")

    def test_browser_consumes_project_catalog_through_neutral_contract(self):
        controls = self.text(CONTROLS)
        self.assertIn('contracts/project-catalog.mjs', controls)
        self.assertIn('assertProjectCatalogPort', controls)
        self.assertIn('{ projects = null } = {}', controls)
        self.assertIn('projectPort?.getSnapshot()', controls)
        self.assertIn('projectPort?.subscribe', controls)
        self.assertIn('projectPort.recordOpened(projectId)', controls)

    def test_native_composition_shares_same_project_runtime_with_files_and_internet(self):
        native = self.text(NATIVE_MAIN)
        self.assertIn('createProjectCatalogRuntime', native)
        self.assertIn('const projects = fileSpace === null ? null : createProjectCatalogRuntime', native)
        self.assertIn('{ recentFiles, projects }', native)
        self.assertIn('{ projects },', native)

    def test_web_composition_keeps_project_context_unavailable_without_fake_storage(self):
        web = self.text(WEB_MAIN)
        self.assertIn('mountInternetBrowserControls(root, browserSession, surface)', web)
        self.assertNotIn('createProjectCatalogRuntime', web)

    def test_reference_persistence_remains_disabled_until_its_own_contract_exists(self):
        controls = self.text(CONTROLS)
        self.assertIn('save.disabled = true', controls)
        self.assertIn('referências web ainda exigem um contrato próprio', controls)
        self.assertNotIn('projectPort.create(', controls)
        self.assertNotIn('projectPort.remove(', controls)
        self.assertNotIn('localStorage', controls)
        self.assertNotIn('sessionStorage', controls)

    def test_project_selection_is_explicitly_session_scoped(self):
        controls = self.text(CONTROLS)
        self.assertIn('PROJETO DESTA SESSÃO', controls)
        self.assertIn('A escolha vale apenas para esta sessão do navegador.', controls)
        self.assertIn('selectedProjectId = null', controls)
        self.assertIn('dataset.browserProjectOptions', controls)
        self.assertIn('aria-pressed', controls)


if __name__ == "__main__":
    unittest.main()
