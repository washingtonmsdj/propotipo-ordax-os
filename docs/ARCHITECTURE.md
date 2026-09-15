# Architecture

Status: CANONICAL FOR PROTOTYPE

## Goal

Prove a minimal, reproducible, Git-first operating system substrate that can boot independently, establish secure remote control, and then acquire the rest of the system as versioned releases.

## Core invariant

```text
GIT_SOURCE_AUTHORITY=YES
USB_SOURCE_AUTHORITY=NO
NOTEBOOK_SOURCE_AUTHORITY=NO
PHYSICAL_PARTITIONS=2
SEPARATE_HOME_PARTITION=NO
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

### 4. Persistent state

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

### 5. User data

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
```

## Ownership rules

Each responsibility must have one canonical owner. A compatibility wrapper is acceptable only when it is thin, documented and delegates to that owner. Permanent duplicate implementations are forbidden.

## Failure model

Identity, integrity, host-key trust, release verification and physical-target selection fail closed. Loss of network or Git must not make the machine unbootable when a previously verified release exists.

## Non-goals for the first prototype

The first prototype does not need to prove:

- final desktop design;
- marketplace/apps ecosystem;
- final user-data encryption policy;
- final multi-user model;
- production update CDN;
- every service from the legacy repository.

The first milestone is a trustworthy substrate that boots and can evolve by Git without reimaging for every change.
