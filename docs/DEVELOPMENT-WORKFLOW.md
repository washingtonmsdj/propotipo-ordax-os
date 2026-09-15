# Development Workflow

Status: CANONICAL FOR PROTOTYPE

## Source model

`main` is the source authority for this prototype.

The intended daily loop is:

```text
edit source
  -> run affected tests
  -> commit to main
  -> materialize/sync only the delta when target is online
  -> restart/reconcile only the affected owner
  -> verify health/readiness
  -> record evidence
```

A full image rebuild, USB reflash or notebook reboot is not the default development action.

## Phases

### Phase A - source-only

Work that can be completed without the notebook:

- architecture/contracts;
- provisioning logic;
- release layout;
- security policy;
- unit/fixture tests;
- disposable image/QEMU tests;
- static verification.

### Phase B - physical bootstrap

Once provisioning is proven against a disposable target:

- identify the physical USB;
- clean-provision the two-partition layout;
- install only the pre-Git bootstrap;
- verify physical bytes/layout;
- boot the notebook;
- prove network + identity + Remote Core/SSH + Control Plane + Git.

### Phase C - live evolution

Once the notebook can safely reach source/releases:

```text
Git main
 -> build/test affected component
 -> publish/materialize release or delta
 -> notebook target
 -> owner-local restart/reconcile
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

Expected development transport:

- root-capable developer target only where explicitly allowed;
- SSH public-key authentication only;
- persistent device host key;
- strict host-key checking;
- multiple authorized public keys may coexist;
- Control Plane is preferred for audited remote actions when available;
- SSH remains a bootstrap/fallback path.

Never use `StrictHostKeyChecking=no` or `UserKnownHostsFile=/dev/null` in an active workflow.

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

## When the target is offline

Do not block source work that is independently testable. Mark physical validation explicitly as pending and continue source/QEMU/fixture work.
