# Architecture

Status: CANONICAL FOR PROTOTYPE

## Goal

Prove a minimal, reproducible, Git-first OrdaX that boots independently, reaches the network, acquires the rest of the system as a verified release, and exposes the same user-facing Surface on Web, USB and native disk from one source tree.

## Core invariant

```text
GIT_SOURCE_AUTHORITY=YES
USB_SOURCE_AUTHORITY=NO
NOTEBOOK_SOURCE_AUTHORITY=NO
PHYSICAL_PARTITIONS=2
SEPARATE_HOME_PARTITION=NO
ONE_PRODUCT_WEB_USB_NATIVE=YES
SINGLE_SURFACE_SOURCE=YES
WEB_AND_DEVICE_UI_FORKS=FORBIDDEN
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
  system/               # shared product delivered as releases
    surface/            # same UI source for Web + native OrdaX
    apps/               # same app source
    services/
    adapters/
      web/
      native/
  platform/             # persistent layout contracts/templates
  tools/
    creator/
    dev/
    verify/
  docs/
  tests/
```

There must not be separate Web and native forks of the Surface or application source.

## Product modes

```text
OrdaX Web
  -> OrdaX USB
  -> OrdaX Native (SSD/HD)
```

They share account model, Surface source and app source. Capability differences are expressed through adapters only.

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
- GitHub/Git/release acquisition over standard secure transport;
- release integrity verification;
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

If future evidence shows Remote Core, Control Plane or a persistent device identity is actually necessary, add it through a new recorded architectural decision. Do not preinstall it speculatively.

### 3. Releases

Canonical materialization model:

```text
/ordax/releases/<commit>/
/ordax/current -> releases/<commit>
```

A release is immutable after verification. Activation changes the pointer, not existing release contents. Rollback selects a previously verified release.

The first full release is acquired after boot. Once verified and activated, at least one known-good release remains local so ordinary boot does not require the network.

### 4. Universal Surface

There is exactly one user-facing Surface source tree.

The same source owns desktop, windows, explorer, settings, first-party apps, visual tokens and shared interaction behavior.

It renders from the same components on:

1. OrdaX USB/native runtime;
2. local browser development;
3. hosted Web deployment.

Creating copied CSS, copied screens or separate Web/native UI implementations is forbidden. Platform differences live only behind capability adapters.

### 5. Persistent state

Persistent mutable state lives under:

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
  -> network
  -> Git/release acquisition
  -> verify release
  -> /ordax/releases/<commit>
  -> atomic current switch
  -> OrdaX runtime
  -> shared Surface
```

The Web path begins from the same source graph without the native boot boundary:

```text
Git
  -> shared system source
  -> web adapter
  -> OrdaX Web
```

## Update semantics

Normal development is Git-driven:

```text
edit shared source
 -> local Web/HMR while developing
 -> test
 -> commit/push
 -> hosted Web receives the commit
 -> OrdaX updater detects/pulls the matching release or delta
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

If a later product requirement appears for remote device management, diagnostics or recovery, an OrdaX-owned Remote Core may be added as a normal release component using mature standard transport/cryptography. SSH remains unnecessary unless explicitly justified later.

## Failure model

Integrity, release verification and physical-target selection fail closed. Loss of network or Git must not make the machine unbootable once a known-good release has been activated locally.

## First milestone

The first milestone is deliberately small:

```text
boot
 -> network
 -> acquire verified release from Git/GitHub
 -> activate
 -> boot that release offline later
```

Everything else must justify its presence instead of entering the bootstrap by default.
