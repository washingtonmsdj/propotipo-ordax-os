# OrdaX Remote / Control Core

Status: CANONICAL DIRECTION FOR PROTOTYPE

## Goal

OrdaX must not depend on an external SSH executable as the primary product control path.

The prototype will build one OrdaX-owned Remote/Control Core used by development, device management, logs, file transfer, release activation and recovery operations.

## Important security boundary

OrdaX may own the protocol/application layer, but must not invent cryptographic primitives.

Use audited standard cryptography and secure transport libraries. Do not design custom ciphers, key exchange, signatures or certificate formats.

## Product transport

Target direction:

```text
OrdaX Client / Web / Creator
        |
        | authenticated encrypted transport
        v
OrdaX Remote Core
        |
        +-- device identity
        +-- capability RPC
        +-- file/delta transfer
        +-- logs/events
        +-- release control
        +-- health/readiness
        +-- bounded recovery actions
```

The transport should be based on broadly implemented secure web-compatible standards so both native clients and browser-based OrdaX tooling can use the same service where appropriate.

Preferred architectural properties:

- TLS 1.3 or equivalent mature secure transport;
- authenticated device identity;
- explicit client authorization;
- structured RPC rather than arbitrary shell as the normal path;
- streaming for logs/files/events;
- capability-scoped permissions;
- replay-resistant requests for state-changing operations;
- audit receipts for privileged mutations;
- no password authentication;
- no private keys committed to Git.

## SSH policy

SSH is not a required product dependency.

```text
SSH_REQUIRED_FOR_PRODUCT=NO
SSH_REQUIRED_FOR_CREATOR=NO
SSH_REQUIRED_FOR_DAILY_DEVELOPMENT=NO
```

During prototype migration, SSH may temporarily remain available only as an explicitly documented break-glass/bootstrap compatibility mechanism until OrdaX Remote Core proves equivalent recovery access on physical hardware.

Once that gate passes, SSH can be removed from the required bootstrap contract.

## Structured operations

Normal remote actions should be named capabilities, for example:

```text
system.health.read
system.logs.stream
release.stage
release.activate
release.rollback
files.delta.push
service.restart
creator.attest
recovery.status
```

Avoid making unrestricted remote shell execution the foundation of development. A privileged emergency console, if retained, must be separately gated and auditable.

## Web compatibility

Because OrdaX Web is a first-class product mode, the Remote Core should be consumable through browser-compatible transport for authorized operations where browser security allows it.

This permits the same OrdaX management UI to inspect/manage a paired native device without maintaining a second SSH-specific frontend.

## Device pairing

Target pairing model:

1. device generates/persists its private identity locally;
2. user authenticates to OrdaX;
3. device presents a public identity/attestation;
4. user approves pairing;
5. client receives only public trust material/capability authorization;
6. privileged calls are mutually authenticated and authorized.

Private device keys remain on the device and never synchronize through the repository.

## Migration rule

Do not copy the legacy SSH tooling as the new Remote Core.

Legacy code may be studied only for invariants worth preserving, such as:

- persistent device identity;
- multi-operator authorization;
- fail-closed trust;
- recovery access expectations;
- readiness/health semantics.

The new implementation must be clean-room and must not preserve legacy host-key workarounds, shell wrappers or duplicated control owners merely for compatibility.
