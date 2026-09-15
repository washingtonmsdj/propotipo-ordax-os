# OrdaX Creator

`tools/creator/` is the single source root for OrdaX physical-media creation.

The permanent end-user experience lives inside OrdaX Desktop, but the first prototype may publish a small `ordax-creator.exe` shell before the complete Desktop UI exists. Both use the same Creator Core; a second flasher implementation is forbidden.

Goal: prepare USB media and, later, native SSD/HD installation without requiring Codex, WSL, QEMU or a kernel toolchain on the user's machine.

```text
tools/creator/
  core/                 # host-neutral policy and deterministic write planning
  cmd/
    ordax-creator/      # thin prototype CLI/shell around the same Core
  platform/
    windows/            # thin raw-disk/elevation adapter
    linux/              # optional later adapter
    macos/              # optional later adapter
```

The shared Core owns:

- artifact selection;
- canonical two-partition validation;
- signature/hash policy;
- write-plan generation;
- fail-closed physical-write authorization;
- post-write verification contract;
- recovery/retry semantics.

Platform adapters own only unavoidable host API integration. They may not define another OrdaX layout or security policy.

## Current implementation state

The initial Core and `ordax-creator` command can validate `docs/contracts/minimal-bootstrap.json` and intentionally refuse a physical write plan while the manifest remains unresolved or unauthorized.

Current safety contract:

```text
CHECK=IMPLEMENTED
PLAN=FAIL_CLOSED_UNTIL_MANIFEST_AUTHORIZED
APPLY=NOT_IMPLEMENTED
PHYSICAL_USB_WRITE=NO
```

The Windows and Linux executables built by CI are candidate engineering artifacts only. They do not yet write disks.

See `docs/CREATOR-INSTALLATION.md`.
