# Minimal Network Bootstrap

Status: CLEAN-ROOM PROTOTYPE — PHYSICAL USE NOT AUTHORIZED

This owner exists only to obtain enough network connectivity for the **first signed release acquisition** when `/ordax/current` does not yet exist.

It is deliberately smaller than the full OrdaX connectivity stack.

## Prototype scope

The first physical prototype targets DHCP on an already exposed Ethernet-like interface:

- wired Ethernet;
- USB Ethernet;
- Android/compatible USB tethering that appears as an Ethernet interface.

The prototype bootstrap does **not** own Wi-Fi authentication. Full Wi-Fi onboarding remains a product promotion requirement and belongs in the first full system release until a later clean-room bootstrap Wi-Fi owner is justified.

This keeps the first USB small and avoids copying the legacy `wpa_supplicant`/connectivity stack into the clean bootstrap.

## Runtime

```text
/ordax/bootstrap/network/bring-up
  -> /ordax/bootstrap/network/bin/netbox
     -> ifconfig/ip/udhcpc/route
  -> /ordax/bootstrap/network/udhcpc.script
  -> IPv4 + default route + /etc/resolv.conf
```

`bring-up` scans non-loopback interfaces and exits success only after DHCP yields an IPv4 address. HTTPS/DNS/TLS correctness is then independently proven by the release acquisition agent.

## Netbox

`bin/netbox` is not yet resolved. It will be a repository-built static BusyBox networking binary using the same pinned BusyBox 1.38.0 upstream archive already used by the clean initramfs, but with a separate network-only applet configuration.

Required applets are intentionally bounded:

```text
busybox
ifconfig
ip
route
udhcpc
```

No HTTP server, telnet daemon, SSH server, packet sniffer or general administration shell belongs in this network payload.

## Kernel prerequisites

The kernel must expose the network device before this owner runs. For the prototype path, common wired Ethernet and USB tether/Ethernet drivers should be built into the kernel rather than requiring a module loader before the first release.

## Final-product gate

Ethernet/USB tether is acceptable for the first engineering bring-up only. Consumer promotion still requires a clean first-boot Wi-Fi experience with real authentication, firmware provenance, credential protection and reconnect behavior.
