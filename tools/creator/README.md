# OrdaX Creator

`tools/creator/` is the source root for the end-user installer/provisioner.

Goal: one OrdaX Creator product capable of preparing USB media and, later, native SSD/HD installation without requiring WSL, QEMU or a kernel toolchain on the user's machine.

Target architecture:

```text
tools/creator/
  core/                 # host-neutral policy and workflow
  platform/
    windows/            # thin raw-disk/elevation adapter
    linux/              # thin raw-disk/elevation adapter
    macos/              # thin raw-disk/elevation adapter
```

The shared core owns:

- artifact selection;
- signature/hash verification;
- canonical two-partition plan;
- write plan;
- post-write verification;
- recovery/retry semantics;
- user-visible flow.

Platform adapters own only unavoidable host API integration.

No host adapter may define a different OrdaX layout or security policy.
