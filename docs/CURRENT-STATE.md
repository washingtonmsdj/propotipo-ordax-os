# Current State

Status date: 2026-09-15

This file is the handoff snapshot for another AI/conversation. Update it when the phase changes materially.

## Repository

```text
REPOSITORY=washingtonmsdj/propotipo-ordax-os
ROLE=CLEAN_ROOM_PROTOTYPE
DEFAULT_BRANCH=main
PROMOTED_TO_OFFICIAL=NO
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_REPOSITORY_IS_REFERENCE=YES
```

## Physical architecture target

```text
PHYSICAL_PARTITIONS=2
PARTITION_1=ORDAX-ESP
PARTITION_2=ORDAX
SEPARATE_HOME_PARTITION=NO
GIT_IS_SOURCE_AUTHORITY=YES
USB_IS_SOURCE_AUTHORITY=NO
```

## Physical environment at prototype creation

The OrdaX USB media is connected to the Windows development machine, not currently booting the notebook.

A separate Codex mission was already running against the previous project context to inventory SSH/operator-key state and inspect the existing USB safely. Do not assume that mission has completed. Retrieve its final evidence before making decisions that depend on its results.

The existence of this prototype does not authorize formatting or writing the USB yet.

## Completed here

- repository initialized from empty state;
- mandatory agent contract created;
- clean-room architecture documented;
- two-partition physical-media contract documented;
- Git-first development workflow documented;
- selective migration ledger created;
- promotion gates defined;
- initial architectural decisions recorded.

## Not yet implemented

```text
KERNEL_MIGRATED=NO
INITRAMFS_MIGRATED=NO
BOOTLOADER_IMPLEMENTED=NO
NETWORK_BOOTSTRAP_IMPLEMENTED=NO
IDENTITY_IMPLEMENTED=NO
REMOTE_CORE_IMPLEMENTED=NO
CONTROL_PLANE_IMPLEMENTED=NO
GIT_RELEASE_ACQUISITION_IMPLEMENTED=NO
TWO_PARTITION_PROVISIONER_IMPLEMENTED=NO
DISPOSABLE_BOOT_PROVEN=NO
PHYSICAL_USB_WRITTEN=NO
PHYSICAL_NOTEBOOK_BOOT_PROVEN=NO
LIVE_DELTA_DEVELOPMENT_PROVEN=NO
```

## Next safe source milestone

Do not begin by copying the whole old repository.

Next sequence:

1. inspect the known-good kernel and initramfs provenance in `novo-ordax-os`;
2. record both in `docs/SOURCE-MIGRATION.md`;
3. decide whether to adopt exact artifacts temporarily or rebuild them in this repository;
4. define the minimal boot artifact manifest;
5. implement a disposable two-partition image/provisioning test;
6. prove boot in disposable/QEMU-style environment before authorizing physical USB wipe.

## Handoff rule

Any new AI/conversation should read `AGENTS.md` and the documents linked from `README.md` before making changes. If this file conflicts with a canonical architecture document, the architecture document wins and this snapshot must be updated.
