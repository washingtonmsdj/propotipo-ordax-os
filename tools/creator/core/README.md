# OrdaX Creator Core

Host-neutral owner of physical-media provisioning policy.

Implemented now:

- strict parsing of the canonical minimal-bootstrap manifest;
- exact `ORDAX-ESP` + `ORDAX` layout validation;
- rejection of weakened write gates;
- deterministic write-plan generation;
- fail-closed refusal while the physical manifest is unresolved or unauthorized;
- regression coverage against a third `ORDAX-HOME` partition and malformed hashes.

Not implemented yet:

- raw-disk writes;
- elevation;
- partition/filesystem mutation;
- device enumeration;
- physical target selection.

Those operations must remain outside the Core and behind narrow `tools/creator/platform/*` adapters. The full OrdaX Desktop will consume this same Core instead of reimplementing provisioning.

The Core must never require WSL, QEMU, Codex or a local kernel toolchain.
