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

## ADR-010 - One OrdaX product across five execution modes

Decision:

```text
OrdaX Web
 -> OrdaX Mobile (Android / iPhone)
 -> OrdaX Desktop
 -> OrdaX USB
 -> OrdaX Native (SSD/HD)
```

These are capability modes of one product, not separate forks.

They share account model, Surface source, app source and safe synchronizable user state. Device-local secrets and hardware state remain local. Mode-specific authority is expressed through capability adapters rather than copied product implementations.

This expands the original Web/USB/native prototype decision to the canonical five-mode product model.

## ADR-011 - Single-source Surface and applications

Decision: Web, Mobile, Desktop, USB and native-disk OrdaX use shared user-facing source trees wherever the feature is applicable.

Platform-specific differences are capability adapters only. Shared code may react to capability availability; it must not fork product policy by platform identity when a capability boundary can express the difference.

Copied CSS, copied screens, Android/iOS product forks, Desktop-only copies of shared apps and native-specific visual forks are forbidden.

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

## ADR-018 - Product growth is capability-driven and additive

Decision: new product features and execution environments extend stable capability contracts instead of creating platform forks.

Machine-readable authority: `docs/contracts/product-capabilities.json`.

Rules:

- capability IDs are stable;
- adding a capability definition or an optional capability is the normal backward-compatible path;
- a new required capability on an existing mode requires an explicit migration;
- changing the meaning of an existing capability requires a new capability ID or contract major;
- an unknown optional capability may be ignored;
- an unknown required capability fails closed;
- security-sensitive capabilities keep explicit privilege boundaries.

Reason: allow future hardware, mobile APIs, remote-management functions, AI capabilities or entirely new modes to be added without rewriting shared product logic.

## ADR-019 - Published release protocol schemas have immutable semantics

Decision: a published release schema keeps its meaning for the lifetime of that schema. Breaking release changes require a new schema version and explicit support in every relevant owner.

Machine-readable authority: `docs/contracts/release-protocol.json`.

The current `release-manifest/1` remains exactly one complete `system.tar` addressed by source commit. Delta updates, multiple artifacts or new required fields cannot be silently added to v1.

A future version may coexist with an older version during a migration window. Optional delta delivery must preserve a verified full-release fallback until its migration policy says otherwise.

Reason: old devices must never reinterpret previously understood signed data under new semantics.

## ADR-020 - Sync semantics are provider-neutral and versioned

Decision: account/synchronization semantics are owned by `system/services/sync`, not by a database vendor, cloud provider or platform adapter.

Machine-readable authority: `docs/contracts/sync-model.json`.

Stable object IDs, object schema versions, server revisions, idempotent mutation keys, explicit tombstones and deterministic versioned conflict resolvers form the domain boundary. Client wall clocks are not conflict authority and universal last-writer-wins is forbidden.

Infrastructure may change without forcing a client-domain migration solely because the storage provider changed. Device-private keys, machine secrets, raw-disk state and other never-sync classes remain local regardless of paid plan.

Reason: keep future backend, scaling and hosting choices replaceable without locking the product model to today's infrastructure.

## ADR-021 - Shared modules follow an acyclic contract-first dependency direction

Decision: shared runtime modules depend inward through platform-neutral contracts rather than importing concrete environment implementations.

Machine-readable authority: `docs/contracts/module-boundaries.json`.

Canonical direction:

```text
contracts
  <- services
  <- apps
  <- surface

contracts/services
  <- adapters
```

`system/contracts/` is intentionally small and only gains concrete interfaces when a real implementation requires them. It is not a speculative framework layer.

Surface/apps/services do not import concrete Web/Mobile/Desktop/native adapters. Adapters implement capabilities and do not own shared screens or application policy. Dependency cycles are forbidden. Temporary compatibility bridges require an owner and removal condition; permanent ownerless bridges are forbidden.

Reason: keep modules replaceable and independently evolvable as the codebase grows, while avoiding both monolithic coupling and premature abstraction.

## ADR-022 - Runtime component trust and activation are independent boundaries

Decision: independently delivered runtime components use a trust domain and activation lifecycle that are distinct from the whole-OS release boundary.

Machine-readable authority: `docs/contracts/runtime-component-package.json`.

A runtime component release is bound as:

```text
runtime-component public trust
 -> Ed25519 signed component release descriptor
 -> exact component id + semantic version + source commit
 -> exact package size + SHA-256
 -> exact component-package manifest SHA-256
 -> exact packaged file hashes
 -> immutable staged slot
```

The whole-OS release trust anchor is not implicitly reused as component trust. A canonical component key requires its own explicit custody/promotion decision outside Git. Ephemeral CI keys may prove the protocol but cannot establish product trust.

A valid signature authorizes verification and staging only. It does not authorize direct activation. Promotion requires a separate runtime-health gate:

```text
signed + verified package
 -> immutable slot
 -> pending
 -> runtime load/mount
 -> health observation
 -> promote current
 -> preserve previous
```

Until this full path exists for a component, its manifest remains `releaseMode: "bundled"`. Rollback is component-local only after `current/previous` promotion is implemented and proven.

Reason: a cryptographically valid package can still contain a runtime regression. Separating authenticity, staging and health-based activation prevents a signed application update from being able to take the whole OrdaX Surface down or to claim independent rollback before that rollback path actually exists.

