# Current State

Status date: 2026-09-15

This is the canonical handoff snapshot. Architecture/contracts win if another document conflicts with it.

## Repository

```text
REPOSITORY=washingtonmsdj/prototipo-ordax-os
ROLE=CLEAN_ROOM_PROTOTYPE
DEFAULT_BRANCH=main
PROMOTED_TO_OFFICIAL=NO
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_REPOSITORY_IS_REFERENCE_ONLY=YES
GIT_MAIN_IS_SOURCE_AUTHORITY=YES
USB_IS_SOURCE_AUTHORITY=NO
```

## Product model

```text
ONE_PRODUCT=YES
MODES=WEB,MOBILE,DESKTOP,USB,NATIVE_DISK
ONE_ACCOUNT_MODEL=YES
ONE_SURFACE_SOURCE=YES
CAPABILITY_DIFFERENCES_VIA_ADAPTERS=YES
SYSTEM_ENTRYPOINT_IMPLEMENTED=YES
SURFACE_BOOTSTRAP_RUNTIME=YES
REAL_SYSTEM_BUNDLE_REPRODUCIBLE=PASS
GRAPHICAL_SURFACE_COMPLETE=NO
CANONICAL_SYSTEM_RUNTIME_COMPLETE=NO
```

`system/` is the shared product source. The real release path now exists as `system/entrypoint -> system/surface/entrypoint -> system/surface/bin/ordax-surface`, and repository CI proves that the actual `system/` tree can be bundled deterministically as `system.tar`. The current Surface runtime is a deliberate bootstrap-console milestone; the graphical user-facing Surface remains incomplete and must not be described as production-ready.

## Build autonomy

```text
CODEX_REQUIRED=NO
LOCAL_DEVELOPER_TOOLCHAIN_REQUIRED=NO
MANUAL_KERNEL_BUILD_REQUIRED=NO
CI_BUILD_REQUIRED=YES
ARTIFACT_PROVENANCE_REQUIRED=YES
ARTIFACT_SHA256_REQUIRED=YES
PINNED_KERNEL_BUILD_ENVIRONMENT=PASS
KERNEL_REPEAT_DIGEST_PROOF=PASS
```

GitHub Actions is the current executor; repository recipes remain source authority. The kernel environment is pinned by immutable OCI digest, APT snapshot, exact package versions and CA-bundle digest, and an independent repeat build produced identical kernel artifact hashes.

## Physical architecture

```text
PHYSICAL_PARTITIONS=2
PARTITION_1=ORDAX-ESP
PARTITION_1_FILESYSTEM=FAT32
PARTITION_2=ORDAX
PARTITION_2_FILESYSTEM=EXT4
SEPARATE_HOME_PARTITION=NO
LEGACY_ORDAX_PLATFORM_PARTITION=FORBIDDEN
LEGACY_ORDAX_HOME_PARTITION=FORBIDDEN
```

Canonical geometry is in `docs/contracts/physical-media.json`:

```text
SECTOR_BYTES=512
ALIGNMENT=1_MiB
ESP_START_LBA=2048
ESP_SIZE=256_MiB
ORDAX_START_LBA=526336
ORDAX_SIZE=FILL_REMAINING_USABLE
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

Boot chain:

```text
UEFI
 -> kernel/initramfs
 -> mount LABEL=ORDAX
 -> /ordax/bootstrap/entrypoint
 -> boot /ordax/current immediately when known-good exists
 -> otherwise bring up minimum network
 -> fetch signed release envelope over HTTPS
 -> verify local Ed25519 trust anchor
 -> download and verify system.tar
 -> safely materialize /ordax/releases/<commit>/system
 -> atomically activate current
 -> /ordax/current/system/entrypoint
 -> shared Surface entry path
