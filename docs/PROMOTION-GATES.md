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
REMOTE_CONTROL_CONTRACT=PASS
PHYSICAL_MEDIA_CONTRACT=PASS
DEVELOPMENT_WORKFLOW=PASS
MIGRATION_LEDGER=PASS
```

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
- initial physical media excludes normal Surface/apps/high-level services/full source/toolchain.

```text
BOOTSTRAP_SOURCE=PASS
MINIMAL_BOOTSTRAP_MANIFEST=PASS
KERNEL_PROVENANCE=PASS
INITRAMFS_PROVENANCE=PASS
SECRET_SCAN=PASS
FULL_SYSTEM_PRESEEDED=NO
SURFACE_PRESEEDED=NO
NORMAL_APPS_PRESEEDED=NO
COMPLETE_SOURCE_PRESEEDED=NO
BUILD_TOOLCHAIN_PRESEEDED=NO
WSL_REQUIRED=NO
QEMU_REQUIRED=NO
```

## Gate 2 - Two-partition provisioning in disposable media

Required:

- GPT with exactly `ORDAX-ESP` and `ORDAX`;
- expected filesystem types;
- no separate HOME partition;
- provisioning can start from blank/disposable target representation;
- rerun behavior is defined;
- target-selection logic cannot silently choose an unrelated disk;
- validation must not require QEMU specifically.

```text
DISPOSABLE_GPT=PASS
PARTITION_COUNT=2
SEPARATE_HOME_PARTITION=NO
PROVISION_VERIFY=PASS
```

## Gate 3 - Boot artifact and bootstrap proof

Required:

- UEFI boot contract is verified;
- kernel artifact is verified and boots in at least one trustworthy execution environment before physical promotion;
- initramfs/bootstrap enters expected state;
- recovery/maintenance entry exists or equivalent safe path is proven;
- no dependence on legacy USB contents;
- bootstrap can reach the release-acquisition state without a full system preseed.

An emulator may be used, but no specific emulator is required. Real-hardware proof remains mandatory later.

```text
UEFI_BOOT_CONTRACT=PASS
KERNEL_BOOT=PASS
BOOTSTRAP_ENTRY=PASS
RELEASE_ACQUISITION_ENTRY=PASS
LEGACY_MEDIA_DEPENDENCY=NO
EMULATOR_SPECIFIC_DEPENDENCY=NO
```

## Gate 4 - OrdaX Creator host independence

Required:

- one shared Creator core owns layout/artifact/security policy;
- host-specific code is thin and limited to raw-device/elevation integration;
- Windows path works without WSL;
- user does not need a kernel toolchain;
- Creator verifies artifacts before write and bytes/layout after write;
- Creator writes only the bounded minimal payload defined by the bootstrap manifest for the default prototype flow;
- platform adapters pass common conformance tests.

```text
CREATOR_SHARED_CORE=PASS
WINDOWS_WITHOUT_WSL=PASS
HOST_POLICY_FORKS=NO
END_USER_KERNEL_TOOLCHAIN_REQUIRED=NO
CREATOR_VERIFY=PASS
CREATOR_MINIMAL_PAYLOAD_ONLY=PASS
```

Linux/macOS adapters may remain pending for initial prototype promotion if explicitly scoped, but their architecture must already follow the same shared-core contract.

## Gate 5 - Physical USB reprovisioning

This gate is destructive and requires explicit authorization at execution time.

Required before write:

```text
TARGET_IDENTITY=PASS
SOURCE_LAYOUT_CONTRACT=PASS
MINIMAL_BOOTSTRAP_MANIFEST=PASS
DISPOSABLE_LAYOUT_TEST=PASS
DESTRUCTIVE_OPERATION_EXPLICITLY_AUTHORIZED=YES
```

Required after write:

```text
PHYSICAL_GPT_VERIFY=PASS
PHYSICAL_FILESYSTEM_VERIFY=PASS
BOOT_ARTIFACT_HASH_VERIFY=PASS
PHYSICAL_PAYLOAD_MATCHES_MANIFEST=PASS
UNAPPROVED_FULL_SYSTEM_PRESEED=NO
```

## Gate 6 - Physical notebook bootstrap and OrdaX Remote Core

Required:

```text
NOTEBOOK_UEFI_BOOT=PASS
NETWORK_READY=PASS
DEVICE_IDENTITY=PASS
REMOTE_CORE_READY=PASS
REMOTE_CORE_AUTHORIZATION=PASS
REMOTE_CORE_FAIL_CLOSED=PASS
REMOTE_CORE_FILE_DELTA=PASS
REMOTE_CORE_LOG_STREAM=PASS
CONTROL_PLANE_BOOTSTRAP=PASS
SSH_REQUIRED_FOR_NORMAL_OPERATION=NO
```

If temporary break-glass SSH still exists during migration, the prototype is not considered free of SSH dependency until normal boot, development, update and recovery evidence no longer require it.

## Gate 7 - First network release acquisition and activation

Required:

- the minimal physical bootstrap can reach the configured source/release channel;
- the first complete system release is not required to be prewritten to the initial USB;
- a release tied to an exact commit can be acquired and materialized;
- integrity/authenticity is checked before activation;
- `current` activation is atomic;
- the verified release remains local after activation;
- rollback to previous verified release works once more than one verified release exists;
- a known-good current release boots without network/Git.

```text
GIT_OR_RELEASE_CHANNEL_REACHABLE=PASS
FIRST_RELEASE_ACQUIRED_AFTER_BOOT=PASS
RELEASE_MATERIALIZE=PASS
RELEASE_INTEGRITY=PASS
ATOMIC_ACTIVATION=PASS
KNOWN_GOOD_PERSISTED=PASS
KNOWN_GOOD_OFFLINE_BOOT=PASS
ROLLBACK=PASS
```

## Gate 8 - Single-source Surface across Web and native

Required:

- Web and native consume the same Surface component/app source;
- design tokens are shared;
- no copied Web/native UI trees;
- one visible source change is proven to reach local/hosted Web and native OrdaX from the same commit;
- differences are capability adapters only.

```text
ONE_SURFACE_SOURCE=PASS
UI_FORKS=NO
WEB_MODE=PASS
NATIVE_MODE=PASS
SAME_COMMIT_VISUAL_CHANGE=PASS
CAPABILITY_ADAPTER_BOUNDARY=PASS
```

## Gate 9 - Live incremental development

With the normal user-facing system running:

```text
EDIT_SOURCE=PASS
AFFECTED_TEST=PASS
WEB_PREVIEW=PASS
DELTA_SYNC_OR_RELEASE=PASS
OWNER_LOCAL_RECONCILE=PASS
HEALTH_READINESS=PASS
FULL_IMAGE_REBUILD_REQUIRED=NO
USB_REFLASH_REQUIRED=NO
ROUTINE_REBOOT_REQUIRED=NO
SSH_REQUIRED=NO
```

## Gate 10 - User continuity Web -> USB -> native disk

Required before final product-direction promotion:

- same OrdaX identity/account model;
- safe synchronization policy distinguishes cloud/synchronizable state from device-local secrets;
- a Web user can create/boot USB and recover allowed synchronized environment;
- native disk install path is specified and tested before being advertised as supported;
- device-private keys and machine identity do not migrate as ordinary cloud settings.

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
- invalid device/client authorization or trust mismatch;
- failed delta/release activation.

Before the first full release, bootstrap/recovery must remain available. After the first verified release, that known-good system must remain available locally.

```text
BOOTSTRAP_RECOVERY_WITHOUT_FIRST_RELEASE=PASS
KNOWN_GOOD_PRESERVED=PASS
OFFLINE_BOOT=PASS
INTERRUPTED_UPDATE_SAFE=PASS
TRUST_MISMATCH_FAIL_CLOSED=PASS
REMOTE_CORE_RECOVERY=PASS
```

## Promotion decision

Only after the applicable Gates 0-11 pass may the repository be declared a successor candidate for the current OrdaX repository.

Promotion does not automatically delete or rewrite the legacy repository. Archival/retirement is a separate decision.
