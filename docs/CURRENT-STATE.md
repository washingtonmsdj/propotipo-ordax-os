# Current State

Status date: 2026-09-15

This is the canonical handoff snapshot for another AI/conversation. Architecture/contracts win if this file ever conflicts with them.

## Repository

```text
REPOSITORY=washingtonmsdj/prototipo-ordax-os
ROLE=CLEAN_ROOM_PROTOTYPE
DEFAULT_BRANCH=main
PROMOTED_TO_OFFICIAL=NO
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_REPOSITORY_IS_REFERENCE_ONLY=YES
```

## Product model

```text
ONE_PRODUCT=YES
ONE_ACCOUNT_MODEL=YES
MODES=WEB,MOBILE,DESKTOP,USB,NATIVE_DISK
MOBILE_PLATFORMS=ANDROID,IOS
ONE_SURFACE_SOURCE=YES
ONE_APP_SOURCE=YES
CAPABILITY_DIFFERENCES_VIA_ADAPTERS=YES
BASIC_CROSS_DEVICE_SYNC_PLAN_GATED=NO
```

Canonical product progression:

```text
OrdaX Web
 -> OrdaX Mobile
 -> OrdaX Desktop
 -> OrdaX USB
 -> OrdaX Native
```

Plans may expand storage/history/backup/collaboration/AI/recovery, but identity and basic cross-device continuity are not separate account silos.

## Build autonomy

```text
CODEX_REQUIRED=NO
CODEX_IS_OPTIONAL_PARTNER=YES
CODEX_IS_BUILD_AUTHORITY=NO
CODEX_IS_RELEASE_AUTHORITY=NO
LOCAL_DEVELOPER_TOOLCHAIN_REQUIRED=NO
MANUAL_KERNEL_BUILD_REQUIRED=NO
CI_BUILD_REQUIRED=YES
ARTIFACT_PROVENANCE_REQUIRED=YES
ARTIFACT_SHA256_REQUIRED=YES
```

GitHub Actions is the current executor. The repository remains source authority.

## Physical architecture

```text
PHYSICAL_PARTITIONS=2
PARTITION_1=ORDAX-ESP
PARTITION_2=ORDAX
SEPARATE_HOME_PARTITION=NO
USB_IS_SOURCE_AUTHORITY=NO
```

Logical main layout:

```text
/ordax/bootstrap
/ordax/releases/<commit>
/ordax/current
/ordax/state
/ordax/home
```

## Minimal USB policy

The first media remains deliberately small.

```text
FULL_SYSTEM_PRESEEDED=NO
SURFACE_PRESEEDED=NO
NORMAL_APPS_PRESEEDED=NO
REMOTE_CORE_PRESEEDED=NO
CONTROL_PLANE_PRESEEDED=NO
SSH_PRESEEDED=NO
SOURCE_CHECKOUT_PRESEEDED=NO
BUILD_TOOLCHAIN_PRESEEDED=NO
FIRST_FULL_RELEASE_ACQUIRED_AFTER_BOOT=YES
KNOWN_GOOD_OFFLINE_BOOT_REQUIRED=YES
PHYSICAL_WRITE_ALLOWED=NO
```

Boot policy now exists in source:

```text
UEFI
 -> kernel/initramfs
 -> mount LABEL=ORDAX
 -> /ordax/bootstrap/entrypoint
 -> if /ordax/current is bootable: boot offline immediately
 -> otherwise: minimal network
 -> signed HTTPS release acquisition
 -> verified /ordax/releases/<commit>
 -> atomic current
 -> boot release
```

## Kernel

```text
KERNEL_VERSION=6.6.52
UPSTREAM_ARCHIVE_SHA256=1591ab348399d4aa53121158525056a69c8cf0fe0e90935b0095e9a58e37b4b8
CANONICAL_BUILD_ENTRYPOINT=bootstrap/kernel/build.py
KERNEL_SOURCE_CONTRACT=bootstrap/kernel/source.json
KERNEL_BUILD_IN_CI=PROVEN
KERNEL_CANDIDATE_BUILD=SUCCESS
PHYSICAL_KERNEL_AUTHORIZED=NO
```

The old repository's known-good kernel is evidence only; it is not copied as source authority.

## Initramfs

```text
INITRAMFS_DECISION=CLEAN_ROOM_REIMPLEMENTED
BUSYBOX_STATIC=YES
MUSL_BUILD=YES
NETWORK_INSIDE_FIXED_INITRAMFS=NO
CANONICAL_HANDOFF=/ordax/bootstrap/entrypoint
INITRAMFS_CANDIDATE_CI=SUCCESS
PHYSICAL_INITRAMFS_AUTHORIZED=NO
```

The fixed initramfs only mounts the ORDAX partition and hands control to the partition bootstrap. It does not contain SSH, Remote Core, Control Plane or the full networking stack.

## Bootstrap orchestrator

Implemented at:

`bootstrap/entrypoint`

Properties:

```text
KNOWN_GOOD_BEFORE_NETWORK=YES
NETWORK_REQUIRED_FOR_NORMAL_KNOWN_GOOD_BOOT=NO
FIRST_RELEASE_REQUIRES_NETWORK=YES
HTTPS_REQUIRED=YES
RECOVERY_ON_ACQUISITION_FAILURE=YES
```

## Release acquisition

Implemented clean-room in Go at:

