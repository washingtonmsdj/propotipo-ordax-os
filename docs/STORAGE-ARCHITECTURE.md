# OrdaX Storage Architecture

Status: ADOPTED ARCHITECTURE — IMPLEMENTATION IN PROGRESS

Machine-readable authority: `docs/contracts/storage-architecture.json`.

This document defines the long-term storage direction for OrdaX. The core decision is that **native SSD/HDD installs and portable USB execution must not use the same physical storage layout**. They share the same product semantics—signed releases, transactional activation, rollback, recovery and preservation of user data—but optimize the physical media differently.

## Decision summary

### Native SSD / NVMe / HDD

Use a Windows-like capacity model but Linux-native internals:

```text
GPT
├─ ORDAX-ESP   FAT32   boot + minimal signed recovery
└─ ORDAX-POOL  LUKS2 -> Btrfs   system deployments + apps + state + users
```

`ORDAX-POOL` consumes the remaining installation target and is a **single shared capacity pool**. System, applications and user data are separated by Btrfs subvolumes and immutable deployment boundaries, not by rigid fixed-size partitions.

This means a user does not end up with 100 GB free in a `/home` partition while the system partition is full. The free space is shared until the entire pool is actually full.

Recommended logical layout:

```text
ORDAX-POOL
├─ immutable/versioned OS deployments
├─ /var                 persistent machine/application state
├─ /var/home            user files, exposed as /home
├─ /var/lib/ordax/apps  managed application storage
├─ /var/lib/containers  optional container storage
└─ bounded snapshots / rollback metadata
```

The initial implementation should prefer a mature transactional engine with bootc/OSTree semantics rather than inventing a new low-level update engine. The public OrdaX contract remains product-owned so the underlying engine can be replaced later if required.

### Portable USB

Do **not** treat a USB flash drive as a small SSD installation.

Long-term target:

```text
GPT
├─ ORDAX-ESP   FAT32   boot + recovery + current/fallback boot assets
└─ ORDAX-DATA  exFAT   user files + versioned OrdaX image/state files
```

Inside the large cross-platform data volume:

```text
ORDAX-DATA/
├─ normal user files...
└─ .ordax/
   ├─ releases/
   │  ├─ <release>.erofs
   │  └─ integrity metadata / verity tree
   └─ state/
      └─ persistent-state.img   (ext4 filesystem image)
```

The base OS is a compressed read-only EROFS image. Persistent Linux writes go to an ext4 filesystem image mounted through a loop device and used as the OverlayFS writable layer. exFAT is never used directly as the Linux writable overlay because it does not provide the Linux filesystem semantics required by OverlayFS.

The state image grows in controlled chunks when needed, constrained only by the actual free space and the update safety reserve. The OS image is also a file rather than a fixed-size system partition, so a future larger OrdaX release does not require moving partition boundaries.

This architecture gives the USB one shared capacity pool for user files, system images and persistence while still keeping Linux-native writable state where it belongs.

## Why this differs from Windows

Modern Windows UEFI installations normally use a small EFI System Partition, a tiny Microsoft Reserved partition, one large Windows NTFS partition and a separate recovery partition. The Windows partition normally contains both the OS and the default user profile tree (`C:\Users`). Microsoft does not recommend a separate normal data partition in its default layout.

The useful idea for OrdaX is **not** to copy NTFS or the MSR partition. The useful idea is to avoid unnecessarily splitting the large usable capacity into hard boundaries.

OrdaX obtains the same flexibility through one Btrfs pool, while gaining Linux subvolumes, checksums, snapshots and image-based transactional system deployments.

## Why not separate `/` and `/home` partitions

Traditional Linux installations often separated root and home. That can protect user data during manual reinstall, but it creates a permanent sizing decision at install time.

Btrfs subvolumes provide logical separation while sharing the same free-space pool. Fedora desktop moved from separate root/home logical volumes to root/home Btrfs subvolumes specifically so the space is shared rather than preallocated.

