# OrdaX Internet

Status: PROTOTYPE IMPLEMENTATION — NATIVE HARDWARE PROOF PENDING

## Goal

`Internet` is the OrdaX first-party browser application. Its product flow is:

```text
browse
 -> organize tabs inside the current workspace
 -> save an explicit page reference to a project
 -> add project-owned notes
 -> optionally ask for assistance with user-selected context
 -> continue the work later
```

The visual direction follows the OrdaX browser concept: conventional navigation at the top, workspace/tab organization at the left, the web page as the primary center surface, and a collapsible project-context panel at the right.

This application is being implemented in the clean-room prototype. It does not import the legacy `ordax.browser` implementation or any old browser directory wholesale.

## Non-negotiable security boundary

Arbitrary websites are untrusted content. They must never execute inside the privileged OrdaX Surface WebView and must never receive Surface/native capability bridges.

Therefore the native implementation has two planes:

```text
privileged plane
  OrdaX Surface WebView
  -> shared browser chrome
  -> workspace/project UI
  -> narrow browser-session bridge

unprivileged web-content plane
  separate WebKit WebContext
  -> separate WebViews per tab
  -> normal external HTTP/HTTPS content
  -> no OrdaX privileged message handler
```

The shared Surface only owns browser chrome and orchestration. The native adapter owns the engine boundary. This keeps the product aligned with the repository rule that platform differences are capability adapters rather than copied applications.

## Native engine

The USB/native-disk runtime uses the WebKitGTK 4.1 engine already appropriate to the Alpine graphical runtime, but the OrdaX host owns the application integration instead of delegating product behavior to a generic browser shell.

`system/surface/runtime/ordax_browser_host.py` owns:

- one privileged Surface WebView with the `ordaxBrowser` message handler;
- a separate persistent website-data manager for external browsing;
- one unprivileged WebView per browser tab;
- tab lifecycle, navigation history and viewport placement;
- durable restoration of public tab URLs, tab order and the active tab across Surface restarts;
- default-deny website permission requests in the first implementation slice;
- fail-closed rejection of localhost, loopback, private/link-local and other non-public literal IP navigation;
- filtering of external WebView resource requests and redirects so literal/local non-public network targets are not intentionally dispatched by the browser plane;
- blocked downloads until a dedicated user-space download contract is connected.

The external browsing profile is persisted beneath:

```text
/var/lib/ordax-user/browser/
├─ session.json
└─ default/
   ├─ data/
   └─ cache/
```

`session.json` is a small OrdaX-owned state file. It stores only the filtered public URL list and active-tab index, is written atomically with private permissions, is bounded to 16 tabs, and fails closed on missing, corrupt, oversized, symlinked or unsupported state. It does not serialize page HTML, privileged Surface state or website storage. Website data remains owned by the isolated WebKit profile.

That path is backed by the existing OrdaX user-state mount rather than a new physical partition.

### Loopback and DNS-rebinding status

The browser host rejects direct local/non-public network destinations both for top-level navigation and for WebKit resource requests. That closes the straightforward path where an Internet page tries to load `127.0.0.1`, RFC1918/private addresses, link-local addresses, single-label local hosts, `.local`, or `.home.arpa` targets as subresources.

The native loopback HTTP host now also owns the server-side request boundary. Every request must carry the exact bound `127.0.0.1:<port>` Host authority; privileged `/__ordax/native/` requests additionally reject explicit foreign Origin, Referer or Sec-Fetch-Site provenance. The live handler integration tests exercise canonical same-origin access, foreign-origin rejection and a DNS-rebinding-style public Host alias resolving to loopback. The server also refuses startup on a non-loopback bind.

This closes the previously documented source-level Host/origin gap. Hardware validation is still required before the browser slice is considered proven on the notebook, and the external WebKit plane remains independently constrained by its public-network policy.

## Shared application shell

The product shell lives in shared source:

```text
system/apps/internet/app.mjs
system/contracts/browser-session.mjs
system/surface/ui/internet-browser-controls.mjs
system/surface/ui/internet.css
```

Adapters:

```text
system/adapters/native/browser-session.mjs
system/adapters/web/browser-session.mjs
```

Native tab-session persistence is isolated from GTK/WebKit in:

```text
system/surface/runtime/browser_session_store.py
```

The shared app does not import native/Web adapters, call loopback control endpoints directly, or create an iframe for arbitrary sites.

## Capability

The engine boundary is represented by:

```text
browser.web-content
```

Security boundary:

```text
isolated-unprivileged-web-content
```

It is currently a baseline capability of `usb` and `native-disk`. The Web mode intentionally exposes an unavailable browser-session port instead of pretending that arbitrary websites can be embedded safely and reliably inside the Web Surface.

