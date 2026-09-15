# Minimal USB Bootstrap

Status: CANONICAL FOR PROTOTYPE

## Goal

The first physical USB must contain only the minimum trusted substrate required to boot, reach the network, acquire a verified system release and recover if acquisition fails.

The initial USB is not a preinstalled copy of the complete OrdaX product.

## Physical layout

```text
ORDAX-ESP
ORDAX
```

Exactly two physical partitions.

## Initial USB payload

### ORDAX-ESP

Only boot-critical material:

```text
UEFI bootloader
loader configuration
verified kernel
verified initramfs
recovery entry when required
```

### ORDAX main partition

Only the mandatory pre-release bootstrap and empty runtime roots:

```text
/ordax/bootstrap/
  network/
  release-acquisition/
  recovery/

/ordax/releases/        # initially empty
/ordax/current          # unset until first release is verified
/ordax/state/           # empty/minimal runtime root
/ordax/home/            # user-data root
```

## Explicitly absent from the first USB

```text
Surface/desktop = NO
normal apps = NO
high-level services = NO
stable device identity service = NO
Remote Core = NO
Control Plane = NO
SSH = NO
complete source checkout = NO
build toolchain = NO
WSL/QEMU payload = NO
legacy repository dump = NO
```

A tiny local status/recovery presentation is allowed only if required to show network, acquisition, verification or failure state.

## First boot

```text
UEFI
 -> kernel/initramfs
 -> minimal bootstrap
 -> network
 -> Git/GitHub release acquisition
 -> verify integrity/authenticity
 -> materialize /ordax/releases/<commit>
 -> atomically activate /ordax/current
 -> launch OrdaX
```

Remote access is not needed for this path.

## After the first successful release

At least one known-good verified release remains local.

```text
NETWORK_REQUIRED_FOR_KNOWN_GOOD_BOOT=NO
KNOWN_GOOD_RELEASE_PRESERVED=YES
ROLLBACK_LOCAL=YES
```

Network/Git are required to acquire new releases, not to boot an already verified current release.

## Development model

```text
system/Surface/app change
 -> Git push
 -> Web receives same source change
 -> OrdaX updater acquires release/delta
 -> verify + activate
 -> no USB reflash

boot/kernel/initramfs change
 -> separately gated base update
 -> reboot only when required
```

## Source/media relationship

Everything needed to reproduce the bootstrap is represented in this repository through source, manifests, configuration, provenance and build recipes.

Private/runtime data is not committed to public Git.

## Prototype rule

```text
INITIAL_USB_POLICY=MINIMUM_GIT_ACQUISITION_FIRST
REMOTE_CONTROL_PRESEEDED=NO
SSH_PRESEEDED=NO
FULL_SYSTEM_PRESEEDED=NO
SURFACE_PRESEEDED=NO
APPS_PRESEEDED=NO
FIRST_FULL_RELEASE_ACQUIRED_AFTER_BOOT=YES
REFLASH_FOR_NORMAL_SYSTEM_CHANGES=NO
```

If a future requirement proves that device identity, Remote Core or Control Plane is necessary, it must be introduced deliberately through an architectural decision rather than added preemptively.