For OrdaX, recovery safety is provided by the recovery/update model, not by forcing user data into a fixed physical partition.

## Native update and rollback model

The base OS is treated as an immutable versioned deployment:

1. Download a signed new release.
2. Verify publisher identity, manifest and payload integrity.
3. Stage a new deployment without modifying the currently booted deployment.
4. Keep the current known-good deployment.
5. Activate the new deployment at reboot.
6. Mark it healthy only after boot validation.
7. Roll back to the previous deployment if activation fails.
8. Garbage-collect old deployments only after a newer version is confirmed healthy.

This is conceptually A/B, but **not A/B physical partitions**. Logical deployments share the pool and only consume the blocks actually needed.

## Native recovery model

The boot partition carries a minimal signed recovery environment so recovery does not depend on the main root deployment being bootable.

Recovery actions are intentionally separate:

- **Rollback**: boot the previous known-good OS deployment.
- **Repair / reinstall system**: replace the OS deployment while preserving user data and user-owned persistent state by default.
- **Reset persistent state**: rebuild damaged machine/application state without deleting normal user files where technically safe.
- **Factory reset**: explicit destructive action that may erase user data.

A large fixed offline recovery partition is not required by default. An OEM/device profile may add one later if a specific offline requirement justifies the reserved capacity.

## Native encryption

For installed systems, the large pool should use LUKS2 by default where the hardware/product profile supports it.

TPM2 automatic unlock is allowed, but it must be paired with a separately recoverable high-entropy recovery key. The storage design must not make the TPM the only path to the user's data.

Portable USB must not assume one machine's TPM because portability is part of the product mode. Optional password/FIDO2-protected state can be added without making the USB machine-bound.

## Portable update model

A portable release is never overwritten in place:

```text
current.erofs      remains known-good
new.erofs          is downloaded separately
 -> verify signature/integrity
 -> install matching boot asset
 -> select new release for next boot
 -> boot and validate
 -> keep old release as rollback
 -> garbage collect only later
```

The exact filenames may differ; the important contract is versioned immutable payloads and atomic activation.

For stronger runtime integrity, the EROFS image should use a signed root hash with block-level verification such as dm-verity (or an equivalent mature mechanism), avoiding the need to re-hash the complete USB system image on every boot.

## Why EROFS on USB

EROFS is designed for immutable image filesystems and supports transparent compression with optimized metadata/decompression. That fits a live USB well:

- most OS bytes are read, not rewritten;
- compressed reads reduce physical USB traffic;
- system releases are immutable and easy to verify;
- updating means adding a new image instead of modifying thousands of small files;
- rollback is simply selecting the previous image.

SquashFS is also a proven Live Linux approach. EROFS is preferred for the target design because it is a modern image filesystem aimed at immutable system/container use, while the OrdaX contract should remain abstract enough to change image implementation if measurement proves another format better.

## Why the USB writable layer is ext4, not exFAT

OverlayFS requires a writable upper filesystem with Linux semantics such as extended attributes and valid directory entry type information. exFAT is appropriate for cross-platform user files but not as the direct Linux OverlayFS upper layer.

Therefore:

```text
exFAT ORDAX-DATA
  -> contains persistent-state.img
      -> ext4 inside the image
          -> OverlayFS upper/work directories
```

This retains Windows visibility for normal user files and Linux correctness for system persistence.

## USB write policy

The portable profile should minimize write amplification:

- immutable compressed system image;
- ephemeral caches/logs in tmpfs or zram where reasonable;
- persistent writes only for data that truly must survive reboot;
- bounded logs and caches;
- no routine package mutation of the base root;
- no writing zeros across unused USB capacity;
- no full-device readback when large regions are intentionally unused and will be recreated/formatted separately.

This is especially important for low-cost flash drives with weak random-write performance and limited endurance.

## External SSD connected by USB

The bus name is not the architecture.

An external NVMe/SSD enclosure connected through USB may be fast and durable enough for the native-disk profile. Conversely, a cheap thumb drive should use the portable profile.

