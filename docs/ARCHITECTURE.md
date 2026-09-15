# Architecture

Status: CANONICAL FOR PROTOTYPE

## Goal

Prove a minimal, reproducible, Git-first operating system substrate that can boot independently, establish secure OrdaX-owned control, acquire the rest of the system as versioned releases, and expose the same user-facing Surface on Web, USB and native-disk OrdaX from one source tree.

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
SSH_REQUIRED_FOR_PRODUCT=NO
CUSTOM_CRYPTO_ALLOWED=NO
```

## Source/product shape

```text
propotipo-ordax-os/
  boot/                 # source/definition for boot media
  bootstrap/            # source needed to reach a trusted release
  system/               # shared product delivered as releases
    surface/            # same UI source for Web + native OrdaX
    apps/               # same app source
    services/           # shared domain/service logic
    adapters/
      web/               # browser capability adapter
      native/            # OrdaX/native capability adapter
  platform/             # persistent layout contracts/templates
  tools/
    creator/             # one OrdaX Creator product
    dev/
    verify/
  docs/
  tests/
```

There must not be separate Web and native forks of the Surface or application source.

## Product modes

See `docs/PRODUCT-MODES.md`.

```text
OrdaX Web
  -> OrdaX USB
  -> OrdaX Native (SSD/HD)
```

They share account model, Surface source and app source. Capability differences are expressed through adapters only.

## Layers

### 1. ESP

Role: only UEFI boot material.

Expected contents are bounded to the bootloader, loader configuration, kernel/initramfs references or payloads required for boot, and recovery/developer entries when justified.

ESP must not become a general application filesystem.

### 2. Bootstrap substrate

Role: make the machine independently capable of reaching a trusted release.

Minimum responsibilities:

- kernel + initramfs;
- minimal userspace needed for boot;
- network bring-up;
- stable device identity;
- OrdaX Remote Core;
- minimal Control Plane path;
- Git/release acquisition;
- recovery/maintenance path.

Anything that is not needed to reach, verify, activate, control or recover a release should normally not live here.

SSH is not part of the required final product substrate. A temporary break-glass SSH path may exist only during migration while OrdaX Remote Core is not yet proven on physical hardware.

### 3. Releases

Canonical materialization model:

```text
/ordax/releases/<commit>/
/ordax/current -> releases/<commit>
```

A release is immutable after publication. Activation changes the pointer, not the contents of an existing release.

Rollback changes `current` to a previously verified release.

### 4. Universal Surface

There is exactly one user-facing Surface source tree.

The same source owns desktop, shell/chrome, windows, explorer, settings, first-party apps, visual tokens and shared interaction behavior.

It must render from the same components and design tokens on:

1. OrdaX USB/native runtime;
2. local browser development;
3. hosted Web deployment.

Creating a second Web UI, a second notebook UI, copied CSS, copied components or platform-specific visual forks is forbidden.

Platform differences are expressed only behind capability interfaces/adapters.

```text
Surface/core/UI
      |
      +--> adapters/native -> real OrdaX services/kernel/hardware capabilities
      |
      +--> adapters/web    -> browser-safe implementations or authorized remote APIs
```

A color, spacing, component, window, app or interaction changed in shared Surface source must be the same change for every mode consuming that commit.

The Web target is a real supported OrdaX mode, not a screenshot, mock or separate product fork.

### 5. Persistent state

Persistent mutable state must be separated from release contents.

```text
/ordax/state/
```

Examples:

- device identity;
- local private device identity material;
- approved operator/device authorizations;
- Control Plane enrollment/attestation state;
- release activation metadata;
- bounded service state that cannot be reconstructed.

Never store source code here as canonical authority. Private keys and secrets never belong in Git.

### 6. User data

User/workspace data is logically separate:

```text
/ordax/home/
```

This is not a separate physical partition in the prototype. Backup, quota, encryption, snapshots or later isolation can be implemented logically first.

### 7. Shared system

`system/` is the source for the product users interact with after bootstrap.

Web, USB and native-disk modes consume the same Surface/apps/services source. Only capability adapters differ.

## Boot and evolution chain

```text
UEFI
  -> ESP
  -> kernel/initramfs
  -> bootstrap substrate
  -> network
  -> device identity
  -> OrdaX Remote/Control Core
  -> Git/release resolver
  -> verified releases/<commit>
  -> atomic current switch
  -> OrdaX runtime
  -> shared Surface
```

The Web path begins from the same source graph without the native kernel boundary:

```text
Git
  -> shared system source
  -> web adapter
  -> OrdaX Web
```

## Update semantics

A normal Surface/application change is source-shared:

```text
edit shared source
 -> local browser HMR during development
 -> commit/push
 -> hosted Web receives the same commit
 -> USB/native release or delta receives the same commit
```

No manual porting or conversion step between Web and native OrdaX is allowed for shared UI/app code.

Changes to boot/kernel/initramfs remain separately gated because the browser has no equivalent kernel boundary.

## Host independence

See `docs/HOST-INDEPENDENCE.md`.

No canonical operation may depend exclusively on WSL, QEMU, PowerShell, Bash or one desktop operating system.

Where raw-disk/elevation APIs differ, shared tooling may use thin host adapters. Partition policy, artifact selection, verification and product behavior remain single-source.

QEMU may be used as optional test infrastructure, but it is never required for the product, OrdaX Creator or source authority.

## Remote control

See `docs/REMOTE-CONTROL.md`.

OrdaX owns the control protocol/application layer but uses mature audited secure transport and cryptographic libraries. Custom cryptographic primitives are forbidden.

Normal remote control is structured capability RPC, file/delta transfer, logs/events and release operations rather than an unrestricted shell.

## Ownership rules

Each responsibility must have one canonical owner. A compatibility wrapper is acceptable only when it is thin, documented and delegates to that owner. Permanent duplicate implementations are forbidden.

For the Surface specifically, platform adapters own capabilities; they do not own duplicated screens or design systems.

## Failure model

Identity, integrity, authorization, release verification and physical-target selection fail closed. Loss of network or Git must not make the machine unbootable when a previously verified release exists.

Web unavailability must not make the physical OrdaX device unusable, and physical-device unavailability must not prevent shared Surface development in the browser.

## Non-goals for the first prototype

The first prototype does not need to prove:

- final desktop visual design;
- marketplace/apps ecosystem;
- final user-data encryption policy;
- final multi-user model;
- production update CDN;
- every service from the legacy repository;
- custom cryptographic primitives;
- browser access to privileged kernel operations that browsers cannot safely expose.

The first milestone is a trustworthy substrate that boots and can evolve by Git without reimaging for every change, with one shared product source across Web and native OrdaX.
