# OrdaX Creator

`tools/creator/` is the single source root for OrdaX physical-media creation.

The permanent end-user experience belongs inside OrdaX Desktop, but the prototype may publish a small `ordax-creator.exe` shell before the complete Desktop UI exists. Both must use the same Creator Core; a second flasher policy implementation is forbidden.

Goal: prepare USB media and, later, native SSD/HD installation without requiring Codex, WSL, QEMU or a kernel toolchain on the user's machine.

```text
tools/creator/
  core/                 # host-neutral policy, payload verification and write planning
  proof/                # non-destructive disposable GPT/filesystem proof
  cmd/
    ordax-creator/      # thin prototype CLI/shell around the same Core
  platform/
    windows/            # future thin raw-disk/elevation adapter
    linux/              # optional later adapter
    macos/              # optional later adapter
```

The shared Core owns:

- artifact selection;
- canonical two-partition validation;
- signature/hash policy boundaries;
- Creator payload integrity verification;
- transactional disposable filesystem-tree staging;
- write-plan generation;
- fail-closed physical-write authorization;
- post-write verification contract;
- recovery/retry semantics.

Platform adapters own only unavoidable host API integration. They may not define another OrdaX layout or security policy.

## Creator payload boundary

`source_path` in `docs/contracts/minimal-bootstrap.json` means a slash-separated path **relative to the assembled Creator payload root**, never an arbitrary developer/runner path.

Before any future physical `apply`, the Core must independently verify every local source artifact against the SHA-256 pinned in the manifest.

The Core rejects:

- absolute source paths;
- `..` traversal;
- backslash/path ambiguity;
- symlink traversal in the payload;
- non-regular artifact files;
- malformed hashes or modes;
- duplicate target paths on the same partition;
- missing or byte-modified artifacts.

Payload verification remains independent from destructive authorization. Verified bytes do not imply permission to write a disk.

## Transactional `stage-tree`

`stage-tree` is a non-destructive Creator Core operation. It preflights the complete manifest/payload, builds a sibling temporary tree, fsyncs and re-hashes copied files, creates the logical runtime roots, and publishes the output only after all checks pass.

Published shape:

```text
ORDAX-ESP/
ORDAX/
```

Main-partition targets are required to live below `/ordax/...` and map below the `ORDAX/` mirror. `releases/`, `state/` and `home/` are created under that mirror.

On any copy-time or validation failure, no partial payload is published at the requested output path and temporary staging is removed.

## Disposable GPT/filesystem proof

The source tree now also contains `tools/creator/proof/disposable_media.py`, which consumes a fully staged Creator tree and creates a **regular disposable RAW file only**. It proves the geometry in `docs/contracts/physical-media.json`:

```text
GPT
├── ORDAX-ESP  FAT32  256 MiB
└── ORDAX      ext4   fill remaining usable space
```

The proof verifies:

- valid GPT;
- exactly two partitions;
- expected start LBAs/type GUIDs;
- FAT32/ext4 filesystem types and labels;
- staged file SHA-256 after extraction from each filesystem;
- required ext4 directories;
- partition-image bytes after embedding into the RAW file;
- `physical_write_authorized=false` throughout.

`.github/workflows/creator-disposable-media.yml` routes its input through the Creator Core `stage-tree` first, then runs the GPT/filesystem proof. CI publishes only `proof.json`; the RAW is ephemeral and deleted.

## Release bootstrap inputs

The release-channel pointer is now canonical and hash-bound in the minimal-bootstrap manifest:

```text
/ordax/bootstrap/config/release-envelope-url
 -> https://github.com/washingtonmsdj/prototipo-ordax-os/releases/latest/download/release-envelope.json
```

This URL is only a delivery selector. Authenticity still depends on the unresolved local Ed25519 public trust anchor:

```text
/ordax/bootstrap/trust/release-ed25519.json
```

No private signing key belongs in Git, Creator payloads or downloadable installers.

## Current implementation state

The Windows Creator now has a native graphical shell. Normal users select an eligible USB in the window and never need Prompt, PowerShell or a `.cmd` file. The destructive path remains fail-closed until a publisher-bound physical candidate is available.

```text
CREATOR_NATIVE_WINDOWS_GUI=IMPLEMENTED
USB_TARGET_DISCOVERY=IMPLEMENTED
SYSTEM_DISK_EXCLUSION=IMPLEMENTED
TARGET_REENUMERATION=IMPLEMENTED
DESTRUCTIVE_CONFIRMATION_UI=IMPLEMENTED
WINDOWS_UAC_HANDOFF=IMPLEMENTED
RAW_DISK_BACKEND=IMPLEMENTED_BUILD_TAGGED
PREPARE_EXACT_TARGET_IMAGE=IMPLEMENTED_GATED
PHYSICAL_APPLY_FLOW=IMPLEMENTED_GATED
POST_WRITE_READBACK=IMPLEMENTED_GATED
PHYSICAL_SIGNED_CHANNEL=IMPLEMENTED
OFFLINE_LAST_KNOWN_GOOD_PHYSICAL_BACKEND=IMPLEMENTED
CREATOR_DEV_CHANNEL=READ_ONLY
EXPLICIT_OWNER_AUTHORIZATION_FIRST_USB=RECORDED
CANONICAL_RELEASE_TRUST=PENDING
AUTHORIZED_PHYSICAL_CANDIDATE=PENDING_CANONICAL_TRUST
PHYSICAL_USB_WRITE=BLOCKED_UNTIL_PROMOTION_GATES_PASS
```

The development `OrdaX-Creator.exe` is intentionally useful for the graphical workflow, automatic development updates and safe USB discovery, but it cannot acquire a raw writer because its physical trust binding is unresolved. This separation prevents an ordinary development build from becoming destructive by accident.

The final physical flow is already wired:

```text
OrdaX-Creator.exe
 -> refresh signed physical channel
 -> select verified USB target
 -> explicit destructive confirmation
 -> prepare exact-size GPT image
 -> Windows UAC elevation
 -> raw write to the reverified target only
 -> flush + byte-complete readback verification
 -> success / fail-closed result in the GUI
```

Canonical publisher trust and the purpose-bound signed physical release must be completed before that flow is enabled for the first real USB.

Examples for non-destructive engineering verification:

```text
ordax-creator verify-payload \
  --manifest docs/contracts/minimal-bootstrap.json \
  --payload-root <assembled-payload-directory>

ordax-creator stage-tree \
  --manifest docs/contracts/minimal-bootstrap.json \
  --payload-root <assembled-payload-directory> \
  --output-root <disposable-directory>
```

See `docs/CREATOR-INSTALLATION.md`, `docs/PHYSICAL-MEDIA.md`, `docs/RELEASE-TRUST-CEREMONY.md` and `docs/PROMOTION-GATES.md`.
