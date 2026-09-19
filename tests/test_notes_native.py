from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import os
import stat
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HOST_SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
NOTES_CONTRACT = ROOT / "system" / "contracts" / "notes-store.mjs"
NOTES_RUNTIME = ROOT / "system" / "services" / "notes" / "runtime.mjs"
WEB_ADAPTER = ROOT / "system" / "adapters" / "web" / "notes.mjs"
NATIVE_ADAPTER = ROOT / "system" / "adapters" / "native" / "notes.mjs"
NOTES_OWNER = ROOT / "system" / "apps" / "notes" / "app.mjs"
APP_CATALOG = ROOT / "system" / "apps" / "catalog.mjs"
NOTES_CONTROLS = ROOT / "system" / "surface" / "ui" / "notes-workspace-controls.mjs"
NOTES_CSS = ROOT / "system" / "surface" / "ui" / "notes.css"
DESKTOP_SHELL = ROOT / "system" / "surface" / "ui" / "desktop-shell.mjs"
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.mjs"
NATIVE_MAIN = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_HTML = ROOT / "system" / "composition" / "web" / "index.html"
NATIVE_HTML = ROOT / "system" / "composition" / "native" / "index.html"


def load_host_server():
    spec = spec_from_file_location("ordax_native_host_notes_test", HOST_SERVER)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class NotesNativeTests(unittest.TestCase):
    def test_native_notes_payload_is_bounded_atomic_and_private(self):
        host = load_host_server()
        with tempfile.TemporaryDirectory() as directory:
            host.NOTES_FILE = str(Path(directory) / "notes.json")
            payload = '{"$schema":"ordax.notes-snapshot/1","selectedProjectId":"meu-espaco","selectedNoteId":null,"projects":[],"notes":[]}'
            self.assertTrue(host.valid_notes_payload(payload))
            self.assertFalse(
                host.valid_notes_payload("x" * (host.MAX_NOTES_PAYLOAD + 1))
            )

            host.write_notes_payload(payload)
            self.assertEqual(host.read_notes_payload(), payload)
            self.assertFalse(list(Path(directory).glob("*.tmp.*")))
            mode = stat.S_IMODE(os.stat(host.NOTES_FILE).st_mode)
            self.assertEqual(mode, 0o600)

            host.write_notes_payload(None)
            self.assertIsNone(host.read_notes_payload())

    def test_native_host_owns_a_loopback_notes_state_endpoint(self):
        text = HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn('NOTES_PATH = "/__ordax/native/notes"', text)
        self.assertIn('NOTES_FILE = "/var/lib/ordax/notes.json"', text)
        self.assertIn("read_notes_payload", text)
        self.assertIn("write_notes_payload", text)
        self.assertIn("{SYNC_STATE_PATH, NOTES_PATH}", text)
        self.assertIn('if self.path == NOTES_PATH:', text)
        self.assertNotIn("Access-Control-Allow-Origin", text)

    def test_notes_contract_runtime_and_adapters_keep_platform_boundaries(self):
        contract = NOTES_CONTRACT.read_text(encoding="utf-8")
        runtime = NOTES_RUNTIME.read_text(encoding="utf-8")
        web = WEB_ADAPTER.read_text(encoding="utf-8")
        native = NATIVE_ADAPTER.read_text(encoding="utf-8")

        self.assertIn('ordax.notes-store/1', contract)
        self.assertIn('ordax.notes-snapshot/1', contract)
        self.assertIn("validateNotesSnapshot", contract)
        self.assertIn("createNotesRuntime", runtime)
        self.assertNotIn("Um lugar para criar", runtime)
        self.assertNotIn("example.org", runtime)
        self.assertNotIn("localStorage", runtime)
        self.assertNotIn("/__ordax/native/", runtime)
        self.assertIn('STORAGE_KEY = "ordax.notes.v1"', web)
        self.assertIn("localStorage", web)
        self.assertIn('NOTES_ENDPOINT = "/__ordax/native/notes"', native)
        self.assertIn("persistQueue", native)
        self.assertNotIn("localStorage", native)

    def test_notes_is_a_real_first_party_app_in_both_compositions(self):
        owner = NOTES_OWNER.read_text(encoding="utf-8")
        catalog = APP_CATALOG.read_text(encoding="utf-8")
        shell = DESKTOP_SHELL.read_text(encoding="utf-8")
        web_main = WEB_MAIN.read_text(encoding="utf-8")
        native_main = NATIVE_MAIN.read_text(encoding="utf-8")

        self.assertIn('id: "notes"', owner)
        self.assertIn('extensionId: "notes-workspace"', owner)
        self.assertIn('./notes/app.mjs', catalog)
        self.assertIn('railButton("notes", "Notas", ICONS.notes)', shell)

        self.assertIn("createWebNotesStore", web_main)
        self.assertIn("createNotesRuntime", web_main)
        self.assertIn("mountNotesWorkspaceControls", web_main)
        self.assertIn("notesWorkspaceControls.destroy()", web_main)

        self.assertIn("createNativeNotesStore", native_main)
        self.assertIn('"OrdaX native notes persistence unavailable"', native_main)
        self.assertIn("createNotesRuntime({ store: notesStore })", native_main)
        self.assertIn("mountNotesWorkspaceControls", native_main)
        self.assertIn("{ fileSpace, appActivation }", native_main)
        self.assertIn("notesWorkspaceControls.destroy()", native_main)

    def test_notes_surface_matches_concept_without_platform_storage_shortcuts(self):
        controls = NOTES_CONTROLS.read_text(encoding="utf-8")
        css = NOTES_CSS.read_text(encoding="utf-8")
        web_html = WEB_HTML.read_text(encoding="utf-8")
        native_html = NATIVE_HTML.read_text(encoding="utf-8")

        self.assertIn('[data-app-extension="notes-workspace"]', controls)
        self.assertIn("Buscar notas", controls)
        self.assertIn("Nova nota", controls)
        self.assertIn("Favoritas", controls)
        self.assertIn("Recentes", controls)
        self.assertIn("Lixeira", controls)
        self.assertIn("Referências", controls)
        self.assertIn("Disponível offline", controls)
        self.assertNotIn("Começar pequeno. Manter o que importa.", controls)
        self.assertIn("scheduleSave", controls)
        self.assertIn("assertNotesRuntime", controls)
        self.assertIn("assertSurfaceRenderLifecycle", controls)
        self.assertIn("assertFileSpacePort", controls)
        self.assertIn("assertAppActivationPort", controls)
        self.assertIn("Relacionar arquivo", controls)
        self.assertIn("file-picker-open-directory", controls)
        self.assertIn("attach-file-reference", controls)
        self.assertIn('activationPort.publish({ appId: "files"', controls)
        self.assertIn("subscribeRender", controls)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("/__ordax/native/", controls)
        self.assertNotIn("http://", controls)
        self.assertNotIn("https://", controls)

        self.assertIn("grid-template-columns: 220px 285px", css)
        self.assertIn("--notes-accent: #ed4b25", css)
        self.assertIn(".ordax-notes-references", css)
        self.assertIn(".ordax-notes-file-picker", css)
        self.assertIn(".ordax-notes-ref-open", css)
        self.assertIn("@media (max-width: 1180px)", css)
        self.assertIn("../../surface/ui/notes.css", web_html)
        self.assertIn("../../surface/ui/notes.css", native_html)


if __name__ == "__main__":
    unittest.main()
