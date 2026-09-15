# Release Acquisition Bootstrap

This directory owns only the pre-release client required to acquire a verified OrdaX release after minimal network bring-up.

It does **not** own a full Git checkout or a build toolchain.

Target responsibility:

```text
network ready
 -> fetch small release manifest over HTTPS
 -> verify manifest authenticity/integrity
 -> fetch required release artifacts
 -> verify SHA-256/size
 -> materialize /ordax/releases/<commit>
 -> atomically activate current
```

No kernel compilation, source checkout, SSH, Remote Core or Control Plane belongs here.

See `docs/RELEASE-CHANNEL.md`.
