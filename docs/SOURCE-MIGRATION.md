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
IMPLEMENTATION=COMPLETE|PENDING
NOTES=
```

## Initial migration candidates

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

```text
inspect legacy implementation
 -> identify real invariant
 -> decide adopt vs reimplement
 -> add prototype test/contract
 -> implement in prototype
 -> verify independently
 -> record result in this ledger
```

## Ledger 001 - Kernel baseline

```text
COMPONENT=kernel
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_COMMIT=f8ea8424f8cf52b516800f16f2331090ccb56748
LEGACY_PATH=out/forge/gate-inputs/vmlinuz-f3h + F3H build recipe
RESPONSIBILITY=boot kernel and hardware/module substrate
WHY_NEEDED=known-good notebook/maintenance baseline
DEPENDENCIES=official Linux 6.6.52 source; GCC 13; reviewed kernel config
SECURITY_REVIEW=no legacy build cache or pre-extracted source accepted as authority
TESTS=legacy F3H isolated build/proof inspected; prototype tests pending
ARTIFACT_SHA256=351941db619b7e93a4dc87010dbf39d3b8bf07262c73342381021385398a277d
DECISION=REIMPLEMENTED
TARGET_PATH=bootstrap/kernel
IMPLEMENTATION=PENDING
NOTES=Keep version/source identity and known-good output digest as baseline; do not import Forge subsystem.
```

Official Linux archive identity selected from the legacy source contract:

```text
KERNEL_VERSION=6.6.52
KERNEL_SOURCE_SHA256=1591ab348399d4aa53121158525056a69c8cf0fe0e90935b0095e9a58e37b4b8
```

See `bootstrap/kernel/PROVENANCE.md`.

## Ledger 002 - Initramfs/bootstrap capsule

```text
COMPONENT=initramfs
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_COMMIT=f8ea8424f8cf52b516800f16f2331090ccb56748
LEGACY_PATH=ordax-bootstrap/scripts/build-initramfs.sh + docs/contracts/boot-capsule-minimal.manifest.json
RESPONSIBILITY=pre-release boot/bootstrap/recovery substrate
WHY_NEEDED=machine must boot, recover and reach a verified release before full OS exists
DEPENDENCIES=kernel modules/firmware; minimal userspace; reviewed network/identity/remote/release bootstrap
SECURITY_REVIEW=legacy manifest contains old storage/layout responsibilities and cannot be copied intact
TESTS=legacy deterministic builder/proof inspected; clean-room manifest/tests pending
ARTIFACT_SHA256=428c9cd1c54e35534b358fbf8a6384b28b72c005f26a7c568217895fc6733ee3
DECISION=REIMPLEMENTED
TARGET_PATH=bootstrap/initramfs
IMPLEMENTATION=PENDING
NOTES=Legacy archive is evidence only. New initramfs must understand ORDAX-ESP + ORDAX and must not require physical ORDAX-HOME.
```

An older evidence record referenced SHA256 `038769af1a65954cf511c6b1a4f1b1b4f9845f289e934156fb6715de1d5f42ee`; it is historical and not the selected current legacy baseline.

See `bootstrap/initramfs/PROVENANCE.md`.

## Current ledger state

```text
REVIEWED_COMPONENT_COUNT=2
IMPLEMENTED_MIGRATION_COUNT=0
BULK_LEGACY_IMPORT=NO
LEGACY_REPOSITORY_CHANGED_BY_MIGRATION=NO
```
