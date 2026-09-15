# Release Manifest Contract

Status: CANONICAL TOOLING CONTRACT — RELEASE SIGNING/PUBLICATION NOT YET AUTHORIZED

`tools/release-manifest` produces the exact unsigned manifest consumed by the release-signing boundary and release-acquisition agent.

For schema `prototype-ordax.release-manifest/1`, the manifest contains exactly one artifact:

```text
name=system.tar
role=system
```

The generator pins:

- source repository;
- exact lowercase 40-hex source commit;
- `release_id` equal to the source commit;
- CI recipe identity;
- canonical HTTPS artifact URL;
- SHA-256 of the exact `system.tar` bytes;
- exact artifact size.

## Fail-closed input policy

- the artifact must be a regular non-symlink file named `system.tar`;
- artifact size must be greater than zero and no larger than the release-agent bound;
- the artifact URL must be absolute HTTPS without credentials or fragment;
- source commit must be lowercase 40-hex;
- output is create-only and never overwritten;
- output parent paths may not traverse symlinks.

The tool does not sign the manifest and does not publish any release.

## Canonical pipeline

```text
system source
 -> deterministic system.tar
 -> release-manifest.json
 -> external Ed25519 signing boundary
 -> release-envelope.json
 -> canonical HTTPS release channel
 -> device verification
 -> transactional materialization
 -> atomic current activation
```

Each stage independently validates the input it owns. No stage may assume that success in a previous stage replaces its own checks.

## Current state

```text
RELEASE_MANIFEST_TOOLING_IMPLEMENTED=YES
SYSTEM_TAR_HASH_AND_SIZE_PINNED=YES
SOURCE_COMMIT_PINNED=YES
CANONICAL_RELEASE_TRUST_RESOLVED=NO
RELEASE_SIGNED=NO
PRODUCTION_RELEASE_PUBLISHED=NO
PHYSICAL_WRITE_AUTHORIZED=NO
```
