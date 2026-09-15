# Shared Services

Shared product/domain services that are not tied to one presentation target.

Services expose contracts consumed by the Surface/apps and may delegate environment-specific capabilities to `system/adapters/` without giving adapters ownership of product semantics.

Current canonical service boundaries:

- `system/services/account/` owns provider-neutral runtime invariants between account/session state and advertised capabilities; adapters expose environment integration but cannot redefine those invariants;
- `system/services/preferences/` owns user-facing preference semantics such as appearance; persistence/sync are separate capabilities and are not implied by the preference definition itself;
- `system/services/sync/` owns cross-device data classification, versioning, conflict and retry semantics;
- `system/services/config/` owns product/runtime configuration semantics and remains distinct from user preferences and secrets;
- `system/services/state/` owns durable product-state evolution semantics;
- `system/services/diagnostics/` owns local-first diagnostics policy.

Adapters own platform integration only and must not redefine shared domain policy. Service contracts remain provider-neutral: database vendors, cloud products, browser APIs and native platform APIs are implementation choices, not product-domain authorities.

Do not duplicate service policy between Web, Mobile, Desktop or native targets.
