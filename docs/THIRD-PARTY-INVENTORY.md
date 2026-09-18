# Third-Party Input Inventory

Status: DECLARED INPUTS TRACKED / NOT A RELEASE SBOM

The repository now tracks the external inputs that OrdaX explicitly selects before a final image is assembled.

This inventory exists to make later license and source-compliance work deterministic. It is deliberately narrower than an SBOM.

## What is tracked today

`platform/compliance/declared-inputs.json` records three source-controlled input groups:

- the pinned Linux kernel source archive from `bootstrap/kernel/source.json`;
- the Alpine development-base version and explicitly requested packages from `bootstrap/dev-base/_build_core.py`;
- the replaceable native Surface runtime packages requested by `system/surface/bin/ordax-surface`.

The owner/development base also records `zstd` as build-only because it is pruned after image assembly.

## What this is not

This file is **not** the final list of everything shipped to a user.

Package managers can resolve transitive dependencies, firmware can carry separate terms, and final release composition can differ by target. The final SBOM must therefore be generated from the bytes/packages actually present in the release artifact.

The declared-input inventory is an earlier control:

```text
source-selected external inputs
 -> build
 -> final shipped bytes/packages
 -> release SBOM
 -> license/notice resolution
 -> source-compliance bundle
 -> public release gate
```

## License fields

License identifiers are intentionally unresolved in this inventory.

That is safer than copying assumptions into a machine-readable file. Before a public release, license metadata must be resolved against the exact final component versions and captured in the real SBOM/notices workflow.

The CI test rejects drift between this inventory and the repository's actual selected versions/package lists. It also rejects adding an SPDX identifier here while the record still says its license is unresolved.

## Machine-readable contract

See `docs/contracts/third-party-inventory.json`.

Public release requirements remain owned by `docs/RELEASE-COMPLIANCE.md` and `docs/contracts/release-compliance.json`.
