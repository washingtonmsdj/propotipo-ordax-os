import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_SITE_TOOLS = ROOT / "tools" / "public-site"
sys.path.insert(0, str(PUBLIC_SITE_TOOLS))
BUILD_PATH = PUBLIC_SITE_TOOLS / "build.py"
LEGAL_CONTRACT = ROOT / "docs" / "contracts" / "public-legal-readiness.json"
SITE = ROOT / "sites" / "public"


def load_build():
    spec = importlib.util.spec_from_file_location("ordax_public_site_build_legal", BUILD_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


build = load_build()


class PublicLegalReadinessTests(unittest.TestCase):
    def test_canonical_legal_gate_is_not_ready(self):
        contract = json.loads(LEGAL_CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["status"], "not-ready")
        self.assertFalse(contract["account_activation_ready"])
        self.assertFalse(contract["documents"]["privacy"]["final"])
        self.assertFalse(contract["documents"]["terms"]["final"])
        self.assertIsNone(contract["documents"]["privacy"]["version"])
        self.assertIsNone(contract["documents"]["terms"]["version"])

    def test_runtime_config_matches_not_ready_gate(self):
        config = json.loads((SITE / "config" / "public-site.json").read_text(encoding="utf-8"))
        self.assertFalse(config["legal"]["account_activation_ready"])
        self.assertEqual(config["legal"]["privacy_url"], "/privacidade/")
        self.assertEqual(config["legal"]["terms_url"], "/termos/")
        self.assertIsNone(config["identity"]["login_url"])
        self.assertIsNone(config["identity"]["register_url"])

    def test_identity_urls_cannot_be_enabled_while_legal_gate_is_not_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            copied = Path(tmp) / "public"
            shutil.copytree(SITE, copied)
            config_path = copied / "config" / "public-site.json"
            config = json.loads(config_path.read_text(encoding="utf-8"))
            config["identity"]["login_url"] = "/auth/login"
            config["identity"]["register_url"] = "/auth/register"
            config_path.write_text(json.dumps(config), encoding="utf-8")

            with self.assertRaises(build.PublicSiteError) as caught:
                build.validate_source(copied)
            self.assertIn("identity URLs must remain null", str(caught.exception))

    def test_readiness_pages_do_not_claim_final_legal_status(self):
        privacy = (SITE / "privacidade" / "index.html").read_text(encoding="utf-8")
        terms = (SITE / "termos" / "index.html").read_text(encoding="utf-8")
        self.assertIn("não é uma política de privacidade final", privacy)
        self.assertIn("não estão vigentes", terms)
        self.assertIn("Conta pública ainda desativada", privacy)
        self.assertIn("Cadastro permanece fechado", terms)


if __name__ == "__main__":
    unittest.main()