Desktop and mobile remain unclaimed until their adapters provide an equivalent isolation contract.

## First implementation slice

Implemented in source:

- first-party `Internet` app registration;
- visual browser shell based on the approved concept direction;
- address navigation;
- up to 16 native tabs;
- activate/close tabs;
- back/forward/reload;
- persistent per-profile WebKit website data;
- safe tab URL/order/active-tab restoration across Surface restarts;
- external-content isolation from Surface capabilities;
- direct local/non-public literal network target filtering for external navigation, subresources and redirects;
- explicit native capability advertisement;
- native runtime package ownership without a `barkery-browser` dependency;
- fail-closed Web-mode behavior;
- architecture regression tests;
- explicit project-owned web-reference persistence on Native/USB;
- bounded per-reference user notes stored with the saved page;
- automatic cleanup of saved web references when their project is removed;
- device-local browser favorites with canonical URL identity, explicit add/remove controls and session fallback when privileged profile storage is unavailable.

Intentionally not faked yet:

- collections/read-later/history persistence;
- downloads;
- website permission UI;
- private-session lifecycle;
- page-to-AI context extraction;
- desktop/mobile browser engines.

The concept surfaces these future controls, but disabled controls must remain honest until their domain owners and persistence/security contracts exist.

## Project/reference integration

`Salvar no projeto` now stores an explicit bounded reference owned by the project domain. It does not download the page and does not grant website JavaScript access to project storage.

The persisted record contains a stable reference id, project id, canonical HTTP/HTTPS URL, captured title, optional user note and created/updated timestamps. The same project/URL pair is updated in place rather than duplicated. Removing a project prunes its saved web references through the project-reference runtime. Persistence is device-scoped in the Native privileged profile and degrades honestly to session scope if durable storage is unavailable.

The shared Internet UI receives only neutral project/reference and browser-favorites ports. It does not use `localStorage`, Native endpoints or adapters directly.

Favorites are browser-owned rather than project-owned. The Native/USB composition persists them in the privileged Surface profile through `ordax.browser-favorites/1`; arbitrary website WebViews never receive that storage capability. A favorite stores only a stable local id, canonical HTTP/HTTPS URL, captured title and timestamps. Persistence degrades explicitly to session scope if privileged profile storage is unavailable.

Download and offline-copy semantics remain separate operations and still need separate storage, size, provenance and permission rules.

## Optional assistance direction

`Perguntar sobre esta página` is not an automatic website privilege. A future implementation must make the selected context explicit and mediate extraction through a bounded page-context contract. External page JavaScript never receives AI, file, project or system capabilities merely because a page is visible.

## Native delivery to the notebook

The notebook already materializes the Surface from the checked-out OrdaX source. This browser change replaces the generic Barkery host dependency with explicit GTK/WebKitGTK runtime packages and starts the OrdaX-owned graphical/browser host under Cage.

Normal delivery remains:

```text
main
 -> ordax-pull / normal update path
 -> affected Surface/native-host materialization
 -> Surface restart when required
```

No kernel rebuild or USB reflash is required solely for this application/runtime source change.

Physical hardware validation is still required before this slice can be called proven on the notebook. Until that proof exists, repository tests and CI validate structure and contracts but do not substitute for real keyboard/touchpad/GPU/network/WebKit behavior.

## Hardware proof checklist

On the notebook, validate in this order:

1. Surface starts under Cage with `ordax_browser_host.py` and reaches the normal desktop.
2. Internet app opens without changing another first-party app.
3. Address entry retains keyboard focus while a page is already visible.
4. External HTTPS page loads and scrolls in the center viewport only.
5. Top/left/right OrdaX browser chrome remains interactive around the page.
6. New tab, activate, close, back, forward and reload behave correctly.
7. Restarting the Surface restores the filtered public tab URL list, order and active tab, while normal WebKit profile data also persists.
8. Corrupt or invalid `session.json` state fails closed to a clean browser session.
9. `http://127.0.0.1`, `localhost`, private/link-local literal IPs and local-name navigation are rejected in the external content plane.
10. A remote page attempting local/non-public subresource loads or redirects does not dispatch those literal targets from the external WebView.
11. Native loopback Host/provenance pinning rejects a DNS-rebinding-style alias and foreign browser provenance on the real notebook runtime.
12. Website permission prompts fail closed in this slice.
13. Download attempts do not write files until the download contract exists.
14. Existing Files, Ajustes, Conta, Sistema, network, power and update paths remain healthy.
15. Update/health rollback still recovers if the new graphical host cannot remain healthy.
