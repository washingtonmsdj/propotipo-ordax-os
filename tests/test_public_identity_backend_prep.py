import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IDENTITY_CONTRACT = ROOT / "docs" / "contracts" / "public-identity.json"
SERVICE_README = ROOT / "services" / "public-identity" / "README.md"
SUPABASE_ROOT = ROOT / "infra" / "supabase" / "identity"
PREFLIGHT = SUPABASE_ROOT / "preflight.sql"
MIGRATION = SUPABASE_ROOT / "migrations" / "0001_ordax_profiles.sql"


class PublicIdentityBackendPrepTests(unittest.TestCase):
    def test_identity_contract_keeps_provider_unconfigured(self):
        contract = json.loads(IDENTITY_CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["status"], "provider-unconfigured")
        self.assertFalse(contract["backend"]["provider_configured"])
        self.assertTrue(contract["backend"]["dedicated_or_isolated_target_required"])
        self.assertFalse(contract["backend"]["conflicting_auth_user_trigger_allowed"])
        self.assertFalse(contract["supabase_candidate"]["existing_shared_project_mutation_allowed"])

    def test_gateway_boundary_does_not_claim_live_provider(self):
        text = SERVICE_README.read_text(encoding="utf-8")
        self.assertIn("PROVIDER NOT CONFIGURED", text)
        self.assertIn("GET  /auth/login", text)
        self.assertIn("GET  /auth/register", text)
        self.assertIn("POST /auth/logout", text)
        self.assertIn("HttpOnly", text)
        self.assertNotIn("service_role", text.lower())

    def test_supabase_preflight_is_read_only(self):
        sql = PREFLIGHT.read_text(encoding="utf-8").lower()
        statements = [part.strip() for part in sql.split(";") if part.strip()]
        for statement in statements:
            if statement.startswith("--"):
                lines = [
                    line for line in statement.splitlines()
                    if line.strip() and not line.lstrip().startswith("--")
                ]
                statement = "\n".join(lines).strip()
            self.assertTrue(statement.startswith("select"), statement)
        for forbidden in (
            " insert ",
            " update ",
            " delete ",
            " drop ",
            " alter ",
            " create ",
            " grant ",
            " revoke ",
            " truncate ",
        ):
            self.assertNotIn(forbidden, f" {sql} ")

    def test_profile_migration_is_minimal_owner_scoped_and_no_anon_access(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create table public.ordax_profiles", sql)
        self.assertIn("references auth.users(id) on delete cascade", sql)
        self.assertIn("enable row level security", sql)
        self.assertIn("to authenticated", sql)
        self.assertIn("(select auth.uid()) = user_id", sql)
        self.assertIn("revoke all on table public.ordax_profiles from public, anon, authenticated", sql)
        self.assertIn("grant select, update on table public.ordax_profiles to authenticated", sql)
        self.assertNotRegex(sql, re.compile(r"grant\s+.*\s+to\s+anon"))

    def test_profile_bootstrap_function_is_private_and_search_path_locked(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create schema if not exists private", sql)
        self.assertIn("private.handle_ordax_user_created()", sql)
        self.assertIn("security definer", sql)
        self.assertIn("set search_path = ''", sql)
        self.assertIn("on_auth_user_created_ordax", sql)
        self.assertIn("after insert on auth.users", sql)


if __name__ == "__main__":
    unittest.main()
