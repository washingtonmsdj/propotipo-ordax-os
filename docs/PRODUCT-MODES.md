# Product Modes

Status: CANONICAL FOR PROTOTYPE

## One product, three execution modes

OrdaX is one product with one account, one Surface and one application model.

```text
OrdaX Web
   -> OrdaX USB
   -> OrdaX Native (SSD/HD)
```

These are capability tiers, not separate products or forks.

## Single-source Surface

The same source files must implement the visual shell, desktop, windows, apps, settings and shared interaction behavior for every supported mode.

```text
system/surface/      # one visual source
system/apps/         # one app source
system/services/     # shared service/domain logic
system/adapters/     # environment capabilities only
```

Forbidden architecture:

```text
surface-web/
surface-native/
apps-web/
apps-native/
```

A visual change must not need to be repeated for another target. If one color, spacing value, component or app behavior changes in shared Surface source, all modes receive that same change when they consume that commit/release.

## Capability adapters

Differences between web and native environments live only behind capability interfaces.

Examples:

- filesystem access;
- process/service control;
- raw device access;
- networking details;
- battery/hardware telemetry;
- native notifications;
- installer/update operations.

The UI must consume capability contracts, not platform-specific APIs directly.

Target adapters:

```text
system/adapters/web/
system/adapters/native/
```

Platform-specific code below the native adapter is allowed only where the operating system or firmware genuinely requires it. It must remain thin and must not fork product behavior.

## Synchronization model

User-visible state that is safe and meaningful to synchronize should follow the user's OrdaX identity across modes.

Examples:

- theme and appearance;
- desktop layout;
- app preferences;
- installed/enabled app metadata;
- workspace metadata;
- selected documents/data when cloud sync is enabled.

Device-local state must remain local.

Examples:

- private device keys;
- machine identity secrets;
- hardware drivers;
- caches and temporary data;
- raw disk state;
- secrets bound to one installation.

## Web is a real OrdaX mode

OrdaX Web is not a screenshot, mock or separate demo. It runs the real shared Surface and app source with the web capability adapter.

Capabilities unavailable in a browser must degrade explicitly through the capability contract rather than causing a second UI implementation.

## Promotion path

A user should be able to start on the web and later gain native capabilities without changing product identity:

```text
OrdaX Web
  -> download OrdaX Creator
  -> create USB
  -> boot OrdaX USB
  -> sign in / pair
  -> restore synchronized environment
  -> optionally install OrdaX Native on SSD/HD
```

The goal is continuity of identity, Surface, apps and synchronized user state across all three modes.
