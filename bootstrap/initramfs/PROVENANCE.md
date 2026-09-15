# Initramfs Provenance

Status: REIMPLEMENTATION REQUIRED / LEGACY ARTIFACT NOT IMPORTED

## Legacy source of evidence

```text
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_COMMIT=f8ea8424f8cf52b516800f16f2331090ccb56748
LEGACY_BUILD_COMMAND=ordax-bootstrap/scripts/build-initramfs.sh
LEGACY_MANIFEST=docs/contracts/boot-capsule-minimal.manifest.json
LEGACY_APPROVED_ARTIFACT=build/boot-capsule-minimal-b3335ed1/initramfs.cpio.gz
LEGACY_APPROVED_SHA256=428c9cd1c54e35534b358fbf8a6384b28b72c005f26a7c568217895fc6733ee3
```

An earlier physical/QEMU evidence entry referenced the same output path with SHA-256 `038769af1a65954cf511c6b1a4f1b1b4f9845f289e934156fb6715de1d5f42ee`. The later canonical Dev Host contract and deterministic rebuild evidence at the selected legacy commit identify `428c9cd1...` as the approved current artifact. The older digest is retained only as historical evidence and is not selected for this prototype.

## Why the legacy initramfs is not copied

The legacy minimal manifest still contains architecture-specific assumptions that this clean-room intentionally removes, including storage discovery for both `ORDAX-PLATFORM` and `ORDAX-HOME`, old maintenance/storage-layout tooling, and other responsibilities tied to the previous physical design.

Copying the legacy archive would therefore silently import the old architecture even if the new GPT were changed to two partitions.

## Prototype decision

```text
DECISION=REIMPLEMENTED
COPY_LEGACY_ARCHIVE=NO
COPY_LEGACY_MANIFEST=NO
REUSE_PROVEN_INVARIANTS=SELECTIVE
```

Candidate invariants to preserve only after individual review:

- deterministic initramfs construction;
- minimal PID 1 / bootstrap supervision;
- bounded recovery path;
- required kernel module/firmware closure;
- minimal network bring-up;
- persistent Remote Core/SSH host identity handoff;
- fail-closed operator authorization;
- Git/release bootstrap path.

## New initramfs constraints

The prototype initramfs must understand only the new physical contract:

```text
ORDAX-ESP
ORDAX
```

It must not require or discover `ORDAX-HOME` as a physical partition.

It should contain only what is necessary to:

```text
boot
 -> discover/mount ORDAX safely
 -> establish minimal network/identity
 -> make recovery/remote control available
 -> reach or activate a verified release
```

High-level services belong in `releases/<commit>`, not in the fixed initramfs.

## Next implementation work

1. define a new prototype initramfs manifest from zero;
2. enumerate exact binaries/libraries/modules/firmware required;
3. implement deterministic archive generation;
4. add forbidden-path tests so desktop/apps/legacy layout owners cannot leak into the capsule;
5. boot it with the selected kernel in disposable media.
