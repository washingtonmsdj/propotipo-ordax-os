# Current State

Status date: 2026-09-15

This file is the handoff snapshot for another AI/conversation. Update it when the phase changes materially.

## Repository

```text
REPOSITORY=washingtonmsdj/prototipo-ordax-os
ROLE=CLEAN_ROOM_PROTOTYPE
DEFAULT_BRANCH=main
PROMOTED_TO_OFFICIAL=NO
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_REPOSITORY_IS_REFERENCE=YES
```

The repository was renamed from the earlier misspelled `propotipo-ordax-os` to `prototipo-ordax-os`. Use only the current repository name in new documentation/tooling.

## Product direction

```text
ONE_PRODUCT=YES
MODES=WEB,USB,NATIVE_DISK
ONE_SURFACE_SOURCE=YES
ONE_APP_SOURCE=YES
WEB_IS_FIRST_CLASS_MODE=YES
CAPABILITY_DIFFERENCES_VIA_ADAPTERS=YES
```

Target user progression:

```text
OrdaX Web
 -> OrdaX Creator
 -> OrdaX USB
 -> optional OrdaX Native on SSD/HD
```

Safe user/account state should be able to follow the user across modes. Device-private keys, machine identity secrets, drivers, caches and hardware-bound state remain local.

## Initial USB policy

```text
INITIAL_USB_POLICY=MINIMUM_NETWORK_FIRST
FULL_SYSTEM_PRESEEDED=NO
SURFACE_PRESEEDED=NO
NORMAL_APPS_PRESEEDED=NO
COMPLETE_SOURCE_CHECKOUT_PRESEEDED=NO
BUILD_TOOLCHAIN_PRESEEDED=NO
FIRST_FULL_RELEASE_ACQUIRED_AFTER_BOOT=YES
KNOWN_GOOD_RELEASE_PERSISTED_AFTER_FIRST_ACTIVATION=YES
NORMAL_SYSTEM_CHANGE_REQUIRES_REFLASH=NO
```

The physical media is only the stable launch/recovery substrate. Most future system work arrives through Git/releases after network/control is available.

See `docs/MINIMAL-USB-BOOTSTRAP.md`.

## Minimal bootstrap manifest state

The machine-readable bounded manifest now exists at `docs/contracts/minimal-bootstrap.json`.

Current gate:

```text
MINIMAL_BOOTSTRAP_MANIFEST_SKELETON=YES
ALL_BOOTSTRAP_ARTIFACTS_RESOLVED=NO
PHYSICAL_WRITE_ALLOWED=NO
```

This is intentional. Physical write remains fail-closed until every approved artifact has source path, target path, SHA-256, mode, owner and reason, and all pre-write gates pass.

## Physical architecture target

```text
PHYSICAL_PARTITIONS=2
PARTITION_1=ORDAX-ESP
PARTITION_2=ORDAX
SEPARATE_HOME_PARTITION=NO
GIT_IS_SOURCE_AUTHORITY=YES
USB_IS_SOURCE_AUTHORITY=NO
```

## Host/tool independence target

```text
WSL_REQUIRED=NO
QEMU_REQUIRED=NO
POWERSHELL_REQUIRED=NO
BASH_REQUIRED=NO
SPECIFIC_DESKTOP_OS_REQUIRED=NO
END_USER_KERNEL_TOOLCHAIN_REQUIRED=NO
CREATOR_SHARED_CORE=YES
THIN_HOST_ADAPTERS=YES
```

QEMU is optional test infrastructure only. Host-specific raw-disk/elevation APIs are isolated behind Creator adapters and cannot own OrdaX policy.

## Remote/control target

```text
ORDAX_REMOTE_CORE_REQUIRED=YES
EXTERNAL_SSH_EXECUTABLE_REQUIRED=NO
SSH_REQUIRED_FOR_PRODUCT=NO
SSH_REQUIRED_FOR_DAILY_DEVELOPMENT=NO
STRUCTURED_CAPABILITY_RPC=YES
CUSTOM_CRYPTO_ALLOWED=NO
MATURE_SECURE_TRANSPORT_REQUIRED=YES
```

During migration, SSH may temporarily remain as break-glass compatibility only until OrdaX Remote Core proves equivalent physical recovery. It must not become the new architecture.

## Legacy/Codex evidence received 2026-09-15

Codex completed the SSH/operator-key reconciliation in `washingtonmsdj/novo-ordax-os`.

Verified repository continuity:

```text
LEGACY_MAIN_BEFORE_PROTOTYPE_SSH_RECONCILE=f8ea8424f8cf52b516800f16f2331090ccb56748
LEGACY_MAIN_AFTER_CODEX=49fe41fa67d9032f2e349e86592304e64d6c2d88
LEGACY_CODEX_COMMIT_PARENT=f8ea8424f8cf52b516800f16f2331090ccb56748
LEGACY_MAIN_DIVERGENCE=NO
```

Although the Codex report printed an older `MAIN_SHA_BEFORE`, GitHub confirms commit `49fe41fa...` is directly based on `f8ea8424...`; the clean source hardening was not lost.

Operator public-key fingerprints reported by Codex:

