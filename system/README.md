# Shared Product System

`system/` contains the implementation that defines one OrdaX product across Web, Mobile, Desktop, USB and native-disk modes.

These modes are capability tiers of one product, not UI or application forks.

```text
system/
  contracts/     # platform-neutral runtime interfaces/value shapes
  surface/       # shell, windows, explorer, settings, design system
  apps/          # first-party apps
  services/      # shared product/domain services, including account/sync
  adapters/
    web/          # browser capabilities
    mobile/       # Android/iOS capabilities behind one mobile boundary
    desktop/      # host desktop capabilities; Windows first
    native/       # OrdaX OS capabilities shared by USB/native where genuine
  composition/   # thin target wiring: shared Surface + exactly one environment adapter
```

The machine-readable capability boundary is `docs/contracts/product-capabilities.json`. The dependency direction is owned by `docs/contracts/module-boundaries.json`. Shared product code asks for platform-neutral contracts instead of importing a concrete platform adapter.

Rules:

- `contracts/` is the innermost neutral layer and must not depend on product implementations;
- `services/` owns shared domain policy and depends inward on contracts, never outward on presentation/adapters;
- `apps/` may use contracts/services but does not import concrete platform adapters;
- `surface/` composes shared presentation/apps/services but does not import concrete platform adapters;
- adapters implement environment-specific capabilities and cannot own copied screens, CSS, app policy or separate product logic;
- `composition/` is the only shared-system layer allowed to wire a concrete adapter to the shared Surface; it owns wiring only, never product policy or visual assets;
- never create separate Web/Mobile/Desktop/native Surface forks;
- never create independent Android and iOS product logic when a thin adapter is sufficient;
- shared visual changes live in `surface/` only;
- shared app changes live in `apps/` only;
- shared account, sync and domain behavior lives in `services/`;
- capability IDs are stable contracts: additive evolution is preferred and breaking semantic changes require a new ID or contract major;
- an unknown optional capability can be ignored, but an unknown required capability must fail closed;
- Mobile platform APIs such as notifications, biometrics, camera/media and secure storage stay behind `adapters/mobile/`;
- Desktop raw-device operations are explicit privileged Creator capabilities, not general Surface authority;
- private device state and secrets never belong in synchronized shared state;
- temporary compatibility bridges require an owner and removal condition; permanent ownerless bridges are forbidden;
- this tree is materialized into versioned releases for bootable/native OrdaX and packaged through the same shared source for Web/Mobile/Desktop;
- a product change should reach every applicable mode from the same source commit rather than manual ports.
