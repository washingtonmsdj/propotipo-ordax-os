# Apps

`system/apps/` owns the single source of first-party OrdaX applications.

Apps are product modules, not Web/Mobile/Desktop forks. The Surface imports the shared catalog and renders those app contracts inside the same workspace/window model across every compatible host.

## Current baseline

`catalog.mjs` is the canonical first-party registry for the graphical prototype. It currently defines:

- Arquivos;
- Configurações;
- Conta;
- Sistema.

The catalog contains platform-neutral metadata, capability requirements and declarative panels. It does not import browser/native adapters and it does not decide which platform is running.

Application availability is capability-driven. A future app that requires a capability declares that capability in `requiredCapabilities`; the Surface fails closed when the host does not expose it.

## Boundary

Apps may depend on shared contracts and services according to `docs/contracts/module-boundaries.json`. They must not import `system/surface/` or concrete adapter implementations.

Do not create `apps-web`, `apps-mobile`, `apps-desktop`, Android/iOS copies or host-specific UI trees. Genuine host operations belong behind capability contracts and adapters.

The current catalog is intentionally small. It is a first-party registry, not a plugin marketplace or arbitrary code-loading framework.