```text
OLD_OPERATOR_KEY=SHA256:Q2ClLoKlAz4WTsFoc8+b3pBnjim8mayhhzafM9eJ8f0
NEW_OPERATOR_KEY=SHA256:wKKyxsf8vQ3uKYczpqKnv/P2LTbHILs8oYnrqNRGvuM
OLD_KEY_PRESERVED=YES
NEW_KEY_ADDED=NO_PHYSICAL_TARGET_PENDING
```

Physical proof remains pending:

```text
USB_LOCATION=WINDOWS
USB_CONNECTED_TO_NOTEBOOK=NO
PHYSICAL_USB_WRITTEN=NO
PHYSICAL_LAYOUT_CHANGED=NO
ROOT_SSH_OLD_KEY=PENDING
ROOT_SSH_NEW_KEY=PENDING
CONTROL_PLANE_ATTESTATION=PENDING_PHYSICAL_TARGET
LIVE_DEV_GIT_TO_NOTEBOOK=PENDING_PHYSICAL_TARGET
```

This evidence is reference material only. Do not copy the legacy SSH/QEMU/F7 subsystem into this prototype. Preserve useful invariants such as additive operator authorization and fail-closed trust while implementing the new OrdaX Remote Core architecture.

## Physical environment

The existing OrdaX USB media is connected to the Windows development machine, not booting the notebook.

The existence of this prototype does not authorize formatting or writing the USB yet.

## Completed here

- repository initialized from empty state and renamed to `prototipo-ordax-os`;
- mandatory agent contract created;
- clean-room architecture documented;
- two-partition physical-media contract documented;
- minimal network-first initial USB contract documented and regression-protected;
- fail-closed machine-readable minimal bootstrap manifest skeleton created;
- Git-first development workflow documented;
- selective migration ledger created;
- promotion gates defined and expanded for Web/Creator/Remote Core;
- architectural decisions recorded;
- source directory skeleton materialized in Git;
- secret/build-output hygiene added through `.gitignore`;
- machine-readable foundation contract added;
- foundation and minimal-bootstrap regression tests added;
- CI validates both JSON contracts and all regressions;
- legacy kernel provenance reviewed and selected for clean rebuild;
- legacy initramfs provenance reviewed and rejected for direct copy because it carries old layout responsibilities;
- one-product Web/USB/native-disk contract created;
- single-source Surface/app rule made canonical;
- host-independence contract created;
- OrdaX Remote/Control Core direction created;
- external SSH executable removed as a required product/development dependency;
- WSL/QEMU removed as required architectural dependencies;
- `system/` source root created with Surface/apps/services and Web/native adapter boundaries;
- `tools/creator/` created with host-neutral core and thin Windows/Linux/macOS adapter boundaries;
- latest legacy Codex SSH/key evidence reviewed without importing its subsystem.

## Reviewed legacy baselines

```text
LEGACY_BASE_COMMIT=f8ea8424f8cf52b516800f16f2331090ccb56748
LEGACY_LATEST_REFERENCE_COMMIT=49fe41fa67d9032f2e349e86592304e64d6c2d88
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
MINIMAL_BOOTSTRAP_MANIFEST_RESOLVED=NO
KERNEL_BUILD_IMPLEMENTED=NO
INITRAMFS_BUILD_IMPLEMENTED=NO
BOOTLOADER_IMPLEMENTED=NO
NETWORK_BOOTSTRAP_IMPLEMENTED=NO
IDENTITY_IMPLEMENTED=NO
REMOTE_CORE_IMPLEMENTED=NO
CONTROL_PLANE_IMPLEMENTED=NO
GIT_RELEASE_ACQUISITION_IMPLEMENTED=NO
CREATOR_CORE_IMPLEMENTED=NO
CREATOR_WINDOWS_ADAPTER_IMPLEMENTED=NO
TWO_PARTITION_PROVISIONER_IMPLEMENTED=NO
SURFACE_RUNTIME_IMPLEMENTED=NO
WEB_RUNTIME_IMPLEMENTED=NO
SYNC_MODEL_IMPLEMENTED=NO
PHYSICAL_USB_WRITTEN=NO
PHYSICAL_NOTEBOOK_BOOT_PROVEN=NO
LIVE_DELTA_DEVELOPMENT_PROVEN=NO
WEB_TO_USB_CONTINUITY_PROVEN=NO
```

## Next safe source milestones

Do not copy the whole old repository.

Recommended implementation order:

1. resolve the minimal bootstrap manifest component-by-component with real source paths and hashes;
2. define capability interfaces shared by `system/adapters/web` and `system/adapters/native`;
3. define the first minimal shared Surface shell so Web can become the fastest visual development target;
4. define OrdaX Remote Core protocol/capability contract without custom cryptography;
5. implement OrdaX Creator plan/verification core independent of host raw-disk APIs;
6. implement the clean kernel build recipe from official Linux 6.6.52 source identity;
7. implement the new deterministic initramfs without old `ORDAX-HOME`/`ORDAX-PLATFORM` dependencies;
8. implement the Windows Creator raw-disk adapter without WSL;
9. verify a disposable two-partition representation without requiring a specific emulator;
10. only then request authorization to wipe/reprovision the physical USB with the bounded minimal payload.

## Handoff rule

Any new AI/conversation must read `AGENTS.md` and the documents linked from `README.md` before making changes. If this file conflicts with a canonical architecture document, the architecture document wins and this snapshot must be updated.
