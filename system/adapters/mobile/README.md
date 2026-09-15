# Mobile Capability Adapter

Status: ARCHITECTURE BOUNDARY — IMPLEMENTATION TARGET

`system/adapters/mobile/` is the single mobile capability boundary for Android and iOS.

It must not become a second product Surface or separate app tree.

```text
shared Surface / apps / services
        |
        v
mobile capability contracts
        |
        +-> Android native bridge
        +-> iOS native bridge
```

## Responsibilities

The adapter may expose explicitly modeled capabilities such as:

- native notifications;
- secure device storage;
- camera and media picker;
- share sheet / intent integration;
- biometric local gate;
- connectivity/lifecycle state;
- background refresh where the platform permits it;
- local file import/export within platform sandbox rules;
- deep links and universal/app links;
- app-version/update-channel metadata.

## Forbidden authority

Mobile must not expose:

- arbitrary privileged command execution;
- raw disk writing;
- OrdaX USB Creator authority;
- release-signing private keys;
- another device's private identity keys;
- host OS ownership semantics that only USB/native OrdaX has.

## Shared account and sync

Android and iOS use the same OrdaX account model as Web, Desktop and bootable/native OrdaX.

The mobile adapter owns platform lifecycle and secure-storage integration only. Sync semantics, conflict policy, entitlement interpretation and user-data classification belong to shared services.

A mobile client may cache approved synchronized data for offline use and reconcile later through the canonical sync service.

## Platform-specific code

Android/iOS-specific code is allowed only below this adapter for real platform differences. Shared business behavior must not be duplicated in separate Android and iOS implementations.

The choice of packaging/runtime technology is intentionally not made here. React Native, Capacitor, native shells or another option may be evaluated later without changing this boundary.
