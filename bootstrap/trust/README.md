# Release Trust Bootstrap

Status: UNRESOLVED PROMOTION INPUT — PHYSICAL USE NOT AUTHORIZED

This owner will contain only the public trust material required to authenticate the first signed OrdaX release envelope.

Canonical runtime path:

```text
/ordax/bootstrap/trust/release-ed25519.json
```

The release acquisition agent expects schema `prototype-ordax.release-trust/1`, a stable `key_id` and a 32-byte Ed25519 public key encoded as base64.

## Security boundary

- private release-signing keys are never stored in this repository;
- private signing keys are never shipped in the Creator payload or device bootstrap;
- the public trust anchor may be versioned only after its corresponding private signing key has an explicit secure owner outside the repository;
- a random, disposable or CI-ephemeral key must not be promoted as the physical trust anchor;
- Creator physical authorization remains blocked while this owner is unresolved.

`tools/release-signing/` now provides standard-library tooling to generate an external PKCS#8 Ed25519 key during an explicit operator ceremony, derive the public trust JSON from an existing external private key, and sign exact release-manifest bytes. The tool does not make a key canonical merely by generating it.

## Canonicalization gate

Before adding `bootstrap/trust/release-ed25519.json` to the minimal bootstrap, record at minimum:

```text
PRIVATE_KEY_CUSTODY_OWNER=<explicit owner/system outside Git>
PRIVATE_KEY_RECOVERY_POLICY=DEFINED
PRIVATE_KEY_ROTATION_POLICY=DEFINED
KEY_ID=<stable id>
PUBLIC_KEY_DERIVED_FROM_CUSTODIED_PRIVATE_KEY=YES
PUBLIC_KEY_FINGERPRINT_REVIEWED=YES
PRIVATE_KEY_IN_GIT=NO
```

Then derive the public file from the actual private key with `tools/release-signing`, review its public fingerprint independently, and only then bind its exact SHA-256 in `docs/contracts/minimal-bootstrap.json`.

A CI-only test key may be used by isolated protocol tests, but it must remain test-scoped and must never satisfy the physical bootstrap manifest.

See `docs/RELEASE-SIGNING.md`.
