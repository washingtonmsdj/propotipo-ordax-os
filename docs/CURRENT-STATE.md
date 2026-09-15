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

## ESP / bootloader

The seed ESP is deliberately bounded to normal boot plus recovery:

```text
EFI/BOOT/BOOTX64.EFI
loader/loader.conf
loader/entries/ordax.conf
loader/entries/ordax-recovery.conf
ordax/vmlinuz
ordax/initrd.gz
```

Bootloader candidate:

```text
BOOTLOADER=systemd-boot
UPSTREAM_VERSION=261.2
UPSTREAM_TAG=v261.2
UPSTREAM_SOURCE_COMMIT=4925d9f07fc697efccd98a93046ff535b8832445
UPSTREAM_TAG_SIGNATURE_VERIFIED=YES
ESP_BOOTLOADER_CANDIDATE_CI=SUCCESS
SYSTEMD_BOOT_X64_SHA256=9ac1ca03fc52ed2d8c40cea76b84192d718909d561a7bc6cf36d84784b71ada5
SYSTEMD_BOOT_X64_SIZE=177152
PHYSICAL_BOOTLOADER_AUTHORIZED=NO
```

The bootloader is built through the canonical upstream Meson/Ninja `systemd-boot` target. No legacy developer/maintenance boot entries are carried into the clean-room ESP.

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

The prototype first-acquisition network owner is implemented clean-room and CI-proven:

```text
NETWORK_BOOTSTRAP_IMPLEMENTED=YES
NETWORK_BOOTSTRAP_CANDIDATE_CI=SUCCESS
PROTOTYPE_SCOPE=ETHERNET_USB_TETHER_DHCP
BUSYBOX_VERSION=1.38.0
STATIC_MUSL=YES
NETBOX_APPLETS=ifconfig,route,udhcpc
NETBOX_SHELL_APPLET=NO
NETBOX_SHA256=0b8eb465f533d13ebcbc4275c5d4beafddb75f04c9a86930db3bc66d6ce243ba
NETBOX_SIZE=128536
NETWORK_CANDIDATE_SOURCE_COMMIT=7e44986aa1d09bd205939d7ae613c328ea81b16c
WIFI_IN_PROTOTYPE_SEED=NO
CONSUMER_WIFI_REQUIRED_BEFORE_PROMOTION=YES
PHYSICAL_NETWORK_ARTIFACT_AUTHORIZED=NO
```

The build uses Linux UAPI headers only as compile-time inputs for BusyBox DHCP. The resulting netbox is static and has no runtime host dependency. Legacy networking is evidence only and is not bulk-copied.

## Recovery

```text
RECOVERY_ENTRY=YES
RECOVERY_ORDAX_MOUNT=READ_ONLY
RECOVERY_AUTOMATIC_NETWORK=NO
RECOVERY_SSH=NO
RECOVERY_AUTOMATIC_MUTATION=NO
```

Recovery uses the same kernel/initramfs seed and a local read-only recovery path.

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
CREATOR_VERIFY_PAYLOAD_IMPLEMENTED=YES
CREATOR_PLAN_IMPLEMENTED=YES_BUT_FAIL_CLOSED_WHILE_MANIFEST_UNAUTHORIZED
CREATOR_WINDOWS_CANDIDATE_BUILD=SUCCESS
CREATOR_LINUX_CANDIDATE_BUILD=SUCCESS
CREATOR_APPLY_IMPLEMENTED=NO
CREATOR_WINDOWS_RAW_DISK_ADAPTER_IMPLEMENTED=NO
PHYSICAL_USB_WRITE=NO
```

Creator payload contract:

```text
SOURCE_PATH_MEANS=BUNDLE_RELATIVE_PATH
ABSOLUTE_SOURCE_PATH_ALLOWED=NO
PATH_TRAVERSAL_ALLOWED=NO
SYMLINK_TRAVERSAL_ALLOWED=NO
NON_REGULAR_SOURCE_ALLOWED=NO
DUPLICATE_PARTITION_TARGET_ALLOWED=NO
LOCAL_SHA256_RECHECK_BEFORE_APPLY=YES
PAYLOAD_CAN_BE_VERIFIED_BEFORE_DESTRUCTIVE_AUTHORIZATION=YES
```

Canonical docs/source:

- `docs/CREATOR-INSTALLATION.md`
- `tools/creator/core/`
- `tools/creator/cmd/ordax-creator/`
- `.github/workflows/creator-candidate.yml`

Creator Candidate passed again after adding the `verify-payload` integrity gate. The candidate intentionally cannot write disks yet.

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

1. retrieve and pin the actual CI hashes/provenance for kernel, initramfs and release-agent candidates;
2. bind bootloader, kernel, initramfs, network and release-agent artifacts into one deterministic Creator payload contract;
3. implement the CI payload assembler and verify the assembled bytes again through Creator Core;
4. resolve `minimal-bootstrap.json` without enabling physical write;
5. build the disposable two-partition media representation and prove GPT/filesystems/file hashes/recovery;
6. implement Creator target identity and the narrow Windows removable-device adapter;
7. only after disposable proof, add Creator APPLY and request explicit physical destructive authorization;
8. build the shared Surface/runtime for Web/Mobile/Desktop/USB/Native in parallel;
9. implement real account sync/conflict handling before product promotion;
10. prove first physical boot and later Git-driven release updates.

## Handoff rule

Any new AI/conversation must read `AGENTS.md`, this file, and the canonical architecture/contracts before changing source. Never assume an unresolved physical artifact is safe to write merely because a CI candidate exists.
