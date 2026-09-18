from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / "system" / "services" / "telemetry" / "base-agent.sh"
TELEMETRY_INFRA = ROOT / "infra" / "supabase" / "telemetry"
RELAY = TELEMETRY_INFRA / "functions" / "ordax-os-telemetry" / "index.ts"
MIGRATION = TELEMETRY_INFRA / "migrations" / "20260918_add_delivery_boot_refresh_telemetry.sql"


class TelemetrySupabaseContractTests(unittest.TestCase):
    def test_agent_relay_and_database_share_delivery_fields(self):
        agent = AGENT.read_text(encoding="utf-8")
        relay = RELAY.read_text(encoding="utf-8")
        migration = MIGRATION.read_text(encoding="utf-8")

        self.assertIn('"deliveryNumber":%s', agent)
        self.assertIn('"bootRefreshRequired":%s', agent)
        self.assertIn('"relayVersion":4', agent)

        self.assertIn("deliveryNumber: optionalInteger(value.deliveryNumber, 10000000)", relay)
        self.assertIn("bootRefreshRequired: optionalBoolean(value.bootRefreshRequired)", relay)

        self.assertIn("delivery_number bigint", migration)
        self.assertIn("boot_refresh_required boolean", migration)
        self.assertIn("'deliveryNumber', delivery_number", migration)
        self.assertIn("'bootRefreshRequired', boot_refresh_required", migration)

    def test_base_owner_state_is_bounded_and_relayed_without_secret_material(self):
        agent = AGENT.read_text(encoding="utf-8")
        relay = RELAY.read_text(encoding="utf-8")

        for field in (
            "baseOwnerStatus",
            "baseOwnerPhase",
            "baseOwnerBlocker",
            "releaseAgentRefreshState",
            "releaseAgentSha256",
            "canonicalTrustPinned",
            "physicalTrustEnrolled",
            "trustEnrollmentState",
            "signedReleaseMaterialized",
            "materializedReleaseSha",
            "releaseMaterializationState",
            "kernelStaged",
            "candidateArmed",
            "rebootRequested",
            "promotionAttempted",
        ):
            self.assertIn(field, agent)
            self.assertIn(field, relay)

        self.assertIn("BASE_OWNER_STATUS_FILE=$STATE_DIR/base-update/owner-status.json", agent)
        self.assertIn("optionalSha256(value.releaseAgentSha256)", relay)
        self.assertIn("optionalBoolean(value.canonicalTrustPinned)", relay)
        self.assertIn("optionalBoolean(value.rebootRequested)", relay)

        for forbidden in (
            "public_key_base64",
            "private.pem",
            "private_key",
            "ceremony-public-evidence",
            "proof_manifest",
            "recovery-envelope",
        ):
            self.assertNotIn(forbidden, agent)

    def test_relay_keeps_public_ingress_and_server_secret_separate(self):
        relay = RELAY.read_text(encoding="utf-8")
        self.assertIn('req.headers.get("apikey")', relay)
        self.assertIn('Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")', relay)
        self.assertIn('Deno.env.get("SUPABASE_SECRET_KEYS")', relay)
        self.assertNotIn("sb_secret_", relay)
        self.assertNotIn("service_role", relay.lower())

    def test_telemetry_contract_does_not_add_remote_power_execution(self):
        relay = RELAY.read_text(encoding="utf-8")
        migration = MIGRATION.read_text(encoding="utf-8")
        for forbidden in (
            "reboot",
            "poweroff",
            "sysrq-trigger",
            "/__ordax/native/power",
        ):
            self.assertNotIn(forbidden, relay)
            self.assertNotIn(forbidden, migration)


if __name__ == "__main__":
    unittest.main()