`bootstrap/release-acquisition/`

```text
FULL_GIT_CLIENT_ON_DEVICE=NO
SOURCE_CHECKOUT_ON_DEVICE=NO
DEVICE_COMPILER_REQUIRED=NO
HTTPS=YES
ED25519_MANIFEST_SIGNATURE=YES
SHA256_ARTIFACT_VERIFICATION=YES
ATOMIC_RELEASE_ACTIVATION=YES
KNOWN_GOOD_PRESERVED_ON_FAILURE=YES
STATIC_LINUX_AGENT_CI=SUCCESS
PHYSICAL_AGENT_AUTHORIZED=NO
```

## Network bootstrap

```text
NETWORK_BOOTSTRAP_IMPLEMENTED=NO
```

This is the main remaining prerequisite for first online acquisition. Prototype-first direction may use Ethernet/USB tether DHCP to keep the seed minimal; consumer promotion still requires a good first-boot Wi-Fi experience.

Legacy networking is evidence only. Do not bulk-copy it.

## Creator / physical installer

Permanent architecture:

```text
OrdaX Desktop UI
 -> same Creator Core
 -> narrow host adapter/helper
 -> verified USB
```

To avoid waiting for the full Desktop UI, a small prototype `ordax-creator.exe` is allowed as an early shell around the exact same Core.

Implemented now:

```text
CREATOR_CORE_IMPLEMENTED=YES
CREATOR_CHECK_IMPLEMENTED=YES
CREATOR_PLAN_IMPLEMENTED=YES_BUT_FAIL_CLOSED_WHILE_MANIFEST_UNAUTHORIZED
CREATOR_WINDOWS_CANDIDATE_BUILD=SUCCESS
CREATOR_LINUX_CANDIDATE_BUILD=SUCCESS
CREATOR_APPLY_IMPLEMENTED=NO
CREATOR_WINDOWS_RAW_DISK_ADAPTER_IMPLEMENTED=NO
PHYSICAL_USB_WRITE=NO
```

Canonical docs/source:

- `docs/CREATOR-INSTALLATION.md`
- `tools/creator/core/`
- `tools/creator/cmd/ordax-creator/`
- `.github/workflows/creator-candidate.yml`

The first Creator CI artifact was built from commit `a831c8f2d7ddebfebcdb3868cf397b52958f7496` and the workflow completed successfully. The candidate intentionally cannot write disks yet.

## Mobile / account sync

```text
MOBILE_FIRST_CLASS=YES
ANDROID=YES
iOS=YES
MOBILE_RAW_DISK_AUTHORITY=NO
SAME_ACCOUNT_ALL_MODES=YES
BASIC_SYNC_AVAILABLE_ALL_ACCOUNTS=YES
DEVICE_PRIVATE_SECRETS_SYNC=NO
PRICING_DEFINED=NO
```

Canonical docs:

- `docs/PRODUCT-MODES.md`
- `docs/ACCOUNT-SYNC-AND-PLANS.md`
- `system/adapters/mobile/`

## Remote access

```text
SSH_REQUIRED=NO
REMOTE_CORE_REQUIRED=NO
CONTROL_PLANE_REQUIRED=NO
```

They may be added later only if a real post-release product need is demonstrated. Do not reintroduce them merely because the legacy repository used them.

## Host independence

```text
WSL_REQUIRED=NO
QEMU_REQUIRED=NO
POWERSHELL_REQUIRED=NO
BASH_REQUIRED=NO
SPECIFIC_DEVELOPER_DESKTOP_OS_REQUIRED=NO
END_USER_KERNEL_TOOLCHAIN_REQUIRED=NO
THIN_HOST_ADAPTERS_ALLOWED=YES
```

Host-specific APIs are allowed only behind narrow adapters where unavoidable, such as Windows raw removable-disk access.

## Physical state

```text
USB_LOCATION=WINDOWS
PHYSICAL_USB_WRITTEN=NO
PHYSICAL_LAYOUT_CHANGED=NO
PHYSICAL_NOTEBOOK_BOOT_PROVEN=NO
LIVE_GIT_UPDATE_PROVEN=NO
```

No destructive USB authorization exists yet.

## Legacy/Codex evidence

Legacy repository SSH reconciliation finished at:

```text
LEGACY_MAIN_AFTER_CODEX=49fe41fa67d9032f2e349e86592304e64d6c2d88
OLD_OPERATOR_KEY_PRESERVED=YES
```

This remains historical evidence only and must not cause SSH/QEMU/F7 architecture to be imported.

## Current main priorities

1. implement the minimal network owner without importing the legacy networking stack;
2. resolve bootloader/ESP artifacts with source/hash/provenance;
3. bind real kernel/initramfs/release-agent/network artifacts into `minimal-bootstrap.json`;
4. build signed release/media manifests;
5. implement Creator target identity and a narrow Windows removable-device adapter;
6. prove layout/write/verification against disposable media representation;
7. only then add Creator APPLY and request explicit physical destructive authorization;
8. build the shared Surface/runtime for Web/Mobile/Desktop/USB/Native in parallel;
9. implement real account sync/conflict handling before product promotion;
10. prove first physical boot and later Git-driven release updates.

## Handoff rule

Any new AI/conversation must read `AGENTS.md`, this file, and the canonical architecture/contracts before changing source. Never assume an unresolved physical artifact is safe to write merely because a CI candidate exists.
