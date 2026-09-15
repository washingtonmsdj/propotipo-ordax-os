# Surface

`system/surface/` is the single user-facing Surface source for OrdaX shell, windows/workspaces, explorer, settings, design tokens and shared interaction behavior.

The same product Surface serves every applicable execution mode:

```text
Web
Mobile (Android / iOS)
Desktop
USB
Native disk
```

Those modes may host/render the Surface differently, but they do not own separate screens, CSS, design systems or application policy.

## Stable boundary

The native verified-release handoff remains intentionally simple:

```text
system/entrypoint
 -> system/surface/entrypoint
 -> system/surface/bin/ordax-surface
```

`system/surface/entrypoint` is the stable native launch boundary. The current `bin/ordax-surface` is only the bootstrap-console implementation and may later be replaced by the graphical runtime without changing the release handoff contract.

Do not add a plugin/launcher framework merely to prepare for that replacement; the stable entrypoint already supplies the required indirection.

## Capability rule

Environment differences are consumed through platform-neutral contracts under `system/contracts/` and implemented by `system/adapters/`.

Shared Surface code may react to capability availability. It must not import concrete Web/Mobile/Desktop/native adapter implementations or branch on platform identity when the difference can be expressed as a capability.

The machine-readable boundaries are:

- `docs/contracts/product-capabilities.json`;
- `docs/contracts/module-boundaries.json`;
- `docs/contracts/runtime-configuration.json`.

## Rendering/runtime technology

A thin webview/native-shell approach remains a strong candidate because it can reuse one Surface across product modes, but React, another UI framework, a standards-first DOM runtime, Tauri or another host technology is **not** an architectural authority.

Framework/runtime selection must satisfy the shared capability/module contracts and remain replaceable. Product/domain semantics belong to shared OrdaX source, not to a UI framework or host shell.

No target-specific visual fork is allowed.
