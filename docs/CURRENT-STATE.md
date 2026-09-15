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
- initial architectural decisions recorded;
- source directory skeleton materialized in Git;
- secret/build-output hygiene added through `.gitignore`;
- machine-readable foundation contract added;
- foundation regression tests added;
- CI workflow added for the foundation contract;
- legacy kernel provenance reviewed and selected for clean rebuild;
- legacy initramfs provenance reviewed and rejected for direct copy because it carries old layout responsibilities.

## Reviewed legacy baselines

```text
LEGACY_BASE_COMMIT=f8ea8424f8cf52b516800f16f2331090ccb56748
KERNEL_VERSION=6.6.52
KERNEL_KNOWN_GOOD_SHA256=351941db619b7e93a4dc87010dbf39d3b8bf07262c73342381021385398a277d
KERNEL_SOURCE_ARCHIVE_SHA256=1591ab348399d4aa53121158525056a69c8cf0fe0e90935b0095e9a58e37b4b8
LEGACY_APPROVED_INITRAMFS_SHA256=428c9cd1c54e35534b358fbf8a6384b28b72c005f26a7c568217895fc6733ee3
KERNEL_DECISION=REIMPLEMENTED
INITRAMFS_DECISION=REIMPLEMENTED
```

See `bootstrap/kernel/PROVENANCE.md`, `bootstrap/initramfs/PROVENANCE.md` and `docs/SOURCE-MIGRATION.md`.

## Not yet implemented

```text
KERNEL_BUILD_IMPLEMENTED=NO
INITRAMFS_BUILD_IMPLEMENTED=NO
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

Do not copy the whole old repository.

Next sequence:

1. create the minimal boot artifact manifest for this prototype;
2. implement the clean kernel build recipe from official Linux 6.6.52 source identity;
3. define and implement the new deterministic initramfs manifest without physical `ORDAX-HOME`/`ORDAX-PLATFORM` dependencies;
4. implement a disposable two-partition image/provisioning test;
5. prove boot in a disposable/QEMU-style environment;
6. only then request authorization to wipe/reprovision the physical USB.

## Handoff rule

Any new AI/conversation should read `AGENTS.md` and the documents linked from `README.md` before making changes. If this file conflicts with a canonical architecture document, the architecture document wins and this snapshot must be updated.
