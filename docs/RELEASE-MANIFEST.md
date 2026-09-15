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

## Versioning and evolution

`release-manifest/1` is intentionally small and its semantics are immutable. It means one complete `system.tar` addressed by the exact source commit. Existing v1 consumers must never discover that the same schema silently acquired a different meaning.

Future features extend the protocol through new schema versions rather than by weakening v1:

- delta updates require a new manifest schema;
- multiple release artifacts require a new manifest schema;
- new required fields require a new manifest schema;
- consumers explicitly opt into schemas they understand and fail closed on an unknown required schema;
- old and new schemas may coexist during an explicit migration window;
- while delta delivery is optional, a verified full-release fallback remains available;
- release trust rotation uses its own explicit versioned transition protocol rather than silently replacing the meaning of the current trust anchor.

The machine-readable authority for these compatibility rules is `docs/contracts/release-protocol.json`.

This policy intentionally avoids a large internal framework before a second protocol version exists. The current generator, signer and acquisition agent remain independent fail-closed owners, while CI prevents their shared v1 assumptions from drifting. When a real v2 requirement appears, shared protocol code can be extracted incrementally behind the versioned contract instead of through a risky big-bang rewrite.

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
RELEASE_PROTOCOL_VERSIONING_CONTRACT=YES
RELEASE_MANIFEST_V1_SEMANTICS_IMMUTABLE=YES
DELTA_REQUIRES_NEW_MANIFEST_SCHEMA=YES
MULTI_ARTIFACT_REQUIRES_NEW_MANIFEST_SCHEMA=YES
CANONICAL_RELEASE_TRUST_RESOLVED=NO
RELEASE_SIGNED=NO
PRODUCTION_RELEASE_PUBLISHED=NO
PHYSICAL_WRITE_AUTHORIZED=NO
```
