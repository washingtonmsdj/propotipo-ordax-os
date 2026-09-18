# OrdaX Release Compliance

Status: REQUIRED BEFORE FIRST PUBLIC RELEASE

This document defines the repository-side release gate for license notices, source-compliance material and software inventory.

It does **not** decide the legal license of OrdaX product code. Product licensing remains a separate owner decision. This gate exists so a public binary release cannot be published without the compliance material that belongs beside it.

## Why this is separate from the product repository license

A public OrdaX release can contain multiple classes of software:

- OrdaX-owned product code;
- the Linux kernel and selected kernel modules;
- Alpine base/runtime packages;
- firmware and other redistributable binary components;
- libraries pulled transitively by the graphical/runtime stack.

Those components do not share one license merely because they ship in one image.

The release pipeline therefore treats compliance as release metadata rather than a single repository-wide assumption.

## Required public-release artifacts

Every release that appears in `platform/releases/publications.json` must carry three independently downloadable compliance artifacts:

1. **SBOM** — machine-readable inventory of the shipped software components;
2. **THIRD-PARTY-NOTICES** — human-readable notices/license attributions required for the shipped component set;
3. **source bundle** — the source-compliance package for components whose distribution terms require source availability.

Each artifact is bound to the public release with:

- a same-origin immutable path;
- exact byte size;
- SHA-256;
- explicit compliance authorization.

A release cannot enter the public download catalog when one of these is missing.

## Source bundle scope

The source bundle is not defined as “the entire OrdaX repository”.

It must contain the source material required for the exact shipped release according to the licenses of the included third-party components. The Linux kernel source/patch/config provenance is an obvious input for Native/USB releases, but the exact contents of a future source-compliance bundle must be generated from the final release inventory.

Do not use this mechanism to publish proprietary OrdaX source accidentally.

## Current state

There is no authorized public release yet:

```text
PRODUCTION_RELEASE_PUBLISHED=NO
PUBLIC_RELEASE_COUNT=0
```

Therefore no fake SBOM, notice file or source bundle is generated today.

The contract is fail-closed: the first release must supply real artifacts before it can be listed.

## Pipeline direction

```text
release candidate
 -> final shipped component inventory
 -> SBOM generation
 -> license/notice resolution
 -> source-compliance bundle
 -> artifact hashes + byte sizes
 -> compliance authorization
 -> public release authorization
 -> /releases/catalog.json
 -> public Download + Licenças pages
```

## Machine-readable contracts

- `docs/contracts/release-compliance.json`
- `docs/contracts/public-release-catalog.json`
- `platform/releases/publications.json`

## Legal review boundary

Automation can prove presence, identity, integrity and traceability of compliance artifacts. It cannot by itself determine that every legal obligation has been interpreted correctly. A production commercial release should still receive a final license/compliance review of the actual shipped component set.
