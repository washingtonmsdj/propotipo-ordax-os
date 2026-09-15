# Shared Runtime Contracts

`system/contracts/` is the innermost, platform-neutral boundary of the OrdaX product runtime.

It exists so Surface, apps, shared services and platform adapters can evolve independently without importing one another's implementation details. Concrete interfaces and value types should be added here only when a real implementation needs them; this directory is not a dumping ground for speculative abstractions.

Dependency direction:

```text
contracts
   ^
   |------ services
   |          ^
   |          |------ apps
   |          |          ^
   |          |          |------ surface
   |          |
   |----------|------ adapters
```

Adapters implement environment-specific capabilities. Shared Surface/apps/services consume platform-neutral contracts and must not import `adapters/web`, `adapters/mobile`, `adapters/desktop` or `adapters/native` implementations directly.

Rules are machine-readable in `docs/contracts/module-boundaries.json`.
