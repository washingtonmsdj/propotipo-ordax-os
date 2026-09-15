# OrdaX Release Signing

`tools/release-signing/` owns the host-neutral utility for the public/private boundary of the OrdaX release protocol.

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
  --trust <canonical-public-path>/release-ed25519.json \
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

The `sign` command requires the public trust anchor as an explicit input. Before producing an envelope it derives the public key from the supplied private key and requires all of the following to match:

```text
PRIVATE_KEY_PUBLIC_COMPONENT == TRUST_PUBLIC_KEY
SIGNING_KEY_ID == TRUST_KEY_ID
TRUST_SCHEMA == prototype-ordax.release-trust/1
```

A mismatch fails before output creation. This prevents an operator or CI job from producing an apparently valid envelope with a private key that the bootstrapped device can never trust.

## Signing

Before signing, the tool validates the same v1 release-manifest shape consumed by the device agent:

- exact schema;
- expected source repository;
- lowercase 40-hex source commit;
- `release_id == source_commit`;
- bounded CI recipe identifier;
- exactly one artifact;
- artifact name exactly `system.tar`;
- artifact role exactly `system`;
- HTTPS artifact URL;
- exact SHA-256 syntax and positive bounded size.

The signature is standard Ed25519 over the **exact manifest file bytes**. Whitespace is preserved in the signed payload. The output envelope uses `prototype-ordax.release-envelope/1`.

## CI policy

Repository CI may generate an ephemeral test key solely to prove the signing protocol and tooling. CI also proves that the signer refuses private/trust mismatches and that the resulting envelope is accepted by the real release-acquisition agent.

Such a key remains strictly test scoped:

```text
CI_TEST_KEY=YES
CANONICAL_TRUST_ANCHOR=NO
PHYSICAL_BOOTSTRAP_TRUST=NO
PRIVATE_KEY_ARTIFACT_UPLOAD=NO
```

The production/canonical private key must come from a separate explicit custody decision.
