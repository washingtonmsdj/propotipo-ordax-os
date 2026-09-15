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
CANONICAL_SYSTEM_RUNTIME_COMPLETE=NO
```

`system/` is the shared product source, but the real user-facing Surface/runtime is not yet complete enough to publish as a production OrdaX release. CI release fixtures are protocol fixtures only and must never be promoted as the product runtime.

## Build autonomy

```text
CODEX_REQUIRED=NO
LOCAL_DEVELOPER_TOOLCHAIN_REQUIRED=NO
MANUAL_KERNEL_BUILD_REQUIRED=NO
CI_BUILD_REQUIRED=YES
ARTIFACT_PROVENANCE_REQUIRED=YES
ARTIFACT_SHA256_REQUIRED=YES
```

GitHub Actions is the current executor; repository recipes remain source authority.

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
 -> boot release
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
PHYSICAL_KERNEL_AUTHORIZED=NO
```

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

The release-agent candidate above was built with Go 1.27.1, `CGO_ENABLED=0`, Linux amd64, and its CI provenance explicitly marks it as not physically authorized.

### Release build/signing pipeline

Repository-owned tooling now covers the complete pre-publication chain:

```text
RELEASE_BUNDLE_TOOLING_IMPLEMENTED=YES
DETERMINISTIC_SYSTEM_TAR=PASS
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

Integrated CI proves:

```text
system source fixture
 -> deterministic system.tar
 -> exact unsigned release-manifest.json
 -> ephemeral Ed25519 signing with matching public trust
 -> release-envelope.json
 -> verification by the real ordax-release-agent
```

The fixture key is deleted after the proof and never becomes canonical trust. The fixture system is not the OrdaX product runtime.

### Release channel

Resolved in source and hash-bound in the minimal-bootstrap manifest:

```text
RELEASE_CHANNEL=RESOLVED
RELEASE_ENVELOPE_ASSET=release-envelope.json
RELEASE_ENVELOPE_URL=https://github.com/washingtonmsdj/prototipo-ordax-os/releases/latest/download/release-envelope.json
RELEASE_CHANNEL_SHA256=ea1f3bae328a1c1e7aca1474d4930f84b2dd6da1702dcc11b08c01ed63a6ee5b
LATEST_POINTER_IS_AUTHENTICITY_AUTHORITY=NO
```

The URL selects bytes. Ed25519 verification decides whether those bytes are trusted.

### Release trust

```text
RELEASE_TRUST=UNRESOLVED
EXPECTED_RUNTIME_PATH=/ordax/bootstrap/trust/release-ed25519.json
PRIVATE_SIGNING_KEY_IN_GIT=FORBIDDEN
PRIVATE_SIGNING_KEY_IN_USB=FORBIDDEN
PRIVATE_KEY_CUSTODY_OWNER=UNRESOLVED
PRIVATE_KEY_RECOVERY_POLICY=UNRESOLVED
PRIVATE_KEY_ROTATION_POLICY=UNRESOLVED
MINIMAL_BOOTSTRAP_ALL_ARTIFACTS_RESOLVED=NO
PHYSICAL_WRITE_ALLOWED=NO
```

This remains the only unresolved artifact group in `docs/contracts/minimal-bootstrap.json`. Do not replace it with a generated placeholder or CI key. The canonical public trust anchor may be pinned only after its matching private key has explicit custody outside Git.

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

Implemented:

```text
CREATOR_CORE_IMPLEMENTED=YES
CREATOR_VERIFY_PAYLOAD_IMPLEMENTED=YES
CREATOR_STAGE_TREE=IMPLEMENTED_TRANSACTIONAL
CREATOR_DISPOSABLE_GPT_FILESYSTEM_PROOF=PASS
CREATOR_PLAN=FAIL_CLOSED
CREATOR_APPLY_IMPLEMENTED=NO
CREATOR_WINDOWS_RAW_DISK_ADAPTER_IMPLEMENTED=NO
PHYSICAL_USB_WRITE=NO
```

Disposable media proof already demonstrates two partitions, FAT32+EXT4 labels, embedded partition bytes and post-materialization hash verification without touching a physical disk.

## Remote access

```text
SSH_REQUIRED=NO
REMOTE_CORE_REQUIRED=NO
CONTROL_PLANE_REQUIRED=NO
```

Remote/control may return later only as ordinary post-release product capabilities if justified.

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
CREATOR_APPLY_IMPLEMENTED=NO
DESTRUCTIVE_AUTHORIZATION=NO
```

## Current priorities

1. define real custody, recovery and rotation for the canonical Ed25519 release-signing private key, then pin only its public trust anchor in source;
2. complete the real shared `system/` runtime/Surface entry path so a repository-built `system.tar` is an actual OrdaX release rather than only a protocol fixture;
3. add production release publication policy after canonical trust and real runtime are ready;
4. resolve `bootstrap-release-trust`, making the minimal bootstrap byte-complete while keeping physical write disabled;
5. implement Creator target identity and the narrow Windows removable-disk adapter;
6. add physical APPLY only after all non-destructive gates pass;
7. request explicit destructive authorization only at the actual physical write boundary;
8. boot the notebook and prove first release acquisition, offline known-good boot and recovery;
9. continue shared Surface, Web/native adapters and account continuity in parallel.

## Handoff rule

Any new AI/conversation must read `AGENTS.md`, this file and the canonical contracts before changing source. Successful CI, a signed fixture or disposable-media proof never implicitly authorizes physical mutation or promotes a test key/runtime to production.
