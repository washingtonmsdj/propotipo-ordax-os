# Canonical Release Trust Ceremony

Status: POLICY RESOLVED — KEY MATERIAL NOT YET GENERATED

This ceremony exists so the first physical OrdaX prototype can be created without Codex, without committing a private key, and without inventing a CI-only trust anchor.

The repository owns the protocol and policy. The developer owns the canonical private release-signing key. Only the matching public Ed25519 trust anchor may enter Git and the boot payload.

The machine-readable authority for this policy is `docs/contracts/release-trust-policy.json`. If prose and contract diverge, the contract wins.

## Boundary

```text
Windows developer machine
 -> ordax-release-signing.exe generate-key
 -> private PKCS#8 Ed25519 key: stays outside repository
 -> public release-ed25519.json: eligible for source pinning
 -> encrypted offline recovery copy
 -> independent public derivation + signing proof
 -> only then resolve bootstrap-release-trust
```

The first physical prototype uses the fixed key id:

```text
ordax-prototype-release-v1
```

The public anchor target is:

```text
repository: bootstrap/trust/release-ed25519.json
runtime:    /ordax/bootstrap/trust/release-ed25519.json
```

## Required local ceremony

The actual canonical key generation is a local user action and must not be performed in CI, a chat session or a disposable runner. The signer under `tools/release-signing/` already supports the required operation and uses only standard Ed25519/PKCS#8 primitives from the Go standard library.

Build the signer from the exact reviewed source commit, then generate into a private path outside the repository and a separate temporary public-review path:

```text
ordax-release-signing.exe generate-key \
  --private-key <private-path-outside-repository>\ordax-release-private.pem \
  --trust <temporary-public-review-path>\release-ed25519.json \
  --key-id ordax-prototype-release-v1
```

The command must report:

```text
KEY_GENERATED=YES
KEY_ID=ordax-prototype-release-v1
PUBLIC_KEY_SHA256=<64 lowercase hex>
PRIVATE_KEY_PRINTED=NO
```

Before the public anchor is eligible to be pinned:

1. the private key is stored outside the repository in user-private storage;
2. at least one encrypted offline recovery copy exists;
3. the public trust document is independently derived again from the same private key;
4. both public derivations are byte-identical and report the same public-key fingerprint;
5. a real-shaped proof manifest is signed with the private key while supplying the candidate public trust file explicitly;
6. the signer reports `TRUST_MATCH=YES` and refuses mismatched private/public material;
7. the private key is absent from Git, USB bootstrap, Actions artifacts, logs and chat;
8. only the reviewed public `release-ed25519.json` is committed;
9. `docs/contracts/minimal-bootstrap.json` pins that exact public file by SHA-256;
10. `all_artifacts_resolved` remains false until those public bytes and digest are real;
11. physical write remains disabled until every independent gate passes.

## Independent public derivation

Derive a second public file into a different empty review path:

```text
ordax-release-signing.exe derive-trust \
  --private-key <private-path-outside-repository>\ordax-release-private.pem \
  --out <second-public-review-path>\release-ed25519.json \
  --key-id ordax-prototype-release-v1
```

Require:

```text
FIRST_PUBLIC_FILE == SECOND_PUBLIC_FILE
FIRST_PUBLIC_FINGERPRINT == SECOND_PUBLIC_FINGERPRINT
TRUST_SCHEMA == prototype-ordax.release-trust/1
TRUST_KEY_ID == ordax-prototype-release-v1
PUBLIC_KEY_IS_32_BYTE_ED25519=YES
```

Do not hand-edit public key bytes to fix a mismatch. Any mismatch aborts the ceremony.

## Private/public signing proof

Use a non-production proof manifest that satisfies `prototype-ordax.release-manifest/1` and contains exactly one `system.tar` artifact. Then run:

```text
ordax-release-signing.exe sign \
  --manifest <proof-path>\release-manifest.json \
  --private-key <private-path-outside-repository>\ordax-release-private.pem \
  --trust <temporary-public-review-path>\release-ed25519.json \
  --key-id ordax-prototype-release-v1 \
  --out <proof-path>\release-envelope.json
```

Require:

```text
RELEASE_ENVELOPE_SIGNED=YES
KEY_ID=ordax-prototype-release-v1
TRUST_MATCH=YES
PRIVATE_KEY_PRINTED=NO
```

The repository tests must continue proving both sides: a valid signer envelope is accepted by the release-acquisition protocol, while private/trust mismatch fails closed.

## Offline recovery verification

After the encrypted offline backup exists, restore one copy to a **different temporary private path** outside the repository/toolkit. Do not point the recovery proof at the primary custodial PEM.

The Windows toolkit provides:

```text
3-Verify-OrdaXTrustRecovery.cmd
```

It calls `Complete-OrdaXReleaseTrust.ps1`, which fails closed unless all of these are true:

