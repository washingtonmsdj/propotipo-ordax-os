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

## Visual source

The first graphical source now lives under `system/surface/ui/` as standards-first HTML/CSS/JavaScript modules with no remote asset or framework dependency. This is an implementation baseline, not a permanent framework choice.

`surface-state.mjs` keeps interaction state independent from DOM rendering. `surface.mjs` mounts the shared UI against the platform-neutral `ordax.surface-host/1` contract. Design tokens and responsive behavior remain shared CSS.

Environment wiring is intentionally outside the Surface under `system/composition/`. The Web composition combines the shared Surface with `system/adapters/web/runtime.mjs`; future Desktop/Mobile/native composition roots may select different adapters without copying the UI.

## Stable native boundary

The native verified-release handoff remains intentionally simple:

```text
system/entrypoint
 -> system/surface/entrypoint
 -> system/surface/bin/ordax-surface
```

`system/surface/entrypoint` is the stable native launch boundary. The current `bin/ordax-surface` is still the bootstrap-console implementation and remains the safe native fallback until the graphical host/runtime is proven on the booted OS. Adding the shared visual source does not falsely claim native graphical boot support.

Do not add a plugin/launcher framework merely to prepare for runtime replacement; the stable entrypoint already supplies the required indirection.

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
