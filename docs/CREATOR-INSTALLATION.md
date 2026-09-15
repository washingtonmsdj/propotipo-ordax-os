# OrdaX Creator and First Physical Installation

Status: CANONICAL FOR PROTOTYPE

The first physical OrdaX USB must not depend on Codex, WSL, QEMU, a Linux workstation, or a locally installed kernel toolchain.

## Product path

The permanent end-user path is:

```text
OrdaX Desktop
  -> Creator capability
     -> Creator Core
        -> thin Windows raw-device helper
           -> verified OrdaX USB
```

The first prototype may ship a small `ordax-creator.exe` before the complete OrdaX Desktop UI exists. That executable is not a second product: it is an early shell around the exact same Creator Core that the Desktop application will embed later.

## Why the Creator comes before the full Desktop

Waiting for the complete Desktop application would unnecessarily block physical boot validation. Building an unrelated temporary flasher would create duplication and security debt.

Therefore the sequence is:

```text
1. Creator Core
2. minimal Windows creator shell
3. resolve and verify all bootstrap artifacts
4. implement narrow Windows removable-device adapter
5. disposable-media proof
6. explicit destructive authorization
7. first physical USB
8. later embed the same Creator Core in OrdaX Desktop
```

No step requires Codex.

## Creator Core responsibilities

`tools/creator/core/` owns host-neutral policy:

- validate the canonical two-partition contract;
- reject `ORDAX-HOME` or any third required partition;
- verify that every physical artifact is resolved and SHA-256 pinned;
- produce one deterministic write plan;
- enforce that physical writes remain blocked until the manifest authorizes them;
- define post-write verification and rollback/error semantics.

The Core does not own Windows disk APIs, UI, elevation, or arbitrary command execution.

## Windows adapter responsibilities

The Windows adapter/helper will own only the unavoidable privileged operations:

- enumerate removable physical devices through Windows APIs;
- expose stable device identity, size and removable/system-disk classification;
- require explicit user selection;
- fail closed if target identity changes between plan and apply;
- create the GPT and exactly two partitions from the Core plan;
- format and write only the artifacts already authorized by the Core;
- re-read and verify the resulting layout and hashes;
- safely release/eject the target.

It must never decide a different layout or bypass the Core policy.

## Safety phases

The Creator has separate phases:

```text
CHECK
  read contracts only

PLAN
  produce deterministic intended changes only

APPLY
  privileged physical write; unavailable until every physical gate passes

VERIFY
  independently re-read partition table/filesystems/artifacts after write
```

At the current prototype stage only CHECK exists as a usable path and PLAN intentionally fails closed because `physical_write_allowed=false` in the canonical bootstrap manifest. APPLY is not implemented yet.

## Artifact delivery

The Creator never compiles the kernel on the user's Windows machine.

```text
Git main
  -> GitHub CI
     -> kernel candidate/release
     -> initramfs candidate/release
     -> bootstrap artifacts
     -> signed media manifest
        -> OrdaX Creator downloads/verifies
           -> physical USB
```

The user's machine needs only the signed Creator application and normal administrator authorization for the narrow raw-device step.

## Transition into the full Desktop product

When OrdaX Desktop is ready, its button such as `Create OrdaX USB` invokes the same Core. The standalone prototype shell can then disappear without changing provisioning policy or media format.

```text
prototype ordax-creator.exe
           \
            -> same Creator Core -> same Windows helper -> same media contract
           /
OrdaX Desktop Creator UI
```

No parallel flasher implementation is allowed.