1. the primary private key and recovered private key are distinct local files outside the toolkit;
2. the initializer's `ceremony-result.json` is still in the expected pre-promotion state;
3. canonical trust, primary independent derivation and recovered derivation are byte-identical;
4. the recovered key successfully signs the protocol-shaped proof manifest while using the canonical public trust file;
5. the public trust document contains a 32-byte Ed25519 key and the fixed canonical key id;
6. no private-key bytes or private-key hashes enter the public evidence.

On success it emits:

```text
OFFLINE_RECOVERY_VERIFIED=YES
PRIMARY_PUBLIC_DERIVATION_MATCH=YES
RECOVERED_PUBLIC_DERIVATION_MATCH=YES
RECOVERED_PRIVATE_PATH_DISTINCT=YES
RECOVERED_SIGNING_PROOF=YES
PRIVATE_KEY_PRINTED=NO
PRIVATE_KEY_COPIED_TO_PUBLIC_PROMOTION=NO
READY_TO_PIN_PUBLIC_ANCHOR=YES
```

The `trust-review/public-promotion/` directory contains only public material:

```text
release-ed25519.json
ceremony-public-evidence.json
```

The restored private PEM should be removed from the temporary recovery location after verification according to the operator's backup procedure. The repository does not prescribe the backup encryption product or password handling; it proves that the recovered material is cryptographically the same release identity.

## Public-anchor promotion

Only after custody, recovery, derivation and signing proof pass may the reviewed public JSON be copied to:

```text
bootstrap/trust/release-ed25519.json
```

Before commit, verify:

```text
PUBLIC_FILE_ONLY=YES
PRIVATE_KEY_STAGED=NO
PRIVATE_KEY_CONTENT_SEARCH=NO_MATCH
KEY_ID_REVIEWED=YES
PUBLIC_KEY_FINGERPRINT_REVIEWED=YES
```

Then bind the exact public-anchor SHA-256 into `docs/contracts/minimal-bootstrap.json`, update the trust-policy gates, and run the full bootstrap/release verification suite.

## CI signing

An encrypted GitHub Actions secret may hold an online signing copy only after the user explicitly configures it. The secret is an execution input, not source authority and not canonical custody.

No workflow may silently generate a new canonical key when configured signing material is absent. Missing canonical signing material is a hard publication failure.

The private key must never be uploaded as an Actions artifact or printed into logs. Ephemeral CI-only test keys may exercise protocol tests but can never satisfy the physical bootstrap trust gate.

## Ceremony evidence

Record only non-secret evidence:

```text
CEREMONY_STATUS=PASS
SOURCE_COMMIT=<40-hex reviewed commit>
KEY_ID=ordax-prototype-release-v1
PUBLIC_KEY_SHA256=<64 lowercase hex>
PUBLIC_TRUST_FILE_SHA256=<64 lowercase hex>
PRIVATE_KEY_CUSTODY_OWNER=repository-owner-developer
OFFLINE_ENCRYPTED_BACKUP=YES
OFFLINE_BACKUP_RECOVERY_VERIFIED=YES
RECOVERED_PRIVATE_PATH_DISTINCT=YES
RECOVERED_PUBLIC_DERIVATION_MATCH=YES
RECOVERED_SIGNING_PROOF=YES
PUBLIC_KEY_DERIVED_FROM_CUSTODIED_PRIVATE_KEY=YES
PUBLIC_KEY_FINGERPRINT_REVIEWED=YES
SIGNER_PRIVATE_TRUST_MATCH=PASS
PRIVATE_KEY_IN_GIT=NO
PRIVATE_KEY_IN_USB=NO
PRIVATE_KEY_IN_ACTIONS_ARTIFACTS=NO
PRIVATE_KEY_IN_LOGS=NO
PRIVATE_KEY_IN_CHAT=NO
```

Never record the private PEM, a seed, private-key bytes or another reversible secret in this evidence.

## Recovery

For the prototype, key loss is intentionally fail-closed.

Before physical distribution, losing the private key means generating a new key and repinning the public anchor before the first write. After prototype media has been provisioned, loss of the key requires reprovisioning that prototype media with a new trust anchor.

This is acceptable for the first notebook proof because the device population is intentionally tiny and controlled.

## Rotation

Silent public-key replacement is forbidden.

Until a signed trust-transition protocol is implemented, prototype key rotation requires reprovisioning. Production rotation will require the currently trusted key to authorize the successor key before the old key is retired.

Therefore, until this ceremony is actually executed:

```text
TRUST_POLICY_RESOLVED=YES
CANONICAL_KEY_MATERIAL_GENERATED=NO
PUBLIC_ANCHOR_PINNED=NO
BOOTSTRAP_RELEASE_TRUST_RESOLVED=NO
PHYSICAL_WRITE_ALLOWED=NO
```

See also:

- `docs/contracts/release-trust-policy.json`
- `docs/RELEASE-SIGNING.md`
- `bootstrap/trust/README.md`
- `tools/release-signing/README.md`
- `docs/contracts/minimal-bootstrap.json`
- `docs/PROMOTION-GATES.md`
