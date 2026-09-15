# Architectural Decisions

Status: ACTIVE LOG

This file records decisions that change the prototype's durable architecture. Do not use it as a changelog for routine edits.

## ADR-001 - Separate clean-room repository

Decision: build the simplified architecture in `washingtonmsdj/prototipo-ordax-os` instead of rewriting the legacy repository in place.

Reason:

- preserve the known legacy reference while the new model is unproven;
- avoid inheriting obsolete contracts by default;
- make every migrated responsibility explicit;
- allow the new physical layout to be designed from first principles.

Consequences:

- no bulk Git-history import;
- legacy repository remains reference/fallback during prototype phase;
- promotion requires physical gates.

## ADR-002 - Two physical partitions

Decision:

```text
ORDAX-ESP
ORDAX
```

There is no mandatory physical `ORDAX-HOME` partition in the prototype.

Reason: minimize physical layout while preserving logical separation of bootstrap, releases, persistent state and user data.

## ADR-003 - Git is source authority

Decision: `main` is the canonical implementation authority. USB/notebook contents are materializations.

Direct physical edits are experiments only until represented by an equivalent source change and validation.

## ADR-004 - Minimal pre-Git substrate

Decision: only capabilities necessary to boot, reach a trusted release, remotely recover/develop, and preserve essential identity/state may exist before Git/release activation.

The complete OS must not be baked into the bootstrap merely for convenience.

## ADR-005 - Immutable commit-addressed releases

Decision: deploy into `releases/<commit>` and activate through `current` (or an equivalent atomic pointer/state record).

Reason: reproducibility, rollback and separation between immutable implementation and mutable state.

## ADR-006 - HOME is initially logical

Decision: user/workspace data lives logically under the main partition. Backup, encryption, snapshots or quotas may evolve without forcing a separate partition.

A future physical HOME partition requires a new ADR and evidence that logical isolation is insufficient.

## ADR-007 - OrdaX Remote Core is bootstrap infrastructure

Decision: an OrdaX-owned Remote/Control Core and minimal Control Plane functionality belong to the pre-Git substrate because they are required to safely evolve and recover a development target.

Requirements:

- persistent device identity;
- explicit authorization;
- mature authenticated/encrypted transport;
- structured capability RPC;
- file/delta transfer;
- logs/events;
- release operations;
- fail-closed trust.

SSH is not a required final product dependency. It may remain temporarily only as documented break-glass compatibility until Remote Core proves equivalent physical recovery.

Custom cryptographic primitives are forbidden.

## ADR-008 - Legacy components are selected, not inherited

Decision: reuse from `novo-ordax-os` is component-by-component through `SOURCE-MIGRATION.md`.

Working behavior alone is not sufficient provenance. Source commit, role and validation must be known.

## ADR-009 - Clean reprovisioning is preferred for incompatible old media

Decision: once the new two-partition provisioner and disposable tests pass, an obsolete physical USB may be wiped and recreated rather than permanently supporting migration from every historical layout.

This ADR does not itself authorize a physical write. Execution still requires the destructive-operation gate.

## ADR-010 - One OrdaX product across Web, USB and native disk

Decision:

```text
OrdaX Web
 -> OrdaX USB
 -> OrdaX Native (SSD/HD)
```

These are capability modes of one product, not separate forks.

They share account model, Surface source, app source and safe synchronizable user state. Device-local secrets and hardware state remain local.

## ADR-011 - Single-source Surface and applications

Decision: Web and native OrdaX must render/execute shared user-facing code from the same source trees.

Platform-specific differences are capability adapters only.

Copied CSS, copied screens, Web-specific app forks and native-specific visual forks are forbidden.

## ADR-012 - Host-independent architecture

Decision: WSL, QEMU, PowerShell, Bash, one Linux distribution or one desktop OS cannot be mandatory architectural dependencies.

Canonical product/tooling logic is portable and shared. Thin host adapters are allowed only where raw disk, elevation or other host APIs genuinely differ.

QEMU is optional test infrastructure, never source authority or a product prerequisite.

## ADR-013 - OrdaX Creator is the single provisioning product

Decision: users create USB media and later native installations through one OrdaX Creator product with a shared policy/core.

Host adapters may integrate with Windows/Linux/macOS disk APIs but cannot fork layout, artifact or security policy.

End users must not need WSL, QEMU or a kernel toolchain to install OrdaX.

## ADR-014 - Standard cryptography, OrdaX-owned protocol

Decision: OrdaX owns its Remote/Control application protocol and authorization semantics, but does not invent cryptographic algorithms.

Use mature audited transport/crypto implementations. A proprietary or custom protocol layer must still rely on standard cryptographic primitives and fail-closed identity/authentication.

## ADR-015 - Initial physical media is minimum network-first

Decision: the first USB contains only boot-critical artifacts and the minimal substrate required to reach, verify and activate a complete release.

The initial media does not preseed the normal Surface, applications, high-level services, full source checkout or build toolchain.

Target:

```text
UEFI
 -> kernel/initramfs
 -> minimal bootstrap
 -> network
 -> device identity
 -> OrdaX Remote Core
 -> trust/Control Plane minimum
 -> release acquisition
 -> verified releases/<commit>
 -> current
```

After the first verified release is activated, it remains local for normal offline boot and rollback. Git/network are needed for acquiring new releases, not for booting an already known-good system.

Reason: keep physical provisioning small, stable and infrequent while almost all future system development happens over Git/network.

See `docs/MINIMAL-USB-BOOTSTRAP.md`.
