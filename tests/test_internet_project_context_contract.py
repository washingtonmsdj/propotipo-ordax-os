from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "surface" / "ui" / "internet-browser-controls.mjs"
NATIVE_MAIN = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.mjs"
REFERENCE_CONTRACT = ROOT / "system" / "contracts" / "project-web-references.mjs"
REFERENCE_STORE = ROOT / "system" / "contracts" / "project-web-reference-store.mjs"
REFERENCE_RUNTIME = ROOT / "system" / "services" / "projects" / "web-references.mjs"
REFERENCE_ADAPTER = ROOT / "system" / "adapters" / "native" / "project-web-references.mjs"


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
        self.assertIn('createProjectWebReferenceRuntime', native)
        self.assertIn('createNativeProjectWebReferenceStore', native)
        self.assertIn('{ projects, projectReferences },', native)
        self.assertIn('projectReferences?.destroy()', native)

    def test_web_composition_keeps_project_context_unavailable_without_fake_storage(self):
        web = self.text(WEB_MAIN)
        self.assertIn('mountInternetBrowserControls(root, browserSession, surface)', web)
        self.assertNotIn('createProjectCatalogRuntime', web)
        self.assertNotIn('createProjectWebReferenceRuntime', web)
        self.assertNotIn('createNativeProjectWebReferenceStore', web)

    def test_reference_persistence_has_its_own_project_owned_contract(self):
        controls = self.text(CONTROLS)
        contract = self.text(REFERENCE_CONTRACT)
        store = self.text(REFERENCE_STORE)
        runtime = self.text(REFERENCE_RUNTIME)
        adapter = self.text(REFERENCE_ADAPTER)

        self.assertIn('PROJECT_WEB_REFERENCES_SCHEMA = "ordax.project-web-references/1"', contract)
        self.assertIn('MAX_PROJECT_WEB_REFERENCES = 512', contract)
        self.assertIn('assertProjectWebReferencePort', controls)
        self.assertIn('projectReferences = null', controls)
        self.assertIn('referencePort.save({', controls)
        self.assertIn('referencePort.remove(', controls)
        self.assertIn('data.browserSaveProject', controls)
        self.assertIn('data.browserReferenceNote', controls)
        self.assertIn('PROJECT_WEB_REFERENCE_STORE_SCHEMA', store)
        self.assertIn('assertProjectCatalogPort(projects)', runtime)
        self.assertIn('removeMissingProjects', runtime)
        self.assertIn('ordax.native.project-web-references.v1', adapter)
        self.assertNotIn('localStorage', controls)
        self.assertNotIn('sessionStorage', controls)
        self.assertNotIn('/__ordax/native/', controls)

    def test_project_selection_is_explicitly_session_scoped(self):
        controls = self.text(CONTROLS)
        self.assertIn('PROJETO DESTA SESSÃO', controls)
        self.assertIn('A escolha vale apenas para esta sessão do navegador.', controls)
        self.assertIn('selectedProjectId = null', controls)
        self.assertIn('dataset.browserProjectOptions', controls)
        self.assertIn('aria-pressed', controls)


if __name__ == "__main__":
    unittest.main()
