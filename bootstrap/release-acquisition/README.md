# Release Acquisition Bootstrap

Status: CLEAN-ROOM CANDIDATE — PHYSICAL USE NOT AUTHORIZED

This directory owns only the pre-release client required to acquire a verified OrdaX release after minimal network bring-up.

It does **not** own a full Git checkout, compiler, source build, SSH service, Remote Core or Control Plane.

## Runtime chain

```text
network ready
 -> fetch signed release envelope over HTTPS
 -> verify Ed25519 signature against local public trust anchor
 -> parse the exact signed manifest payload
 -> validate repository/commit/artifact policy
 -> fetch artifacts over HTTPS
 -> verify exact size + SHA-256
 -> fsync staging release
 -> atomically materialize /ordax/releases/<commit>
 -> atomically switch /ordax/current
```

A failed download, signature, hash, size or activation check never replaces the current known-good release.

## Cryptographic envelope

The protocol deliberately does not invent canonical JSON. The envelope carries the **exact manifest bytes** as base64 and the Ed25519 signature is computed over those exact bytes.

```json
{
  "$schema": "prototype-ordax.release-envelope/1",
  "payload": "<base64 exact manifest bytes>",
  "signature": "<base64 Ed25519 signature over payload bytes>",
  "key_id": "prototype-1"
}
```

The local public trust anchor is a small regular file:

```json
{
  "$schema": "prototype-ordax.release-trust/1",
  "key_id": "prototype-1",
  "public_key_base64": "<32-byte Ed25519 public key>"
}
```

Private release signing keys must never be shipped in the repository, bootstrap, Desktop app or device image.

## Signed manifest

Prototype schema:

```json
{
  "$schema": "prototype-ordax.release-manifest/1",
  "source_repository": "washingtonmsdj/prototipo-ordax-os",
  "source_commit": "<lowercase 40-hex commit>",
  "release_id": "<same commit in prototype>",
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

The agent rejects unknown JSON fields, unsafe names, non-HTTPS artifact URLs, repository mismatch, malformed commits/hashes, duplicate artifact names and oversized documents/artifacts.

## Agent

`main.go` uses only the Go standard library:

- `crypto/ed25519` for manifest authenticity;
- `crypto/sha256` for artifact integrity;
- `net/http` for HTTPS acquisition;
- strict `encoding/json` decoding;
- filesystem staging, fsync, rename and symlink activation through `os`.

The CI pins Go 1.27.1, runs the protocol regression suite, builds with `CGO_ENABLED=0 GOOS=linux GOARCH=amd64`, rejects a dynamic program interpreter and publishes candidate hashes/provenance.

No candidate is automatically authorized for physical USB use.

## CLI

Verify a downloaded envelope without installing it:

```text
ordax-release-agent verify-envelope \
  --envelope release-envelope.json \
  --trust /ordax/bootstrap/trust/release-ed25519.json
```

Acquire and activate a release:

```text
ordax-release-agent install \
  --envelope-url https://releases.example/ordax/stable.json \
  --trust /ordax/bootstrap/trust/release-ed25519.json \
  --root /ordax
```

For the prototype, `release_id` equals `source_commit`, so immutable release identity and target directory are unambiguous.

See `docs/RELEASE-CHANNEL.md` for the system-wide delivery contract.
