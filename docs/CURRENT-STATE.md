# Current State

Status date: 2026-09-15

This file is the handoff snapshot for another AI/conversation.

## Repository

```text
REPOSITORY=washingtonmsdj/prototipo-ordax-os
ROLE=CLEAN_ROOM_PROTOTYPE
DEFAULT_BRANCH=main
PROMOTED_TO_OFFICIAL=NO
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_REPOSITORY_IS_REFERENCE=YES
```

The repository was renamed from the earlier misspelled `propotipo-ordax-os` to `prototipo-ordax-os`.

## Product direction

```text
ONE_PRODUCT=YES
MODES=WEB,USB,NATIVE_DISK
ONE_SURFACE_SOURCE=YES
ONE_APP_SOURCE=YES
WEB_IS_FIRST_CLASS_MODE=YES
CAPABILITY_DIFFERENCES_VIA_ADAPTERS=YES
```

Target progression:

```text
OrdaX Web
 -> OrdaX Creator
 -> OrdaX USB
 -> optional OrdaX Native on SSD/HD
```

## Build autonomy

Canonical contract:

`docs/BUILD-AUTONOMY.md`
`docs/contracts/build-autonomy.json`

```text
CODEX_REQUIRED=NO
CODEX_IS_OPTIONAL_PARTNER=YES
CODEX_IS_BUILD_AUTHORITY=NO
CODEX_IS_RELEASE_AUTHORITY=NO
LOCAL_DEVELOPER_TOOLCHAIN_REQUIRED=NO
MANUAL_KERNEL_BUILD_REQUIRED=NO
REPOSITORY_BUILD_RECIPE_REQUIRED=YES
PINNED_BUILD_ENVIRONMENT_REQUIRED=YES
CI_BUILD_REQUIRED=YES
ARTIFACT_PROVENANCE_REQUIRED=YES
ARTIFACT_SHA256_REQUIRED=YES
```

The intended operating model is that ChatGPT, another AI, or a developer can change repository source, push `main`, inspect/fix CI and obtain canonical artifacts without Codex-specific execution.

GitHub Actions is the current CI executor, not source authority. Build entrypoints must remain portable to another compatible container/CI executor.

The first heavy artifact to implement under this model is the Linux 6.6.52 kernel recipe. End users must never need to compile that kernel to install OrdaX; OrdaX Creator consumes prebuilt verified artifacts.

## Initial USB policy

The initial physical media is intentionally minimal.

```text
INITIAL_USB_POLICY=MINIMUM_GIT_ACQUISITION_FIRST
FULL_SYSTEM_PRESEEDED=NO
SURFACE_PRESEEDED=NO
NORMAL_APPS_PRESEEDED=NO
REMOTE_CORE_PRESEEDED=NO
CONTROL_PLANE_PRESEEDED=NO
STABLE_DEVICE_IDENTITY_SERVICE_PRESEEDED=NO
SSH_PRESEEDED=NO
COMPLETE_SOURCE_CHECKOUT_PRESEEDED=NO
BUILD_TOOLCHAIN_PRESEEDED=NO
FIRST_FULL_RELEASE_ACQUIRED_AFTER_BOOT=YES
KNOWN_GOOD_RELEASE_PERSISTED_AFTER_FIRST_ACTIVATION=YES
NORMAL_SYSTEM_CHANGE_REQUIRES_REFLASH=NO
```

Mandatory pre-release path:

```text
UEFI
 -> bootloader
 -> kernel/initramfs
 -> minimal userspace
 -> minimal network
 -> Git/GitHub release acquisition
 -> integrity verification
 -> recovery
```

Remote Core, Control Plane and persistent device identity are optional post-release capabilities and must not be added to the initial USB unless a later ADR demonstrates a real need.

## Minimal bootstrap manifest

Machine-readable contract:

`docs/contracts/minimal-bootstrap.json`

Current gate:

```text
MINIMAL_BOOTSTRAP_MANIFEST_SKELETON=YES
ALL_BOOTSTRAP_ARTIFACTS_RESOLVED=NO
PHYSICAL_WRITE_ALLOWED=NO
```

Physical write remains fail-closed until every required artifact has source path, target path, SHA-256, mode, owner and reason and all pre-write gates pass.

## Physical architecture

```text
PHYSICAL_PARTITIONS=2
PARTITION_1=ORDAX-ESP
PARTITION_2=ORDAX
SEPARATE_HOME_PARTITION=NO
GIT_IS_SOURCE_AUTHORITY=YES
USB_IS_SOURCE_AUTHORITY=NO
```

## Host/tool independence

```text
WSL_REQUIRED=NO
QEMU_REQUIRED=NO
POWERSHELL_REQUIRED=NO
BASH_REQUIRED=NO
SPECIFIC_DEVELOPER_DESKTOP_OS_REQUIRED=NO
END_USER_KERNEL_TOOLCHAIN_REQUIRED=NO
CREATOR_SHARED_CORE=YES
THIN_HOST_ADAPTERS=YES
```

