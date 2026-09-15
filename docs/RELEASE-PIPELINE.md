# Release Pipeline Contract

Status: CI PROOF ONLY — NOT A PRODUCTION RELEASE OR PHYSICAL AUTHORIZATION

The release pipeline is intentionally split into small owners with independent validation:

```text
system source
 -> tools/release-bundle
 -> system.tar
 -> tools/release-manifest
 -> release-manifest.json
 -> tools/release-signing + explicit trust input
 -> release-envelope.json
 -> bootstrap/release-acquisition
 -> verified transactional materialization
 -> atomic current activation
```

## CI integration proof

`.github/workflows/release-pipeline.yml` composes the real tools against an isolated temporary system fixture. It proves:

```text
SOURCE_TO_BUNDLE=PASS
BUNDLE_TO_MANIFEST=PASS
MANIFEST_TO_SIGNED_ENVELOPE=PASS
SIGNED_ENVELOPE_TO_AGENT=PASS
```

The workflow uses a CI-only ephemeral Ed25519 key. The private key exists only under the runner temporary directory, is removed before completion and is never uploaded.

The proof deliberately does **not**:

- create or rotate the canonical release key;
- satisfy `bootstrap-release-trust`;
- publish a GitHub Release;
- move the canonical `latest` release pointer;
- authorize Creator APPLY;
- write or repartition physical media.

## Production boundary

Production release publication remains blocked until all of these are true:

```text
CANONICAL_SYSTEM_RUNTIME_COMPLETE=YES
CANONICAL_RELEASE_TRUST_RESOLVED=YES
SIGNER_PRIVATE_TRUST_MATCH=PASS
RELEASE_ARTIFACT_IDENTITY=PASS
RELEASE_ENVELOPE_VERIFY=PASS
PUBLICATION_POLICY=PASS
```

The temporary CI system fixture is only a protocol fixture. It is not the OrdaX product runtime and must never be promoted as a user release.
