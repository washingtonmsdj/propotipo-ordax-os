# Build Autonomy

Status: CANONICAL FOR PROTOTYPE

## Goal

The OrdaX prototype must be buildable, testable and publishable from repository source without requiring Codex, WSL, QEMU, a developer workstation toolchain, or manual one-off build knowledge.

Codex may assist as an optional engineering partner. It is never a build owner, source authority, release authority, or prerequisite for producing OrdaX artifacts.

## Core contract

```text
CODEX_REQUIRED=NO
LOCAL_DEVELOPER_TOOLCHAIN_REQUIRED=NO
WSL_REQUIRED=NO
QEMU_REQUIRED=NO
MANUAL_KERNEL_BUILD_REQUIRED=NO
REPOSITORY_RECIPE_REQUIRED=YES
REPRODUCIBLE_CI_BUILD_REQUIRED=YES
ARTIFACT_PROVENANCE_REQUIRED=YES
ARTIFACT_SHA256_REQUIRED=YES
```

`main` owns the source and build recipes. CI is an execution environment, not a second source authority.

## Build chain

Target flow:

```text
source commit
 -> repository build recipe
 -> pinned build environment
 -> dependency/source hash verification
 -> build affected artifact
 -> tests/verification
 -> provenance manifest
 -> SHA-256
 -> immutable CI artifact/release candidate
```

A person or AI must not need to remember undocumented commands to reproduce an artifact.

## Kernel

The kernel is not a special manual exception.

The repository must contain or identify:

- exact kernel version;
- official source location/identity;
- expected source archive SHA-256;
- canonical OrdaX kernel config;
- canonical patch set, if any;
- pinned compiler/toolchain environment;
- deterministic build entrypoint;
- expected output names;
- module/firmware packaging rules;
- tests and boot evidence;
- generated provenance manifest.

The developer host does not compile the kernel as a prerequisite. A repository CI runner executes the canonical recipe in a pinned environment.

Initial selected baseline remains Linux 6.6.52 until an explicit architecture decision changes it.

## Pinned build environment

Build tooling must be represented declaratively and pinned strongly enough to avoid "works only on that machine" behavior.

Preferred model:

```text
repository source
 + pinned OCI/container build environment by immutable digest
 + pinned upstream source checksums
 + versioned build scripts/config
```

GitHub Actions is the current automation executor because this repository is hosted on GitHub. The architecture must not depend on GitHub Actions-specific behavior: the same build entrypoint should be runnable by another standards-compatible CI/container executor later.

Linux-based CI may be used to compile the Linux kernel. This is an implementation environment, not a requirement that the OrdaX developer own or configure a Linux/WSL workstation.

## Artifact classes

The repository build graph should eventually produce independently:

```text
kernel
initramfs
minimal bootstrap payload
shared Surface/Web bundle
native system release
OrdaX Creator executables
release/provisioning manifests
```

An ordinary Surface/application change must not rebuild the kernel.

A kernel/config change may rebuild the kernel and the dependent bootstrap package, but should not require rebuilding unrelated product artifacts.

## Release provenance

Every boot-critical generated artifact must have machine-readable provenance containing at least:

```text
source_commit
recipe_version_or_path
upstream_source_identity
upstream_source_sha256
toolchain_identity
build_environment_identity
artifact_sha256
build_timestamp_or_reproducible_epoch
```

Where reproducible byte-for-byte builds are practical, they are preferred and should be tested. Where they are not yet byte-reproducible, provenance and integrity must still be explicit.

## ChatGPT / AI operating model

Any capable repository agent should be able to:

```text
read canonical docs
 -> edit source/config/build recipes
 -> commit/push main
 -> observe CI
 -> inspect failures
 -> correct source
 -> validate produced artifacts and hashes
```

No step in this loop may require Codex specifically.

Codex can still be useful for optional parallel review, hardware-local investigation, or a second opinion. Results from Codex become evidence only after they are represented or verified through canonical repository contracts.

## Physical boundary

Repository/CI autonomy does not mean a cloud agent can physically press keys, change firmware settings, or write a USB attached to a user's computer without an authorized device-side/host-side tool.

Physical operations are performed through OrdaX Creator or another explicitly authorized local mechanism. The Creator consumes signed/hashed artifacts generated from repository source; it does not invent or compile them locally for the end user.

Therefore:

```text
SOURCE_AND_BUILD_AUTONOMY=YES
CODEX_DEPENDENCY=NO
USER_LOCAL_BUILD_DEPENDENCY=NO
PHYSICAL_DEVICE_ACTION_STILL_REQUIRES_AUTHORIZED_LOCAL_EXECUTION=YES
```

## Failure rule

If CI is unavailable, source must remain reproducible from the versioned build recipe in another compatible container executor. CI availability must not redefine source truth.
