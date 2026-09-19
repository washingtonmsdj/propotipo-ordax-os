# Minimal USB Bootstrap

Status: CANONICAL FOR PROTOTYPE

## Goal

The bootstrap seed contains only the minimum trusted substrate required to boot and reach the selected acquisition mechanism. It is not a preinstalled copy of the complete OrdaX product.

There are two supported acquisition profiles:

- owner/development Git-first: network -> Git -> partial+sparse checkout of `main` -> `system/entrypoint`;
- canonical signed release: network -> signed release acquisition -> verification -> immutable activation.

The profiles share the same source authority (`main`) and the same principle: ordinary `system/` changes must not require reflashing the USB.

## Physical layout model

### Capacity-independent bootstrap seed

```text
ORDAX-ESP
ORDAX
```

Exactly two seed partitions.

The seed is capacity-independent and is the object described by `docs/contracts/physical-media.json`.

### Final USB prepared by the Creator

```text
ORDAX-ESP
ORDAX
ORDAX-DATA
```

Exactly three prepared-target partitions.

`ORDAX-DATA` is created by the Creator after target capacity is known. It is exFAT portable user-data space and is therefore intentionally absent from the signed/capacity-independent seed. Exact geometry and size policy live in `docs/contracts/physical-prepared-media.json`.

This does **not** introduce a separate HOME partition. `/ordax/home` remains a logical path in `ORDAX`.

## Bootstrap seed payload

### ORDAX-ESP

Only boot-critical material:

```text
UEFI bootloader
loader configuration
verified kernel
verified initramfs
recovery entry when required
```

### ORDAX main partition

Common roots are limited to bootstrap/runtime state. The exact payload depends on the acquisition profile.

Owner/development Git-first base:

```text
/ordax/dev-base/            # minimal runtime substrate
  shell/libc/libs
  selected drivers/modules
  selected firmware
  network tools
  CA certificates
  Git
  apk client + Alpine trust keys   # signed runtime acquisition only

/workspace/ordax/           # created at runtime, persistent, not preseeded
/state/ordax/               # Git state + replaceable runtimes after switch_root
```

The apk client is not permission to turn the base into a normal package-managed desktop. Pulled `system/` code may use it to materialize versioned, replaceable runtime roots under `/state`; Cage/Cog/Mesa and other high-level product/runtime packages remain outside the fixed seed.

Canonical signed-release base:

```text
/ordax/bootstrap/
  network/
  release-acquisition/
  recovery/

/ordax/releases/            # initially empty
/ordax/current              # unset until first release is verified
/ordax/state/               # empty/minimal runtime root
/ordax/home/                # user-data root
```

## Explicitly absent from the seed

```text
normal full Surface/runtime preinstall = NO
normal apps preinstall = NO
high-level services = NO
stable device identity service = NO
Remote Core = NO
Control Plane = NO
SSH = NO
complete repository checkout = NO
build toolchain = NO
WSL/QEMU payload = NO
legacy repository dump = NO
```

A tiny local status/recovery presentation is allowed only if required to show network, acquisition, verification or failure state.

## Owner/development Git-first boot

```text
UEFI
 -> kernel/initramfs
 -> mount LABEL=ORDAX
 -> switch_root to development base
 -> selected drivers/firmware
 -> network
 -> Git
 -> partial+sparse clone of main when checkout is absent
 -> otherwise git pull --ff-only
 -> /workspace/ordax/system/entrypoint
 -> pulled system may materialize a replaceable runtime under /state
 -> OrdaX
```

Current checkout policy:

```text
REMOTE=origin expected repository only
BRANCH=main expected branch only
LOCAL_MODIFICATIONS=BLOCK_PULL
CLONE_FILTER=blob:none
SPARSE_CHECKOUT=/system/ + /bootstrap/base-update/ + selected update/trust contracts
PERSISTENT_CHECKOUT=YES
ROLLBACK_PIN_SURVIVES_REBOOT=YES
EXPLICIT_ORDAX_PULL_RELEASES_PIN=YES
```

A valid local checkout may boot when the network is unavailable. A rollback is sticky across reboot and must not be silently advanced by boot-time synchronization. A runtime already materialized under `/state` is reusable offline; network is needed only for its first acquisition or a version change that requires new package bytes.

## Canonical signed-release first boot

```text
UEFI
 -> kernel/initramfs
 -> minimal bootstrap
 -> network
 -> acquire release envelope/artifacts over HTTPS
 -> verify integrity/authenticity
 -> materialize /ordax/releases/<commit>
 -> atomically activate /ordax/current
 -> launch OrdaX
```

Remote access is not needed for this path.

## After acquisition

Owner/development:

```text
NETWORK_REQUIRED_FOR_VALID_LOCAL_CHECKOUT_BOOT=NO
LOCAL_CHECKOUT_PRESERVED=YES
ROLLBACK_LOCAL=YES
NORMAL_SYSTEM_CHANGE_REQUIRES_REFLASH=NO
```

Canonical release:

```text
NETWORK_REQUIRED_FOR_KNOWN_GOOD_BOOT=NO
KNOWN_GOOD_RELEASE_PRESERVED=YES
ROLLBACK_LOCAL=YES
NORMAL_SYSTEM_CHANGE_REQUIRES_REFLASH=NO
```

Network/Git are required to acquire new development source or new release bytes, not to boot an already valid local state.

## Development model

Owner/development USB:

```text
system/Surface/app/native-host change
 -> Git push main
 -> ordax-pull
 -> ordax-run
 -> pulled code may provision/update replaceable runtime state
 -> no USB reflash

boot/kernel/initramfs/dev-base hardware support change
 -> separately built base candidate
 -> repository-delivered base-update control stages inactive slot
 -> next boot activates candidate
 -> manual USB reflash only when the bootstrap itself cannot recover/update
```

Canonical release:

```text
system/Surface/app change
 -> Git push
 -> CI builds signed release/delta
 -> updater acquires
 -> verify + activate
 -> no USB reflash
```

## Source/media relationship

Everything needed to reproduce the bootstrap is represented in this repository through source, manifests, configuration, provenance and build recipes. The running development checkout intentionally materializes only the product runtime plus the small base-update control plane; large boot artifacts are built from repository source and delivered as base candidates rather than compiled on the notebook.

Private/runtime data is not committed to public Git. The USB is never source authority.

## Trust boundary

The owner/development Creator may use explicitly marked ephemeral prototype trust for development provenance. This does not satisfy canonical release trust and must never be promoted as such.

Canonical public release acquisition remains blocked until the user-controlled release signing ceremony/public anchor is completed.

## Prototype rules

```text
GIT_MAIN_IS_SOURCE_AUTHORITY=YES
BOOTSTRAP_SEED_PARTITIONS=2
PREPARED_USB_PARTITIONS=3
SEPARATE_HOME_PARTITION=NO
REMOTE_CONTROL_PRESEEDED=NO
SSH_PRESEEDED=NO
FULL_SYSTEM_PRESEEDED=NO
COMPLETE_SOURCE_CHECKOUT_PRESEEDED=NO
BUILD_TOOLCHAIN_PRESEEDED=NO
REFLASH_FOR_NORMAL_SYSTEM_CHANGES=NO
```

If a future requirement proves that device identity, Remote Core or Control Plane is necessary, it must be introduced deliberately through an architectural decision rather than added preemptively.