```

## Boot artifacts

### ESP

```text
BOOTLOADER=systemd-boot
UPSTREAM_VERSION=261.2
UPSTREAM_SOURCE_COMMIT=4925d9f07fc697efccd98a93046ff535b8832445
SYSTEMD_BOOT_X64_SHA256=9ac1ca03fc52ed2d8c40cea76b84192d718909d561a7bc6cf36d84784b71ada5
PHYSICAL_BOOTLOADER_AUTHORIZED=NO
```

### Kernel

```text
KERNEL_VERSION=6.6.52
UPSTREAM_ARCHIVE_SHA256=1591ab348399d4aa53121158525056a69c8cf0fe0e90935b0095e9a58e37b4b8
KERNEL_ARTIFACT_SHA256=e080323be390b2e921ed34286794cbce18642b653fc6790ae308f61720c90ba1
KERNEL_BUILD_IN_CI=PROVEN
KERNEL_BUILD_ENVIRONMENT=pinned-repeat-proof-complete
KERNEL_REPEAT_DIGEST_PROOF=PASS
PHYSICAL_KERNEL_AUTHORIZED=NO
```

The reproducible kernel build is eligible to enter the physical-media pipeline, but physical artifact authorization remains a separate fail-closed gate.

### Initramfs

```text
INITRAMFS=CLEAN_ROOM_REIMPLEMENTED
CANONICAL_HANDOFF=/ordax/bootstrap/entrypoint
NETWORK_INSIDE_FIXED_INITRAMFS=NO
SSH_INSIDE_FIXED_INITRAMFS=NO
INITRAMFS_ARTIFACT_SHA256=d8e5155de1e0ff3b1a7faaefde67fcbf3e1114fc208a4b37ab1ba7e562efce67
PHYSICAL_INITRAMFS_AUTHORIZED=NO
```

## First-acquisition network

```text
NETWORK_BOOTSTRAP_IMPLEMENTED=YES
PROTOTYPE_SCOPE=ETHERNET_USB_TETHER_DHCP
BUSYBOX_VERSION=1.38.0
STATIC_MUSL=YES
NETBOX_APPLETS=ifconfig,route,udhcpc
NETBOX_SHA256=0b8eb465f533d13ebcbc4275c5d4beafddb75f04c9a86930db3bc66d6ce243ba
WIFI_IN_PROTOTYPE_SEED=NO
CONSUMER_WIFI_REQUIRED_BEFORE_PRODUCT_PROMOTION=YES
PHYSICAL_NETWORK_ARTIFACT_AUTHORIZED=NO
```

## Release acquisition

Implemented clean-room in `bootstrap/release-acquisition/`.

```text
FULL_GIT_CLIENT_ON_DEVICE=NO
SOURCE_CHECKOUT_ON_DEVICE=NO
DEVICE_COMPILER_REQUIRED=NO
HTTPS_REQUIRED=YES
ED25519_MANIFEST_SIGNATURE=YES
SHA256_ARTIFACT_VERIFICATION=YES
EXACT_SOURCE_COMMIT_REQUIRED=YES
RELEASE_V1_ARTIFACT=system.tar
SAFE_TAR_MATERIALIZATION=PASS
PATH_TRAVERSAL_REJECTED=PASS
SYMLINK_HARDLINK_DEVICE_REJECTED=PASS
SYSTEM_ENTRYPOINT_REQUIRED=PASS
MATERIALIZED_TREE_REVERIFY=PASS
ATOMIC_RELEASE_ACTIVATION=YES
IDEMPOTENT_REINSTALL=PASS
KNOWN_GOOD_PRESERVED_ON_FAILURE=PASS
RELEASE_AGENT_SHA256=9d76eec25ba07c436b21aa59ea88b5c972e531ebd8ec345cf10aa590fb8122f4
RELEASE_AGENT_SIZE=7090336
PHYSICAL_AGENT_AUTHORIZED=NO
```

### Release build/signing pipeline

```text
RELEASE_BUNDLE_TOOLING_IMPLEMENTED=YES
DETERMINISTIC_SYSTEM_TAR=PASS
REAL_REPOSITORY_SYSTEM_BUNDLE=PASS
RELEASE_MANIFEST_TOOLING_IMPLEMENTED=YES
MANIFEST_PINS_SOURCE_COMMIT=PASS
MANIFEST_PINS_SYSTEM_TAR_SHA256_SIZE=PASS
RELEASE_SIGNING_TOOLING_IMPLEMENTED=YES
SIGNING_REQUIRES_EXPLICIT_TRUST_INPUT=YES
SIGNER_PRIVATE_TRUST_MATCH=PASS
SIGNER_KEY_ID_TRUST_MATCH=PASS
SIGNER_AGENT_PROTOCOL=PASS
RELEASE_PIPELINE_CI=PASS
PRODUCTION_RELEASE_PUBLISHED=NO
```

CI has proved both the protocol fixture chain and deterministic bundling of the actual repository `system/` tree. CI-only signing keys remain ephemeral and are never canonical trust.

### Release channel

```text
RELEASE_CHANNEL=RESOLVED
RELEASE_ENVELOPE_ASSET=release-envelope.json
RELEASE_ENVELOPE_URL=https://github.com/washingtonmsdj/prototipo-ordax-os/releases/latest/download/release-envelope.json
RELEASE_CHANNEL_SHA256=ea1f3bae328a1c1e7aca1474d4930f84b2dd6da1702dcc11b08c01ed63a6ee5b
LATEST_POINTER_IS_AUTHENTICITY_AUTHORITY=NO
```

The URL selects bytes. Ed25519 verification decides whether those bytes are trusted.

### Release trust

Policy is resolved; actual canonical key material is not.

```text
RELEASE_TRUST_POLICY=RESOLVED
TRUST_POLICY_SCHEMA=prototype-ordax.release-trust-policy/1
CANONICAL_KEY_ID=ordax-prototype-release-v1
CANONICAL_KEY_MATERIAL_GENERATED=NO
PUBLIC_ANCHOR_PINNED=NO
RELEASE_TRUST=UNRESOLVED
EXPECTED_RUNTIME_PATH=/ordax/bootstrap/trust/release-ed25519.json
PRIVATE_SIGNING_KEY_IN_GIT=FORBIDDEN
PRIVATE_SIGNING_KEY_IN_USB=FORBIDDEN
PRIVATE_KEY_CUSTODY_OWNER=repository-owner-developer
PRIVATE_KEY_GENERATION_HOST=developer-windows-machine
PRIVATE_KEY_RECOVERY_POLICY=offline-encrypted-backup-required
PRIVATE_KEY_ROTATION_POLICY=prototype-reprovision-until-signed-transition
MINIMAL_BOOTSTRAP_ALL_ARTIFACTS_RESOLVED=NO
PHYSICAL_WRITE_ALLOWED=NO
```

`docs/contracts/release-trust-policy.json` and `docs/RELEASE-TRUST-CEREMONY.md` define the custody/recovery/rotation boundary. The actual private key must be generated locally outside Git; only the matching public trust document may be pinned in source. A CI key or placeholder must never satisfy `bootstrap-release-trust`.

## Recovery

```text
RECOVERY_ENTRY=YES
RECOVERY_ORDAX_MOUNT=READ_ONLY
RECOVERY_AUTOMATIC_NETWORK=NO
RECOVERY_SSH=NO
RECOVERY_AUTOMATIC_MUTATION=NO
```

## Creator

Permanent architecture:

```text
OrdaX Desktop UI
 -> shared Creator Core
 -> narrow host raw-device/elevation adapter
 -> verified target
