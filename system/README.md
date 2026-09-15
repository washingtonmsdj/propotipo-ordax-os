# Shared OrdaX System

`system/` is the single source for the user-facing OrdaX product delivered across Web, Mobile, Desktop, USB and native-disk modes.

These modes are capability tiers of one product, not UI or application forks.

```text
system/
  surface/       # shell, windows, explorer, settings, design system
  apps/          # first-party apps
  services/      # shared product/domain services, including account/sync
  adapters/
    web/         # browser capabilities
    mobile/      # Android/iOS capabilities behind one mobile boundary
    desktop/     # host desktop capabilities; Windows first
    native/      # OrdaX OS capabilities shared by USB/native where genuine
```

The machine-readable capability boundary is `docs/contracts/product-capabilities.json`. Shared product code should ask for a capability contract, not infer behavior from a platform name when the distinction can be expressed as a capability.

Rules:

- never create separate Web/Mobile/Desktop/native Surface forks;
- never create independent Android and iOS product logic when a thin adapter is sufficient;
- shared visual changes live in `surface/` only;
- shared app changes live in `apps/` only;
- shared account, sync and domain behavior lives in `services/`;
- environment-specific behavior is behind capability interfaces in `adapters/`;
- capability IDs are stable contracts: additive evolution is preferred and breaking semantic changes require a new ID or contract major;
- an unknown optional capability can be ignored, but an unknown required capability must fail closed;
- Mobile platform APIs such as notifications, biometrics, camera/media and secure storage stay behind `adapters/mobile/`;
- Desktop raw-device operations are explicit privileged Creator capabilities, not general Surface authority;
- private device state and secrets never belong in synchronized shared state;
- this tree is materialized into versioned releases for bootable/native OrdaX and packaged through the same shared source for Web/Mobile/Desktop;
- a product change should reach every applicable mode from the same source commit rather than manual ports.

Account continuity is cross-platform by design. See `docs/ACCOUNT-SYNC-AND-PLANS.md` for synchronization and entitlement boundaries.
