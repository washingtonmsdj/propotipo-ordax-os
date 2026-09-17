# Physical boot finding: minimal BusyBox handoff

A physical owner/development USB built from commit `3cac49702146bdb07c6d7440e44a312f6a101901` reached Linux PID 1, mounted `LABEL=ORDAX` read/write, then reported both the ext4 growth helper and `/ordax/bootstrap/entrypoint` as unavailable.

The common dependency was `command -v`. The fixed initramfs BusyBox is built from `allnoconfig` and does not explicitly enable the optional ash `command` builtin. The runtime handoff must therefore not depend on it.

This finding is hardware evidence only for the observed path. It does not promote the prototype or prove later network/Git/system stages.
