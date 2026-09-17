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

    def test_wifi_selects_strongest_secure_network_without_ssid_typing(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('select_best_secure_ssid()', text)
        self.assertIn('best_signal = -1000', text)
        self.assertIn('ssid != "" && secure && signal > best_signal', text)
        self.assertIn('/^[[:space:]]*(RSN:|WPA:)/', text)
        self.assertIn('ssid=$(select_best_secure_ssid || true)', text)
        self.assertIn('rede selecionada automaticamente', text)
        self.assertNotIn("printf 'SSID", text)
        self.assertNotIn('read -r ssid', text)

    def test_password_has_brief_character_feedback_then_mask(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('read_password_with_feedback()', text)
        self.assertIn('stty -echo -icanon min 1 time 0', text)
        self.assertIn('IFS= read -r -n 1 ch', text)
        reveal = text.index("printf '%s' \"$ch\"")
        mask = text.index("printf '\\b*'", reveal)
        self.assertLess(reveal, mask)
        self.assertIn("printf 'Senha WPA/WPA2: '", text)
        self.assertNotIn('read -r password\nstty echo', text)

    def test_network_synchronizes_clock_before_returning_success(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('sync_clock()', text)
        self.assertIn('/bin/busybox ntpd -q -n -p "$server"', text)
        self.assertIn('time.cloudflare.com time.google.com pool.ntp.org', text)
        finish = text.index('finish_network()')
        sync = text.index('sync_clock', finish)
        self.assertLess(finish, sync)
        self.assertIn('finish_network "$wifi"', text)
        self.assertIn('finish_network "$iface"', text)

    def test_maintenance_shell_reestablishes_controlling_tty(self) -> None:
        text = DEV_INIT.read_text(encoding="utf-8")
        self.assertIn('if [ -x /bin/setsid ]; then', text)
        self.assertIn('exec /bin/setsid -c /bin/sh', text)
        self.assertIn("printf 'Rede:         ordax-network", text)


if __name__ == "__main__":
    unittest.main()
