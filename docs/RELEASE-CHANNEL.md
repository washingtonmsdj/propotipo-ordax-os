# Release Channel

Status: CANONICAL FOR PROTOTYPE

## Goal

`main` remains the source authority, but an OrdaX device must not need a compiler, source checkout, Codex, or a full Git client in the pre-release bootstrap.

Repository CI materializes immutable releases from exact source commits. The device consumes a compact signed release envelope and immutable artifacts over standard HTTPS.

## Source vs delivery

```text
GitHub main                     device
    |                              |
    | source authority             | no source build
    v                              |
CI build graph                     |
    |                              |
    +-> kernel                     |
    +-> initramfs/bootstrap        |
    +-> system/native release      |
    +-> shared Surface/Web         |
    +-> Desktop package            |
    |                              |
    v                              |
signed envelope + artifacts -------+
          HTTPS + signature/hash verification
```

Git owns *what* OrdaX is. The release channel owns only immutable delivery of a specific Git commit.

## Minimal first-boot chain

```text
UEFI
 -> kernel/initramfs
 -> mount ORDAX
 -> minimal network
 -> HTTPS release acquisition agent
 -> local public release trust anchor
 -> verified release
 -> /ordax/current
```

A full `git` executable and complete repository checkout are not mandatory before the first system release.

## Release identity

Every prototype release is bound to one exact lowercase 40-hex source commit and uses that commit as `release_id` and the immutable directory name:

```text
/ordax/releases/<source_commit>
```

Rebuilding the same release identity with different bytes is forbidden. Changed bytes require a different source/release identity.

## Signed-envelope protocol

HTTPS transport is mandatory but is not the authenticity authority.

The release endpoint serves an envelope:

```json
{
  "$schema": "prototype-ordax.release-envelope/1",
  "payload": "<base64 exact manifest bytes>",
  "signature": "<base64 Ed25519 signature over the exact payload bytes>",
  "key_id": "prototype-1"
}
```

The signature is standard Ed25519 over the decoded `payload` bytes exactly as carried. The protocol intentionally avoids inventing canonical-JSON signing rules.

The device carries only a public trust anchor:

```json
{
  "$schema": "prototype-ordax.release-trust/1",
  "key_id": "prototype-1",
  "public_key_base64": "<32-byte Ed25519 public key>"
}
```

Private signing material never belongs in Git, the USB bootstrap, OrdaX Desktop, a native installation or any downloadable client bundle.

## Signed manifest

The decoded signed payload uses:

```json
{
  "$schema": "prototype-ordax.release-manifest/1",
  "source_repository": "washingtonmsdj/prototipo-ordax-os",
  "source_commit": "<lowercase 40-hex>",
  "release_id": "<same source commit>",
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

Unknown fields are rejected by the bootstrap agent. Artifact names are safe basenames, URLs are absolute HTTPS without embedded credentials, hashes and sizes must match exactly, and the expected source repository is pinned by policy.

## Transactional materialization

The acquisition agent never downloads directly into the active release.

```text
fetch + verify signed manifest
 -> create /ordax/releases/.staging-<commit>-*
 -> download each artifact
 -> verify exact size + SHA-256
 -> fsync files + staging directory
 -> write exact signed release-manifest.json
 -> rename staging -> /ordax/releases/<commit>
 -> fsync releases directory
 -> atomically replace /ordax/current symlink
 -> fsync /ordax
```

`current` is changed only after every byte of the new release has passed policy and integrity checks.

An already materialized release may be reactivated only when its stored signed manifest bytes and every artifact still match the requested signed release. Existing divergent bytes fail closed.

## Failure and offline behavior

```text
network unavailable       -> boot current known-good release
release service unavailable -> boot current known-good release
signature invalid         -> reject candidate; retain current
artifact invalid          -> reject candidate; retain current
activation precondition fails -> retain current
```

After first successful provisioning, network is an update dependency, not a normal boot dependency.

## Cryptography

- Ed25519 uses the platform/standard-library implementation; no custom signing algorithm.
- SHA-256 verifies downloaded artifact bytes.
- HTTPS provides transport confidentiality/server authentication but does not replace release signing.
- Trust failure is fail-closed.
- Key rotation must be an explicit future trust-policy protocol; silently accepting an untrusted replacement key is forbidden.

## Publication target

GitHub Releases is the natural prototype host for generated immutable assets, but the protocol is deliberately host-neutral. The signed manifest contains ordinary HTTPS artifact URLs, so the delivery host can later move to another immutable object store/CDN without changing source authority.

## Product-mode relationship

Web, Desktop, USB and Native are one product but have distinct delivery mechanics:

```text
Web       -> deployment refresh from the shared source commit
Desktop   -> signed desktop application update
USB       -> signed OrdaX release acquisition/activation
Native    -> signed OrdaX release acquisition/activation
```

OrdaX Desktop may download and verify bootable/native artifacts and may create USB media through its narrow Creator capability. Its own application updater remains a separate trust/update channel and must never silently write removable media or alter the Windows boot configuration.

## Development semantics

A normal system change becomes:

```text
edit source
 -> tests
 -> push main
 -> CI builds affected deliverables
 -> CI signs/publishes release material for exact commit
 -> Web/Desktop consume applicable shared source
 -> bootable/native updater sees an eligible signed release
 -> download + verify
 -> atomically activate
```

The device does not recompile the kernel because source changed. Kernel and bootstrap compilation belong to repository CI.

## Codex independence

Codex is not part of release publication or consumption.

```text
CODEX_REQUIRED_FOR_BUILD=NO
CODEX_REQUIRED_FOR_PUBLICATION=NO
CODEX_REQUIRED_FOR_DEVICE_UPDATE=NO
```

Any repository-capable engineering workflow can modify source and diagnose CI. A running device consumes the release protocol, not an AI-specific channel.

## Promotion boundary

The current acquisition agent and all emitted artifacts remain **candidates** until virtual boot, rollback, offline known-good and real-hardware gates pass.

```text
PHYSICAL_ARTIFACT_AUTHORIZED=NO
```
