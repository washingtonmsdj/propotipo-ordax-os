# Physical Media Contract

Status: CANONICAL FOR PROTOTYPE

## Target layout

The prototype targets exactly two GPT partitions:

```text
1. ORDAX-ESP  - EFI System Partition, FAT32
2. ORDAX      - main OrdaX partition, ext4
```

No separate `ORDAX-HOME` or `ORDAX-PLATFORM` partition is permitted.

The byte-level prototype contract is `docs/contracts/physical-media.json`:

```text
LOGICAL_SECTOR_BYTES=512
ALIGNMENT=1_MiB
ORDAX_ESP_START_LBA=2048
ORDAX_ESP_SIZE=256_MiB
ORDAX_START_LBA=526336
ORDAX_SIZE_POLICY=fill-remaining-usable
```

The 512 MiB RAW size used by CI is only a disposable-proof capacity. It is **not** the capacity contract for a real USB device.

## Main partition logical layout

```text
/ordax/
  bootstrap/
  releases/
  current
  state/
  home/
```

`home/` is a logical directory inside `ORDAX`; it is not a third physical partition.

## Disposable proof already implemented

The canonical non-destructive proof path is:

```text
Creator Core
 -> transactional stage-tree
 -> regular sparse RAW file
 -> GPT
 -> ORDAX-ESP/FAT32
 -> ORDAX/ext4
 -> filesystem labels
 -> re-extract staged files
 -> SHA-256 reverify
 -> compare embedded partition bytes
```

Current source/CI evidence:

```text
DISPOSABLE_GPT=PASS
PARTITION_COUNT=2
FILESYSTEMS=FAT32,EXT4
PROVISION_VERIFY=PASS
POST_MATERIALIZATION_HASH_VERIFY=PASS
RAW_PARTITION_BYTES_VERIFY=PASS
PHYSICAL_WRITE_AUTHORIZED=NO
```

The RAW image exists only inside the ephemeral CI runner. CI publishes proof metadata, not a bootable image artifact.

## Reprovisioning policy

If connected media contains an obsolete three-partition layout or incompatible historical contents, prefer clean reprovisioning over indefinite compatibility layers, but only after all destructive gates pass:

```text
TARGET_IDENTITY=PASS
SOURCE_LAYOUT_CONTRACT=PASS
DISPOSABLE_LAYOUT_TEST=PASS
MINIMAL_BOOTSTRAP_FULLY_RESOLVED=PASS
DESTRUCTIVE_OPERATION_EXPLICITLY_AUTHORIZED=YES
```

Only then may a physical operation delete the old GPT, create the two target partitions, format filesystems, install the minimal bootstrap and verify every written byte.

## What may exist before the first full release

Only the minimum substrate required to boot, acquire a signed release and recover from failure:

- UEFI bootloader;
- kernel;
- fixed initramfs;
- bootstrap orchestrator;
- minimal first-acquisition network owner;
- release-acquisition agent;
- public release trust anchor;
- release-channel pointer;
- local recovery/maintenance entrypoint.

The initial seed **does not** preinstall:

- normal Surface/apps/high-level services;
- full source checkout or compiler/build toolchain;
- SSH;
- Remote Core;
- Control Plane;
- mandatory device-identity service.

Those are normal post-release capabilities if later required by the product. This matches ADR-004, ADR-007 and ADR-015.

## Artifact provenance

A file that works on historical media is not automatically canonical. Before reuse, source ownership, exact version/commit, SHA-256 and validation evidence must be known. Prefer reproducible repository builds; copying unexplained bytes from old media is not a clean-room implementation.

## Write safety

Before any physical write:

1. independently identify the target disk rather than trusting a drive letter;
2. fail closed if an internal/system disk could match;
3. record pre-write device identity and geometry;
4. open the selected physical disk read-only first and re-prove disk number, USB transport, capacity and stable device identity from that exact handle;
5. enumerate every Windows volume by GUID and map it to physical disks through volume disk extents rather than assuming the original drive letter is the only mounted volume;
6. fail closed if any volume touching the target also spans another physical disk; destructive scope must never cross the confirmed target disk boundary;
7. require every target-owned volume to be locked/dismounted through a fail-closed managed lease, prove each locked volume's extents through the same handle, re-enumerate volume identities to detect newly appearing target volumes, dismount only after all locks succeed, and keep all locked handles alive until the physical-device operation ends;
8. require the writable `PhysicalDrive` open to receive that exact managed same-disk lease and re-prove disk number, USB transport, capacity, removable identity and serial from the writable handle itself before returning it;
9. require an elevated process token rather than relying on Administrators-group membership;
10. require the canonical two-partition disposable proof;
11. require a fully resolved minimal-bootstrap manifest, including canonical release trust;
12. show the exact destructive scope;
13. require explicit destructive authorization at execution time;
14. re-read GPT/filesystems after writing and verify artifact hashes from the physical target.

Implementation evidence exists in source for steps 1-9, but the destructive Windows pieces are additionally excluded from normal builds. `FSCTL_LOCK_VOLUME`/dismount, process elevation, the lease-bound writable `PhysicalDrive` primitive and `windowsRawDiskRuntimeUnbound` compile only with the explicit `ordax_raw_backend` build tag. Normal/public Windows builds exclude those files entirely. CI proves both halves: the public build omits them and the tagged internal build compiles/tests them on native Windows without opening a real target for writing.

## Current physical state

```text
USB_LOCATION=WINDOWS
PHYSICAL_USB_WRITTEN=NO
PHYSICAL_LAYOUT_CHANGED=NO
CREATOR_READ_ONLY_PHYSICALDRIVE_HANDLE_PROBE=PASS
CREATOR_VOLUME_EXTENT_INVENTORY=PASS
CREATOR_TARGET_VOLUME_ISOLATION_POLICY=PASS
CREATOR_VOLUME_LEASE_POLICY=PASS
WINDOWS_RAW_BACKEND_BUILD_TAG=ordax_raw_backend
WINDOWS_RAW_BACKEND_BUILD_TAG_ISOLATION=PASS
WINDOWS_RAW_BACKEND_IN_PUBLIC_BUILD=NO
WINDOWS_VOLUME_LOCK_DISMOUNT_PRIMITIVES=PASS_TAGGED_UNBOUND
WINDOWS_WRITABLE_PHYSICALDRIVE_HANDLE=PASS_TAGGED_UNBOUND
WINDOWS_PROCESS_ELEVATION_PROBE=PASS_TAGGED_UNBOUND
WINDOWS_NATIVE_RAW_DISK_BACKEND=PASS_TAGGED_UNBOUND
CREATOR_PUBLIC_PHYSICAL_APPLY=NO
PHYSICAL_WRITE_AUTHORIZED=NO
```

`PASS_TAGGED_UNBOUND` means the native implementation exists in source only behind the explicit internal build tag, is excluded from public builds and is deliberately unreachable from the public Creator surface. No source implementation, successful CI run or disposable proof implicitly authorizes a physical write.
