# Source Migration Ledger

Status: CANONICAL LEDGER

This file controls selective reuse from `washingtonmsdj/novo-ordax-os`.

## Rule

Nothing is imported by directory-copy or history-copy. Every reused component must be reviewed independently.

## Required record

Use one entry per migrated component:

```text
COMPONENT=
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_COMMIT=
LEGACY_PATH=
RESPONSIBILITY=
WHY_NEEDED=
DEPENDENCIES=
SECURITY_REVIEW=
TESTS=
ARTIFACT_SHA256=
DECISION=ADOPTED|REIMPLEMENTED|REJECTED
TARGET_PATH=
NOTES=
```

## Initial migration candidates

These are candidates only, not approvals:

1. known-good kernel artifact/source;
2. known-good minimal initramfs artifact/source;
3. only the network drivers/userspace required by the actual notebook;
4. stable device identity logic;
5. Remote Core / SSH host-key persistence and multi-key authorization behavior;
6. Control Plane attestation/bootstrap logic;
7. minimal maintenance/recovery functionality;
8. trustworthy Windows-side target identification/provisioning ideas that can be simplified for the two-partition contract.

## Explicitly not imported by default

- `history/` trees;
- temporary diagnostic scripts;
- old physical-layout contracts requiring `ORDAX-HOME` as a partition;
- obsolete rsync-daemon ownership;
- duplicate remote-access owners;
- fail-open SSH helpers;
- backup outputs, generated artifacts or physical evidence as source code;
- stale compatibility bridges;
- complete desktop/application trees before the bootstrap substrate is proven.

## Migration sequence

For each candidate:

```text
inspect legacy implementation
 -> identify real invariant
 -> decide adopt vs reimplement
 -> add prototype test/contract
 -> implement in prototype
 -> verify independently
 -> record result in this ledger
```

## Current ledger

No implementation has been migrated yet.

```text
MIGRATED_COMPONENT_COUNT=0
BULK_LEGACY_IMPORT=NO
LEGACY_REPOSITORY_CHANGED=NO
```
