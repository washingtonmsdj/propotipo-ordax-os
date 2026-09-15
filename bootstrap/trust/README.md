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
- a random or CI-ephemeral key must not be promoted as the physical trust anchor;
- Creator physical authorization remains blocked while this owner is unresolved.

A CI-only test key may be used by isolated protocol tests, but it must be clearly test-scoped and must never satisfy the physical bootstrap manifest.
