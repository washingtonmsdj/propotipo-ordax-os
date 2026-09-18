import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GATEWAY_PATH = ROOT / "services" / "public-identity" / "gateway.py"
CONTRACT_PATH = ROOT / "docs" / "contracts" / "public-identity-gateway.json"

spec = importlib.util.spec_from_file_location("ordax_public_identity_gateway", GATEWAY_PATH)
gateway_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = gateway_module
spec.loader.exec_module(gateway_module)


class PublicIdentityGatewayTests(unittest.TestCase):
    def setUp(self):
        self.gateway = gateway_module.PublicIdentityGateway()

    def payload(self, response):
        return json.loads(response.body.decode("utf-8"))

    def test_contract_keeps_provider_disabled(self):
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        self.assertEqual(contract["status"], "implemented-provider-unconfigured")
        self.assertFalse(contract["baseline"]["provider_configured"])
        self.assertFalse(contract["baseline"]["credential_collection"])
        self.assertFalse(contract["baseline"]["remote_redirect_allowed"])

    def test_session_is_anonymous_and_contains_no_tokens(self):
        response = self.gateway.handle("GET", "/auth/session")
        self.assertEqual(response.status, 200)
        payload = self.payload(response)
        self.assertFalse(payload["authenticated"])
        self.assertEqual(payload["provider"], "unconfigured")
        body = response.body.decode("utf-8").lower()
        for forbidden in ("access_token", "refresh_token", "bearer", "password"):
            self.assertNotIn(forbidden, body)
        self.assertIn(("Cache-Control", "no-store, max-age=0"), response.headers)

    def test_identity_entry_routes_fail_closed_until_provider_exists(self):
        for path in ("/auth/login", "/auth/register", "/auth/callback?code=x"):
            with self.subTest(path=path):
                response = self.gateway.handle("GET", path)
                self.assertEqual(response.status, 503)
                self.assertEqual(
                    self.payload(response)["error"],
                    "identity-provider-unavailable",
                )

    def test_logout_fails_closed_without_provider(self):
        response = self.gateway.handle("POST", "/auth/logout")
        self.assertEqual(response.status, 503)
        self.assertNotIn("Set-Cookie", dict(response.headers))

    def test_methods_are_narrow(self):
        cases = (
            ("POST", "/auth/session", "GET"),
            ("POST", "/auth/login", "GET"),
            ("GET", "/auth/logout", "POST"),
        )
        for method, path, allowed in cases:
            with self.subTest(method=method, path=path):
                response = self.gateway.handle(method, path)
                self.assertEqual(response.status, 405)
                self.assertEqual(dict(response.headers)["Allow"], allowed)

    def test_unknown_auth_route_is_not_accepted(self):
        response = self.gateway.handle("GET", "/auth/admin")
        self.assertEqual(response.status, 404)
        self.assertEqual(self.payload(response)["error"], "identity-route-not-found")

    def test_provider_redirects_must_remain_same_origin(self):
        class BadProvider:
            configured = True

            def begin_login(self):
                return "https://evil.example/auth"

            def begin_registration(self):
                return "//evil.example/auth"

            def complete_callback(self, query):
                del query
                return "https://evil.example/callback"

            def revoke_session(self, cookie_header):
                del cookie_header
                return ()

        gateway = gateway_module.PublicIdentityGateway(BadProvider())
        for path in ("/auth/login", "/auth/register", "/auth/callback?code=x"):
            with self.subTest(path=path):
                response = gateway.handle("GET", path)
                self.assertEqual(response.status, 502)
                self.assertEqual(self.payload(response)["error"], "invalid-provider-redirect")

    def test_cross_site_logout_is_rejected_before_provider_action(self):
        class Provider:
            configured = True

            def begin_login(self):
                return "/"

            def begin_registration(self):
                return "/"

            def complete_callback(self, query):
                del query
                return "/"

            def revoke_session(self, cookie_header):
                raise AssertionError("must not be reached for cross-site request")

        gateway = gateway_module.PublicIdentityGateway(Provider())
        response = gateway.handle(
            "POST",
            "/auth/logout",
            {"Sec-Fetch-Site": "cross-site"},
        )
        self.assertEqual(response.status, 403)
        self.assertEqual(self.payload(response)["error"], "cross-site-request-rejected")


if __name__ == "__main__":
    unittest.main()
