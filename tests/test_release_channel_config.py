import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse
import unittest

ROOT = Path(__file__).resolve().parents[1]
CHANNEL_FILE = ROOT / "bootstrap" / "config" / "release-envelope-url"
MINIMAL_BOOTSTRAP = ROOT / "docs" / "contracts" / "minimal-bootstrap.json"
RELEASE_CHANNEL = ROOT / "docs" / "contracts" / "release-channel.json"

EXPECTED_URL = "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/latest/download/release-envelope.json"
EXPECTED_SHA256 = "ea1f3bae328a1c1e7aca1474d4930f84b2dd6da1702dcc11b08c01ed63a6ee5b"


class ReleaseChannelConfigTests(unittest.TestCase):
    def test_channel_file_is_exact_single_https_pointer(self):
        data = CHANNEL_FILE.read_bytes()
        self.assertEqual(data, (EXPECTED_URL + "\n").encode("utf-8"))
        self.assertEqual(hashlib.sha256(data).hexdigest(), EXPECTED_SHA256)

        parsed = urlparse(EXPECTED_URL)
        self.assertEqual(parsed.scheme, "https")
        self.assertEqual(parsed.netloc, "github.com")
        self.assertEqual(parsed.username, None)
        self.assertEqual(parsed.password, None)
        self.assertEqual(parsed.query, "")
        self.assertEqual(parsed.fragment, "")
        self.assertEqual(
            parsed.path,
            "/washingtonmsdj/prototipo-ordax-os/releases/latest/download/release-envelope.json",
        )

    def test_release_channel_contract_matches_bootstrap_pointer(self):
        contract = json.loads(RELEASE_CHANNEL.read_text(encoding="utf-8"))
        self.assertEqual(contract["$schema"], "prototype-ordax.release-channel/1")
        self.assertEqual(
            contract["source_authority"]["repository"],
            "washingtonmsdj/prototipo-ordax-os",
        )
        self.assertEqual(contract["publication"]["release_envelope_asset_name"], "release-envelope.json")
        self.assertEqual(contract["publication"]["latest_envelope_url"], EXPECTED_URL)
        self.assertTrue(contract["publication"]["latest_pointer_is_delivery_selector_not_authenticity"])
        self.assertTrue(contract["device_pre_release"]["public_trust_anchor_required"])

    def test_minimal_bootstrap_binds_exact_channel_bytes_but_keeps_write_blocked(self):
        manifest = json.loads(MINIMAL_BOOTSTRAP.read_text(encoding="utf-8"))
        groups = {group["id"]: group for group in manifest["artifact_groups"]}
        channel = groups["bootstrap-release-channel"]

        self.assertTrue(channel["resolved"])
        self.assertEqual(channel["source_owner"], "bootstrap/config")
        self.assertEqual(len(channel["artifacts"]), 1)
        artifact = channel["artifacts"][0]
        self.assertEqual(artifact["source_path"], "bootstrap/config/release-envelope-url")
        self.assertEqual(artifact["target_path"], "/ordax/bootstrap/config/release-envelope-url")
        self.assertEqual(artifact["sha256"], EXPECTED_SHA256)
        self.assertEqual(artifact["mode"], "0644")

        unresolved = [group["id"] for group in manifest["artifact_groups"] if not group["resolved"]]
        self.assertEqual(unresolved, ["bootstrap-release-trust"])
        self.assertFalse(manifest["all_artifacts_resolved"])
        self.assertFalse(manifest["physical_write_allowed"])


if __name__ == "__main__":
    unittest.main()
