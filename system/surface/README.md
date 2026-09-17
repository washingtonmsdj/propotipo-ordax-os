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

The first graphical source lives under `system/surface/ui/` as standards-first HTML/CSS/JavaScript modules with no remote asset or framework dependency. This is an implementation baseline, not a permanent framework choice.

`surface-state.mjs` keeps interaction state independent from DOM rendering. `surface.mjs` mounts the shared UI against the platform-neutral `ordax.surface-host/1` contract. Design tokens and responsive behavior remain shared CSS.

Environment wiring is intentionally outside the Surface under `system/composition/`. The Web composition combines the shared Surface with `system/adapters/web/runtime.mjs`; Desktop/Mobile/native composition roots may select different adapters without copying the UI.

## Stable native boundary

The native verified-release handoff remains intentionally simple:

```text
system/entrypoint
 -> system/surface/entrypoint
 -> system/surface/bin/ordax-surface
```

`system/surface/entrypoint` is the stable native launch boundary. The owner/development USB attempts a thin native graphical host using the existing shared Web composition: Cage provides the DRM/Wayland kiosk compositor, Barkery/WebKitGTK provides the browser runtime, and a loopback-only HTTP server inside the replaceable graphical runtime gives the ES-module tree normal origin semantics. The Surface source itself is not duplicated.

The graphical stack is **not** part of the fixed Git-first development base. The base stops at kernel/hardware support, network, CA trust, Git and a minimal signed-package acquisition client. `bin/ordax-surface`, which arrives through `ordax-pull`, materializes the replaceable Cage/Barkery/Mesa runtime under `/state/ordax/runtime/native-surface/` from signed Alpine packages and launches it in a chroot. Therefore ordinary Surface/host/runtime changes remain pullable and do not require rewriting the USB image.

The first physical provisioning attempt proved the Git-first path and exposed that Alpine v3.22 no longer ships the earlier Cog package on x86_64. The native host therefore uses `barkery-browser`, which is available in Alpine v3.22 community and still renders the same checked-out Surface through WebKit. Runtime identity is versioned so a failed or obsolete host candidate under `/state` cannot be mistaken for the current one.

A later physical attempt proved the full Cage/Barkery runtime could be installed, but also exposed an incorrect dependency on an HTTP applet in the fixed bootstrap BusyBox. The bootstrap intentionally excludes that server applet. The Surface launcher now bind-mounts the checked-out `system/` tree into the graphical chroot and starts Python's loopback-only `http.server` from the already provisioned Barkery runtime. This keeps HTTP hosting inside replaceable Git-controlled runtime state rather than widening the immutable bootstrap.

The next physical attempt reached Cage/seatd and exposed three host prerequisites rather than a new bootstrap requirement: the development base had not configured IPv4 loopback, Alpine's Cage build expected an Xwayland binary, and wlroots rejected a seat with no discovered libinput devices. The Git-controlled launcher now brings `lo` up as `127.0.0.1/8`, prepares `/dev/shm`, extends an existing runtime in place with the small `xwayland` package instead of rebuilding the 642 MiB runtime, and accepts a no-input seat during graphical bring-up. These remain replaceable runtime/host concerns and therefore still do not justify a USB reflash.

A reflash/base update is reserved for the real bootstrap boundary: kernel, initramfs, hardware/driver/firmware support, or the minimal network/Git/acquisition substrate itself.

If DRM/KMS, network during first runtime acquisition, or another graphical host requirement is unavailable, `bin/ordax-surface` falls back to a maintenance console rather than inventing a second visual implementation. The fallback surfaces both native-host and loopback-HTTP diagnostics. Once provisioned under `/state`, the graphical runtime is reusable without downloading it on every boot. Native graphical boot remains a physical-hardware validation gate until the host is observed successfully on the target notebook.

Do not add a plugin/launcher framework merely to prepare for runtime replacement; the stable entrypoint already supplies the required indirection.

## Capability rule

Environment differences are consumed through platform-neutral contracts under `system/contracts/` and implemented by `system/adapters/`.

Shared Surface code may react to capability availability. It must not import concrete Web/Mobile/Desktop/native adapter implementations or branch on platform identity when the difference can be expressed as a capability.

The machine-readable boundaries are:

- `docs/contracts/product-capabilities.json`;
- `docs/contracts/module-boundaries.json`;
- `docs/contracts/runtime-configuration.json`.

## Rendering/runtime technology

The owner/development USB currently uses Cage + Barkery/WebKitGTK as the native host candidate because that keeps the graphical host replaceable while reusing the same Surface source. That host choice is not architectural authority: it may be replaced if physical evidence shows a better runtime.

Framework/runtime selection must satisfy the shared capability/module contracts and remain replaceable. Product/domain semantics belong to shared OrdaX source, not to a UI framework or host shell.

No target-specific visual fork is allowed.
