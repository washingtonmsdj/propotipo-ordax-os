# Bootstrap Release Channel Configuration

Status: CANONICAL PROTOTYPE INPUT — PHYSICAL USE STILL NOT AUTHORIZED

This owner contains the minimum bootstrap configuration needed to locate the first signed OrdaX release envelope.

Canonical source file:

```text
bootstrap/config/release-envelope-url
```

Canonical runtime path:

```text
/ordax/bootstrap/config/release-envelope-url
```

The file contains exactly one HTTPS URL:

```text
https://github.com/washingtonmsdj/prototipo-ordax-os/releases/latest/download/release-envelope.json
```

GitHub documents `/releases/latest/download/<asset>` as the direct download form for an asset on the latest release. This pointer selects the candidate delivery object only; it is **not** an authenticity authority. The downloaded envelope must still pass the local Ed25519 trust anchor, strict schema checks, repository pin, exact source-commit identity, artifact size checks and SHA-256 verification.

## Security boundary

- HTTPS is mandatory transport;
- the `latest` pointer may move only by publishing another GitHub Release;
- moving that pointer cannot make an unsigned or wrongly signed envelope acceptable;
- the release trust anchor remains independently pinned in `/ordax/bootstrap/trust/release-ed25519.json`;
- changing this URL is a source-controlled bootstrap policy change;
- no access token, credential or private signing material belongs in this file;
- physical write remains blocked while the release trust owner is unresolved and until the remaining promotion gates pass.
