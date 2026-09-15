# Shared Services

Shared product/domain services that are not tied to one presentation target.

Services expose contracts consumed by the Surface/apps and may delegate environment-specific capabilities to `system/adapters/`.

Current canonical service boundaries:

- `system/services/sync/` owns cross-device data classification, versioning, conflict and retry semantics;
- adapters own platform integration only and must not redefine shared domain policy.

Service contracts should remain provider-neutral. Database vendors, cloud products and platform APIs are implementation choices, not product-domain authorities.

Do not duplicate service policy between Web, Mobile, Desktop or native targets.
