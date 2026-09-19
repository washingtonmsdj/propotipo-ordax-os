# Current State

Status date: 2026-09-18

This is the canonical handoff snapshot. Architecture/contracts win if another document conflicts with it. Detailed historical evidence remains under `docs/evidence/`; this file records the current boundary without treating CI proof, development-hardware proof and product-release authorization as interchangeable.

## Repository

```text
REPOSITORY=washingtonmsdj/prototipo-ordax-os
ROLE=CLEAN_ROOM_PROTOTYPE
DEFAULT_BRANCH=main
PROMOTED_TO_OFFICIAL=NO
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_REPOSITORY_IS_REFERENCE_ONLY=YES
GIT_MAIN_IS_SOURCE_AUTHORITY=YES
USB_IS_SOURCE_AUTHORITY=NO
```

## Product model

```text
ONE_PRODUCT=YES
MODES=WEB,MOBILE,DESKTOP,USB,NATIVE_DISK
ONE_ACCOUNT_MODEL=YES
ONE_SURFACE_SOURCE=YES
CAPABILITY_DIFFERENCES_VIA_ADAPTERS=YES
SYSTEM_ENTRYPOINT_IMPLEMENTED=YES
SURFACE_BOOTSTRAP_RUNTIME=YES
GRAPHICAL_SURFACE_SOURCE=IMPLEMENTED
SHARED_WORKSPACE_WINDOW_MODEL=IMPLEMENTED
FIRST_PARTY_APP_REGISTRY=FILES,NOTES,SETTINGS,ACCOUNT,SYSTEM
SETTINGS_VISIBLE_LABEL=AJUSTES
SURFACE_HOME_TECHNICAL_UPDATE_MARKERS=REMOVED
UPDATE_HUMAN_IDENTITY=DELIVERY_NUMBER
UPDATE_PR_NUMBER_IS_PRODUCT_IDENTITY=NO
UPDATE_RUNNING_LABEL=EM_EXECUCAO
WEB_CLIENT_CANDIDATE=PASS
APPEARANCE_THEME_VALUES=DARK,LIGHT
SURFACE_ACCESSIBILITY_PREFERENCES=CONTRAST,MOTION,TEXT_SCALE
SURFACE_TEXT_SCALE_VALUES=STANDARD,LARGE,EXTRA_LARGE
APPEARANCE_PERSISTENCE=WEB_LOCAL_PASS
APPEARANCE_ACCOUNT_SYNC=NO
NATIVE_GRAPHICAL_HOST=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_PRIMARY_INPUT=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_POWER_RESTART=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_POWER_SHUTDOWN=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_GIT_HOT_UPDATE=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_UPDATE_SELF_HEALING=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_GUARDIAN_SUPERVISOR=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_RESCUE_CHANNEL=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_TELEMETRY_RELAY=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_CANDIDATE_PREFLIGHT_SUCCESS_PATH=PASS_PHYSICAL_DEVELOPMENT_USB
CANONICAL_KERNEL_ACPI_BATTERY_SUPPORT=EXPLICIT
CANONICAL_KERNEL_SYSRQ_RESTART_FALLBACK=EXPLICIT
REAL_SYSTEM_BUNDLE_REPRODUCIBLE=PASS
GRAPHICAL_SURFACE_COMPLETE=NO
CANONICAL_SYSTEM_RUNTIME_COMPLETE=NO
```

`system/` is the shared product source. The native development path is physically proven through `system/entrypoint (guardian) -> system/supervisor -> system/surface/entrypoint -> system/surface/bin/ordax-surface`; repository CI also proves that the actual `system/` tree can be bundled deterministically as `system.tar`.

The shared graphical source remains under `system/surface/ui/` with platform-neutral contracts, workspace/window lifecycle and capability-driven app availability. Notes is now a first-party shared app with local projects, a visual structured-text editor, checklists, real local-file/web references, autosave and device-local Native persistence through a bounded loopback state endpoint; Web uses local browser persistence with an explicit session fallback. Notes stores rich formatting as bounded blocks/marks rather than raw HTML or visible Markdown, keeps a plain-text body for search/import continuity, and migrates existing local snapshot schema v1 state to schema v2 on validation/save. Ajustes now owns persisted Surface-level contrast, motion and text-scale preferences; text scale changes the shared typographic base without claiming host-level accessibility control. Platform-specific behavior belongs in adapters/compositions, not in forks of the shared Surface. The normal Home now keeps technical delivery/recovery markers out of the area label; real delivery identity and update details live in Sistema. The visible settings identity is standardized as **Ajustes** while preserving the stable internal app id `settings`.

