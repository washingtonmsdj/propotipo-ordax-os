import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "sites" / "public"
PUBLIC_CONTRACT = ROOT / "docs" / "contracts" / "public-site.json"
BUILD_CONTRACT = ROOT / "docs" / "contracts" / "build-autonomy.json"


class PublicSiteContractTests(unittest.TestCase):
    def test_required_public_routes_exist(self):
        for relative in (
            "index.html",
            "download/index.html",
            "login/index.html",
            "cadastro/index.html",
        ):
            self.assertTrue((SITE / relative).is_file(), relative)

    def test_public_site_is_distinct_from_product_web_mode(self):
        contract = json.loads(PUBLIC_CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["artifact_class"], "public-site")
        self.assertTrue(contract["separate_from_product_web_mode"])
        self.assertEqual(contract["source_root"], "sites/public")
        self.assertEqual(contract["build_recipe"], "tools/public-site/build.py")

    def test_identity_and_downloads_fail_closed_by_default(self):
        config = json.loads((SITE / "config" / "public-site.json").read_text(encoding="utf-8"))
        self.assertIsNone(config["identity"]["login_url"])
        self.assertIsNone(config["identity"]["register_url"])
        self.assertIsNone(config["downloads"]["catalog_url"])

        login = (SITE / "login" / "index.html").read_text(encoding="utf-8")
        register = (SITE / "cadastro" / "index.html").read_text(encoding="utf-8")
        download = (SITE / "download" / "index.html").read_text(encoding="utf-8")
        self.assertIn("Serviço de identidade ainda não configurado", login)
        self.assertIn("Cadastro ainda não configurado", register)
        self.assertIn("data-download-status", download)

    def test_site_baseline_has_no_remote_runtime_dependencies(self):
        for path in SITE.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".html", ".css", ".js"}:
                continue
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("http://", text, path)
            self.assertNotIn("https://", text, path)
            self.assertNotIn('src="//', text, path)
            self.assertNotIn('href="//', text, path)

    def test_runtime_integration_uses_same_origin_paths(self):
        script = (SITE / "assets" / "site.js").read_text(encoding="utf-8")
        self.assertIn('value.startsWith("/")', script)
        self.assertIn('!value.startsWith("//")', script)
        self.assertIn('credentials: "same-origin"', script)
        self.assertIn("prototype-ordax.public-release-catalog/1", script)
        self.assertIn("SHA-256", script)

    def test_public_site_is_independent_build_artifact(self):
        contract = json.loads(BUILD_CONTRACT.read_text(encoding="utf-8"))
        classes = contract["artifact_graph"]["independent_artifact_classes"]
        self.assertIn("public-site", classes)
        self.assertNotIn("public-site", contract["target_relationships"])
        self.assertFalse(contract["artifact_graph"]["public_site_change_rebuilds_system"])

    def test_landing_links_public_routes_without_fake_claims(self):
        landing = (SITE / "index.html").read_text(encoding="utf-8")
        for href in ("/download/", "/login/", "/cadastro/"):
            self.assertIn(f'href="{href}"', landing)
        self.assertIn("Protótipo em desenvolvimento", landing)
        self.assertIn("Downloads públicos aparecem somente", landing)


if __name__ == "__main__":
    unittest.main()
