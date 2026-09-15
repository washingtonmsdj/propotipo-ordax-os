# Shared OrdaX System

`system/` is the single source for the user-facing OrdaX product delivered across Web, Desktop, USB and native-disk modes.

These modes are capability tiers of one product, not UI or application forks.

```text
system/
  surface/       # desktop, shell, windows, explorer, settings, design system
  apps/          # first-party apps
  services/      # shared product/domain services
  adapters/
    web/         # browser capabilities
    desktop/     # host desktop capabilities; Windows first
    native/      # OrdaX OS capabilities shared by USB/native where genuine
```

Rules:

- never create separate Web/Desktop/native Surface forks;
- shared visual changes live in `surface/` only;
- shared app changes live in `apps/` only;
- shared domain behavior lives in `services/`;
- environment-specific behavior is behind capability interfaces in `adapters/`;
- Desktop raw-device operations are explicit privileged capabilities, not general Surface authority;
- private device state and secrets never belong here;
- this tree is materialized into versioned releases for bootable/native OrdaX and packaged through the same shared source for Web/Desktop;
- a product change should reach every applicable mode from the same source commit rather than manual ports.
