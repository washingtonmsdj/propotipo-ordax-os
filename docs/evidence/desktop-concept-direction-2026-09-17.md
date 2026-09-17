# OrdaX desktop concept direction — 2026-09-17

Status: visual/product direction, not an implementation-completeness claim.

The current desktop concept supplied during physical bring-up establishes the preferred direction for the native desktop Surface:

- fixed left navigation for first-party system apps such as Arquivos, Ajustes, Conta and Sistema;
- a large time/date home focus and a restrained editorial information hierarchy;
- quick application search/launcher access;
- user-space shortcuts such as Documentos, Imagens and Downloads;
- explicit workspace/area switching in the lower shell;
- network/update/system status kept visible but secondary;
- a protected power affordance separated from ordinary app navigation;
- warm neutral materials, black linework and a restrained OrdaX orange accent.

Implementation guidance:

- preserve the single shared Surface source and capability-driven behavior;
- do not fork product UI for USB/native-disk versus Web/Desktop;
- desktop-specific density/layout may be responsive presentation, not separate app semantics;
- workspace persistence must precede multi-area expansion so live Git updates do not discard window placement;
- selected, hover, focus and disabled states must remain explicit and keyboard accessible;
- destructive power actions require deliberate confirmation or an equivalent protected interaction.

This document records direction only. Physical success remains governed by the existing runtime and hardware evidence gates.
