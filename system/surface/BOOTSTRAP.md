# Bootstrap Surface milestone

This is the first native release-visible Surface milestone. It is intentionally console-only and exists to prove the verified handoff chain:

```text
/ordax/current/system/entrypoint
 -> system/surface/entrypoint
 -> system/surface/bin/ordax-surface
```

It is not the final graphical Surface and must not become a separate product fork. The graphical Surface remains shared across Web, Mobile, Desktop, USB and native-disk modes through capability adapters.

The bootstrap Surface owns no networking, release acquisition, SSH, shell fallback or physical-device mutation. Missing runtime dependencies fail closed into the canonical bootstrap recovery entrypoint.
