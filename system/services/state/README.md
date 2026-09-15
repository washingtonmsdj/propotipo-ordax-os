# Device State Evolution Boundary

`system/services/state/` owns the product-level semantics for mutable device state under `/ordax/state`.

The machine-readable authority is `docs/contracts/state-evolution.json`.

This boundary exists so future releases can change internal state without making updates or rollback fragile. It does **not** mean every release needs a migration framework; concrete migration code is added only when a real state-schema change exists.

Core rules:

- releases are immutable, while `/ordax/state` is mutable and explicitly schema-versioned;
- a candidate release declares which state schemas it can read and which schema it writes;
- unknown newer or malformed state fails closed to recovery rather than being reset;
- only verified release code may migrate state;
- migrations are ordered, validated, crash-safe and either idempotent or safely resumable;
- partially migrated state never becomes the active state;
- before an irreversible migration, rollback is preserved through compatibility or a restorable checkpoint bound to the previous release/schema;
- the preferred evolution model is expand -> migrate -> contract, so a single release does not both introduce and destructively require a new representation;
- `/ordax/home` user data has a separate, stricter migration/backup boundary and must never be treated as disposable device state;
- synchronized account state and local device state are separate concerns.

The implementation may later use directories, databases, journals, copy-on-write snapshots or another storage engine. Those choices do not own the state schema contract.
