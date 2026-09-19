# Apps

`system/apps/` owns the single source of first-party OrdaX applications.

Apps are product modules, not Web/Mobile/Desktop forks. The Surface imports the shared catalog and renders those app contracts inside the same workspace/window model across every compatible host.

## Current baseline

Each first-party app has one explicit owner:

```text
system/apps/files/app.mjs
system/apps/notes/app.mjs
system/apps/settings/app.mjs
system/apps/account/app.mjs
system/apps/system/app.mjs
```

`app-contract.mjs` validates the stable first-party app shape. `catalog.mjs` is deliberately thin: it composes the current owners, rejects duplicate IDs and exposes lookup/list operations to the Surface.

The initial owners are:

- Arquivos;
- Notas;
- Ajustes;
- Conta;
- Sistema.

App definitions contain platform-neutral metadata, capability requirements and declarative panels. They do not import browser/native adapters and they do not decide which platform is running.

Application availability is capability-driven. A future app that requires a capability declares that capability in `requiredCapabilities`; the Surface fails closed when the host does not expose it. An app may also declare `optionalCapabilities`: these enrich the same app when a host exposes them without turning that app into a platform fork or making the optional feature a launch requirement.

**Notas is an app, not a Surface/system subsystem.** It is currently bundled as a first-party app and is especially useful on Native/USB because `filesystem.user-space` is available there, but its stable app identity remains `notes` and that filesystem capability is optional. This keeps the application boundary compatible with a future signed app-package/store path without pretending that a general package manager or Store already exists. Until independent app packaging/release is implemented, Notas shares the product release/version instead of inventing a separate app version.

## Boundary

Apps may depend on shared contracts and services according to `docs/contracts/module-boundaries.json`. They must not import `system/surface/` or concrete adapter implementations.

Do not create `apps-web`, `apps-mobile`, `apps-desktop`, Android/iOS copies or host-specific UI trees. Genuine host operations belong behind capability contracts and adapters.

The current registry is intentionally first-party and bounded. It is not a plugin marketplace or arbitrary code-loading framework; extension mechanics should only be introduced when there is a concrete product requirement and an explicit trust boundary.
