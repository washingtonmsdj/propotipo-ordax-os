# OrdaX Desktop Adapter

Status: CANONICAL BOUNDARY — IMPLEMENTATION PENDING

`system/adapters/desktop/` is the only user-product boundary allowed to translate shared OrdaX capabilities into APIs provided by a host desktop operating system.

The first supported host is Windows. Other desktop hosts may be added later without forking `system/surface/` or `system/apps/`.

## Authority model

OrdaX Desktop runs as a normal user application by default.

```text
system/surface
  -> capability interfaces
     -> system/adapters/desktop
        -> unprivileged desktop runtime
           -> narrow privileged helper only for an approved operation
```

The desktop runtime must not expose a generic privileged shell, arbitrary command execution, or unrestricted raw-device API to the Surface.

## Initial capabilities

The adapter may implement these capability families:

- local file open/save and user-selected directory access;
- native notifications;
- app protocol/deep-link handling;
- safe background work supported by the host;
- local application/file integration;
- desktop application version and signed updater state;
- OrdaX release download and cryptographic verification;
- removable-device discovery;
- explicit OrdaX USB creation and post-write verification;
- bootable-device pairing, diagnostics and recovery assistance.

Every capability must declare whether it is:

- unprivileged;
- user-consent gated;
- privileged-helper gated;
- unavailable on the current host.

## Creator capability

USB creation belongs to OrdaX Desktop but is not ordinary application authority.

The flow is:

```text
Surface
  -> request create-media
  -> desktop adapter validates intent
  -> identify removable target fail-closed
  -> request explicit user authorization
  -> privileged helper receives a narrow typed operation
  -> write only the selected removable target
  -> read back and verify
  -> return structured receipt
```

The helper must reject ambiguous disk identity, internal-system disks, unsigned/unverified OrdaX artifacts, and operations outside its allowlist.

The Surface never receives raw privileged handles.

## Update separation

Two update channels exist and must never be conflated:

```text
OrdaX Desktop application
  -> signed desktop-app updater

OrdaX bootable/native system
  -> verified OrdaX release acquisition/activation
```

Updating the Windows application must not silently write a USB or alter the host boot configuration. Downloading an OrdaX OS release must not silently install it to an internal disk.

## Shared Surface invariant

Desktop-specific code may provide capabilities and host chrome integration, but must not recreate:

- desktop UI;
- window manager UI;
- settings UI;
- first-party apps;
- design tokens;
- account/product behavior.

Those remain in the shared `system/surface/`, `system/apps/` and `system/services/` trees.

## Implementation baseline

A thin webview/native shell architecture is preferred because it can consume the same shared Surface directly while keeping privileged code behind a native boundary. Tauri is the current leading implementation candidate for the Windows-first shell, but framework choice is not an architectural invariant and must remain replaceable.

No private signing key, device private key, access token or release-authority secret belongs in this directory or in a shipped client bundle.
