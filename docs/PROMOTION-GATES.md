# Promotion Gates

Status: CANONICAL FOR PROTOTYPE

This repository remains a prototype until every required gate below is closed with reproducible evidence. A green CI candidate never implicitly authorizes physical-media mutation.

## Gate 0 - Repository foundation

Required:

```text
AGENTS_CONTRACT=PASS
ARCHITECTURE_CONTRACT=PASS
BUILD_AUTONOMY_CONTRACT=PASS
PRODUCT_MODES_CONTRACT=PASS
MINIMAL_USB_CONTRACT=PASS
HOST_INDEPENDENCE_CONTRACT=PASS
PHYSICAL_MEDIA_CONTRACT=PASS
DEVELOPMENT_WORKFLOW=PASS
MIGRATION_LEDGER=PASS
```

Remote control is not a promotion prerequisite unless a later ADR makes it a supported product requirement.

## Gate 1 - Autonomous reproducible build foundation

Required:

```text
CODEX_REQUIRED=NO
LOCAL_DEVELOPER_TOOLCHAIN_REQUIRED=NO
MANUAL_KERNEL_BUILD_REQUIRED=NO
REPOSITORY_BUILD_RECIPE=PASS
UPSTREAM_SOURCE_HASH_VERIFY=PASS
ARTIFACT_PROVENANCE=PASS
ARTIFACT_SHA256=PASS
PORTABLE_BUILD_ENTRYPOINT=PASS
PINNED_BUILD_ENVIRONMENT=PASS
KERNEL_REPEAT_DIGEST_PROOF=PASS
KERNEL_BUILD_ENVIRONMENT_PROMOTABLE=YES
PHYSICAL_KERNEL_AUTHORIZED=NO
```

The immutable kernel environment is now pinned by OCI manifest digest, APT snapshot, exact package versions and CA-bundle digest in `docs/contracts/kernel-build-environment.json`. Two independent builds produced identical config, modules and bzImage SHA-256 values, so the build-environment portion of this gate is closed. `PHYSICAL_KERNEL_AUTHORIZED=NO` remains a separate physical-media decision and is not changed by reproducibility proof.

## Gate 2 - Reproducible minimal bootstrap source

Current state:

