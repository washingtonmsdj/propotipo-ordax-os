# Canonical Release Trust Ceremony

Status: POLICY RESOLVED — KEY MATERIAL NOT YET GENERATED

This ceremony exists so the first physical OrdaX prototype can be created without Codex, without committing a private key, and without inventing a CI-only trust anchor.

The repository owns the protocol and policy. The developer owns the private release-signing key. Only the matching public Ed25519 trust anchor may enter Git and the boot payload.

## Boundary

```text
Windows developer machine
 -> ordax-release-signing.exe generate-key
 -> private PKCS#8 Ed25519 key: stays outside repository
 -> public release-ed25519.json: eligible for source pinning
 -> offline encrypted private-key backup
 -> only then resolve bootstrap-release-trust
```

The canonical key id for the first physical prototype is:

```text
ordax-prototype-release-v1
```

The public anchor target is:

```text
repository: bootstrap/trust/release-ed25519.json
runtime:    /ordax/bootstrap/trust/release-ed25519.json
```

## Required local ceremony

The actual key generation is a local user action and must not be performed in CI, a chat session or a disposable runner. The Windows signer candidate already supports the required operation.

A future OrdaX Desktop flow will wrap the same operation. The underlying ceremony is equivalent to:

```text
ordax-release-signing.exe generate-key \
  --private-key <private-path-outside-repository> \
  --trust <temporary-public-trust-path> \
  --key-id ordax-prototype-release-v1
```

Before the public anchor is pinned:

1. the private key must be stored outside the repository in user-private storage;
2. at least one encrypted offline recovery copy must exist;
3. the public trust document must be checked against the private key with the signer tooling;
4. the private key must not be copied into Git, the bootstrap USB, Actions artifacts, logs or chat;
5. only the public `release-ed25519.json` may be committed;
6. `docs/contracts/minimal-bootstrap.json` must then pin that public file by exact SHA-256;
7. `all_artifacts_resolved` must remain false until the public bytes and digest are real;
8. physical write remains disabled until every independent gate passes.

## CI signing

An encrypted GitHub Actions secret may hold an online signing copy only after the user explicitly configures it. The secret is an execution input, not source authority. The repository must never contain the private key or a base64 copy of it.

No workflow may silently generate a new canonical key when the configured signing key is missing. Missing signing material is a hard publication failure.

## Recovery

For the prototype, key loss is intentionally fail-closed.

Before any physical distribution, losing the private key means generating a new key and repinning the public anchor before the first write. After prototype media has been provisioned, loss of the key requires reprovisioning that prototype media with a new trust anchor.

This is acceptable for the first notebook proof because the device population is intentionally tiny and controlled.

## Rotation

Silent public-key replacement is forbidden.

Until a signed trust-transition protocol is implemented, prototype key rotation requires reprovisioning. Production rotation will require the currently trusted key to authorize the successor key before the old key is retired.

Therefore:

```text
TRUST_POLICY_RESOLVED=YES
CANONICAL_KEY_MATERIAL_GENERATED=NO
PUBLIC_ANCHOR_PINNED=NO
BOOTSTRAP_RELEASE_TRUST_RESOLVED=NO
PHYSICAL_WRITE_ALLOWED=NO
```

The machine-readable owner is `docs/contracts/release-trust-policy.json`.