On the target notebook, the owner/development USB has physically proven the Git-first native host: Cage/Wayland + Barkery/WebKitGTK renders the shared Surface fullscreen; keyboard and mouse/touchpad work; authenticated native restart and shutdown work; and Git changes can be pulled and applied with a Surface reload while the notebook remains running. The temporary live-update marker appeared and then disappeared automatically in the same running session, proving the rebootless update round trip.

The Git-first update path is now split between a stable `system/entrypoint` guardian and a child `system/supervisor`. Ordinary Surface changes reload the browser, native-host changes restart only the Surface, supervisor/guardian changes use a controlled supervisor restart, and boot/bootstrap changes are marked as requiring a later reboot instead of rebooting automatically. The guardian monitors the supervisor's state-file heartbeat and can restart a stalled supervisor child without returning to the Development Base maintenance shell. The controlled `exit 75 -> guardian refresh -> supervisor restart` path has been physically exercised on the target notebook.

Recovery no longer depends on that supervisor alone. A persistent, bounded `ordax-rescue` agent lives under `/state/ordax/rescue/` and consumes only target-bound, monotonic commands from the separate Git rescue ref. The physical notebook has acknowledged multiple rescue generations, including no-op generations while healthy. The rescue protocol does not provide remote shell, arbitrary commands, reboot, poweroff or arbitrary Git reset.

Operational observability is also physically active through the temporary Supabase relay. A host-base telemetry agent starts before the graphical runtime and reports checkout SHA, human `deliveryNumber`, pending `bootRefreshRequired`, updater state, health state, rescue generation/action, power-action proof fields and a supervisor state-file heartbeat. The deployed relay configuration is source-controlled. Supabase is observation-only and has no command semantics. This allowed the recovery from the stale `d071477a` graphical session to be diagnosed and verified without relying on the visible screen.

A native-host update delivered through the live Git path has been physically validated to restart only the Surface and return to the graphical session without rebooting the notebook. Candidate Git objects are now preflighted before switching the live checkout, and the valid-candidate success path has been physically exercised; rejection/rollback of an intentionally broken candidate remains a separate physical exercise. The durable offline sync-state store is implemented and CI-proven; survival of a deliberately created pending mutation across a later explicit Surface restart remains a separate physical persistence exercise.

These development-USB results do **not** imply that the canonical signed release-acquisition/native-disk product path is complete. `GRAPHICAL_SURFACE_COMPLETE` and `CANONICAL_SYSTEM_RUNTIME_COMPLETE` remain `NO` until their separate product gates close.

## Development USB — physically proven path

```text
OWNER_DEVELOPMENT_USB_BOOT=PASS
DEVELOPMENT_GIT_CHECKOUT=PASS
DEVELOPMENT_NETWORK_FOR_GIT=PASS
REPLACEABLE_NATIVE_RUNTIME=PASS
CAGE_WAYLAND_RENDER=PASS
BARKERY_WEBKIT_RENDER=PASS
PHYSICAL_KEYBOARD=PASS
PHYSICAL_MOUSE_TOUCHPAD=PASS
NATIVE_RESTART=PASS
NATIVE_SHUTDOWN=PASS
RETURN_BOOT_AFTER_SHUTDOWN=PASS
GIT_HOT_UPDATE_RELOAD=PASS
GIT_HOT_UPDATE_ROUND_TRIP=PASS
GUARDIAN_SUPERVISOR_RESTART=PASS
INDEPENDENT_GIT_RESCUE=PASS
HOST_BASE_REMOTE_TELEMETRY=PASS
CANDIDATE_PREFLIGHT_VALID_PATH=PASS
USB_REFLASH_REQUIRED_FOR_NORMAL_SYSTEM_CHANGES=NO
SSH_REQUIRED=NO
REMOTE_CONTROL_PLANE_REQUIRED=NO
```

