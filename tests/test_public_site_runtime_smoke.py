import importlib.util
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_SITE_TOOLS = ROOT / "tools" / "public-site"
sys.path.insert(0, str(PUBLIC_SITE_TOOLS))
BUILD_PATH = PUBLIC_SITE_TOOLS / "build.py"
PREVIEW_PATH = PUBLIC_SITE_TOOLS / "preview_server.py"
DEPLOYMENT_CONTRACT = ROOT / "docs" / "contracts" / "public-site-deployment.json"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


build = load_module("ordax_public_site_build_smoke", BUILD_PATH)
preview = load_module("ordax_public_site_preview_smoke", PREVIEW_PATH)


class PublicSiteRuntimeSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.temp.name) / "public-site"
        build.build_bundle(cls.out, "1" * 40)
        cls.server = preview.make_server(cls.out, "127.0.0.1", 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        cls.thread.start()
        host, port = cls.server.server_address[:2]
        cls.base = f"http://{host}:{port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.temp.cleanup()

    def fetch(self, path):
        return urlopen(self.base + path, timeout=3)

    def test_deployment_contract_requires_security_headers(self):
        contract = json.loads(DEPLOYMENT_CONTRACT.read_text(encoding="utf-8"))
        self.assertTrue(contract["production_requirements"]["https"])
        self.assertTrue(contract["production_requirements"]["host_adapter_must_apply_security_headers"])
        self.assertEqual(contract["routing"]["identity_prefix"], "/auth/")

    def test_landing_and_download_pages_are_served(self):
        for path in ("/", "/download/", "/login/", "/cadastro/"):
            with self.subTest(path=path):
                with self.fetch(path) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn("text/html", response.headers["Content-Type"])
                    self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
                    self.assertEqual(response.headers["X-Frame-Options"], "DENY")
                    self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])

    def test_generated_release_catalog_is_served_and_empty(self):
        with self.fetch("/releases/catalog.json") as response:
            payload = json.load(response)
            self.assertEqual(payload["$schema"], "prototype-ordax.public-release-catalog/1")
            self.assertEqual(payload["status"], "empty")
            self.assertEqual(payload["releases"], [])
            self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_auth_session_is_anonymous_through_same_origin_runtime(self):
        with self.fetch("/auth/session") as response:
            payload = json.load(response)
            self.assertEqual(response.status, 200)
            self.assertFalse(payload["authenticated"])
            self.assertEqual(payload["provider"], "unconfigured")
            self.assertEqual(response.headers["Cache-Control"], "no-store, max-age=0")

    def test_login_route_remains_fail_closed(self):
        with self.assertRaises(HTTPError) as caught:
            self.fetch("/auth/login")
        self.assertEqual(caught.exception.code, 503)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(payload["error"], "identity-provider-unavailable")

    def test_unknown_path_and_traversal_do_not_escape_site_root(self):
        for path in ("/missing", "/%2e%2e/README.md"):
            with self.subTest(path=path):
                with self.assertRaises(HTTPError) as caught:
                    self.fetch(path)
                self.assertEqual(caught.exception.code, 404)

    def test_preview_server_rejects_non_loopback_bind(self):
        with self.assertRaises(ValueError):
            preview.make_server(self.out, "0.0.0.0", 0)


if __name__ == "__main__":
    unittest.main()
