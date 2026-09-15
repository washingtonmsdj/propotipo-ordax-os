# Release Channel

Status: CANONICAL FOR PROTOTYPE

## Goal

`main` remains the source authority, but an OrdaX device must not need a compiler, source checkout, Codex, or even a full Git client in the pre-release bootstrap.

The repository CI materializes an immutable release from an exact source commit and publishes a small machine-readable manifest plus verified artifacts. The device consumes that release over standard HTTPS.

## Source vs delivery

```text
GitHub main                     device
    |                              |
    | source authority             | no source build
    v                              |
CI build graph                     |
    |                              |
    +-> kernel                     |
    +-> initramfs/bootstrap        |
    +-> system/native release      |
    +-> Surface/Web                |
    +-> Creator                    |
    |                              |
    v                              |
release manifest + artifacts ------+
                HTTPS + verification
```

Git owns *what* OrdaX is. The release channel owns only the immutable materialization of a specific Git commit.

## Why this matters

The first USB can be smaller:

```text
UEFI
 -> kernel/initramfs
 -> minimal network
 -> HTTPS release resolver
 -> public trust anchor
 -> verified release
 -> current
```

A full `git` executable and complete repository checkout are not mandatory before the first system release.

## Release identity

Every release is bound to one exact source commit.

Minimum manifest identity:

```text
schema
source_repository
source_commit
release_id
created_from_ci_recipe
artifacts[]
  name
  role
  url
  sha256
  size
integrity/authenticity metadata
```

Release artifacts are immutable once published as verified. Rebuilding the same release identity with different bytes is forbidden; a changed artifact requires a new source/release identity.

## Security

- HTTPS transport is required, but transport alone is not enough.
- Every downloaded artifact is verified against the release manifest before activation.
- The manifest itself must have an authenticity mechanism before production promotion; the exact signing implementation is still pending architecture work.
- No custom cryptographic algorithms.
- Trust failure is fail-closed.
- A bad/unavailable new release never destroys the current known-good release.

## Publication target

For the prototype, GitHub is the natural current host for source and generated release assets.

GitHub Releases or another immutable artifact endpoint may be used by the CI publisher. This is a delivery implementation, not source authority. The manifest format and device resolver must remain portable enough to move to another CDN/artifact host later.

## Development semantics

A normal change becomes:

```text
edit source
 -> test
 -> push main
 -> CI builds only affected deliverables
 -> release manifest points to exact commit/artifacts
 -> Web deploy consumes same source commit
 -> device updater sees newer eligible release
 -> downloads delta/artifact
 -> verifies
 -> activates atomically
```

The device never recompiles the kernel because a source commit changed. Kernel compilation belongs to repository CI.

## Offline behavior

Once a verified release is active:

```text
network unavailable -> boot current known-good release
release channel unavailable -> boot current known-good release
new release invalid -> reject it, retain current
```

Network is an update dependency, not a normal boot dependency after first successful provisioning.

## Codex independence

Codex is not part of release publication or consumption.

```text
CODEX_REQUIRED_FOR_BUILD=NO
CODEX_REQUIRED_FOR_PUBLICATION=NO
CODEX_REQUIRED_FOR_DEVICE_UPDATE=NO
```

Any repository-capable agent can modify source and diagnose CI. The device uses the release protocol, not an AI-specific channel.
