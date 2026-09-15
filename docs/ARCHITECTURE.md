# Architecture

Status: CANONICAL FOR PROTOTYPE

## Goal

Prove a minimal, reproducible, Git-first OrdaX that boots independently, reaches the network, acquires the rest of the system as a verified release, and exposes one product across Web, Mobile, Desktop, USB and native disk from one shared source graph.

## Core invariant

```text
GIT_SOURCE_AUTHORITY=YES
USB_SOURCE_AUTHORITY=NO
NOTEBOOK_SOURCE_AUTHORITY=NO
PHYSICAL_PARTITIONS=2
SEPARATE_HOME_PARTITION=NO
ONE_PRODUCT_FIVE_MODES=YES
SINGLE_SURFACE_SOURCE=YES
SINGLE_APPLICATION_SOURCE=YES
PLATFORM_POLICY_FORKS=FORBIDDEN
CAPABILITY_ADAPTERS=REQUIRED
WSL_REQUIRED=NO
QEMU_REQUIRED=NO
SSH_REQUIRED=NO
REMOTE_CONTROL_REQUIRED=NO
CUSTOM_CRYPTO_ALLOWED=NO
```

## Source/product shape

```text
prototipo-ordax-os/
  boot/                 # boot media definition
  bootstrap/            # only what is needed to reach a verified release
  system/               # shared product delivered/packaged across modes
    surface/            # one visual source
    apps/               # one first-party app source
    services/           # shared account/sync/domain behavior
    adapters/
      web/
      mobile/           # Android/iOS differences stay behind this boundary
      desktop/          # desktop-host capabilities; Windows first
      native/           # USB/native-disk capabilities where genuinely shared
  platform/             # persistent layout contracts/templates
  tools/
    creator/
    dev/
    verify/
  docs/
    contracts/
      foundation.json
      product-capabilities.json
  tests/
```

There must not be separate Web, Mobile, Desktop or native forks of Surface/application logic. Platform differences are capabilities, not alternate products.

## Product modes

```text
OrdaX Web
  -> OrdaX Mobile (Android / iPhone)
  -> OrdaX Desktop
  -> OrdaX USB
  -> OrdaX Native (SSD/HD)
```

They share account model, Surface source, app source and compatible service contracts. USB and native-disk share the native adapter when their capability is genuinely identical.

`docs/contracts/product-capabilities.json` is the machine-readable boundary for how modes gain capabilities without forking the product.

### Capability evolution

Shared code depends on stable capability IDs, not platform-name conditionals. The compatibility rules are deliberately asymmetric:

- adding a new capability definition is backward-compatible;
- adding an optional capability to a mode is backward-compatible;
- adding a new required capability to an existing mode requires an explicit migration;
- changing the meaning of an existing capability requires a new capability ID or a contract major version;
- removing a capability is breaking;
- an unknown optional capability may be ignored;
- an unknown required capability fails closed;
- privileged/destructive capabilities require an explicit security boundary and user authorization where applicable.

This lets future features such as delta updates, new hardware integrations, richer mobile APIs or remote-management capabilities grow through adapters and contracts instead of forcing a rewrite of shared product code.

## Layers

### 1. ESP

Role: only UEFI boot material.

Expected contents are bounded to bootloader/configuration plus the kernel/initramfs payloads required for boot. ESP must not become a general application filesystem.

### 2. Minimal bootstrap substrate

Role: do only enough work to reach and activate the first verified release.

Mandatory responsibilities:

- kernel + initramfs;
- minimal userspace needed for boot;
- minimal network bring-up;
- signed release acquisition over standard HTTPS;
- release authenticity/integrity verification;
- recovery/maintenance path.

Not mandatory before the first release:

- SSH;
- OrdaX Remote Core;
- Control Plane;
- stable device identity service;
- Surface/desktop;
- normal applications;
- complete source checkout;
- build toolchain.

If future evidence shows Remote Core, Control Plane or a persistent device identity is actually necessary, add it through a new recorded architectural decision and capability contract. Do not preinstall it speculatively.

### 3. Releases

Canonical materialization model:

```text
/ordax/releases/<commit>/
/ordax/current -> releases/<commit>
```

A release is immutable after verification. Activation changes the pointer, not existing release contents. Rollback selects a previously verified release.

The first full release is acquired after boot. Once verified and activated, at least one known-good release remains local so ordinary boot does not require the network.

Release protocol evolution is versioned. Current `release-manifest/1` intentionally contains one `system.tar`; future formats such as deltas or additional artifacts must enter through a new version/contract path rather than silently changing v1 semantics.

### 4. Universal Surface

There is exactly one user-facing Surface source tree.

The same source owns desktop/window shell, explorer, settings, first-party apps, visual tokens and shared interaction behavior. It is packaged/rendered through the applicable adapter on:

1. hosted/local Web;
2. Android/iOS mobile clients;
3. Desktop host clients;
4. OrdaX USB runtime;
5. OrdaX native-disk runtime.

Creating copied CSS, copied screens or separate mode-specific UI implementations is forbidden. Shared Surface may branch on capability availability, not on platform identity where a capability abstraction can express the difference.

### 5. Persistent state

Persistent mutable device state lives under:

```text
/ordax/state/
```

Only state that cannot or should not be reconstructed belongs there. Private keys and secrets never belong in Git.

### 6. User data

User/workspace data lives logically under:

```text
/ordax/home/
```

It is not a separate physical partition in the prototype.

## Boot and evolution chain

```text
UEFI
  -> ESP
  -> kernel/initramfs
  -> minimal bootstrap
  -> network when needed
  -> acquire signed release
  -> verify release
  -> /ordax/releases/<commit>
  -> atomic current switch
  -> OrdaX runtime
  -> shared Surface
```

Client modes begin from the same source graph without the native boot boundary:

```text
Git
  -> shared system source
  -> capability adapter
  -> Web / Mobile / Desktop
```

## Update semantics

Normal development is Git-driven:

```text
edit shared source
 -> local Web/HMR when applicable
 -> test
 -> commit/push main
 -> CI builds/verifies affected targets
 -> client modes receive their signed/deployed update
 -> OrdaX USB/native detects the matching verified release or future compatible delta
 -> verify
 -> activate
```

No SSH session, remote shell or Control Plane is required for that normal path.

Changes to boot/kernel/initramfs remain separately gated and may require a staged base update/reboot.

## Host independence

No canonical operation may depend exclusively on WSL, QEMU, PowerShell, Bash or one desktop operating system.

Thin host adapters are allowed only where operating systems expose different raw-disk/elevation APIs. Product policy remains shared.

## Optional remote/control capability

Remote management is intentionally **not** a bootstrap dependency or daily-development dependency.

If a later product requirement appears for remote device management, diagnostics or recovery, an OrdaX-owned Remote Core may be added as a normal release capability using mature standard transport/cryptography. SSH remains unnecessary unless explicitly justified later.

## Failure model

Integrity, release verification, unknown required capabilities and physical-target selection fail closed. Loss of network must not make the machine unbootable once a known-good release has been activated locally.

## First milestone

The first milestone remains deliberately small:

```text
boot
 -> network when required
 -> acquire verified release
 -> activate
 -> boot that release offline later
```

Everything else must justify its presence instead of entering the bootstrap by default.
