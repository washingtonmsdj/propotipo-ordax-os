# Minimal Network Bootstrap

Status: CLEAN-ROOM CANDIDATE — PHYSICAL USE NOT AUTHORIZED

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
     -> ifconfig / route / udhcpc
  -> /ordax/bootstrap/network/udhcpc.script
  -> IPv4 + default route + /etc/resolv.conf
```

`bring-up` scans non-loopback interfaces and exits success only after DHCP yields an IPv4 address. HTTPS/DNS/TLS correctness is then independently proven by the release acquisition agent.

## Netbox

`bin/netbox` is a repository-built static BusyBox 1.38.0 multicall candidate with a deliberately bounded executable surface.

Current candidate:

```text
SHA256=0b8eb465f533d13ebcbc4275c5d4beafddb75f04c9a86930db3bc66d6ce243ba
SIZE=128536
APPLETS=ifconfig,route,udhcpc
STATIC=YES
```

`busybox` is the multicall binary identity, not an exposed extra bootstrap applet. `sh`, HTTP servers, telnet, SSH, packet sniffers and general administration applets are rejected by the CI contract.

## Kernel prerequisites

The kernel must expose the network device before this owner runs. The canonical Linux 6.6.52 fragment builds common first-acquisition paths directly into the kernel, including USB networking, CDC Ethernet/NCM and RNDIS host support. The current candidate configuration verifies those selectors as built-in, so this bootstrap does not need a module loader for its engineering Ethernet/USB-tether path.

Wi-Fi drivers may remain modules because Wi-Fi authentication and firmware policy are outside this minimum first-acquisition owner.

## Final-product gate

Ethernet/USB tether is acceptable for the first engineering bring-up only. Consumer promotion still requires a clean first-boot Wi-Fi experience with real authentication, firmware provenance, credential protection and reconnect behavior.

No candidate in this directory is automatically authorized for physical USB use.
