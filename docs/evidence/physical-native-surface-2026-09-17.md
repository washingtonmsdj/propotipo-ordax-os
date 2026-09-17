# Physical native Surface validation — 2026-09-17

## Result

The owner/development USB reached the shared OrdaX Surface graphically on the target notebook after pulling the Git-controlled system runtime from `main`, and the same physical session family subsequently proved the notebook keyboard and mouse/touchpad path.

Observed on physical hardware:

- the notebook booted the existing development USB without reflashing;
- the Git-first flow reached the checked-out `system/` tree;
- the replaceable Alpine v3.22 graphical runtime under `/state/ordax/runtime/native-surface/` was reused and extended in place;
- Cage started through `seatd` on the physical DRM device;
- Barkery/WebKitGTK rendered the existing shared Web composition;
- the OrdaX Surface was visibly displayed fullscreen on the notebook panel;
- the visible UI showed the OrdaX brand, `Surface compartilhada`, `Seu espaço OrdaX.`, workspace/connectivity/capability cards, and the `Mesa` control;
- after runtime-owned eudev/libinput classification was enabled, the physical keyboard worked inside the Surface;
- the physical mouse/touchpad also worked inside the Surface;
- a stale `/run/seatd.sock` discovered during the input-validation reboot was recovered safely by the Git-controlled launcher before the successful input boot.

This closes the native graphical-host and primary-input bring-up blockers on this target notebook. The proven path is now:

```text
physical notebook
 -> existing owner/development USB bootstrap
 -> network
 -> ordax-pull
 -> system/entrypoint
 -> system/surface/entrypoint
 -> system/surface/bin/ordax-surface
 -> replaceable runtime under /state
 -> eudev/libinput classification
 -> seatd
 -> Cage / Wayland
 -> Barkery / WebKitGTK
 -> shared Surface composition
 -> physical keyboard + mouse/touchpad interaction
```

Relevant successful host fixes landed in `main` as:

- `55d11f8cef21ed3c1d0c160cbafa914957fb8a05` — repair wlroots prerequisites on the physical Surface host (#30);
- `760c1aa83abb6275c62cf67dbe017c82e1c077e5` — enable physical keyboard and touchpad input discovery (#32);
- `19a8dc933941779289cf77815ec050927f6620c6` — recover safely from a stale seatd socket (#33).

## Architectural conclusion

The successful boots validate the intended Git-first boundary for this prototype: ordinary Surface/native-host/runtime fixes were delivered through Git and persisted runtime state without rebuilding the kernel, initramfs, or Development Base and without rewriting the USB.

Native rendering and primary input are now physically proven on this notebook. Long-run stability, suspend/resume, audio, acceleration quality, power management, shutdown/restart UX and broader hardware coverage remain separate physical validation gates.
