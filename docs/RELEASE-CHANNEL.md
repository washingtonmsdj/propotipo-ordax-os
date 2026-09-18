# Release Channel

Status: CANONICAL FOR PROTOTYPE

## Goal

`main` remains source authority, while an OrdaX device consumes prebuilt immutable releases without needing a compiler, source checkout, Codex or a full Git client in the pre-release bootstrap.

Repository CI owns build/sign/publication. The device consumes a compact signed release envelope and immutable artifacts over HTTPS.

## Source vs delivery

```text
GitHub main
 -> CI build graph
 -> exact source commit
 -> immutable release artifacts
 -> signed release envelope
 -> HTTPS publication
 -> OrdaX release acquisition agent
 -> signature/hash verification
 -> /ordax/releases/<commit>
 -> /ordax/current
```

Git owns what OrdaX is. Delivery only selects bytes for a particular source commit.

## Canonical bootstrap selector

The prototype seed now pins this source-controlled channel file:

```text
bootstrap/config/release-envelope-url
```

with exactly:

```text
https://github.com/washingtonmsdj/prototipo-ordax-os/releases/latest/download/release-envelope.json
```

GitHub documents `/releases/latest/download/<asset>` as a direct download form for an asset on the latest Release. The `latest` pointer is intentionally mutable as a **selector**, while the release identity and authenticated payload remain immutable after verification.

Runtime path:

```text
/ordax/bootstrap/config/release-envelope-url
```

The exact file bytes are SHA-256 bound in `docs/contracts/minimal-bootstrap.json`.

## Security model

HTTPS is mandatory transport but not the authenticity authority.

The device must carry a local Ed25519 public trust anchor at:

```text
/ordax/bootstrap/trust/release-ed25519.json
```

Expected schema:

```json
{
  "$schema": "prototype-ordax.release-trust/1",
  "key_id": "prototype-1",
  "public_key_base64": "<32-byte Ed25519 public key>"
}
```

The corresponding private key must never be committed to Git, embedded in Creator/USB media, bundled in Desktop, or published as an artifact.

Current state:

```text
RELEASE_CHANNEL=RESOLVED
RELEASE_TRUST=UNRESOLVED
PRIVATE_SIGNING_KEY_CUSTODY=NOT_YET_ESTABLISHED
PHYSICAL_WRITE_ALLOWED=NO
```

No placeholder key may satisfy the trust gate.

## Signed envelope

The release endpoint serves:

```json
{
  "$schema": "prototype-ordax.release-envelope/1",
  "payload": "<base64 exact manifest bytes>",
  "signature": "<base64 Ed25519 signature over exact payload bytes>",
  "key_id": "prototype-1"
}
```

The signature is over the decoded payload bytes exactly as carried. No custom canonical-JSON signing algorithm is used.

## Signed manifest

Decoded payload schema:

```json
{
  "$schema": "prototype-ordax.release-manifest/1",
  "source_repository": "washingtonmsdj/prototipo-ordax-os",
  "source_commit": "<lowercase 40-hex>",
  "release_id": "<same source commit>",
  "created_from_ci_recipe": "release/native/1",
  "artifacts": [
    {
      "name": "system.tar",
      "role": "system",
      "url": "https://...",
      "sha256": "<lowercase 64-hex>",
      "size": 123
    }
  ]
}
```

The release agent rejects unknown fields, unsafe names, non-HTTPS artifact URLs, malformed commits/hashes, duplicate artifact names, repository mismatch, key-id mismatch, signature failure, size mismatch and SHA-256 mismatch.

## Release identity

Each prototype release is tied to exactly one lowercase 40-hex source commit and uses that commit as both `release_id` and directory identity:

```text
/ordax/releases/<source_commit>
```

Reusing the same release identity for different bytes is forbidden.

## Transactional materialization

```text
fetch signed envelope
 -> verify signature + manifest policy
 -> create /ordax/releases/.staging-<commit>-*
 -> download artifacts
 -> verify exact size + SHA-256
 -> fsync files/staging
 -> store exact signed manifest payload
 -> rename staging -> releases/<commit>
 -> fsync releases
 -> stop here for A/B materialize mode
 -> atomically replace current symlink only for install mode
 -> fsync /ordax
```

`current` changes only after every candidate byte has passed authentication and integrity checks, and only when the caller explicitly uses the bootstrap `install` mode.

The A/B base-update owner uses `materialize --expected-commit <checkout>`. That mode requires the signed source commit to match the running checkout exactly and ends after immutable release materialization; it must not change `/ordax/current`. An existing release may be reused only when its stored manifest, artifact and extracted tree still match; divergence fails closed.

## Failure/offline behavior

```text
network unavailable before first release -> recovery
release endpoint unavailable before first release -> recovery
signature invalid -> reject candidate + recovery/current preserved
artifact invalid -> reject candidate + recovery/current preserved
known-good current exists -> boot it without requiring network
```

After the first verified release, network is an update dependency rather than a normal boot dependency.

## Publication target

GitHub Releases is the current prototype host. The protocol remains host-neutral because signed manifests carry ordinary HTTPS artifact URLs.

The next source-side step is to implement repository-owned signing/publication that:

- reads private signing material only from an external CI secret or similarly protected signer;
- derives/validates the corresponding public key identity;
- signs exact manifest bytes with standard Ed25519;
- publishes immutable assets for the exact source commit;
- publishes `release-envelope.json` under the GitHub Release;
- refuses publication when provenance, hashes, source commit or signing material are incomplete.

Publication must not be enabled by committing a private key.

## Product modes

```text
Web       -> deployment refresh from shared source commit
Desktop   -> signed desktop application update
USB       -> signed OrdaX release acquisition/activation
Native    -> signed OrdaX release acquisition/activation
```

The Desktop application updater is a separate trust/update concern and must not silently mutate removable media.

## Codex independence

```text
CODEX_REQUIRED_FOR_BUILD=NO
CODEX_REQUIRED_FOR_PUBLICATION=NO
CODEX_REQUIRED_FOR_DEVICE_UPDATE=NO
```

A running device consumes the release protocol, not an AI-specific transport.

## Promotion boundary

The acquisition agent, channel and generated artifacts remain candidates until signed publication, disposable acquisition/activation, virtual/physical boot, rollback and offline-known-good gates pass.

```text
PHYSICAL_ARTIFACT_AUTHORIZED=NO
```
