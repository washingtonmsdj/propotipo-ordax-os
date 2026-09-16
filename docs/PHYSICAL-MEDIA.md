# Physical Media Contracts

Status: TRANSITIONAL BOOTSTRAP / HARDWARE-PROOF CONTRACTS

Long-term storage authority: `docs/contracts/storage-architecture.json` and `docs/STORAGE-ARCHITECTURE.md`.

This document describes the current bootstrap seed and the transitional physical proof. It **does not define one permanent partition layout for every OrdaX installation**.

## Three different responsibilities

Do not merge these contracts:

1. **Bootstrap seed proof** — capacity-independent source image used to prove boot artifacts and release acquisition.
2. **Current physical USB proof** — temporary real-hardware layout used while the boot path is being validated.
3. **Durable product storage profiles** — separate long-term layouts for portable USB and installed SSD/HDD.

## 1. Bootstrap seed proof

`docs/contracts/physical-media.json` remains the byte-level bootstrap seed/proof contract:

```text
1. ORDAX-ESP  FAT32
2. ORDAX      EXT4
```

This two-partition shape is intentionally retained while the existing bootstrap and recovery chain are being proven. It is **not** the final portable USB architecture and it is **not** the native SSD/HDD architecture.

The 512 MiB RAW capacity used by disposable CI proofs is test capacity only. It is not a product disk-size policy.

The logical bootstrap layout currently used by the proof remains:

```text
/ordax/bootstrap
/ordax/releases/<commit>
/ordax/current
/ordax/state
/ordax/home
```

No historical `ORDAX-HOME` or `ORDAX-PLATFORM` physical partition is reintroduced by this compatibility proof.

## 2. Current physical USB proof

`docs/contracts/physical-prepared-media.json` describes the transitional owner-prototype target currently being used for real-hardware validation:

```text
ORDAX-ESP   FAT32
ORDAX       bounded EXT4
ORDAX-DATA  remaining capacity, exFAT
```

This layout fixed two immediate prototype problems:

- `ORDAX` must not consume the whole USB capacity;
- the remaining capacity must be visible and useful from Windows.

The Creator must only report success after the controlled system regions have been written and read back, and after `ORDAX-DATA` has been formatted/validated according to the prepared-media contract.

This three-partition layout is a **transitional proof only**. It must not be promoted as the long-term portable-storage contract.

## 3. Durable storage profiles

### Portable USB target

Long-term target:

```text
GPT
├─ ORDAX-ESP   FAT32
└─ ORDAX-DATA  exFAT, all remaining usable capacity
```

There is no fixed physical `ORDAX` system partition.

The immutable compressed system is stored as versioned image files under the shared data capacity, and Linux-native persistent writable state is stored in a growable filesystem image rather than using exFAT directly as an OverlayFS upper layer.

Conceptually:

```text
ORDAX-DATA/
├─ user files...
└─ .ordax/
   ├─ releases/<version>.erofs
   └─ state/persistent-state.img   # ext4 inside
```

This allows future OrdaX releases, applications and persistence to consume real free space without repartitioning the USB.

### Native SSD / NVMe / HDD target

Long-term target:

```text
GPT
├─ ORDAX-ESP   FAT32, boot + minimal signed recovery
└─ ORDAX-POOL  LUKS2 -> Btrfs, all remaining install-target capacity
```

System deployments, applications, machine state and user data share one Btrfs capacity pool and are separated logically by subvolumes/deployment boundaries rather than hard partition sizes.

The installed system therefore does not reserve a fixed `/home`, fixed application partition or physical A/B root slots by default.

## Why the bootstrap seed is allowed to differ

The bootstrap seed is an implementation artifact, not source authority for product storage policy.

Keeping its current geometry temporarily allows us to diagnose the real-hardware boot chain without simultaneously changing partition count, root discovery, boot assets, filesystem semantics and persistent-state design.

Once the existing physical boot proof is healthy, migration to the final portable layout can be performed behind a new contract major and regression gates.

## Disposable proof

The non-destructive proof path remains useful:

```text
Creator Core
 -> transactional stage tree
 -> regular sparse RAW file
 -> GPT/filesystems
 -> filesystem labels
 -> re-extract staged files
 -> SHA-256 reverify
 -> compare controlled partition bytes
```

CI proof never authorizes a physical write by itself.

## Physical-write safety

Every destructive path must continue to:

1. independently identify the selected target disk rather than trusting a drive letter;
2. reject the Windows/system disk and ambiguous targets;
3. bind confirmation to the exact re-enumerated physical-device identity;
4. map mounted volumes to physical-disk extents;
5. reject target volumes that span another physical disk;
6. lock and dismount target-owned volumes before raw writes;
7. keep the managed volume lease alive for the destructive operation;
8. require an elevated Windows process for the privileged helper;
9. validate the exact source artifact and target storage profile before opening the disk for write;
10. write only the regions authorized by the selected profile;
11. flush and read back the controlled written regions;
12. create/format any post-write user-data filesystem only after the raw system regions verify;
13. re-enumerate the resulting disk and validate its final geometry/filesystem labels;
14. report success only after all required verification has completed.

The normal/public Creator must not gain raw-disk authority merely because the implementation exists. Build/channel authorization remains a separate fail-closed boundary.

## Performance rule

Whole-device zero streaming and whole-device readback are forbidden when most of the target capacity is intentionally user/free capacity.

For portable USB, the design must minimize random writes and write amplification. For native SSD/HDD, the Creator must use the native-disk profile rather than pretending every storage device has thumb-drive characteristics.

## Durable rule

`physical-media.json` and `physical-prepared-media.json` are transitional proof contracts. The durable product contract is `storage-architecture.json`.

If a future implementation tries to infer the final SSD/HDD or portable USB layout from the old two-partition bootstrap seed, that implementation is wrong and must fail architecture regression tests.
