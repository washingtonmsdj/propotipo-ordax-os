# Kernel Provenance

Status: CLEAN-ROOM BUILD ENTRYPOINT IMPLEMENTED / PINNED REPEAT PROOF COMPLETE

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
PINNED_ENVIRONMENT_RESOLVED=YES
PHYSICAL_ARTIFACT_AUTHORIZED=NO
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

## Immutable build environment

The canonical environment contract is `docs/contracts/kernel-build-environment.json`.

```text
STATUS=pinned-repeat-proof-complete
ARCHITECTURE=linux/amd64
BASE_IMAGE=docker.io/library/ubuntu:24.04
BASE_IMAGE_MANIFEST_DIGEST=sha256:a61567bd31828687156d735ea8eb01ba4e37636e225dd6a48ba94136a70d9d61
APT_SNAPSHOT=20260910T000000Z
EXACT_APT_PACKAGE_VERSIONS=17
CA_BUNDLE_SHA256=9481fcd95f41b221f02f14d896535fe500bec539bc563c4cdca1acee483a8bdd
```

The image tag is informational only; the manifest digest is the immutable image identity. The build environment verifier requires exact architecture, snapshot, package set, package versions and CA-bundle digest before the build is accepted.

## Repeat proof

The first measured observation and the independent repeat build produced identical output digests:

```text
FIRST_OBSERVATION_SOURCE_COMMIT=6537ddc1a6947de6257f3111ca7ffad3ee9d574d
REPEAT_PROOF_SOURCE_COMMIT=01a10ab7abb9c6f5985e4c4c6a807802b14b0f8d
REPEAT_PROOF_WORKFLOW_RUN_ID=34982193218
REPEAT_PROOF_RESULT=PASS
KERNEL_CONFIG_SHA256=c83a86c2bf87a6f052c8485cfbdc36a1f904216cdc79b542205e3010d3392841
KERNEL_MODULES_SHA256=0056f8bd6a1ea02b9aa0b0f35a30adc27060888b6ae6124804e96b6740de72f2
VMLINUX_SHA256=e080323be390b2e921ed34286794cbce18642b653fc6790ae308f61720c90ba1
```

Therefore the pinned build environment is no longer a blocker. The environment contract may mark the reproducible build output as promotable to the physical-media pipeline, but that is not the same as authorizing a physical artifact. `bootstrap/kernel/source.json` intentionally keeps `physical_artifact_authorized=false` until the independent physical-media gates are closed.

## CI

`.github/workflows/kernel-candidate.yml` runs the build directly from repository source. Repository-owned verifiers enforce the immutable environment contract and repeat-proof expectations rather than relying on workflow YAML alone.

Current semantic split:

```text
PINNED_BUILD_ENVIRONMENT=PASS
REPEAT_BUILD_DIGEST_MATCH=PASS
BUILD_OUTPUT_ELIGIBLE_FOR_PHYSICAL_PIPELINE=YES
PHYSICAL_KERNEL_AUTHORIZED=NO
```

This distinction is mandatory: reproducibility proves what bytes are built; it does not grant permission to mutate a physical USB device.

## Creator payload handoff

A successful kernel CI output is an input to the deterministic Creator payload, not a direct physical-media source path.

```text
kernel CI output
 -> SHA-256 + provenance
 -> exact bzImage copied into Creator payload
 -> bundle-relative source_path pinned in media manifest
 -> Creator Core re-hashes local payload bytes
 -> disposable two-partition boot proof
 -> later explicit destructive authorization
```

Workflow artifact IDs, runner paths and `out/` paths are provenance only. They must never appear as runtime `source_path` values in the canonical physical media contract.

The payload assembler must preserve the exact proven bytes. Rebuilding the kernel implicitly while assembling the payload is forbidden; rebuilds belong to the kernel candidate pipeline and must produce new provenance.

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

1. resolve canonical Ed25519 release trust through the local key ceremony and pin only the public trust anchor;
2. rerun the byte-complete bootstrap media proof using canonical public trust;
3. keep `physical_artifact_authorized=false` until the physical-media owner explicitly promotes the exact artifact set;
4. finish the native Windows raw-disk backend behind the already tested internal fail-closed orchestration;
5. require explicit destructive authorization immediately before any future physical write;
6. prove physical notebook boot, first release acquisition, known-good offline boot and recovery.
