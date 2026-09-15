# Initramfs Provenance

Status: CLEAN-ROOM REIMPLEMENTATION IN PROGRESS

The legacy initramfs is evidence only. Its archive and manifest are not imported because they encoded the retired three-partition/storage and pre-Git service architecture.

## Canonical source

The prototype owns its initramfs recipe in this repository:

```text
bootstrap/initramfs/source.json
bootstrap/initramfs/root/init
bootstrap/initramfs/build.py
```

BusyBox source is downloaded from its upstream archive and accepted only when its pinned SHA-256 matches. The root filesystem is assembled from source, serialized as deterministic `newc` CPIO, then gzip-compressed with timestamp zero.

## Fixed-capsule boundary

The initramfs is intentionally smaller than the old implementation. Its job is only to:

```text
mount proc/sys/dev
 -> discover LABEL=ORDAX
 -> mount ORDAX
 -> hand off to /ordax/bootstrap/entrypoint
 -> provide a bounded local recovery shell if handoff is impossible
```

It does **not** own networking, SSH, Remote Core, Control Plane, Git checkout, compilers, desktop services or normal applications. Network and verified release acquisition are materialized under `/ordax/bootstrap` and can evolve independently of the fixed boot capsule.

Physical partitions understood by the clean initramfs are only:

```text
ORDAX-ESP
ORDAX
```

`ORDAX-HOME` and `ORDAX-PLATFORM` are forbidden legacy partition assumptions.

## Creator payload handoff

A successful initramfs CI candidate is copied byte-for-byte into the deterministic Creator payload. Its workflow artifact path is not a physical media source path.

```text
initramfs CI candidate
 -> candidate SHA-256 + provenance
 -> exact initramfs.cpio.gz copied into Creator payload
 -> bundle-relative source_path pinned in media manifest
 -> Creator Core re-hashes local payload bytes
 -> disposable boot proof with the selected kernel
 -> later explicit destructive authorization
```

The payload assembler may not silently rebuild or mutate the archive. If initramfs source changes, its own candidate pipeline must produce a new artifact and provenance first.

## Promotion gate

A successful CI build is still a candidate until the build environment is pinned and the resulting kernel + initramfs pair passes disposable boot/media tests. No current initramfs candidate is yet authorized for destructive physical provisioning.