The physical evidence is recorded in `docs/evidence/physical-native-surface-2026-09-17.md`. The original BusyBox `command -v` handoff failure was corrected in PR #21 and subsequent owner/development USB boots progressed through the Git checkout into the graphical Surface, so that historical bring-up blocker is closed for this development path.

## Build autonomy

```text
CODEX_REQUIRED=NO
LOCAL_DEVELOPER_TOOLCHAIN_REQUIRED=NO
MANUAL_KERNEL_BUILD_REQUIRED=NO
CI_BUILD_REQUIRED=YES
ARTIFACT_PROVENANCE_REQUIRED=YES
ARTIFACT_SHA256_REQUIRED=YES
PINNED_KERNEL_BUILD_ENVIRONMENT=PASS
KERNEL_REPEAT_DIGEST_PROOF=PASS
GITHUB_ACTIONS_IMMUTABLE_SHA_POLICY=PASS
GITHUB_ACTIONS_MUTABLE_TAGS=FORBIDDEN
GITHUB_ACTIONS_UNKNOWN_EXTERNAL_REFS=FORBIDDEN
GITHUB_ACTIONS_PULL_REQUEST_TARGET=FORBIDDEN_BY_DEFAULT
BASE_UPDATE_FAT32_STAGING_PROOF=PASS_DISPOSABLE_CI
```

GitHub Actions remains the current build/proof executor; repository recipes are source authority. Kernel/build reproducibility, Action pinning and deterministic real-`system/` bundling remain CI-proven. The current A/B base staging code is also exercised on a disposable FAT32 loop image: the proof preserves current/recovery entries and the active slot, writes and verifies the inactive candidate, unmounts, runs read-only `fsck.vfat`, remounts and re-verifies bytes. That proof is explicitly filesystem-staging-only: it does not exercise canonical release trust, authorize physical writes, activate a candidate or prove notebook boot. CI proof does not authorize destructive physical writes or substitute for hardware validation.

## Physical architecture

```text
PHYSICAL_PARTITIONS=2
PARTITION_1=ORDAX-ESP
PARTITION_1_FILESYSTEM=FAT32
PARTITION_2=ORDAX
PARTITION_2_FILESYSTEM=EXT4
SEPARATE_HOME_PARTITION=NO
LEGACY_ORDAX_PLATFORM_PARTITION=FORBIDDEN
LEGACY_ORDAX_HOME_PARTITION=FORBIDDEN
```

Canonical geometry remains defined by `docs/contracts/physical-media.json`. The canonical release layout remains `/ordax/bootstrap`, `/ordax/releases/<commit>`, `/ordax/current`, `/ordax/state` and `/ordax/home`.

## Minimal bootstrap and canonical release path

The product bootstrap/release architecture remains distinct from the owner/development USB Git path.

```text
FULL_SYSTEM_PRESEEDED=NO
NORMAL_APPS_PRESEEDED=NO
REMOTE_CORE_PRESEEDED=NO
CONTROL_PLANE_PRESEEDED=NO
SSH_PRESEEDED=NO
BUILD_TOOLCHAIN_PRESEEDED=NO
KNOWN_GOOD_OFFLINE_BOOT_REQUIRED=YES
RELEASE_BUNDLE_TOOLING_IMPLEMENTED=YES
DETERMINISTIC_SYSTEM_TAR=PASS
REAL_REPOSITORY_SYSTEM_BUNDLE=PASS
RELEASE_MANIFEST_TOOLING_IMPLEMENTED=YES
RELEASE_SIGNING_TOOLING_IMPLEMENTED=YES
RELEASE_PIPELINE_CI=PASS
PRODUCTION_RELEASE_PUBLISHED=NO
```

The canonical release channel resolves `release-envelope.json`; the URL selects bytes and Ed25519 verification decides authenticity. The release acquisition code remains fail-closed with SHA-256 verification, exact source-commit binding, safe materialization, atomic activation and known-good preservation.

### Canonical release trust — unresolved

