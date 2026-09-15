# Minimal USB Bootstrap

Status: CANONICAL FOR PROTOTYPE

## Goal

The first physical USB must contain only the minimum trusted substrate required to boot the notebook, establish network/identity/control, acquire a verified system release, and recover if acquisition fails.

The initial USB is not a preinstalled copy of the complete OrdaX product.

## Physical layout

```text
ORDAX-ESP
ORDAX
```

Exactly two physical partitions are required by the prototype contract.

## Initial USB payload

### ORDAX-ESP

Only boot-critical material:

```text
UEFI bootloader
loader configuration
verified kernel
verified initramfs
normal/recovery boot entries when required
```

The ESP must not contain the Surface, applications, normal services, user files, package caches, source trees, developer tooling, or historical artifacts.

### ORDAX main partition

Only the pre-release bootstrap substrate and empty runtime roots:

```text
/ordax/bootstrap/
  network/
  identity/
  remote/
  control-plane/
  release-acquisition/
  recovery/
  trust/

/ordax/releases/        # initially empty unless an explicitly verified emergency seed is approved
/ordax/current          # unset until a release is verified/activated
/ordax/state/           # runtime-local state; secrets generated/enrolled locally
/ordax/home/            # user-data root; no personal payload from Git by default
```

The concrete files under `/ordax/bootstrap` must be bounded by a machine-readable manifest before physical provisioning is authorized.

## Explicitly absent from the first USB

The initial media must not be bloated with components that can arrive safely after network acquisition:

```text
full Surface/desktop = NO
normal first-party apps = NO
marketplace/catalog = NO
high-level services = NO
complete source checkout = NO
build toolchain = NO
WSL/QEMU/tooling payload = NO
legacy repository dump = NO
```

Only a tiny bootstrap/recovery presentation is allowed if needed to show network, acquisition, verification, recovery, or diagnostics state before the first release is available.

## First boot

Target chain:

```text
UEFI
 -> kernel/initramfs
 -> bootstrap
 -> network
 -> stable device identity
 -> OrdaX Remote Core
 -> minimal Control Plane/trust
 -> acquire exact release commit
 -> verify integrity/authenticity
 -> materialize /ordax/releases/<commit>
 -> atomically activate /ordax/current
 -> launch OrdaX system/Surface
```

The complete user-facing OS therefore arrives from the release channel after the minimal bootstrap is alive.

## After the first successful release

Once at least one release has been verified and activated, it must remain locally available for offline boot and rollback.

Normal later boots do not require Git/network when a verified `current` release already exists.

```text
NETWORK_AVAILABLE=optional_for_known_good_boot
KNOWN_GOOD_RELEASE_PRESERVED=YES
ROLLBACK_LOCAL=YES
```

Network/Git are required to acquire new releases, not to make an already verified installation fundamentally bootable.

## Development model

The physical base should change rarely.

```text
bootstrap/boot change
 -> separately gated base update
 -> verification
 -> reboot when required

system/Surface/app change
 -> Git/release or delta
 -> no USB reflash
 -> no full image rebuild
 -> no routine reboot
```

This keeps initial provisioning small and makes most future work happen through Git/network rather than repeated pendrive rewriting.

## Source/media relationship

Everything needed to reproduce the bootstrap is represented by source, manifests, configuration, provenance, and build recipes in this repository.

Generated machine-private state is not backed up to public Git:

- device private identity keys;
- credentials/tokens;
- machine-specific secrets;
- user-private files;
- ephemeral caches.

The repository is the software source/backup authority; device-private state requires a separate safe synchronization/backup policy.

## Prototype rule

```text
INITIAL_USB_POLICY=MINIMUM_NETWORK_FIRST
FULL_SYSTEM_PRESEEDED=NO
SURFACE_PRESEEDED=NO
APPS_PRESEEDED=NO
FIRST_FULL_RELEASE_ACQUIRED_AFTER_BOOT=YES
REFLASH_FOR_NORMAL_SYSTEM_CHANGES=NO
```

A future optional offline/full installer may preseed a signed release, but it must not become a requirement for the clean-room bootstrap architecture.
