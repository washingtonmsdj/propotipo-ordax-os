#!/usr/bin/env python3
"""Regressions for the owner-development physical network/maintenance path."""

from __future__ import annotations

from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NETWORK = ROOT / "bootstrap/dev-base/ordax-network"
DEV_INIT = ROOT / "bootstrap/dev-base/ordax-dev-init"


class DevelopmentNetworkContractTest(unittest.TestCase):
    def test_shell_scripts_are_syntactically_valid(self) -> None:
        for script in (NETWORK, DEV_INIT):
            subprocess.run(["/bin/sh", "-n", str(script)], check=True)

    def test_wired_dhcp_skips_kernel_tunnel_interfaces(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('net_type=$(cat "$netpath/type" 2>/dev/null || true)', text)
        self.assertIn('[ "$net_type" = 1 ] || continue', text)
        self.assertIn('echo "ordax-network: tentando DHCP em $iface"', text)
        self.assertLess(
            text.index('[ "$net_type" = 1 ] || continue'),
            text.index('echo "ordax-network: tentando DHCP em $iface"'),
        )

    def test_wifi_waits_for_real_association_before_dhcp(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('wait_for_wifi_link()', text)
        self.assertIn('iw dev "$wifi" link', text)
        self.assertIn("grep -q '^Connected to '", text)
        self.assertIn('if ! wait_for_wifi_link; then', text)
        self.assertLess(
            text.index('if ! wait_for_wifi_link; then'),
            text.index('try_dhcp "$wifi"', text.index('connect_saved_wifi()')),
        )
        self.assertNotIn('sleep 2\n    try_dhcp "$wifi"', text)

    def test_wifi_prompt_distinguishes_ssid_from_password(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn("SSID (nome exato da rede acima, nao a senha)", text)
        self.assertIn("Senha WPA/WPA2", text)

    def test_maintenance_shell_reestablishes_controlling_tty(self) -> None:
        text = DEV_INIT.read_text(encoding="utf-8")
        self.assertIn('if [ -x /bin/setsid ]; then', text)
        self.assertIn('exec /bin/setsid -c /bin/sh', text)
        self.assertIn("printf 'Rede:         ordax-network", text)


if __name__ == "__main__":
    unittest.main()
