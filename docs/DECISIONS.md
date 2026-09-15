# Architectural Decisions

Status: ACTIVE LOG

This file records decisions that change the prototype's durable architecture. Do not use it as a changelog for routine edits.

## ADR-001 - Separate clean-room repository

Decision: build the simplified architecture in `washingtonmsdj/propotipo-ordax-os` instead of rewriting the legacy repository in place.

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

## ADR-007 - Secure remote access is bootstrap infrastructure

Decision: Remote Core/SSH and minimal Control Plane functionality belong to the pre-Git substrate because they are required to safely evolve and recover a development target.

Requirements include persistent host identity, public-key-only operator access and fail-closed host trust.

## ADR-008 - Legacy components are selected, not inherited

Decision: reuse from `novo-ordax-os` is component-by-component through `SOURCE-MIGRATION.md`.

Working behavior alone is not sufficient provenance. Source commit, role and validation must be known.

## ADR-009 - Clean reprovisioning is preferred for incompatible old media

Decision: once the new two-partition provisioner and disposable tests pass, an obsolete physical USB may be wiped and recreated rather than permanently supporting migration from every historical layout.

This ADR does not itself authorize a physical write. Execution still requires the destructive-operation gate.
