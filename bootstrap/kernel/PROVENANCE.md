# Kernel Provenance

Status: BASELINE SELECTED / BUILD NOT YET PORTED

## Legacy source of evidence

```text
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_COMMIT=f8ea8424f8cf52b516800f16f2331090ccb56748
LEGACY_ARTIFACT_PATH=out/forge/gate-inputs/vmlinuz-f3h
KERNEL_RELEASE=6.6.52
KNOWN_GOOD_BZIMAGE_SHA256=351941db619b7e93a4dc87010dbf39d3b8bf07262c73342381021385398a277d
OFFICIAL_SOURCE_ARCHIVE_SHA256=1591ab348399d4aa53121158525056a69c8cf0fe0e90935b0095e9a58e37b4b8
```

The legacy F3H proof builds from the official Linux 6.6.52 source archive, verifies the archive digest, starts from a fresh source tree, uses GCC 13, applies `defconfig` plus the project kernel fragment, clears embedded initramfs, runs `olddefconfig`, then builds `bzImage` and modules in an isolated workspace.

## Prototype decision

```text
DECISION=REIMPLEMENTED
REUSE_BINARY_AS_SOURCE=NO
REUSE_VERSION=YES
REUSE_OFFICIAL_SOURCE_DIGEST=YES
REUSE_KNOWN_GOOD_OUTPUT_DIGEST_AS_BASELINE=YES
```

The prototype will implement a smaller independent kernel build recipe from the same official Linux source identity instead of importing the legacy Forge subsystem.

The known-good bzImage digest is a baseline comparison value, not a requirement that the new build remain byte-identical forever. Any intentional kernel configuration change must produce a new recorded identity and pass the relevant boot/hardware gates.

## Required migration work

1. port only the kernel configuration requirements needed by the real notebook and bootstrap;
2. preserve the effective MediaTek/Wi-Fi closure that was already proven where the target hardware still needs it;
3. build in an isolated directory;
4. normalize/fingerprint module output;
5. record compiler/tool versions;
6. test bzImage structure and required modules;
7. boot the resulting kernel with the new prototype initramfs in disposable media.

## Not imported

- legacy Forge graph;
- legacy CAS implementation;
- legacy receipts/history;
- shared temporary build directories;
- pre-extracted kernel source trees.
