# Release Bundle Contract

Status: CANONICAL TOOLING CONTRACT — RELEASE PUBLICATION NOT YET AUTHORIZED

OrdaX release acquisition v1 consumes exactly one signed artifact:

```text
system.tar
```

The archive materializes the normal post-bootstrap system under:

```text
/ordax/releases/<commit>/system/
```

The bootstrap activates that immutable release through `/ordax/current` only after the signed manifest, artifact hash, archive structure and materialized tree pass verification.

## Bundle source contract

The bundler receives a source root containing `system/` and emits a new `system.tar`.

Required:

- `system/` is a real directory with mode `0755`;
- `system/entrypoint` exists, is a non-empty regular file and has mode `0755`;
- directories are `0755`;
- regular files are `0644` or `0755`;
- symlinks, hardlinks, devices and other special file types are forbidden;
- the output archive cannot be created inside the source `system/` tree;
- existing output is never overwritten.

The release acquisition agent independently enforces the same runtime safety boundary when extracting the archive. The bundler does not replace device-side verification.

## Determinism

`tools/release-bundle` normalizes archive metadata so identical input bytes, paths and modes produce byte-identical output:

- lexical path order;
- uid/gid `0`;
- empty user/group names;
- timestamp fixed to Unix epoch;
- no host-specific ownership metadata;
- canonical modes preserved;
- USTAR archive format.

CI builds the tool for Linux and Windows and proves two independent bundle invocations are byte-identical.

## Release boundary

This tooling does not publish a GitHub Release and does not sign a release envelope by itself.

The intended pipeline is:

```text
canonical system source
 -> deterministic system.tar
 -> SHA-256 + size
 -> release-manifest.json tied to exact source commit
 -> external Ed25519 signing boundary
 -> release-envelope.json
 -> publication to canonical HTTPS release channel
 -> bootstrap verification and transactional activation
```

A production release must not be published until the canonical public Ed25519 trust anchor has an explicitly owned private key outside Git and the release-signing gate validates that the external private key matches that trust anchor.

## Current state

```text
RELEASE_BUNDLE_TOOLING_IMPLEMENTED=YES
DETERMINISTIC_SYSTEM_TAR_CONTRACT=YES
DEVICE_SIDE_SAFE_EXTRACTION_IMPLEMENTED=YES
CANONICAL_SYSTEM_RUNTIME_COMPLETE=NO
CANONICAL_RELEASE_TRUST_RESOLVED=NO
PRODUCTION_RELEASE_PUBLISHED=NO
PHYSICAL_WRITE_AUTHORIZED=NO
```

`system/` remains the single source for the shared OrdaX product, but its native runtime entrypoint is not yet production-complete. The presence of bundle tooling must not be interpreted as a completed OrdaX release.