Selection should consider:

- user-selected mode: live portable vs installed system;
- removable-media indication;
- capacity;
- rotational vs solid-state information;
- TRIM/discard support;
- conservative device class and, later, bounded performance measurement.

The Creator must not assume that every device on USB is slow or that every non-USB device is fast.

## Space management without rigid partitions

Native disk:

- system, apps and home share one Btrfs capacity pool;
- no default hard size for system, apps or home;
- use a logical update safety reserve rather than a fixed update partition;
- refuse or defer an update cleanly when there is not enough safe staging space;
- preserve the previous known-good deployment until the new boot is confirmed.

Portable USB:

- user files and immutable OS image files share the large exFAT volume;
- Linux persistent state lives in a growable ext4 image file;
- growing state or downloading a new OS release consumes only real free space;
- keep enough free capacity for one staged update and rollback;
- old releases are garbage-collected after health confirmation.

## Comparison of researched models

### Windows

Useful lessons:

- one large normal system/user capacity area avoids unnecessary sizing boundaries;
- boot and recovery are protected separately;
- recovery can operate independently of a broken main OS.

Not copied:

- NTFS as the OrdaX native filesystem;
- Microsoft Reserved partition;
- Windows-specific recovery mechanics.

### Fedora / Btrfs desktops

Useful lessons:

- Btrfs root and home subvolumes share free space;
- subvolumes provide logical separation without fixed capacities;
- checksums, snapshots and compression are useful desktop primitives.

Adopted for native OrdaX pool semantics.

### bootc / OSTree and immutable Linux systems

Useful lessons:

- stage the next system independently of the running deployment;
- persistent `/var` is decoupled from OS rollback;
- updates activate transactionally;
- previous deployments provide rollback;
- OS delivery can use signed/versioned image artifacts.

Adopted as the preferred initial update/deployment implementation model.

### SUSE transactional systems

Useful lesson:

- read-only system state can be updated in a separate snapshot and activated only after reboot;
- rollback is a first-class operation;
- mutable application/user state can remain outside the system snapshot.

This confirms that system rollback should not imply user-data rollback.

### ChromeOS physical A/B

Useful lesson:

- fully independent bootable slots provide strong failure recovery.

Not chosen as the default OrdaX disk model because physical A/B duplicates reserved system capacity and introduces fixed slot sizing. OrdaX uses logical versioned deployments instead.

### Ubuntu Core

Useful lessons:

- recovery must be independently bootable;
- system data can be grown at installation time;
- recovery and normal data are different responsibilities.

Not copied literally because its embedded/device partition model would impose more fixed physical boundaries than needed for a general OrdaX desktop.

### Debian Live / Live USB

Useful lessons:

- compressed read-only system images are appropriate for portable live media;
- writable persistence can be layered separately;
- persistence may itself be provided as an image file on another filesystem;
- encrypted persistence is possible when required.

Adopted as the basis for the portable OrdaX model, combined with signed immutable releases and EROFS/verity-style integrity.

## Current prototype and migration

The current Creator work that produces:

```text
ORDAX-ESP
ORDAX
ORDAX-DATA
```

is now classified as a **transitional physical proof**, not the long-term portable storage contract.

It may still be used for the immediate real-hardware boot proof because changing boot media geometry and debugging the boot failure simultaneously would make diagnosis harder. It must not be promoted as the stable final architecture.

The next storage migration should replace the fixed portable `ORDAX` system partition with the file-based immutable system model described here, after the current physical boot path is proven.

This avoids throwing away the current boot investigation while also preventing a temporary prototype layout from becoming permanent technical debt.

## Durable rule

The product-level storage rule is:

> **Native OrdaX uses one flexible Linux-native capacity pool; Portable OrdaX uses a read-mostly immutable system and minimizes writes while keeping user files cross-platform. Both use signed versioned releases, independent recovery and rollback without deleting user data by default.**

Any future storage change that violates this rule requires a new architecture decision and evidence from real hardware measurements.