```text
RELEASE_TRUST_POLICY=RESOLVED
TRUST_POLICY_SCHEMA=prototype-ordax.release-trust-policy/1
CANONICAL_KEY_ID=ordax-prototype-release-v1
CANONICAL_KEY_MATERIAL_GENERATED=NO
PUBLIC_ANCHOR_PINNED=NO
RELEASE_TRUST=UNRESOLVED
PRIVATE_SIGNING_KEY_IN_GIT=FORBIDDEN
PRIVATE_SIGNING_KEY_IN_USB=FORBIDDEN
PRIVATE_KEY_CUSTODY_OWNER=repository-owner-developer
MINIMAL_BOOTSTRAP_ALL_ARTIFACTS_RESOLVED=NO
PHYSICAL_WRITE_ALLOWED=NO
```

The canonical private key must be generated and backed up outside Git according to `docs/RELEASE-TRUST-CEREMONY.md`; only the matching public trust document may enter source. CI/fixture keys never satisfy canonical trust.

## Creator and physical-write boundary

```text
CREATOR_CORE_IMPLEMENTED=YES
CREATOR_VERIFY_PAYLOAD_IMPLEMENTED=YES
CREATOR_STAGE_TREE=IMPLEMENTED_TRANSACTIONAL
CREATOR_DISPOSABLE_GPT_FILESYSTEM_PROOF=PASS
CREATOR_WINDOWS_TARGET_DISCOVERY=PASS
CREATOR_WINDOWS_SYSTEM_DISK_EXCLUSION=PASS
CREATOR_WINDOWS_NATIVE_RAW_DISK_BACKEND=PASS_TAGGED_UNBOUND
CREATOR_WINDOWS_RAW_BACKEND_BUILD_TAG=ordax_raw_backend
CREATOR_WINDOWS_RAW_BACKEND_BUILD_TAG_ISOLATION=PASS
CREATOR_WINDOWS_RAW_BACKEND_IN_PUBLIC_BUILD=NO
CREATOR_NATIVE_BACKEND_PUBLICLY_REACHABLE=NO
CREATOR_PUBLIC_PHYSICAL_APPLY_IMPLEMENTED=NO
PHYSICAL_WRITE_AUTHORIZED=NO
DESTRUCTIVE_AUTHORIZATION=NO
```

The internal Windows raw-disk implementation remains compile-time isolated and unreachable from the public Creator command. Nothing in the successful owner/development USB bring-up changes that destructive-write authorization boundary.

The byte-complete media workflow remains proven with ephemeral CI trust and disposable media only. That proof establishes composition and growth behavior; it does not establish canonical public trust or authorize a product-media write. The notebook development-USB boot is a separate physical proof and must not be used to collapse those boundaries.

## Recovery

```text
RECOVERY_ENTRY=YES
RECOVERY_ORDAX_MOUNT=READ_ONLY
RECOVERY_AUTOMATIC_NETWORK=NO
RECOVERY_SSH=NO
RECOVERY_AUTOMATIC_MUTATION=NO
RECOVERY_PHYSICAL_EXERCISE=PENDING_FINAL_VALIDATION
```

## Host independence and remote access

```text
WSL_REQUIRED=NO
QEMU_REQUIRED=NO
POWERSHELL_REQUIRED=NO
BASH_REQUIRED=NO
SPECIFIC_DEVELOPER_DESKTOP_OS_REQUIRED=NO
END_USER_KERNEL_TOOLCHAIN_REQUIRED=NO
THIN_HOST_ADAPTERS_ALLOWED=YES
SSH_REQUIRED=NO
REMOTE_CORE_REQUIRED=NO
CONTROL_PLANE_REQUIRED=NO
```

## Physical state

```text
OWNER_DEVELOPMENT_USB_PRESENT=YES
PHYSICAL_NOTEBOOK_BOOT_PROVEN=PASS_DEVELOPMENT_USB
PHYSICAL_NATIVE_GRAPHICS=PASS_DEVELOPMENT_USB
PHYSICAL_PRIMARY_INPUT=PASS_DEVELOPMENT_USB
PHYSICAL_NATIVE_RESTART=PASS_DEVELOPMENT_USB
PHYSICAL_NATIVE_SHUTDOWN=PASS_DEVELOPMENT_USB
PHYSICAL_LIVE_UPDATE=PASS_DEVELOPMENT_USB
PHYSICAL_GUARDIAN_SUPERVISOR=PASS_DEVELOPMENT_USB
PHYSICAL_RESCUE_CHANNEL=PASS_DEVELOPMENT_USB
PHYSICAL_TELEMETRY_RELAY=PASS_DEVELOPMENT_USB
CANONICAL_SIGNED_RELEASE_BOOT_PROVEN=NO
CANONICAL_NATIVE_DISK_INSTALL_PROVEN=NO
CREATOR_PUBLIC_PHYSICAL_APPLY_IMPLEMENTED=NO
RELEASE_TRUST=UNRESOLVED
DESTRUCTIVE_AUTHORIZATION=NO
```

