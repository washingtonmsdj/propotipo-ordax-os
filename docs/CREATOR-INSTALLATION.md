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
4. assemble one deterministic Creator payload
5. verify every payload byte against the canonical manifest
6. implement narrow Windows removable-device adapter
7. disposable-media proof
8. explicit destructive authorization
9. first physical USB
10. later embed the same Creator Core in OrdaX Desktop
```

No step requires Codex.

## Creator Core responsibilities

`tools/creator/core/` owns host-neutral policy:

- validate the canonical two-partition contract;
- reject `ORDAX-HOME` or any third required partition;
- verify that every physical artifact is resolved and SHA-256 pinned;
- interpret every `source_path` only relative to an assembled payload root;
- independently hash all local payload bytes before physical authorization;
- reject traversal, absolute paths, symlinks, target collisions and non-regular files;
- produce one deterministic write plan;
- enforce that physical writes remain blocked until the manifest authorizes them;
- define post-write verification and rollback/error semantics.

The Core does not own Windows disk APIs, UI, elevation, or arbitrary command execution.

## Creator payload

CI-produced artifacts are never referenced through temporary runner paths such as `/home/runner/...` or `out/...` outside the delivered bundle.

A Creator release assembles a deterministic payload directory. The exact final packaging format can later be a signed archive or resources embedded with the Desktop application, but after extraction/materialization the Core sees one root:

```text
creator-payload/
  boot/
    esp/
      systemd-bootx64.efi
      loader/...
  bootstrap/
    kernel/
      bzImage
    initramfs/
      initramfs.cpio.gz
    network/
      netbox
      bring-up
      udhcpc.script
    release/
      release-agent
    recovery/
      entrypoint
    entrypoint
```

The canonical media manifest maps those bundle-relative source paths to their target partition paths. The directory layout above is illustrative until every artifact group is resolved; no unresolved filename becomes canonical merely by appearing in this document.

The integrity order is mandatory:

```text
CI builds candidate
 -> CI verifies candidate provenance/hash
 -> payload assembler copies exact candidate bytes
 -> Creator Core hashes assembled payload again
 -> disposable layout proof
 -> explicit destructive authorization
 -> physical write
 -> independent post-write re-read/hash verification
```

A CI success alone is not permission to write a USB.

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
  read and validate contracts only

ASSEMBLE
  CI/release process materializes one deterministic payload root

VERIFY-PAYLOAD
  Core independently hashes every source artifact; no disk write

PLAN
  produce deterministic intended changes; requires explicit manifest authorization

APPLY
  privileged physical write; unavailable until every physical gate passes

VERIFY-MEDIA
  independently re-read partition table/filesystems/artifacts after write
```

At the current prototype stage CHECK and the Core-side VERIFY-PAYLOAD capability exist. The canonical manifest is still unresolved/unauthorized, so a real current payload cannot yet pass VERIFY-PAYLOAD and PLAN remains blocked. APPLY is not implemented.

## Artifact delivery

The Creator never compiles the kernel on the user's Windows machine.

```text
Git main
  -> GitHub CI
     -> kernel candidate/release
     -> initramfs candidate/release
     -> ESP bootloader candidate/release
     -> network bootstrap candidate/release
     -> release acquisition candidate/release
     -> deterministic Creator payload
     -> signed/pinned media manifest
        -> OrdaX Creator verifies local bytes again
           -> physical USB
```

The user's machine needs only the signed Creator application, its verified payload and normal administrator authorization for the narrow raw-device step.

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
