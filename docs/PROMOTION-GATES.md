# Promotion Gates

Status: CANONICAL FOR PROTOTYPE

This repository remains a prototype until every required gate below is closed with reproducible evidence.

## Gate 0 - Repository foundation

Required:

```text
AGENTS_CONTRACT=PASS
ARCHITECTURE_CONTRACT=PASS
PRODUCT_MODES_CONTRACT=PASS
MINIMAL_USB_CONTRACT=PASS
HOST_INDEPENDENCE_CONTRACT=PASS
PHYSICAL_MEDIA_CONTRACT=PASS
DEVELOPMENT_WORKFLOW=PASS
MIGRATION_LEDGER=PASS
```

Remote-control documentation may exist, but remote control is not a promotion prerequisite unless a later ADR makes it a supported product requirement.

## Gate 1 - Reproducible minimal bootstrap source

Required:

- kernel provenance identified;
- initramfs provenance identified;
- minimal userspace source/build reproducible;
- no private secrets in repository;
- exact pre-Git dependency/file manifest explicit before physical write;
- bootstrap build has deterministic/verified artifact hashes where practical;
- no legacy `ORDAX-HOME`/`ORDAX-PLATFORM` physical dependency;
- no mandatory WSL/QEMU/host-shell dependency;
- initial media excludes Surface/apps/high-level services/full source/toolchain/SSH/Remote Core/Control Plane.

```text
BOOTSTRAP_SOURCE=PASS
MINIMAL_BOOTSTRAP_MANIFEST=PASS
KERNEL_PROVENANCE=PASS
INITRAMFS_PROVENANCE=PASS
SECRET_SCAN=PASS
FULL_SYSTEM_PRESEEDED=NO
SURFACE_PRESEEDED=NO
NORMAL_APPS_PRESEEDED=NO
REMOTE_CORE_PRESEEDED=NO
CONTROL_PLANE_PRESEEDED=NO
SSH_PRESEEDED=NO
COMPLETE_SOURCE_PRESEEDED=NO
BUILD_TOOLCHAIN_PRESEEDED=NO
WSL_REQUIRED=NO
QEMU_REQUIRED=NO
```

## Gate 2 - Two-partition provisioning in disposable media

Required:

```text
DISPOSABLE_GPT=PASS
PARTITION_COUNT=2
SEPARATE_HOME_PARTITION=NO
PROVISION_VERIFY=PASS
```

Provisioning must start from a blank/disposable representation, select targets safely and not require a particular emulator.

## Gate 3 - Boot artifact and bootstrap proof

Required:

```text
UEFI_BOOT_CONTRACT=PASS
KERNEL_BOOT=PASS
BOOTSTRAP_ENTRY=PASS
NETWORK_READY=PASS
RELEASE_ACQUISITION_ENTRY=PASS
LEGACY_MEDIA_DEPENDENCY=NO
EMULATOR_SPECIFIC_DEPENDENCY=NO
REMOTE_CONTROL_DEPENDENCY=NO
```

The bootstrap must be able to reach release acquisition without a full system preseed.

## Gate 4 - OrdaX Creator host independence

Required:

```text
CREATOR_SHARED_CORE=PASS
WINDOWS_WITHOUT_WSL=PASS
HOST_POLICY_FORKS=NO
END_USER_KERNEL_TOOLCHAIN_REQUIRED=NO
CREATOR_VERIFY=PASS
CREATOR_MINIMAL_PAYLOAD_ONLY=PASS
```

Host-specific code may only integrate raw-device/elevation APIs; layout, artifact and verification policy remain shared.

## Gate 5 - Physical USB reprovisioning

This gate is destructive and requires explicit authorization at execution time.

Before write:

```text
TARGET_IDENTITY=PASS
SOURCE_LAYOUT_CONTRACT=PASS
MINIMAL_BOOTSTRAP_MANIFEST=PASS
DISPOSABLE_LAYOUT_TEST=PASS
DESTRUCTIVE_OPERATION_EXPLICITLY_AUTHORIZED=YES
```

After write:

```text
PHYSICAL_GPT_VERIFY=PASS
PHYSICAL_FILESYSTEM_VERIFY=PASS
BOOT_ARTIFACT_HASH_VERIFY=PASS
PHYSICAL_PAYLOAD_MATCHES_MANIFEST=PASS
UNAPPROVED_FULL_SYSTEM_PRESEED=NO
```

## Gate 6 - Physical notebook minimal bootstrap

Required:

```text
NOTEBOOK_UEFI_BOOT=PASS
NETWORK_READY=PASS
RELEASE_CHANNEL_REACHABLE=PASS
RECOVERY_PATH=PASS
SSH_REQUIRED=NO
REMOTE_CORE_REQUIRED=NO
CONTROL_PLANE_REQUIRED=NO
```

## Gate 7 - First network release acquisition and activation

Required:

```text
FIRST_RELEASE_ACQUIRED_AFTER_BOOT=PASS
RELEASE_MATERIALIZE=PASS
RELEASE_INTEGRITY=PASS
ATOMIC_ACTIVATION=PASS
KNOWN_GOOD_PERSISTED=PASS
KNOWN_GOOD_OFFLINE_BOOT=PASS
ROLLBACK=PASS
```

A release must be tied to an exact source commit and verified before activation.

## Gate 8 - Single-source Surface across Web and native

Required:

```text
ONE_SURFACE_SOURCE=PASS
UI_FORKS=NO
WEB_MODE=PASS
NATIVE_MODE=PASS
SAME_COMMIT_VISUAL_CHANGE=PASS
CAPABILITY_ADAPTER_BOUNDARY=PASS
```

## Gate 9 - Git-driven live incremental development

With the normal user-facing system running:

```text
EDIT_SOURCE=PASS
AFFECTED_TEST=PASS
WEB_PREVIEW=PASS
GIT_PUSH=PASS
DEVICE_RELEASE_OR_DELTA_UPDATE=PASS
HEALTH_READINESS=PASS
FULL_IMAGE_REBUILD_REQUIRED=NO
USB_REFLASH_REQUIRED=NO
ROUTINE_REBOOT_REQUIRED=NO
SSH_REQUIRED=NO
REMOTE_CONTROL_REQUIRED=NO
```

## Gate 10 - User continuity Web -> USB -> native disk

Required:

```text
ACCOUNT_CONTINUITY=PASS
SYNC_POLICY=PASS
WEB_TO_USB_CONTINUITY=PASS
DEVICE_SECRETS_STAY_LOCAL=PASS
```

`NATIVE_DISK_INSTALL=PASS` is required before native-disk installation is declared production-supported.

## Gate 11 - Recovery after failure

Simulate at least:

- first-release acquisition unavailable;
- bad/unavailable new release;
- network unavailable after a known-good release exists;
- Git/release channel unavailable;
- interrupted release acquisition;
- failed release activation.

Required:

```text
BOOTSTRAP_RECOVERY_WITHOUT_FIRST_RELEASE=PASS
KNOWN_GOOD_PRESERVED=PASS
OFFLINE_BOOT=PASS
INTERRUPTED_UPDATE_SAFE=PASS
RELEASE_INTEGRITY_FAIL_CLOSED=PASS
```

## Optional future remote-management gate

Only if Remote Core or another remote-management feature is later adopted as a supported product capability should it receive its own security, authorization and recovery gates. It is intentionally not part of the bootstrap or daily-development critical path today.

## Promotion decision

Only after the applicable Gates 0-11 pass may the repository be declared a successor candidate.
