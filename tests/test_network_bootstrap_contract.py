#!/usr/bin/env python3
"""Clean-room network bootstrap regressions."""

import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NETWORK = ROOT / "bootstrap" / "network"
SOURCE = json.loads((NETWORK / "source.json").read_text(encoding="utf-8"))
MANIFEST = json.loads((ROOT / "docs" / "contracts" / "minimal-bootstrap.json").read_text(encoding="utf-8"))
KERNEL_FRAGMENT = (ROOT / "bootstrap" / "kernel" / "config" / "ordax.fragment").read_text(encoding="utf-8")


class NetworkBootstrapContractTest(unittest.TestCase):
    def test_network_scope_is_small_and_wifi_not_imported(self):
        self.assertEqual(SOURCE["$schema"], "prototype-ordax.network-bootstrap-source/1")
        self.assertEqual(SOURCE["prototype_scope"], "ethernet-and-usb-tether-dhcp")
        self.assertFalse(SOURCE["wifi_in_bootstrap"])
        self.assertTrue(SOURCE["consumer_wifi_required_before_promotion"])
        self.assertFalse(SOURCE["build"]["physical_artifact_authorized"])

    def test_network_builder_is_repository_owned(self):
        self.assertEqual(SOURCE["build"]["canonical_entrypoint"], "bootstrap/network/build.py")
        self.assertTrue((ROOT / SOURCE["build"]["canonical_entrypoint"]).is_file())
        self.assertEqual(SOURCE["build"]["static_userspace"], "busybox-musl")

    def test_network_userspace_is_bounded(self):
        self.assertEqual(
            SOURCE["busybox"]["required_applets"],
            ["busybox", "ifconfig", "ip", "route", "udhcpc"],
        )
        text = (NETWORK / "bring-up").read_text(encoding="utf-8").lower()
        dhcp = (NETWORK / "udhcpc.script").read_text(encoding="utf-8").lower()
        builder = (NETWORK / "build.py").read_text(encoding="utf-8").lower()
        for forbidden in ("wpa_supplicant", "sshd", "dropbear", "remote-core", "control-plane", "codex"):
            self.assertNotIn(forbidden, text)
            self.assertNotIn(forbidden, dhcp)
        self.assertNotIn("config_httpd\": \"y", builder)
        self.assertNotIn("config_telnetd\": \"y", builder)

    def test_runtime_sources_match_source_contract_hashes(self):
        runtime = SOURCE["runtime"]
        for path_key, hash_key in (("bring_up", "bring_up_sha256"), ("dhcp_script", "dhcp_script_sha256")):
            path = ROOT / runtime[path_key]
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(runtime[hash_key], digest)

    def test_network_scripts_are_partially_pinned_while_netbox_remains_unresolved(self):
        groups = {g["id"]: g for g in MANIFEST["artifact_groups"]}
        group = groups["bootstrap-network"]
        self.assertFalse(group["resolved"])
        artifacts = {a["source_path"]: a for a in group["artifacts"]}
        for relative in ("bootstrap/network/bring-up", "bootstrap/network/udhcpc.script"):
            path = ROOT / relative
            self.assertIn(relative, artifacts)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(artifacts[relative]["sha256"], digest)
        self.assertNotIn("bootstrap/network/bin/netbox", artifacts)

    def test_kernel_has_builtin_first_acquisition_network_paths(self):
        required = (
            "CONFIG_NET=y",
            "CONFIG_INET=y",
            "CONFIG_E1000E=y",
            "CONFIG_USB_USBNET=y",
            "CONFIG_USB_NET_CDCETHER=y",
            "CONFIG_USB_NET_CDC_NCM=y",
            "CONFIG_USB_NET_RNDIS_HOST=y",
        )
        for selector in required:
            self.assertIn(selector + "\n", KERNEL_FRAGMENT, selector)


if __name__ == "__main__":
    unittest.main()
