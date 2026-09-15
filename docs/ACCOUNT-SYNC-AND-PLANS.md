# Account Sync and Plans

Status: CANONICAL FOR PROTOTYPE

## One identity

An OrdaX user has one account across every supported product mode:

```text
Web
Android / iPhone / iPad
Desktop
USB
Native
```

The account owns identity, entitlements and synchronized user state. A device owns only device-local state and secrets.

## Baseline sync

Basic cross-device continuity is part of the account model and is not reserved for a paid tier.

Baseline sync may include:

- appearance and theme;
- preferences;
- workspace metadata;
- app-state metadata that is safe to move between devices;
- explicitly selected cloud-backed user content.

A user should be able to start on Web, continue on a phone, open Desktop later and finally boot OrdaX without creating a new identity or manually rebuilding basic preferences.

## Never-sync boundary

The following classes remain local regardless of plan:

- private device keys;
- machine identity secrets;
- hardware-specific drivers;
- raw disk state;
- ephemeral caches;
- credentials that are intentionally device-bound;
- privileged recovery material whose security contract requires locality.

A paid plan never turns device-private security material into cloud-synchronized data.

## Offline-first behavior

Clients may continue working with locally available data while offline. Synchronization resumes when connectivity returns.

Before production promotion the sync engine must define deterministic conflict handling for concurrent changes. Silent last-writer-wins for all data classes is not an acceptable universal policy.

The scalable sync boundary is now machine-readable in `docs/contracts/sync-model.json`. It requires stable object IDs, versioned object schemas, server revisions, idempotent mutation keys, explicit deletion tombstones, opaque incremental cursors and support for a safe full resync. Client wall-clock time is not authoritative for conflict resolution.

Conflict algorithms are deliberately not frozen globally. Each data class or content type owns a deterministic, versioned resolver. This allows richer future models without rewriting every client and prevents a simplistic global last-writer-wins rule from becoming permanent architecture.

## Provider independence

Sync/domain semantics belong to `system/services/sync`, not to a database vendor, cloud provider or platform adapter. A future backend may use any suitable durable store, queue or object storage combination as long as it satisfies the domain contract.

Clients consume OrdaX object/revision semantics rather than database rows or provider-specific identifiers. Changing the backend therefore must not require a client migration solely because infrastructure changed.

Platform adapters own secure token storage, lifecycle/background integration and transport plumbing. They cannot redefine data classification, conflict policy, entitlements or never-sync boundaries.

## Security

Synchronization requires:

- encrypted transport;
- server-side authorization for every user-scoped object;
- device/session revocation;
- bounded token lifetime and secure local token storage;
- explicit data classification;
- auditable entitlement checks for premium capabilities;
- no client-side trust in a locally claimed paid plan.

Platform biometric APIs may protect local session access, but biometrics do not replace canonical account authentication or server authorization.

## Plans are entitlements, not separate products

Pricing and commercial names are intentionally deferred. The foundation defines only entitlement behavior.

Suggested product structure:

```text
Core account
  -> identity on every supported mode
  -> basic cross-device sync
  -> modest cloud quota

Expanded plan(s)
  -> larger cloud quota
  -> longer sync/version history
  -> device backup/restore
  -> advanced collaboration
  -> premium AI compute/features
  -> enhanced recovery/support
```

This can later become Free / Plus / Pro / Family / Business or another commercial structure without changing the account architecture.

## Downgrade safety

A plan downgrade must not silently delete user data. If the stored amount exceeds the new quota, the service should enter a documented limited state, for example retaining existing data while blocking new uploads until usage is reduced or the plan is upgraded.

Exact retention and grace-period policy is a later commercial decision, but destructive surprise is forbidden.

## Device limits

Device-count limits, if ever introduced, are an entitlement policy rather than a new identity system. Revoking one device must not invalidate the account on all other devices.

A device registry should distinguish sessions/devices and support remote sign-out without synchronizing device-private keys.

## Data ownership and portability

Plan design must not make the user's own synchronized data inaccessible solely because a premium feature expired. Export/delete/account controls should remain account-level capabilities independent of the client used to invoke them.

## Architecture boundary

Shared services own sync semantics. Platform adapters own transport integration, secure storage, background scheduling and OS-specific lifecycle details.

```text
system/services/sync
        |
        +-> web adapter
        +-> mobile adapter (Android/iOS)
        +-> desktop adapter
        +-> native adapter
```

No platform gets its own incompatible synchronization model.
