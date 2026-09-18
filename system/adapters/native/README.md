# Native OrdaX Capability Adapter

Native implementation of OrdaX capability contracts for USB and SSD/HD modes.

This adapter bridges shared product code to OrdaX services and hardware-facing capabilities. It does not own duplicated screens, visual tokens or app forks.

Kernel/driver-specific details stay below the capability boundary and must not leak into shared Surface components.

## Diagnostic export

`diagnostic-export.mjs` implements the narrow `ordax.diagnostic-export/1` port on top of the existing bounded Native `file-space` capability. It writes only an already validated diagnostic JSON document into the logical `/Downloads` user directory through `importFile()`.

The adapter deliberately does not use an anchor/download handoff as proof of persistence. It returns `saved` only after the Native file-space port returns a listing that confirms the same destination directory, file name, regular-file kind and UTF-8 byte size. Host write failures, duplicate/no-clobber rejection or an inconsistent confirmation are allowed to fail upward so the shared diagnostic export service can return the stable non-secret `export-failed` result.

The adapter does not create a new host endpoint, bypass the user-space root, overwrite existing files or introduce remote transport. Surface wiring and the explicit user action that invokes this port remain separate responsibilities.
