# Physical Media Contract

Status: CANONICAL FOR PROTOTYPE

## Target layout

The prototype targets exactly two GPT partitions:

```text
1. ORDAX-ESP  - EFI System Partition, FAT32
2. ORDAX      - main OrdaX partition, Linux filesystem
```

No separate HOME partition is created in the prototype.

## Main partition logical layout

```text
/ordax/
  bootstrap/
  releases/
  current
  state/
  home/
```

Directory names may later move behind mount points or links, but the responsibility split must remain.

## Reprovisioning policy

If the connected USB contains an obsolete three-partition layout or incompatible historical contents, prefer clean reprovisioning over indefinite reconciliation, but only after the following gates pass:

```text
TARGET_IDENTITY=PASS
SOURCE_LAYOUT_CONTRACT=PASS
DISPOSABLE_LAYOUT_TEST=PASS
DESTRUCTIVE_OPERATION_EXPLICITLY_AUTHORIZED=YES
```

A destructive operation may then:

- delete old GPT/partitions;
- create a new GPT;
- create the two target partitions;
- format filesystems;
- install the minimal bootstrap;
- verify layout and written artifacts.

## What may exist before Git

Only artifacts necessary to boot, recover and reach a verified release:

- UEFI bootloader;
- kernel;
- initramfs;
- minimal bootstrap userspace;
- network support required by target hardware;
- device identity support;
- Remote Core / SSH support;
- Control Plane bootstrap support;
- Git/release acquisition support;
- recovery/maintenance support.

Do not preinstall the complete desktop, applications or general high-level services just because they existed in a previous image.

## Artifact provenance

A file that already works on the old USB is not automatically canonical.

Before reusing an artifact, record:

- repository and source path;
- source commit;
- version/release where meaningful;
- SHA256 of the exact built artifact when applicable;
- test/evidence that justifies reuse.

Prefer rebuilding from canonical source. Copy bytes from old media only when the artifact cannot yet be reproduced and the exception is explicitly documented.

## Write safety

Before any physical write:

1. identify the target disk independently from drive letters;
2. ensure the operation cannot select a system/internal disk by ambiguity;
3. collect pre-write geometry/identity evidence;
4. run the same layout logic against a disposable image when possible;
5. show the exact planned partition/write scope;
6. apply only after authorization;
7. re-read the physical target and verify the resulting GPT/filesystems/artifact hashes.

## Current USB state

At repository creation time, the physical USB is connected to the Windows development host. This document does not authorize a write by itself. The old repository/mission may continue read-only inventory until a clean provisioning implementation from this repository is ready and explicitly authorized.
