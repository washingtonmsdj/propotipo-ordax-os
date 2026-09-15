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
7. before any future writable disk handle is opened, require every target-owned volume to be locked/dismounted through a fail-closed sequence and revalidate the volume-to-disk inventory;
8. require the canonical two-partition disposable proof;
9. require a fully resolved minimal-bootstrap manifest, including release trust;
10. show the exact destructive scope;
11. require explicit destructive authorization at execution time;
12. re-read GPT/filesystems after writing and verify artifact hashes from the physical target.

Read-only implementation evidence currently exists for steps 1-5. Steps 6-7 are the next policy/native-backend boundary; neither authorizes mutation by itself.

## Current physical state

```text
USB_LOCATION=WINDOWS
PHYSICAL_USB_WRITTEN=NO
PHYSICAL_LAYOUT_CHANGED=NO
CREATOR_READ_ONLY_PHYSICALDRIVE_HANDLE_PROBE=PASS
CREATOR_VOLUME_EXTENT_INVENTORY=PASS
CREATOR_APPLY_IMPLEMENTED=NO
WINDOWS_RAW_DISK_ADAPTER_IMPLEMENTED=NO
```

No source file or successful disposable test implicitly authorizes a physical write.
