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
- a stale `/run/seatd.sock` discovered during the input-validation reboot was recovered safely by the Git-controlled launcher before the successful input boot;
- the native `Energia -> Reiniciar` action, delivered through the loopback-only authenticated power contract, rebooted the physical notebook successfully and returned control to the OrdaX boot flow;
- the native `Energia -> Desligar` action powered the notebook off completely, and a subsequent physical power-on returned the machine to the normal OrdaX boot flow;
- after the Git hot-update supervisor was activated, a live-safe UI change merged into `main` was detected automatically while the notebook remained running;
- the Surface visibly changed from `Surface compartilhada` to `Surface compartilhada • atualização ao vivo` without reboot, proving automatic Git pull plus browser reload on the physical notebook;
- after the cleanup change merged into `main`, the same running session automatically reloaded again and returned from `Surface compartilhada • atualização ao vivo` to `Surface compartilhada` without reboot, proving the live-safe update path round trip.

This closes the native graphical-host, primary-input, native-restart, native-shutdown and live-safe rebootless-update bring-up blockers on this target notebook. The proven path is now:

```text
physical notebook
 -> existing owner/development USB bootstrap
 -> network
 -> ordax-pull
 -> system/entrypoint hot-update supervisor
 -> system/surface/entrypoint
 -> system/surface/bin/ordax-surface
 -> replaceable runtime under /state
 -> eudev/libinput classification
 -> seatd
 -> Cage / Wayland
 -> Barkery / WebKitGTK
 -> shared Surface composition
 -> physical keyboard + mouse/touchpad interaction
 -> authenticated native restart action
 -> authenticated native shutdown action
 -> physical power-on back into the normal OrdaX boot flow
 -> automatic Git update detection
 -> live-safe Surface reload without notebook reboot
 -> second live-safe reload returning to the original UI state
```

Relevant successful host fixes and physical proofs landed in `main` as:

- `55d11f8cef21ed3c1d0c160cbafa914957fb8a05` — repair wlroots prerequisites on the physical Surface host (#30);
- `760c1aa83abb6275c62cf67dbe017c82e1c077e5` — enable physical keyboard and touchpad input discovery (#32);
- `19a8dc933941779289cf77815ec050927f6620c6` — recover safely from a stale seatd socket (#33);
- `f31aa0e039fda9239a52006cb02387469ded6c01` — expose authenticated native restart/shutdown controls (#34), with both restart and shutdown now physically proven on the notebook;
- `25496117f267d8d15c7f62de0961e0d55f731449` — add the Git-controlled hot-update supervisor (#35);
- `bb6fea315f60ebcdae7d63155c71973d61ae4251` — add the temporary physical live-update marker (#36), which appeared automatically on the running notebook without reboot;
- `d2f5715b152a1a8daf27f8c49a8b21d69082b4af` — remove the temporary marker and close the physical live-update proof (#37), with the cleanup also applied automatically without reboot.

## Architectural conclusion

The successful boots, native power actions and round-trip live update validate the intended Git-first boundary for this prototype: ordinary Surface/native-host/runtime fixes are delivered through Git and persisted runtime state without rebuilding the kernel, initramfs, or Development Base and without rewriting the USB.

Native rendering, primary input, native restart, native shutdown and live-safe automatic update application are now physically proven on this notebook. Long-run stability, suspend/resume, audio, acceleration quality, Surface-only restart for native-host changes and broader hardware coverage remain separate physical validation gates.


## Continuation — autonomous recovery validation on 2026-09-18

The same target notebook later exposed a live-update failure mode that could not be diagnosed reliably from the visible Surface alone. The screen remained on an old `d071477a` session showing `Aplicando atualização`, while newer Git commits existed remotely. The subsequent recovery work added independent observation and recovery layers and then physically proved them on the notebook.

Observed through the host-base telemetry relay on the physical machine:

- the stale graphical session was separated from the actual checkout/update state rather than being treated as authoritative;
- stale Cage/Barkery/native-runtime processes left behind by a killed Surface parent are now reaped only when their `/proc/<pid>/root` matches the OrdaX graphical runtime rootfs;
- the notebook recovered from the stale `d071477a` session and returned to a healthy current checkout without a USB reflash;
- the persistent `ordax-rescue` agent acknowledged recovery generations from the separate Git rescue ref and later acknowledged no-op generations while the system was already healthy;
- the persistent host-base telemetry agent reported the real checkout SHA, health SHA, last-applied SHA, update transaction state and rescue generation directly from the notebook;
- a filesystem-backed supervisor heartbeat derived from `/run/ordax-update/state.json` began advancing in telemetry, allowing supervisor liveness to be distinguished from general device/network liveness;
- the stable guardian / child-supervisor split landed physically: after the migration, the notebook returned to `running` with the new checkout healthy;
- a subsequent supervisor-only update exercised the new controlled `exit 75 -> guardian refresh -> supervisor child restart` path and also returned to `running`, proving future supervisor updates no longer require the old self-exec model;
- fetched candidate objects are now preflighted before the live checkout switch. A valid candidate was physically applied through this path and finished with `source_sha == healthy_sha == last_applied_sha`.

The final physically observed state for this validation sequence was:

```text
source_sha=a578a4b84440f82cf719e8dfec40c8ef91d18047
update_status=running
phase=idle
apply_mode=none
healthy_sha=a578a4b84440f82cf719e8dfec40c8ef91d18047
last_applied_sha=a578a4b84440f82cf719e8dfec40c8ef91d18047
rescue_generation=12
rescue_action=noop
last_error=<none>
```

This extends the physically proven development path to:

```text
Git main
 -> system/entrypoint guardian
 -> system/supervisor
 -> bounded candidate preflight
 -> update transaction / health acknowledgement
 -> system/surface/entrypoint
 -> native Surface runtime

independent recovery:
Git ordax-rescue
 -> persistent /state/ordax/rescue agent
 -> closed target-bound recovery actions

independent observation:
host-base telemetry agent
 -> Supabase ordax_os relay
 -> checkout / update / health / rescue / supervisor heartbeat state
```

The Supabase relay is observation-only and the rescue protocol is deliberately bounded; neither is a generic remote shell or a replacement for Git source authority. This evidence does not prove the failure path for an intentionally malformed candidate, full A/B runtime activation, canonical signed release acquisition, native-disk installation or public destructive-write authorization.