```

Implemented and proven without exposing a physical apply route:

```text
CREATOR_CORE_IMPLEMENTED=YES
CREATOR_VERIFY_PAYLOAD_IMPLEMENTED=YES
CREATOR_STAGE_TREE=IMPLEMENTED_TRANSACTIONAL
CREATOR_DISPOSABLE_GPT_FILESYSTEM_PROOF=PASS
CREATOR_PLAN=FAIL_CLOSED_SCHEMA_V2
CREATOR_WINDOWS_TARGET_DISCOVERY=PASS
CREATOR_WINDOWS_REMOVABLE_USB_DISCOVERY=PASS
CREATOR_WINDOWS_FIXED_MEDIA_USB_DISCOVERY=PASS
CREATOR_WINDOWS_USB_TRANSPORT_VERIFICATION=PASS
CREATOR_WINDOWS_SYSTEM_DISK_EXCLUSION=PASS
CREATOR_TARGET_CONFIRMATION_TOKEN=PASS
CREATOR_TARGET_IDENTITY_RECOMPUTED=PASS
CREATOR_TARGET_REENUMERATION_CONFIRMATION=PASS
RAW_DISK_PLAN_STRATEGY=verified-full-disk-image
CREATOR_INTERNAL_RAW_WRITER_ORCHESTRATION=PASS_FAKE_BACKEND_ONLY
CREATOR_INTERNAL_RAW_WRITE_READBACK_SHA256=PASS_FAKE_BACKEND_ONLY
CREATOR_INTERNAL_TARGET_VOLUME_LEASE=PASS
CREATOR_WINDOWS_READ_ONLY_PHYSICALDRIVE_HANDLE_PROBE=PASS
CREATOR_WINDOWS_VOLUME_EXTENT_INVENTORY=PASS
CREATOR_WINDOWS_TARGET_VOLUME_ISOLATION=PASS
CREATOR_WINDOWS_VOLUME_LOCK_DISMOUNT_PRIMITIVES=PASS_TAGGED_UNBOUND
CREATOR_WINDOWS_WRITABLE_PHYSICALDRIVE_HANDLE=PASS_TAGGED_UNBOUND
CREATOR_WINDOWS_PROCESS_ELEVATION_PROBE=PASS_TAGGED_UNBOUND
CREATOR_WINDOWS_NATIVE_RAW_DISK_BACKEND=PASS_TAGGED_UNBOUND
CREATOR_WINDOWS_RAW_BACKEND_BUILD_TAG=ordax_raw_backend
CREATOR_WINDOWS_RAW_BACKEND_BUILD_TAG_ISOLATION=PASS
CREATOR_WINDOWS_RAW_BACKEND_IN_PUBLIC_BUILD=NO
CREATOR_WINDOWS_NATIVE_TESTS=PASS
WINDOWS_PROTOTYPE_TOOLKIT=PASS
CREATOR_PUBLIC_PHYSICAL_APPLY_IMPLEMENTED=NO
CREATOR_NATIVE_BACKEND_PUBLICLY_REACHABLE=NO
PHYSICAL_WRITE_AUTHORIZED=NO
PHYSICAL_USB_WRITE=NO
```

The fail-closed raw-disk plan now uses `prototype-ordax.creator-windows-raw-disk-plan/2` and explicitly separates native implementation from public reachability. It reports `native_backend_implemented=true`, while `public_physical_apply_implemented=false` and `physical_write_authorized=false` remain blocking facts.

The Windows adapter contains the complete internal host-side chain needed for a future physical writer: real process-token elevation detection; USB/system-disk-safe target reenumeration; complete volume GUID/extent inventory; rejection of target volumes spanning another disk; managed `FSCTL_LOCK_VOLUME`/same-handle extent proof/`FSCTL_DISMOUNT_VOLUME` leases; a `GENERIC_READ|GENERIC_WRITE` `PhysicalDrive` open that accepts only the exact active managed lease for the same disk; and same-handle reproof of disk number, USB transport, capacity, removable identity and serial before returning the writable handle.

The destructive native pieces are additionally compile-time isolated behind the explicit Go build tag `ordax_raw_backend`. Default/public Windows builds exclude `raw_handle_write_windows.go`, `volume_lease_windows.go`, `elevation_windows.go` and `raw_runtime_windows.go`; CI separately proves that a tagged internal build contains and compiles them. `ordax-creator.exe` therefore does not link the native raw-disk host package in the public build.

Those pieces are assembled only in the unexported `windowsRawDiskRuntimeUnbound` when the internal tag is explicitly enabled. The internal writer interface also requires the exact acquired lease to be passed into `OpenVerifiedPhysicalDrive`, and holds that lease through write, flush, byte-complete readback and device close. Native Windows CI covers both the normal public build and the tagged guard paths without opening a real target for writing.

The public boundary is still intentionally absent. `ordax-creator` exposes only `check`, `verify-payload`, `stage-tree` and `plan`; CI rejects `apply`, `write`, `flash` or direct unbound-runtime markers in that command owner. Candidate/toolkit provenance records the backend source as implemented while explicitly marking it excluded from the public build, not publicly reachable, public apply unimplemented and physical authorization false.

A unified Windows prototype toolkit is built by CI with `ordax-creator.exe`, `ordax-creator-targets.exe`, `ordax-release-signing.exe`, hashes, provenance and the trust ceremony. It contains no private key and no canonical trust, and its public Creator command cannot compile or reach the tagged native raw-disk backend.

Disposable media proof already demonstrates two partitions, FAT32+EXT4 labels, embedded partition bytes and post-materialization hash verification without touching a physical disk.

## Full bootstrap media proof

The heavy proof workflow rebuilds the real bootstrap owners, injects an ephemeral CI-only public trust into a temporary manifest, assembles the byte-complete payload and materializes the actual two-partition image without touching a physical disk. Run 70 for source commit `95de305cc05701025ca7c93d574769da6a7fcf95` completed successfully. It then destroyed the ephemeral private key and unpublished RAW image and uploaded metadata only.

```text
FULL_BOOTSTRAP_MEDIA_PROOF=PASS_EPHEMERAL_TRUST
FULL_BOOTSTRAP_MEDIA_SOURCE_COMMIT=95de305cc05701025ca7c93d574769da6a7fcf95
FULL_BOOTSTRAP_MEDIA_RUN_ID=34998897295
FULL_BOOTSTRAP_MEDIA_PAYLOAD_ARTIFACTS=14
FULL_BOOTSTRAP_MEDIA_UNRESOLVED_GROUPS=0
FULL_BOOTSTRAP_MEDIA_IMAGE_BYTES=536870912
FULL_BOOTSTRAP_MEDIA_IMAGE_SHA256=95bd9943b3fe65402d9bda06eb7e0d45959f2a18b1671855e5752033659c7bb8
FULL_BOOTSTRAP_MEDIA_PARTITIONS=2
FULL_BOOTSTRAP_MEDIA_CANONICAL_TRUST=NO
FULL_BOOTSTRAP_MEDIA_EPHEMERAL_PRIVATE_KEY_DESTROYED=YES
FULL_BOOTSTRAP_MEDIA_RAW_IMAGE_PUBLISHED=NO
FULL_BOOTSTRAP_MEDIA_PHYSICAL_WRITE_AUTHORIZED=NO
```

The durable non-secret evidence is `docs/evidence/full-bootstrap-media-proof-95de305c.json`. This closes the byte-complete composition proof with ephemeral trust only; it does not resolve canonical release trust and does not authorize physical mutation.

## Remote access

```text
SSH_REQUIRED=NO
REMOTE_CORE_REQUIRED=NO
CONTROL_PLANE_REQUIRED=NO
```

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

## Physical state

```text
USB_LOCATION=WINDOWS
PHYSICAL_USB_WRITTEN=NO
PHYSICAL_LAYOUT_CHANGED=NO
PHYSICAL_NOTEBOOK_BOOT_PROVEN=NO
FULL_BOOTSTRAP_MEDIA_PROOF=PASS_EPHEMERAL_TRUST
CREATOR_WINDOWS_NATIVE_RAW_DISK_BACKEND=PASS_TAGGED_UNBOUND
CREATOR_WINDOWS_RAW_BACKEND_BUILD_TAG=ordax_raw_backend
CREATOR_WINDOWS_RAW_BACKEND_BUILD_TAG_ISOLATION=PASS
CREATOR_WINDOWS_RAW_BACKEND_IN_PUBLIC_BUILD=NO
CREATOR_NATIVE_BACKEND_PUBLICLY_REACHABLE=NO
CREATOR_PUBLIC_PHYSICAL_APPLY_IMPLEMENTED=NO
RELEASE_TRUST=UNRESOLVED
DESTRUCTIVE_AUTHORIZATION=NO
```

## Current priorities

1. generate the canonical Ed25519 prototype release key locally on the developer Windows machine, create the required encrypted offline backup, then commit only the public trust anchor and pin its SHA-256;
2. rerun the byte-complete media proof with canonical public trust while keeping physical write unavailable;
3. keep the tagged, unbound native Windows backend behind `ordax_raw_backend` and the no-public-apply CI gates while completing canonical trust and byte-complete media evidence; do not expose `apply` yet;
4. only after those gates pass, implement the deliberate public apply boundary and request explicit user authorization for the exact target operation at execution time;
5. after an authorized physical write, boot the notebook and prove first-release acquisition, known-good offline reboot and recovery;
6. continue the graphical shared Surface, Web/native adapters and account continuity in parallel;
7. add production release publication and signed trust rotation before product promotion.

## Handoff rule

Any new AI/conversation must read `AGENTS.md`, this file and the canonical contracts before changing source. Successful CI, a signed fixture, byte-complete proof, internal raw-writer test, tagged-unbound native backend or disposable-media proof never implicitly authorizes physical mutation or promotes a CI key/runtime to production.
