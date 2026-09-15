# Product Modes

Status: CANONICAL FOR PROTOTYPE

## One product, five execution modes

OrdaX is one product with one identity, one Surface, one application model and shared synchronized state.

```text
OrdaX Web
   -> OrdaX Mobile (Android / iPhone)
   -> OrdaX Desktop
   -> OrdaX USB
   -> OrdaX Native
```

These are capability tiers, not separate products or forks.

### 1. OrdaX Web

Runs in a browser with the smallest native capability envelope. It is the zero-install entry point and must use the real shared Surface and app source.

### 2. OrdaX Mobile

Runs as a normally installed Android or iOS application and uses the same OrdaX account, shared application model and design system.

Mobile is not a reduced Desktop port. It is its own first-class capability target: stronger than Web for notifications, camera/media, secure device storage, biometrics and offline use, but intentionally without raw-disk, boot-media or arbitrary privileged-host authority.

Android- and iOS-specific behavior must remain behind the mobile capability adapter. The product Surface and app logic must not fork into separate Android/iPhone implementations unless a platform rule makes a thin native bridge unavoidable.

### 3. OrdaX Desktop

A normally installed desktop application for Windows first, with other host platforms allowed later. It is the intermediate tier between browser/mobile access and the bootable operating system.

It provides capabilities a browser cannot safely or reliably provide, including controlled local filesystem access, native notifications, background tasks where allowed, local application integration, signed automatic updates and the privileged Creator capability for preparing OrdaX USB media.

OrdaX Desktop is not the OrdaX operating system and must never own raw host hardware by default. Privileged operations require a narrow, explicit capability boundary and separate user authorization.

### 4. OrdaX USB

Boots the real OrdaX operating system from removable media. It owns the machine while booted and therefore has substantially broader capabilities than Web, Mobile or Desktop.

### 5. OrdaX Native

Installs the OrdaX operating system to internal SSD/HD. It is the most persistent deployment mode, but consumes the same release model as OrdaX USB rather than becoming a fork.

## One account across all devices

The user has one OrdaX identity, not one account per device or product mode.

```text
one OrdaX account
  -> Web session
  -> Android phone/tablet
  -> iPhone/iPad
  -> Windows Desktop
  -> OrdaX USB
  -> OrdaX Native
```

Signing in on another supported device restores the safe synchronized portion of the user's environment according to account entitlements and device capability.

Account identity and basic cross-device continuity must not be paywalled. Plans may expand synchronization capacity and premium services, but must not create incompatible account silos.

See `docs/ACCOUNT-SYNC-AND-PLANS.md`.

## Single-source Surface

The same source files implement the visual shell, apps, settings, design tokens and shared interaction behavior for every supported mode where that UI is applicable.

```text
system/surface/      # one visual source
system/apps/         # one app source
system/services/     # shared service/domain logic
system/adapters/     # environment capabilities only
```

Target adapters:

```text
system/adapters/web/
system/adapters/mobile/
system/adapters/desktop/
system/adapters/native/
```

`mobile` owns Android/iOS capability differences; `native` is shared by USB and internal OrdaX installations wherever the capability is genuinely the same.

Forbidden architecture includes separate application trees such as `apps-android/`, `apps-ios/`, `apps-desktop/` or independent Surface forks. Thin native bridges are allowed only for genuine platform APIs.

## Capability adapters

Differences between execution environments live only behind capability interfaces. Examples include filesystem access, networking details, camera/media, biometrics, native notifications, background tasks, installer/update operations, raw removable-device access and boot-media creation.

The UI consumes capability contracts, not platform-specific APIs directly.

## Mobile security boundary

Mobile clients must use platform secure storage for device-bound credentials/tokens where appropriate and must never receive release signing keys, device-private keys from another installation, raw disk authority or arbitrary privileged-command capabilities.

Biometric authentication may gate local access to a session or secret, but it does not replace the canonical account/authentication model.

## Desktop security boundary

The Desktop application separates its unprivileged UI/runtime from privileged host operations. The privileged helper exposes explicit operations rather than arbitrary command execution. Raw disk access is reserved for removable-media creation/recovery and fails closed on ambiguous device identity.

## Update model

All modes evolve from versioned source, but installation mechanics differ:

```text
Web       -> deployment refresh
Mobile    -> signed/store application update
Desktop   -> signed application update
USB       -> verified OrdaX release activation
Native    -> verified OrdaX release activation
```

Client application updates and OrdaX OS releases are distinct delivery channels even when both originate from the same repository commit.

## Synchronization model

Safe, meaningful user state follows the user's OrdaX identity across modes. Examples include appearance, preferences, workspace metadata, app-state metadata and user-selected cloud content.

Device-local secrets never synchronize. Examples include private device keys, machine identity secrets, hardware drivers, raw disk state and ephemeral caches.

Sync must be offline-tolerant, server-authorized, encrypted in transit and have an explicit conflict-resolution model before production promotion.

## Plans

Pricing is intentionally not defined at foundation stage. Product plans are entitlement bundles, not different account systems.

Baseline policy:

- one identity works across every supported mode;
- basic cross-device sync is available to every account;
- paid plans may increase cloud storage, history retention, backups, collaboration, premium AI compute and recovery/support capabilities;
- downgrading a plan must not silently destroy user data;
- entitlement enforcement is server-authoritative;
- device-private security material is never made syncable by a higher plan.

## Promotion path

A user can gain capability without changing product identity:

```text
OrdaX Web / Mobile
  -> sign in and restore synchronized environment
  -> optionally install OrdaX Desktop
  -> optionally create OrdaX USB inside Desktop
  -> boot OrdaX USB
  -> restore synchronized environment
  -> optionally install OrdaX Native on SSD/HD
```

The goal is continuity of identity, Surface, apps and safe synchronized user state across every tier while keeping each environment's authority boundary explicit.
