# OrdaX Release Signing

`tools/release-signing/` owns the small host-neutral utility used to create and verify the public/private boundary of the OrdaX release protocol.

It uses only the Go standard library and standard Ed25519/PKCS#8 primitives. It does not own release publication, device provisioning or physical-media authorization.

## Commands

```text
ordax-release-signing generate-key \
  --private-key <external-path>/ordax-release-private.pem \
  --trust <review-path>/release-ed25519.json \
  --key-id prototype-1

ordax-release-signing derive-trust \
  --private-key <external-path>/ordax-release-private.pem \
  --out <review-path>/release-ed25519.json \
  --key-id prototype-1

ordax-release-signing sign \
  --manifest release-manifest.json \
  --private-key <external-path>/ordax-release-private.pem \
  --key-id prototype-1 \
  --out release-envelope.json
```

## Private-key boundary

The private key:

- must be a regular non-symlink PKCS#8 Ed25519 PEM file;
- must be `0600` on Unix-like systems;
- is never printed by the CLI;
- is never copied into a trust file or envelope;
- is never accepted from the repository as canonical custody;
- must not be committed, uploaded as a build artifact, placed on the USB seed or shipped inside OrdaX Desktop.

All outputs use exclusive creation. Existing files are never silently replaced.

`generate-key` exists to support an explicit key ceremony on a trusted operator/signing host. Generating a key in CI, a disposable runner or an arbitrary developer temp directory does **not** make that key a canonical release key.

## Trust anchor

`derive-trust` emits only:

```json
{
  "$schema": "prototype-ordax.release-trust/1",
  "key_id": "prototype-1",
  "public_key_base64": "<32 raw Ed25519 public-key bytes in base64>"
}
```

The public trust anchor may enter `bootstrap/trust/release-ed25519.json` only after the matching private key has an explicit custody owner and recovery/rotation policy outside Git.

## Signing

Before signing, the tool validates the same critical release-manifest invariants consumed by the device agent:

- exact schema;
- expected source repository;
- lowercase 40-hex source commit;
- `release_id == source_commit`;
- bounded CI recipe identifier;
- 1..128 uniquely named artifacts;
- HTTPS artifact URLs;
- exact SHA-256 syntax and positive bounded size.

The signature is standard Ed25519 over the **exact manifest file bytes**. Whitespace is preserved in the signed payload. The output envelope uses the existing `prototype-ordax.release-envelope/1` protocol.

## CI policy

Repository CI may generate an ephemeral test key solely to prove the signing protocol and tooling. Such a key:

```text
CI_TEST_KEY=YES
CANONICAL_TRUST_ANCHOR=NO
PHYSICAL_BOOTSTRAP_TRUST=NO
PRIVATE_KEY_ARTIFACT_UPLOAD=NO
```

The production/canonical private key must come from a separate explicit custody decision.
