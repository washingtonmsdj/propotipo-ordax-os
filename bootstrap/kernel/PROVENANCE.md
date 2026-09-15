# Kernel Provenance

Status: CLEAN-ROOM BUILD ENTRYPOINT IMPLEMENTED / PINNED BUILD ENVIRONMENT PENDING

## Canonical prototype source

Machine-readable source identity:

`bootstrap/kernel/source.json`

```text
KERNEL_RELEASE=6.6.52
OFFICIAL_ARCHIVE=https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.6.52.tar.xz
OFFICIAL_SOURCE_ARCHIVE_SHA256=1591ab348399d4aa53121158525056a69c8cf0fe0e90935b0095e9a58e37b4b8
BASE_CONFIG=defconfig
ORDAX_FRAGMENT=bootstrap/kernel/config/ordax.fragment
BUILD_ENTRYPOINT=bootstrap/kernel/build.py
```

The official 6.6.52 archive remains available from kernel.org. The repository build entrypoint downloads it when needed, verifies the pinned SHA-256 before extraction, builds only from a fresh isolated source tree, and never trusts a pre-extracted developer-machine kernel tree.

## Legacy source of evidence

```text
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_REFERENCE_COMMIT=49fe41fa67d9032f2e349e86592304e64d6c2d88
LEGACY_ARTIFACT_PATH=out/forge/gate-inputs/vmlinuz-f3h
KNOWN_GOOD_BZIMAGE_SHA256=351941db619b7e93a4dc87010dbf39d3b8bf07262c73342381021385398a277d
```

The legacy proof established a useful invariant only: Linux 6.6.52 + GCC 13 + `defconfig` + the reviewed kernel fragment can produce the known hardware/Wi-Fi baseline.

The clean-room does not import the Forge graph, cache, receipts, build directories, QEMU ownership or physical-deployment logic.

## Clean fragment

Canonical fragment:

`bootstrap/kernel/config/ordax.fragment`

It was selectively reimplemented from the proven selectors and cleaned of legacy partition/milestone/Forge references.

The MediaTek closure is intentionally:

```text
CONFIG_WLAN_VENDOR_MEDIATEK=y
CONFIG_MT76x2U=m
```

Do not reintroduce `CONFIG_MT76=m`; Linux 6.6.52 does not expose that historical spelling as the configurable selector needed here.

## Repository-owned build

```text
python bootstrap/kernel/build.py check
python bootstrap/kernel/build.py build
```

`check` is network-free and validates source/config contracts.

`build`:

1. resolves GCC 13 and required build tools;
2. downloads the official source archive if absent;
3. verifies the exact SHA-256;
4. safely extracts a fresh source tree;
5. runs `defconfig`;
6. merges the canonical fragment;
7. runs `olddefconfig` and rejects selectors Kconfig did not honor;
8. builds `bzImage` and modules;
9. installs modules into an isolated staging root;
10. requires the baseline Wi-Fi module family;
11. creates a normalized module USTAR;
12. emits final config, artifact hashes and `kernel-provenance.json`.

No Codex execution is involved.

## CI

`.github/workflows/kernel-candidate.yml` runs the build directly from repository source.

The current workflow uses an Ubuntu 24.04 GitHub runner and measured GCC 13 packages. This is enough for autonomous candidate builds, but is **not yet the final promotion environment** because its full container/toolchain identity has not been pinned to an immutable digest.

Therefore current CI kernel output is intentionally labeled:

```text
status=candidate-unpinned-build-environment
promotable_to_physical=false
```

A future source change will pin the immutable build environment, repeat the build, compare provenance and then allow the build-autonomy promotion gate to close.

## Creator payload handoff

A successful kernel CI candidate is an input to the deterministic Creator payload, not a direct physical-media source path.

```text
kernel CI candidate
 -> candidate SHA-256 + provenance
 -> exact bzImage copied into Creator payload
 -> bundle-relative source_path pinned in media manifest
 -> Creator Core re-hashes local payload bytes
 -> disposable two-partition boot proof
 -> later explicit destructive authorization
```

Workflow artifact IDs, runner paths and `out/` paths are provenance only. They must never appear as runtime `source_path` values in the canonical physical media contract.

The payload assembler must preserve the exact candidate bytes. Rebuilding the kernel implicitly while assembling the payload is forbidden; rebuilds belong to the kernel candidate pipeline and must produce new provenance.

## Prototype decision

```text
DECISION=REIMPLEMENTED
REUSE_BINARY_AS_SOURCE=NO
REUSE_VERSION=YES
REUSE_OFFICIAL_SOURCE_DIGEST=YES
REUSE_KNOWN_GOOD_OUTPUT_DIGEST_AS_BASELINE=YES
CODEX_REQUIRED=NO
LOCAL_DEVELOPER_KERNEL_TOOLCHAIN_REQUIRED=NO
```

The known-good legacy bzImage digest is a comparison baseline, not a permanent byte-identity requirement. Intentional config/toolchain changes may produce a new digest, but they must remain explicit and pass boot/hardware gates.

## Remaining gates

1. current clean-room CI kernel candidate succeeds and publishes provenance;
2. inspect resolved `.config` and module closure;
3. pin the build environment/toolchain by immutable identity;
4. reproduce the build under that pinned environment;
5. integrate the resulting kernel with the new minimal initramfs;
6. prove boot in disposable media;
7. only later authorize physical media use.
