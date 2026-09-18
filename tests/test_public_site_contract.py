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

    def test_identity_fails_closed_and_downloads_use_generated_catalog(self):
        config = json.loads((SITE / "config" / "public-site.json").read_text(encoding="utf-8"))
        self.assertIsNone(config["identity"]["login_url"])
        self.assertIsNone(config["identity"]["register_url"])
        self.assertEqual(config["downloads"]["catalog_url"], "/releases/catalog.json")

        login = (SITE / "login" / "index.html").read_text(encoding="utf-8")
        register = (SITE / "cadastro" / "index.html").read_text(encoding="utf-8")
        download = (SITE / "download" / "index.html").read_text(encoding="utf-8")
        self.assertIn("Serviço de identidade ainda não configurado", login)
        self.assertIn("Cadastro ainda não configurado", register)
        self.assertIn("data-download-status", download)

        publications = json.loads(
            (ROOT / "platform" / "releases" / "publications.json").read_text(encoding="utf-8")
        )
        self.assertEqual(publications["$schema"], "prototype-ordax.public-release-publications/1")
        self.assertEqual(publications["releases"], [])

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

    def test_public_identity_and_release_catalog_contracts_exist(self):
        identity = json.loads(
            (ROOT / "docs" / "contracts" / "public-identity.json").read_text(encoding="utf-8")
        )
        releases = json.loads(
            (ROOT / "docs" / "contracts" / "public-release-catalog.json").read_text(encoding="utf-8")
        )
        self.assertFalse(identity["credentials"]["static_site_collects_passwords"])
        self.assertTrue(identity["account_model"]["one_identity_across_product_modes"])
        self.assertTrue(releases["rules"]["public_authorization_required_per_release"])
        self.assertTrue(releases["rules"]["artifact_sha256_required"])

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
