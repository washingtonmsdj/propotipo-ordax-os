# Owner development USB physical boot evidence — 5c62b6b6

Date: 2026-09-17

Scope: owner/development Git-first USB only. This is physical diagnostic evidence, not canonical promotion authorization.

```text
SOURCE_SHA=5c62b6b686a13ee95c624ffc93bd2fc9cdd3dafa
TARGET=real notebook boot from Creator-prepared owner development USB
PHYSICAL_WRITE=ALREADY_PERFORMED_BY_OWNER_CREATOR_FLOW
REBOOT_REQUIRED=YES_FOR_THIS_OBSERVATION

UEFI_TO_KERNEL=PASS
INITRAMFS_TO_DEV_BASE_HANDOFF=PASS
ORDAX_DEV_BASE_STARTED=PASS
RTL8188EU_DETECTED=PASS
RTL8188EU_FIRMWARE_LOAD=PASS
WIFI_INTERFACE_DISCOVERY=PASS
WIFI_SCAN=PASS
NETWORK_READY=NO
FIRST_GIT_CHECKOUT=NOT_REACHED
MAINTENANCE_SHELL_REACHED=PASS
MAINTENANCE_CONTROLLING_TTY=FAIL
```

Observed diagnostic details:

- the corrected initramfs handoff reached `OrdaX Development Base`, closing the previously observed BusyBox `command -v` blocker for this physical boot;
- the `rtl8xxxu` driver loaded RTL8188EU firmware and Wi-Fi scanning returned visible SSIDs;
- the wired-first network loop attempted DHCP on kernel tunnel interface `sit0`, which is not a valid Ethernet/USB-tether candidate;
- the SSID entered at the interactive prompt did not match the visible scanned SSID, so the observed Wi-Fi failure is not evidence that the loaded RTL8188EU path cannot associate;
- the maintenance shell printed `/bin/sh: can't access tty; job control turned off`, proving that the post-`switch_root` maintenance path lacked a controlling TTY.

Follow-up source fix: `fix/physical-wifi-maintenance` filters non-Ethernet interface types before DHCP, waits for actual Wi-Fi association before DHCP, clarifies the SSID prompt, and re-establishes a controlling TTY for the maintenance shell.
