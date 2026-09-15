# OrdaX Creator

`tools/creator/` is the single source root for OrdaX physical-media creation.

The permanent end-user experience lives inside OrdaX Desktop, but the first prototype may publish a small `ordax-creator.exe` shell before the complete Desktop UI exists. Both use the same Creator Core; a second flasher implementation is forbidden.

Goal: prepare USB media and, later, native SSD/HD installation without requiring Codex, WSL, QEMU or a kernel toolchain on the user's machine.

```text
tools/creator/
  core/                 # host-neutral policy, payload verification and write planning
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
- Creator payload integrity verification;
- write-plan generation;
- fail-closed physical-write authorization;
- post-write verification contract;
- recovery/retry semantics.

Platform adapters own only unavoidable host API integration. They may not define another OrdaX layout or security policy.

## Creator payload boundary

`source_path` in `docs/contracts/minimal-bootstrap.json` never means an arbitrary path on a CI runner or developer workstation. It is a slash-separated path **relative to the assembled Creator payload root**.

Before a future physical `apply`, the Core must independently verify every local source artifact against the SHA-256 pinned in the manifest.

The Core rejects:

- absolute source paths;
- `..` traversal;
- backslash/path ambiguity;
- symlink traversal in the payload;
- non-regular artifact files;
- malformed hashes or modes;
- duplicate target paths on the same partition;
- any missing or byte-modified artifact.

Payload verification is intentionally separate from destructive authorization. A complete payload can and must be verified while `physical_write_allowed=false`.

## Current implementation state

The Core and `ordax-creator` command can validate the canonical manifest. `verify-payload` is implemented for a fully resolved payload, while physical planning still refuses to proceed until the manifest is explicitly authorized.

```text
CHECK=IMPLEMENTED
VERIFY_PAYLOAD=IMPLEMENTED_FAIL_CLOSED
PLAN=FAIL_CLOSED_UNTIL_MANIFEST_AUTHORIZED
APPLY=NOT_IMPLEMENTED
PHYSICAL_USB_WRITE=NO
```

Example once the manifest is fully resolved:

```text
ordax-creator verify-payload \
  --manifest docs/contracts/minimal-bootstrap.json \
  --payload-root <assembled-payload-directory>
```

The Windows and Linux executables built by CI are candidate engineering artifacts only. They do not yet write disks.

See `docs/CREATOR-INSTALLATION.md`.
