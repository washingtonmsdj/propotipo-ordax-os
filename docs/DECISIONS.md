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

Decision: only capabilities necessary to boot, establish minimal network access, acquire/verify a trusted release, and recover from acquisition failure may exist before release activation.

The complete OS, Remote Core and Control Plane must not be baked into the bootstrap merely for convenience.

## ADR-005 - Immutable commit-addressed releases

Decision: deploy into `releases/<commit>` and activate through `current` (or an equivalent atomic pointer/state record).

Reason: reproducibility, rollback and separation between immutable implementation and mutable state.

## ADR-006 - HOME is initially logical

Decision: user/workspace data lives logically under the main partition. Backup, encryption, snapshots or quotas may evolve without forcing a separate partition.

A future physical HOME partition requires a new ADR and evidence that logical isolation is insufficient.

## ADR-007 - Remote/Control is optional post-release capability

Decision: OrdaX Remote Core and Control Plane are not required for bootstrap, normal Git/release updates, or daily development.

They may be added later as normal versioned system capabilities if a concrete need for device management, pairing, support or remote recovery is proven.

SSH is not a required product dependency.

If a future Remote/Control capability is implemented, it must use mature authenticated/encrypted transport and standard cryptography; custom cryptographic primitives remain forbidden.

This decision supersedes the earlier prototype idea that Remote Core/Control Plane belonged to the pre-Git substrate.

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

## ADR-014 - Standard cryptography only

Decision: any future OrdaX-owned remote/control protocol may own application semantics, but must not invent cryptographic algorithms.

Use mature audited transport/crypto implementations and fail-closed identity/authentication.

## ADR-015 - Initial physical media is minimum release-acquisition-first

Decision: the first USB contains only boot-critical artifacts and the minimal substrate required to reach, verify and activate a complete release.

The initial media does not preseed the normal Surface, applications, high-level services, Remote Core, Control Plane, SSH, full source checkout or build toolchain.

Target:

```text
UEFI
 -> kernel/initramfs
 -> minimal bootstrap
 -> minimal network
 -> signed release acquisition
 -> verify
 -> releases/<commit>
 -> current
```

Recovery remains available if acquisition fails. After the first verified release is activated, it remains local for normal offline boot and rollback. Network is needed for acquiring new releases, not for booting an already known-good system.

Reason: keep physical provisioning small, stable and infrequent while almost all future system development happens through Git/CI/release delivery.

See `docs/MINIMAL-USB-BOOTSTRAP.md`.

## ADR-016 - Repository-owned autonomous builds; Codex is optional

Decision: no artifact may require Codex or undocumented developer-machine state to be built.

Canonical build ownership is:

```text
main source
 -> versioned repository recipe
 -> pinned build environment
 -> CI execution
 -> tests
 -> provenance + SHA-256
 -> artifact/release candidate
```

The kernel follows this rule like every other artifact. The developer does not manually compile it as a prerequisite for ordinary work or installation.

GitHub Actions is the current executor, not source authority. Build entrypoints must remain portable to another compatible container/CI executor.

Codex may be used as an optional reviewer, investigator or parallel engineering partner. It is not build authority, release authority, source authority or a required solver.

See `docs/BUILD-AUTONOMY.md` and `docs/contracts/build-autonomy.json`.

## ADR-017 - Mutable release selector, immutable signed release identity

Decision: the bootstrap release channel uses the stable GitHub Releases selector:

```text
https://github.com/washingtonmsdj/prototipo-ordax-os/releases/latest/download/release-envelope.json
```

This URL is a **delivery selector only**. It is allowed to move when a newer release is published. It is not trusted as an authenticity source.

Authenticity remains exclusively bound by:

```text
local Ed25519 public trust anchor
 -> signed release envelope
 -> exact source repository
 -> exact source commit / release_id
 -> exact artifact size + SHA-256
```

Consequences:

- changing the `latest` target cannot make an invalid signature acceptable;
- the private signing key must remain outside Git, USB bootstrap and distributable clients;
- only the public trust anchor is embedded in the minimal bootstrap;
- key rotation requires an explicit future trust-policy ADR/protocol;
- the channel URL is source-controlled and hash-bound in `minimal-bootstrap.json`;
- a missing release endpoint fails closed into recovery on first acquisition;
- physical write remains blocked until a real public trust anchor and the remaining promotion gates are satisfied.
