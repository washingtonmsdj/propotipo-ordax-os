from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system" / "surface" / "runtime" / "ordax_browser_host.py"
STORE = ROOT / "system" / "surface" / "runtime" / "browser_session_store.py"


class BrowserSessionIntegrationContractTests(unittest.TestCase):
    def test_native_host_restores_only_through_isolated_session_store(self):
        host = HOST.read_text(encoding="utf-8")
        store = STORE.read_text(encoding="utf-8")

        self.assertIn("from browser_session_store import load_browser_session, save_browser_session", host)
        self.assertIn('self.session_path = os.path.join(self.profile_root, "session.json")', host)
        self.assertIn("self.restore_session()", host)
        self.assertIn("load_browser_session(", host)
        self.assertIn("allow_url=allowed_external_uri", host)
        self.assertIn("max_tabs=MAX_TABS", host)
        self.assertIn("save_browser_session(", host)
        self.assertIn("self.persist_session()", host)
        self.assertIn("if event == WebKit2.LoadEvent.FINISHED", host)
        self.assertIn("self.window.connect(\"destroy\", self.on_window_destroy)", host)

        self.assertIn("SESSION_VERSION = 1", store)
        self.assertIn("MAX_SESSION_BYTES", store)
        self.assertIn("tempfile.mkstemp", store)
        self.assertIn("os.fchmod(descriptor, 0o600)", store)
        self.assertIn("os.replace(temporary, path)", store)
        self.assertIn('getattr(os, "O_NOFOLLOW", 0)', store)

    def test_persisted_state_never_contains_privileged_surface_or_page_content(self):
        store = STORE.read_text(encoding="utf-8")
        host = HOST.read_text(encoding="utf-8")

        self.assertIn('"urls": list(session.urls)', store)
        self.assertIn('"activeIndex": session.active_index', store)
        self.assertNotIn("pageSource", store)
        self.assertNotIn("html", store.lower())
        self.assertNotIn("localStorage", store)
        self.assertNotIn("sessionStorage", store)
        self.assertNotIn("surface_view.get_uri", host)


if __name__ == "__main__":
    unittest.main()