Do not reinterpret `PASS_DEVELOPMENT_USB` as canonical release/install proof. The proven target today is the owner/development Git-first USB on the tested notebook.

## Deferred/final physical validation

The following are intentionally left for later/final hardware validation rather than blocking current product development:

```text
SURFACE_ONLY_NATIVE_HOST_RESTART_PHYSICAL=PASS_DEVELOPMENT_USB
SUSPEND_RESUME=PENDING_FINAL
AUDIO=PENDING_FINAL
GRAPHICS_ACCELERATION_QUALITY=PENDING_FINAL
LONG_RUN_STABILITY=PENDING_FINAL
RECOVERY_PHYSICAL_EXERCISE=PENDING_FINAL
BROADER_HARDWARE_COVERAGE=PENDING_FINAL
```

## Current priorities

1. continue the shared Surface and native adapter work without platform forks, exposing only capabilities that are actually implemented/proven by the adapter;
2. expand first-party apps through neutral contracts, including useful native `Sistema`/`Arquivos` behavior instead of static placeholders;
3. continue hardening staged/transactional Git-first activation beyond the now-proven guardian, rescue, telemetry and candidate-preflight layers, while keeping normal changes rebootless and avoiding an unnecessary bootstrap dependency;
4. continue account/cloud preference and workspace continuity through neutral contracts without claiming remote transport before an authenticated provider exists;
5. in parallel, when the repository owner is ready for the separate trust ceremony, generate the canonical Ed25519 prototype release key outside Git, make the required encrypted offline backup and commit only the matching public trust anchor;
6. after canonical trust and byte-complete canonical media proof close, keep the tagged native raw writer gated until an explicit public apply boundary and exact-target authorization are deliberately introduced;
7. leave suspend/resume, audio, acceleration-quality, long-run and broader-hardware exercises for the final physical-validation phase unless a feature specifically depends on them sooner.

## Autonomous recovery and observation boundary

```text
NORMAL_UPDATE_CONTROL=GIT_MAIN
BOUNDED_RECOVERY_CONTROL=GIT_ORDAX_RESCUE
OBSERVABILITY=SUPABASE_ORDAX_OS_RELAY
REMOTE_SHELL=NO
SUPABASE_COMMAND_CHANNEL=NO
GUARDIAN_NETWORK_ACCESS=NO
SUPERVISOR_GIT_ACCESS=YES
INTENTIONALLY_BAD_UPDATE_ROLLBACK_PHYSICAL_PROOF=PENDING
FULL_A_B_RUNTIME_ACTIVATION=NO
BASE_UPDATE_A_B_CONTRACT=DEFINED
BASE_UPDATE_FAT32_STAGING_PROOF=PASS_DISPOSABLE_CI
BASE_UPDATE_CANONICAL_TRUST_EXERCISED_BY_FAT32_PROOF=NO
BASE_UPDATE_PHYSICAL_HARDWARE_PROVEN=NO
BASE_UPDATE_PHYSICAL_WRITER=NO
```

The temporary Supabase project is an operational relay, not product authority. It may be migrated later without changing the device identity or telemetry contract. Git `main` remains product source authority; `ordax-rescue` remains a separate, deliberately narrow recovery path.

## Handoff rule

Any new AI/conversation must read `AGENTS.md`, this file and the canonical contracts before changing source. CI alone never proves physical boot, native graphics or destructive safety. For the tested owner/development USB notebook, physical native graphics/input/power/live-update claims are supported by `docs/evidence/physical-native-surface-2026-09-17.md`; those claims still do not promote CI trust, authorize physical mutation, prove canonical signed release acquisition or declare the product complete.
