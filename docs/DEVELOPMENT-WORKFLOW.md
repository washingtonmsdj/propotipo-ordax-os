# Development Workflow

Status: CANONICAL FOR PROTOTYPE

## Source model

`main` is the source authority for this prototype.

The intended daily loop is:

```text
edit source
  -> run affected tests
  -> preview in browser when Surface/app work is affected
  -> commit to main
  -> materialize/sync only the delta when native target is online
  -> reconcile only the affected owner
  -> verify health/readiness
  -> record evidence
```

A full image rebuild, USB reflash or notebook reboot is not the default development action.

## Host independence

Development must not require WSL, QEMU, PowerShell, Bash or one desktop OS as a mandatory substrate.

Canonical tools must have portable cores. Host-specific adapters are allowed only for operations where the host OS genuinely controls access, such as raw disks, elevation or device enumeration.

QEMU is optional test infrastructure. It can improve disposable boot coverage, but source development and product correctness must not depend on its presence.

## Product targets

The same shared product source serves:

```text
Web preview / hosted Web
USB OrdaX
Native SSD/HD OrdaX
```

A normal Surface change should be visible through browser HMR before commit and then reach hosted Web and native OrdaX from the same source commit. No manual Web-to-device port is allowed.

## Phases

### Phase A - source-only

Work that can be completed without the notebook:

- architecture/contracts;
- shared Surface/apps/services;
- browser preview/HMR;
- provisioning core logic;
- release layout;
- security policy;
- unit/fixture tests;
- deterministic artifact tests;
- static image/filesystem verification;
- optional emulator-based tests when available.

### Phase B - physical bootstrap

Once provisioning is proven against safe disposable/fixture targets:

- identify the physical USB;
- clean-provision the two-partition layout;
- install only the pre-Git bootstrap;
- verify physical bytes/layout;
- boot the notebook;
- prove network + identity + OrdaX Remote Core + Control Plane + Git.

### Phase C - live evolution

Once the notebook can safely reach source/releases:

```text
Git main
 -> build/test affected component
 -> publish/materialize release or delta
 -> notebook target
 -> owner-local reconcile
 -> readiness/health evidence
```

## Branching

Prefer one permanent branch: `main`.

A temporary work branch is acceptable for isolated validation, but should be short-lived and integrated only after tests pass. Do not create a forest of long-lived feature branches as alternate source authorities.

## Release model

Every deployed system version must be addressable by source commit.

Target shape:

```text
/ordax/releases/<commit>/
/ordax/current -> releases/<commit>
```

Rules:

- release directories are immutable after verification;
- activation is an atomic pointer/state transition;
- rollback selects a previously verified release;
- persistent mutable state never lives inside a release directory.

## Remote development

Primary development/control transport is the OrdaX Remote Core described in `docs/REMOTE-CONTROL.md`.

Expected properties:

- persistent device identity;
- explicit operator/device authorization;
- mature encrypted/authenticated transport;
- structured capability RPC;
- file/delta transfer;
- logs/events streaming;
- release stage/activate/rollback operations;
- health/readiness queries;
- auditable privileged changes.

An external SSH executable is not required for the product or daily development. During migration only, SSH may remain as break-glass compatibility until Remote Core recovery is proven on real hardware.

## OrdaX Creator development

`tools/creator/` must expose one shared product core.

Platform-specific code is limited to adapters needed for host APIs:

```text
tools/creator/platform/windows/
tools/creator/platform/linux/
tools/creator/platform/macos/
```

These adapters do not own layout policy, artifact choice, verification rules or user-visible product behavior.

End users must not need WSL, QEMU or a kernel toolchain to create/install OrdaX.

## Evidence

For changes that affect boot, storage, identity, remote access or release activation, record at least:

```text
SOURCE_SHA=
TESTS=
TARGET=
OPERATION=
RESULT=
PHYSICAL_WRITE=YES|NO
REBOOT_REQUIRED=YES|NO
```

Evidence is not a substitute for tests, but makes the state of the prototype auditable by another conversation or agent.

## When the native target is offline

Do not block source work that is independently testable. Continue contracts, browser preview, fixtures, static artifact validation and other host-neutral work. Mark real-hardware validation explicitly as pending.