```text
BOOTSTRAP_SOURCE=PASS
MINIMAL_BOOTSTRAP_MANIFEST=PARTIAL_UNTIL_RELEASE_TRUST
KERNEL_PROVENANCE=PASS_PINNED_REPEAT_PROOF
INITRAMFS_PROVENANCE=PASS
RELEASE_CHANNEL=PASS
RELEASE_TRUST_POLICY=PASS
RELEASE_TRUST_KEY_MATERIAL=BLOCKED_UNTIL_LOCAL_CEREMONY
REAL_PUBLIC_TRUST_ANCHOR=BLOCKED
PRIVATE_SIGNING_KEY_IN_GIT=NO
PRIVATE_SIGNING_KEY_IN_USB=NO
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

The trust custody/recovery/rotation policy is defined in `docs/contracts/release-trust-policy.json`; policy completion does not resolve the actual public trust artifact.

## Gate 3 - Two-partition provisioning in disposable media

```text
DISPOSABLE_GPT=PASS
PARTITION_COUNT=2
SEPARATE_HOME_PARTITION=NO
FILESYSTEMS=FAT32,EXT4
FILESYSTEM_LABELS=PASS
POST_MATERIALIZATION_HASH_VERIFY=PASS
RAW_PARTITION_BYTES_VERIFY=PASS
PROVISION_VERIFY=PASS
PHYSICAL_WRITE_AUTHORIZED=NO
```

This gate is proven against an ephemeral regular RAW representation through Creator Core staging plus `tools/creator/proof/disposable_media.py`. It does not authorize a physical write.

## Gate 4 - Boot artifact and bootstrap proof

Current source/CI state:

```text
UEFI_BOOT_CONTRACT=PASS
BOOTSTRAP_ENTRY=PASS
NETWORK_BOOTSTRAP_BUILD=PASS
RELEASE_ACQUISITION_ENTRY=PASS
RELEASE_CHANNEL_VALIDATION=PASS
RELEASE_AGENT_SAFE_MATERIALIZATION=PASS
SYSTEM_ENTRYPOINT=PASS
SURFACE_BOOTSTRAP_RUNTIME=PASS
REAL_SYSTEM_BUNDLE=PASS
RELEASE_TRUST_VALIDATION_WITH_EPHEMERAL_CI_KEY=PASS
RELEASE_TRUST_VALIDATION_WITH_CANONICAL_KEY=PENDING
PHYSICAL_KERNEL_BOOT=PENDING
LEGACY_MEDIA_DEPENDENCY=NO
EMULATOR_SPECIFIC_DEPENDENCY=NO
REMOTE_CONTROL_DEPENDENCY=NO
```

The full-bootstrap-media proof may close byte-complete disposable composition with ephemeral trust, but only canonical trust plus physical boot can close the remaining physical portions of this gate.

## Gate 5 - OrdaX Creator host independence and target safety

```text
CREATOR_SHARED_CORE=PASS
WINDOWS_WITHOUT_WSL=PASS
HOST_POLICY_FORKS=NO
END_USER_KERNEL_TOOLCHAIN_REQUIRED=NO
CREATOR_VERIFY=PASS
CREATOR_STAGE_TREE_TRANSACTIONAL=PASS
CREATOR_MINIMAL_PAYLOAD_ONLY=PASS
WINDOWS_USB_TARGET_DISCOVERY=PASS
WINDOWS_FIXED_MEDIA_USB_DISCOVERY=PASS
USB_TRANSPORT_VERIFICATION=PASS
WINDOWS_SYSTEM_DISK_EXCLUSION=PASS
TARGET_CONFIRMATION_TOKEN=PASS
TARGET_IDENTITY_RECOMPUTED_AT_CONFIRMATION=PASS
TARGET_REENUMERATION=PASS
BLOCKED_RAW_DISK_PLAN=PASS
INTERNAL_RAW_WRITER_ORCHESTRATION=PASS_FAKE_BACKEND_ONLY
RAW_WRITE_READBACK_SHA256=PASS_FAKE_BACKEND_ONLY
WINDOWS_READ_ONLY_PHYSICALDRIVE_HANDLE_PROBE=PASS
WINDOWS_VOLUME_EXTENT_INVENTORY=PASS
WINDOWS_NATIVE_HOST_TESTS=PASS
WINDOWS_VOLUME_LOCK_DISMOUNT=NO
WINDOWS_PROTOTYPE_TOOLKIT=PASS
PHYSICAL_WRITE_IMPLEMENTED=NO
```

The target helper may accept Win32 removable or fixed media only when the mapped PhysicalDrive reports USB transport. The physical disk hosting the running Windows installation is always excluded. Target confirmation recomputes the token from the current identity instead of trusting a stored token. The Windows adapter can now open the selected `PhysicalDrive` with `GENERIC_READ` only, verify identity from that exact handle, and enumerate all volume GUIDs touching the disk through physical disk extents; those Windows-only paths are covered by native Windows CI. The internal raw-writer orchestration remains intentionally unexported and write-tested only with an in-memory backend. No writable PhysicalDrive handle, volume lock/dismount path, native destructive backend or public apply command is connected in this gate.

## Gate 6 - Physical USB reprovisioning

This gate is destructive and requires explicit user authorization at execution time.

Before write:

```text
TARGET_IDENTITY=PASS
TARGET_REENUMERATION_IMMEDIATELY_BEFORE_WRITE=REQUIRED
TARGET_HANDLE_IDENTITY_PROOF=PASS_READ_ONLY
TARGET_VOLUME_EXTENT_INVENTORY=PASS_READ_ONLY
TARGET_VOLUME_LOCK_DISMOUNT=PENDING_NATIVE_BACKEND
SOURCE_LAYOUT_CONTRACT=PASS
MINIMAL_BOOTSTRAP_ALL_ARTIFACTS_RESOLVED=PENDING_CANONICAL_TRUST
RELEASE_TRUST=PENDING_CANONICAL_KEY
PINNED_BOOT_BUILD_ENVIRONMENT=PASS
DISPOSABLE_LAYOUT_TEST=PASS
FULL_BOOTSTRAP_BYTE_COMPLETE_PROOF=PENDING_WORKFLOW_RESULT
CREATOR_INTERNAL_RAW_WRITER_ORCHESTRATION=PASS_FAKE_BACKEND_ONLY
CREATOR_NATIVE_WINDOWS_RAW_DISK_BACKEND=NO
CREATOR_PUBLIC_PHYSICAL_APPLY=NO
DESTRUCTIVE_OPERATION_EXPLICITLY_AUTHORIZED=NO
```

After a future authorized write:

```text
PHYSICAL_GPT_VERIFY=PENDING
PHYSICAL_FILESYSTEM_VERIFY=PENDING
BOOT_ARTIFACT_HASH_VERIFY=PENDING
PHYSICAL_PAYLOAD_MATCHES_MANIFEST=PENDING
UNAPPROVED_FULL_SYSTEM_PRESEED=NO
```

Current status:

```text
PHYSICAL_USB_WRITE=NO
PHYSICAL_LAYOUT_CHANGED=NO
DESTRUCTIVE_AUTHORIZATION=NO
```

## Gate 7 - Physical notebook minimal bootstrap

Required:

```text
NOTEBOOK_UEFI_BOOT=PENDING
NETWORK_READY=PENDING_PHYSICAL
RELEASE_CHANNEL_REACHABLE=PENDING_PHYSICAL
RELEASE_SIGNATURE_VERIFY=PENDING_CANONICAL_TRUST_AND_PHYSICAL
RECOVERY_PATH=PENDING_PHYSICAL
SSH_REQUIRED=NO
REMOTE_CORE_REQUIRED=NO
CONTROL_PLANE_REQUIRED=NO
```

## Gate 8 - First network release acquisition and activation

Required:

```text
FIRST_RELEASE_ACQUIRED_AFTER_BOOT=PENDING
RELEASE_MATERIALIZE=PASS_IN_AGENT_TESTS
RELEASE_INTEGRITY=PASS_IN_AGENT_TESTS
ATOMIC_ACTIVATION=PASS_IN_AGENT_TESTS
KNOWN_GOOD_PERSISTED=PENDING_PHYSICAL
KNOWN_GOOD_OFFLINE_BOOT=PENDING_PHYSICAL
ROLLBACK=PENDING_PHYSICAL
```

A release must be tied to an exact source commit and authenticated before activation.

## Gate 9 - Single-source Surface across Web and native

```text
ONE_SURFACE_SOURCE=ARCHITECTURE_PASS
SYSTEM_TO_SURFACE_HANDOFF=PASS
BOOTSTRAP_SURFACE_RUNTIME=PASS
UI_FORKS=NO_BY_CONTRACT
WEB_MODE=PENDING
NATIVE_GRAPHICAL_MODE=PENDING
SAME_COMMIT_VISUAL_CHANGE=PENDING
CAPABILITY_ADAPTER_BOUNDARY=PASS_BY_CONTRACT
```

The console/bootstrap Surface proves the release handoff but does not close the graphical Surface gate.

## Gate 10 - Git-driven live incremental development

Required with the normal user-facing system running:

```text
EDIT_SOURCE=PENDING_END_TO_END
AFFECTED_TEST=PASS_REPOSITORY
WEB_PREVIEW=PENDING
GIT_PUSH=PASS
CI_AFFECTED_ARTIFACT_BUILD=PASS_PARTIAL
DEVICE_RELEASE_OR_DELTA_UPDATE=PENDING_PHYSICAL
HEALTH_READINESS=PENDING
FULL_IMAGE_REBUILD_REQUIRED=NO_TARGET
USB_REFLASH_REQUIRED=NO_TARGET_AFTER_FIRST_RELEASE
ROUTINE_REBOOT_REQUIRED=NO_TARGET
SSH_REQUIRED=NO
REMOTE_CONTROL_REQUIRED=NO
CODEX_REQUIRED=NO
```

## Gate 11 - User continuity Web -> USB -> native disk

```text
ACCOUNT_CONTINUITY=CONTRACT_DEFINED
SYNC_POLICY=CONTRACT_DEFINED
WEB_TO_USB_CONTINUITY=PENDING
DEVICE_SECRETS_STAY_LOCAL=PASS_BY_CONTRACT
NATIVE_DISK_INSTALL=PENDING
```

## Gate 12 - Recovery after failure

Agent/unit/disposable tests already prove multiple fail-closed release cases, but physical recovery remains pending. Final required evidence includes:

```text
BOOTSTRAP_RECOVERY_WITHOUT_FIRST_RELEASE=PENDING_PHYSICAL
KNOWN_GOOD_PRESERVED=PASS_IN_AGENT_TESTS
OFFLINE_BOOT=PENDING_PHYSICAL
INTERRUPTED_UPDATE_SAFE=PASS_IN_AGENT_TESTS
RELEASE_INTEGRITY_FAIL_CLOSED=PASS
RELEASE_SIGNATURE_FAIL_CLOSED=PASS
```

## Optional future remote-management gate

Only if Remote Core or another remote-management feature is later adopted as a supported product capability should it receive its own security, authorization and recovery gates. It is intentionally not part of the bootstrap or daily-development critical path.

## Promotion decision

Only after the applicable Gates 0-12 pass may the repository be declared a successor candidate. In particular, no physical write is permitted while canonical release trust, the native raw-disk backend/public apply path, physical artifact authorization or explicit destructive authorization remain open.
