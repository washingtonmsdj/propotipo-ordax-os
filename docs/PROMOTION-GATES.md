# Promotion Gates

Status: CANONICAL FOR PROTOTYPE

This repository remains a prototype until every required gate below is closed with reproducible evidence.

## Gate 0 - Repository foundation

Required:

```text
AGENTS_CONTRACT=PASS
ARCHITECTURE_CONTRACT=PASS
PHYSICAL_MEDIA_CONTRACT=PASS
DEVELOPMENT_WORKFLOW=PASS
MIGRATION_LEDGER=PASS
```

## Gate 1 - Reproducible bootstrap source

Required:

- kernel provenance identified;
- initramfs provenance identified;
- minimal userspace source/build reproducible;
- no private secrets in repository;
- pre-Git dependency list explicit;
- bootstrap build has deterministic/verified artifact hashes where practical.

```text
BOOTSTRAP_SOURCE=PASS
KERNEL_PROVENANCE=PASS
INITRAMFS_PROVENANCE=PASS
SECRET_SCAN=PASS
```

## Gate 2 - Two-partition provisioning in disposable media

Required:

- GPT with exactly `ORDAX-ESP` and `ORDAX`;
- expected filesystem types;
- no separate HOME partition;
- provisioning can start from blank/disposable image;
- rerun behavior is defined;
- target-selection logic cannot silently choose an unrelated disk.

```text
DISPOSABLE_GPT=PASS
PARTITION_COUNT=2
SEPARATE_HOME_PARTITION=NO
PROVISION_VERIFY=PASS
```

## Gate 3 - Disposable boot

Required:

- UEFI reaches bootloader;
- kernel starts;
- initramfs/bootstrap enters expected state;
- recovery/maintenance entry exists or equivalent safe path is proven;
- no dependence on legacy USB contents.

```text
UEFI_BOOT=PASS
KERNEL_BOOT=PASS
BOOTSTRAP_ENTRY=PASS
LEGACY_MEDIA_DEPENDENCY=NO
```

## Gate 4 - Physical USB reprovisioning

This gate is destructive and requires explicit authorization at execution time.

Required before write:

```text
TARGET_IDENTITY=PASS
SOURCE_LAYOUT_CONTRACT=PASS
DISPOSABLE_LAYOUT_TEST=PASS
DESTRUCTIVE_OPERATION_EXPLICITLY_AUTHORIZED=YES
```

Required after write:

```text
PHYSICAL_GPT_VERIFY=PASS
PHYSICAL_FILESYSTEM_VERIFY=PASS
BOOT_ARTIFACT_HASH_VERIFY=PASS
```

## Gate 5 - Physical notebook bootstrap

Required:

```text
NOTEBOOK_UEFI_BOOT=PASS
NETWORK_READY=PASS
DEVICE_IDENTITY=PASS
SSH_HOST_KEY_PERSISTENT=PASS
ROOT_SSH_PUBLIC_KEY_ONLY=PASS
STRICT_HOST_KEY_TRUST=PASS
CONTROL_PLANE_BOOTSTRAP=PASS
```

If two operator keys are part of the current development policy, both must be tested independently and coexist without deleting the prior valid key.

## Gate 6 - Git acquisition and release activation

Required:

- device can reach the configured source/release channel;
- a release tied to an exact commit can be materialized;
- integrity is checked before activation;
- `current` activation is atomic;
- rollback to previous verified release works.

```text
GIT_REACHABLE=PASS
RELEASE_MATERIALIZE=PASS
RELEASE_INTEGRITY=PASS
ATOMIC_ACTIVATION=PASS
ROLLBACK=PASS
```

## Gate 7 - Live incremental development

With the normal user-facing system running:

```text
EDIT_SOURCE=PASS
AFFECTED_TEST=PASS
DELTA_SYNC_OR_RELEASE=PASS
OWNER_LOCAL_RESTART=PASS
HEALTH_READINESS=PASS
FULL_IMAGE_REBUILD_REQUIRED=NO
USB_REFLASH_REQUIRED=NO
ROUTINE_REBOOT_REQUIRED=NO
```

## Gate 8 - Recovery after failure

Simulate at least:

- bad/unavailable new release;
- network unavailable;
- Git unavailable;
- interrupted release acquisition;
- invalid host identity/trust mismatch.

A previously verified system/recovery path must remain available.

```text
KNOWN_GOOD_PRESERVED=PASS
OFFLINE_BOOT=PASS
INTERRUPTED_UPDATE_SAFE=PASS
TRUST_MISMATCH_FAIL_CLOSED=PASS
```

## Promotion decision

Only after Gates 0-8 pass may the repository be declared a successor candidate for the current OrdaX repository.

Promotion does not automatically delete or rewrite the legacy repository. Archival/retirement is a separate decision.