A Linux/container CI environment may compile the Linux kernel. That is an implementation environment, not a requirement that the developer install Linux or WSL.

## Development path

Normal development is Git-driven and requires no remote shell/control service or Codex:

```text
edit source
 -> Web/HMR preview when applicable
 -> tests
 -> commit/push main
 -> CI builds/verifies affected artifacts
 -> Web receives same commit
 -> OrdaX updater acquires release/delta
 -> verify
 -> activate
```

```text
SSH_REQUIRED_FOR_DAILY_DEVELOPMENT=NO
REMOTE_CORE_REQUIRED_FOR_DAILY_DEVELOPMENT=NO
CONTROL_PLANE_REQUIRED_FOR_DAILY_DEVELOPMENT=NO
CODEX_REQUIRED_FOR_DAILY_DEVELOPMENT=NO
```

## Legacy/Codex evidence

Codex completed SSH/operator-key reconciliation only in `washingtonmsdj/novo-ordax-os`.

```text
LEGACY_MAIN_BEFORE=f8ea8424f8cf52b516800f16f2331090ccb56748
LEGACY_MAIN_AFTER_CODEX=49fe41fa67d9032f2e349e86592304e64d6c2d88
LEGACY_CODEX_COMMIT_PARENT=f8ea8424f8cf52b516800f16f2331090ccb56748
OLD_KEY_PRESERVED=YES
PHYSICAL_USB_WRITTEN=NO
PHYSICAL_LAYOUT_CHANGED=NO
```

This evidence does not justify importing the legacy SSH/QEMU/F7 subsystem. Codex remains optional evidence/review assistance only.

## Reviewed legacy boot baselines

```text
KERNEL_VERSION=6.6.52
KERNEL_KNOWN_GOOD_SHA256=351941db619b7e93a4dc87010dbf39d3b8bf07262c73342381021385398a277d
KERNEL_SOURCE_ARCHIVE_SHA256=1591ab348399d4aa53121158525056a69c8cf0fe0e90935b0095e9a58e37b4b8
LEGACY_APPROVED_INITRAMFS_SHA256=428c9cd1c54e35534b358fbf8a6384b28b72c005f26a7c568217895fc6733ee3
KERNEL_DECISION=REIMPLEMENTED
INITRAMFS_DECISION=REIMPLEMENTED
```

## Not yet implemented

```text
PINNED_KERNEL_BUILD_ENVIRONMENT_RESOLVED=NO
PORTABLE_KERNEL_BUILD_ENTRYPOINT_IMPLEMENTED=NO
KERNEL_CI_ARTIFACT_IMPLEMENTED=NO
MINIMAL_BOOTSTRAP_MANIFEST_RESOLVED=NO
KERNEL_BUILD_IMPLEMENTED=NO
INITRAMFS_BUILD_IMPLEMENTED=NO
BOOTLOADER_IMPLEMENTED=NO
NETWORK_BOOTSTRAP_IMPLEMENTED=NO
GIT_RELEASE_ACQUISITION_IMPLEMENTED=NO
CREATOR_CORE_IMPLEMENTED=NO
CREATOR_WINDOWS_ADAPTER_IMPLEMENTED=NO
TWO_PARTITION_PROVISIONER_IMPLEMENTED=NO
SURFACE_RUNTIME_IMPLEMENTED=NO
WEB_RUNTIME_IMPLEMENTED=NO
SYNC_MODEL_IMPLEMENTED=NO
PHYSICAL_USB_WRITTEN=NO
PHYSICAL_NOTEBOOK_BOOT_PROVEN=NO
LIVE_GIT_UPDATE_PROVEN=NO
WEB_TO_USB_CONTINUITY_PROVEN=NO
```

## Next safe source milestones

1. define and pin the kernel CI build environment/toolchain;
2. implement a portable repository kernel build entrypoint for Linux 6.6.52 with upstream SHA verification;
3. publish kernel artifact + machine-readable provenance + SHA-256 from CI;
4. resolve the reduced minimal-bootstrap manifest with real artifacts/hashes;
5. implement deterministic minimal initramfs with network + release acquisition only;
6. implement release integrity/activation/rollback contract;
7. implement Creator core and Windows adapter without WSL;
8. verify two-partition disposable representation;
9. build the first shared Web/native Surface in parallel;
10. only then request authorization to reprovision the physical USB.

Do not add Codex, SSH, Remote Core or Control Plane as required dependencies because the legacy system used them.

## Handoff rule

Any new AI/conversation must read `AGENTS.md` and the canonical docs before making changes. Architecture/build contracts win over this snapshot if they conflict.
