# Physical native Surface validation — 2026-09-17

## Result

The owner/development USB reached the shared OrdaX Surface graphically on the target notebook after pulling the Git-controlled system runtime from `main`.

Observed on physical hardware:

- the notebook booted the existing development USB without reflashing;
- the Git-first flow reached the checked-out `system/` tree;
- the replaceable Alpine v3.22 graphical runtime under `/state/ordax/runtime/native-surface/` was reused;
- Cage started through `seatd` on the physical DRM device;
- Barkery/WebKitGTK rendered the existing shared Web composition;
- the OrdaX Surface was visibly displayed fullscreen on the notebook panel;
- the visible UI showed the OrdaX brand, `Surface compartilhada`, `Seu espaço OrdaX.`, workspace/connectivity/capability cards, and the `Mesa` control.

This closes the earlier native graphical-host bring-up blocker. The proven path is now:

```text
physical notebook
 -> existing owner/development USB bootstrap
 -> network
 -> ordax-pull
 -> system/entrypoint
 -> system/surface/entrypoint
 -> system/surface/bin/ordax-surface
 -> replaceable runtime under /state
 -> seatd
 -> Cage / Wayland
 -> Barkery / WebKitGTK
 -> shared Surface composition
```

The successful host fix landed in `main` as commit `55d11f8cef21ed3c1d0c160cbafa914957fb8a05` (`Repair wlroots prerequisites on physical Surface host (#30)`).

## Architectural conclusion

The successful boot validates the intended Git-first boundary for this prototype: ordinary Surface/native-host/runtime fixes were delivered through Git and persisted runtime state without rebuilding the kernel, initramfs, or Development Base and without rewriting the USB.

This does **not** yet prove keyboard/touchpad/mouse input behavior, long-run stability, suspend/resume, audio, acceleration quality, or product completeness. Those remain separate physical validation gates.
