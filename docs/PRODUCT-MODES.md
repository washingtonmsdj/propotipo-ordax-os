# Product Modes

Status: CANONICAL FOR PROTOTYPE

## One product, four execution modes

OrdaX is one product with one identity, one Surface, one application model and shared synchronized state.

```text
OrdaX Web
   -> OrdaX Desktop
   -> OrdaX USB
   -> OrdaX Native
```

These are capability tiers, not separate products or forks.

### 1. OrdaX Web

Runs in a browser with the smallest native capability envelope. It is the zero-install entry point and must use the real shared Surface and app source.

### 2. OrdaX Desktop

A normally installed desktop application for Windows first, with other host platforms allowed later. It is the intermediate tier between the browser and the bootable operating system.

It provides capabilities a browser cannot safely or reliably provide, including:

- controlled local filesystem access;
- native notifications;
- background tasks where the host platform allows them;
- local integration with files and applications;
- authenticated local device identity;
- signed automatic application updates;
- download and verification of OrdaX boot artifacts;
- creation and verification of OrdaX USB media through the privileged Creator capability;
- pairing, recovery assistance and diagnostics for a booted OrdaX device.

OrdaX Desktop is not the OrdaX operating system and must never pretend to own raw host hardware by default. Privileged operations such as writing removable media require a narrow, explicit capability boundary and separate user authorization.

The former standalone concept of `OrdaX Creator` becomes a capability of OrdaX Desktop instead of a second end-user product. A small standalone recovery creator may exist later only if there is a proven recovery need.

### 3. OrdaX USB

Boots the real OrdaX operating system from removable media. It owns the machine while booted and therefore has substantially broader capabilities than Web or Desktop.

### 4. OrdaX Native

Installs the OrdaX operating system to internal SSD/HD. It is the most persistent deployment mode, but it must consume the same release model as OrdaX USB rather than becoming a fork.

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
surface-desktop/
surface-usb/
surface-native/
apps-web/
apps-desktop/
apps-native/
```

A visual change must not need to be repeated for another target. If one color, spacing value, component or app behavior changes in shared Surface source, every mode receives that same change when it consumes the corresponding commit/release.

## Capability adapters

Differences between execution environments live only behind capability interfaces.

Examples:

- filesystem access;
- process/service control;
- raw removable-device access;
- networking details;
- battery/hardware telemetry;
- native notifications;
- installer/update operations;
- boot-media creation;
- local application integration.

The UI must consume capability contracts, not platform-specific APIs directly.

Target adapters:

```text
system/adapters/web/
system/adapters/desktop/
system/adapters/native/
```

`native` is shared by USB and internal OrdaX installations wherever the capability is genuinely the same. Platform-specific code below an adapter is allowed only where the host operating system, firmware or hardware genuinely requires it. It must remain thin and must not fork product behavior.

## Desktop security boundary

The Desktop application must separate its unprivileged UI/runtime from privileged host operations.

```text
shared Surface
   -> desktop capability adapter
      -> unprivileged desktop runtime
         -> narrow privileged helper only when required
```

The privileged helper must expose explicit operations rather than arbitrary command execution. Raw disk access is reserved for removable-media creation/recovery flows and must fail closed on ambiguous device identity.

Private device keys, signing keys and release-authority secrets never ship in the application repository or client package.

## Update model

All four modes evolve from versioned releases, but installation mechanics differ:

```text
Web       -> deployment refresh
Desktop   -> signed application update
USB       -> verified OrdaX release activation
Native    -> verified OrdaX release activation
```

Desktop updates must behave like a normal desktop application: versioned, signed, verifiable, resumable where practical and rollback-safe. Desktop application updates are distinct from OrdaX OS releases, even when both originate from the same repository commit.

The Desktop application may download, verify and prepare an OrdaX OS release, but it must not silently convert a host Windows installation into OrdaX Native.

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

## Desktop is a real OrdaX mode

OrdaX Desktop is not merely an installer. A user can remain on Desktop indefinitely if that capability tier is enough for their needs.

It should feel like the same OrdaX environment as Web and bootable OrdaX, while exposing host-safe native capabilities through the desktop adapter.

## Promotion path

A user can gain capability without changing product identity:

```text
OrdaX Web
  -> install OrdaX Desktop
  -> sign in / restore synchronized environment
  -> optionally create OrdaX USB inside Desktop
  -> boot OrdaX USB
  -> pair / restore synchronized environment
  -> optionally install OrdaX Native on SSD/HD
```

The goal is continuity of identity, Surface, apps and synchronized user state across every tier while keeping each environment's authority boundary explicit.
