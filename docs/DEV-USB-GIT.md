# OrdaX Development USB — Git-first

Status: **CANONICAL FOR THE CURRENT DEVELOPMENT USB**

## Goal

The USB exists only to cross the boundary that Git cannot cross by itself:

```text
UEFI
 -> kernel + initramfs
 -> drivers/storage
 -> development network
 -> Git client
 -> /workspace/ordax (clone of main)
```

The OrdaX source itself is **not** preseeded on the USB. `main` remains the source authority.

## Daily loop

After the development base has been flashed once and the notebook can boot it:

```text
edit/commit on remote main
 -> notebook: ordax-pull
 -> notebook: ordax-run
```

`ordax-pull` performs a normal fast-forward `git pull` against:

```text
https://github.com/washingtonmsdj/prototipo-ordax-os.git
branch: main
checkout: /workspace/ordax
```

Before each pull, the current commit is remembered. `ordax-rollback` resets the worktree to that previous commit when a development change must be reverted.

## What is on the USB base

Only the development substrate is preseeded:

- UEFI boot files;
- Linux kernel and initramfs;
- storage/USB/console drivers;
- kernel modules required by the current development hardware policy;
- Ethernet and USB-tether networking;
- Wi-Fi userspace plus the firmware for the currently selected kernel modules;
- CA certificates and HTTPS support;
- Git;
- `ordax-pull`, `ordax-run`, `ordax-rollback`;
- local recovery entrypoint.

Normal OrdaX Surface/apps/services/source are not preseeded. They arrive through Git.

## Reflash rule

A normal source change under the OrdaX repository does **not** require:

- rebuilding the whole USB image;
- reflashing the USB;
- rebuilding the kernel;
- rebooting the notebook unless that component genuinely requires it.

A base-level change is different. Changes to the bootloader, kernel, initramfs, or a driver/firmware needed before Git is reachable can require a base update and reboot. This does not change the normal daily loop above.

The immediate milestone is one final flash of this Git-capable development base. After that, ordinary development is remote edit -> `ordax-pull` -> run.

## Network behavior

Boot prefers Ethernet/USB tether because no credentials are required. If neither is available and a supported Wi-Fi interface is detected, the development base asks for SSID/password and stores its WPA configuration under `/state/network/`.

The current kernel already carries the wireless stack and selected module families. Hardware outside those selected drivers may still need one future base/kernel update. Until then, Ethernet or USB tether remains the deterministic fallback.
