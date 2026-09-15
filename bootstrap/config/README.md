# Bootstrap Release Channel Configuration

Status: UNRESOLVED PROMOTION INPUT — PHYSICAL USE NOT AUTHORIZED

This owner will contain the minimum immutable bootstrap configuration needed to locate the first signed OrdaX release envelope.

Canonical runtime path:

```text
/ordax/bootstrap/config/release-envelope-url
```

The file contains exactly one HTTPS URL consumed by `bootstrap/entrypoint`. The downloaded envelope is not trusted merely because HTTPS succeeds: authenticity is independently verified by the release acquisition agent against the local Ed25519 public trust anchor.

## Promotion boundary

- no placeholder, example domain or temporary CI URL may satisfy the physical manifest;
- the selected URL must have an explicit release-channel owner and retention/availability policy;
- redirects and downloaded bytes remain subject to the release agent's strict HTTPS, signature, size and SHA-256 checks;
- changing the release channel is a source-controlled bootstrap policy change;
- Creator physical authorization remains blocked while this owner is unresolved.
