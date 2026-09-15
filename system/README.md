# Shared OrdaX System

`system/` is the single source for the user-facing OrdaX product delivered after bootstrap.

It is shared by Web, USB and native-disk modes.

```text
system/
  surface/       # desktop, shell, windows, explorer, settings, design system
  apps/          # first-party apps
  services/      # shared product/domain services
  adapters/
    web/         # browser capabilities
    native/      # OrdaX native capabilities
```

Rules:

- never create separate Web/native UI forks;
- shared visual changes live in `surface/` only;
- shared app changes live in `apps/` only;
- environment-specific behavior is behind capability interfaces;
- private device state never belongs here;
- this tree is materialized into versioned releases on native OrdaX.
