# Runtime Configuration Boundary

`system/services/config/` owns product-level runtime configuration semantics. The machine-readable authority is `docs/contracts/runtime-configuration.json`.

The goal is to allow the OrdaX product to gain settings, rollout controls and deployment policy without growing an untraceable web of environment variables or vendor-specific remote-config behavior.

Core rules:

- there is no universal "last source wins" precedence; each configuration key declares which authorities may set it and in what order;
- release defaults come from verified release content and are immutable for that release;
- server policy may tune already-authorized behavior, but cannot grant a capability or cross a privilege/security boundary;
- device-local configuration is separate from user preference and from secrets;
- secret values live behind secure platform storage and only opaque references/handles may enter normal configuration objects where needed;
- feature flags have stable IDs, safe defaults and owners; temporary flags need an expiry/removal condition;
- a flag can select behavior inside an existing capability but cannot grant RAW disk, physical apply, replace trust, disable release verification or bypass explicit authorization;
- configuration is resolved deterministically as an atomic snapshot with a safe last-known-good fallback;
- diagnostics expose effective non-secret values, source class and revision while redacting secrets.

Concrete keys should be added only when a real feature needs them. This contract defines the evolution/security boundary, not a speculative catalog of settings.
