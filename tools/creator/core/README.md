# OrdaX Creator Core

Host-neutral owner of provisioning policy and workflow.

This core must own target-plan validation, artifact manifest consumption, authenticity/integrity verification, the two-partition layout, write sequencing, post-write verification, retry/recovery semantics and receipts.

It must not call WSL or require QEMU.

Raw-disk/elevation details belong in thin `tools/creator/platform/*` adapters.
