# Apps

`system/apps/` owns the single source of first-party OrdaX applications.

Apps are product modules, not Web/Mobile/Desktop forks. The Surface imports the shared catalog and renders those app contracts inside the same workspace/window model across every compatible host.

## Current baseline

Each first-party app has one explicit owner:

```text
system/apps/files/app.mjs
system/apps/settings/app.mjs
system/apps/account/app.mjs
system/apps/system/app.mjs
```

`app-contract.mjs` validates the stable first-party app shape. `catalog.mjs` is deliberately thin: it composes the current owners, rejects duplicate IDs and exposes lookup/list operations to the Surface.

The initial owners are:

- Arquivos;
- Configurações;
- Conta;
- Sistema.

App definitions contain platform-neutral metadata, capability requirements and declarative panels. They do not import browser/native adapters and they do not decide which platform is running.

Application availability is capability-driven. A future app that requires a capability declares that capability in `requiredCapabilities`; the Surface fails closed when the host does not expose it.

## Boundary

Apps may depend on shared contracts and services according to `docs/contracts/module-boundaries.json`. They must not import `system/surface/` or concrete adapter implementations.

Do not create `apps-web`, `apps-mobile`, `apps-desktop`, Android/iOS copies or host-specific UI trees. Genuine host operations belong behind capability contracts and adapters.

The current registry is intentionally first-party and bounded. It is not a plugin marketplace or arbitrary code-loading framework; extension mechanics should only be introduced when there is a concrete product requirement and an explicit trust boundary.
