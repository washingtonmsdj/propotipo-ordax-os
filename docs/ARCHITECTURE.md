# Architecture

Status: CANONICAL FOR PROTOTYPE

## Goal

Prove a minimal, reproducible, Git-first operating system substrate that can boot independently, establish secure remote control, acquire the rest of the system as versioned releases, and expose the same user-facing Surface on real OrdaX hardware and on the web from one source tree.

## Core invariant

```text
GIT_SOURCE_AUTHORITY=YES
USB_SOURCE_AUTHORITY=NO
NOTEBOOK_SOURCE_AUTHORITY=NO
PHYSICAL_PARTITIONS=2
SEPARATE_HOME_PARTITION=NO
SINGLE_SURFACE_SOURCE=YES
WEB_AND_DEVICE_UI_FORKS=FORBIDDEN
```

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
- persistent SSH host identity;
- fail-closed remote access;
- minimal Control Plane path;
- Git/release acquisition;
- recovery/maintenance path.

Anything that is not needed to reach, verify, activate, or recover a release should normally not live here.

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

The same source owns:

- desktop;
- shell/chrome;
- windows;
- explorer;
- settings;
- first-party apps;
- visual tokens;
- shared interaction behavior.

It must render from the same components and design tokens on:

1. the OrdaX notebook/runtime;
2. local browser development;
3. hosted web preview/deployment.

Creating a second web UI, a second notebook UI, copied CSS, copied components or platform-specific visual forks is forbidden.

Platform differences are expressed only behind capability interfaces/adapters.

```text
Surface/core/UI
      |
      +--> adapters/ordax  -> real OrdaX services/kernel/hardware capabilities
      |
      +--> adapters/web    -> browser-safe implementations, mocks or remote APIs
```

A color, spacing, component, window, app or interaction changed in the shared Surface source must be the same change for web and device builds. Platform adapters may change capability availability, never visual ownership.

The web target is therefore a real supported presentation/runtime target of the same OS Surface, not a screenshot, duplicate demo, or separate product fork.

### 5. Persistent state

Persistent mutable state must be separated from release contents.

```text
/ordax/state/
```

Examples that may belong here after explicit ownership is defined:

- device identity;
- SSH host key;
- approved public-key authorization state;
- Control Plane enrollment/attestation state;
- release activation metadata;
- bounded service state that cannot be reconstructed.

Never store source code here as canonical authority.

### 6. User data

User/workspace data is logically separate:

```text
/ordax/home/
```

This is not a separate physical partition in the prototype. Backup, quota, encryption, snapshots or later isolation can be implemented logically first. Physical separation requires a future recorded decision.

## Boot and evolution chain

```text
UEFI
  -> ESP
  -> kernel/initramfs
  -> bootstrap substrate
  -> network
  -> device identity
  -> secure remote/control path
  -> Git/release resolver
  -> verified releases/<commit>
  -> atomic current switch
  -> OrdaX runtime
  -> shared Surface
```

The web path starts later in the same source graph:

```text
Git
  -> shared system/Surface source
  -> web adapter
  -> localhost / preview / hosted web
```

Both targets must resolve the same Surface component versions for a given source commit.

## Update semantics

A normal Surface/application change is source-shared:

```text
edit shared Surface
 -> local browser HMR during development
 -> commit/push
 -> hosted web build receives the same commit
 -> notebook release/delta receives the same commit
```

No manual porting or conversion step between web and notebook is allowed for shared UI code.

Changes to boot/kernel/initramfs remain separately gated because the browser has no equivalent kernel boundary.

## Ownership rules

Each responsibility must have one canonical owner. A compatibility wrapper is acceptable only when it is thin, documented and delegates to that owner. Permanent duplicate implementations are forbidden.

For the Surface specifically, platform adapters own capabilities; they do not own duplicated screens or design systems.

## Failure model

Identity, integrity, host-key trust, release verification and physical-target selection fail closed. Loss of network or Git must not make the machine unbootable when a previously verified release exists.

Web unavailability must not make the physical OrdaX device unusable, and physical-device unavailability must not prevent shared Surface development in the browser.

## Non-goals for the first prototype

The first prototype does not need to prove:

- final desktop design;
- marketplace/apps ecosystem;
- final user-data encryption policy;
- final multi-user model;
- production update CDN;
- every service from the legacy repository;
- browser access to privileged kernel operations that browsers cannot safely expose.

The first milestone is a trustworthy substrate that boots and can evolve by Git without reimaging for every change, with a single Surface source capable of rendering consistently on both device and web targets.
