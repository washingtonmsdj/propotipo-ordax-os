# OrdaX Desktop Identity

The OrdaX desktop concept supplied during the physical bring-up is the visual reference for the shared Surface desktop shell.

This is a product identity contract, not a screenshot contract. Implementations preserve the concept's visual language while remaining functional, responsive, accessible and shared across supported hosts.

## Canonical visual language

- mineral/off-white primary canvas;
- black/graphite editorial foreground;
- OrdaX orange as the single primary accent;
- display serif for large identity/time elements and neutral sans-serif for controls;
- thin architectural rules, generous negative space and restrained borders;
- geometric architectural composition as a replaceable visual layer, never as a baked screenshot;
- fixed primary-app rail on desktop and a compact responsive equivalent on narrow surfaces;
- bottom area/status strip for workspace identity, running applications, update state and connectivity.

The shared implementation lives under `system/surface/ui/`. Platform compositions must not fork this identity. Host differences remain capability/adaptor concerns.

## Interaction contract

The desktop shell must remain operational rather than decorative:

- Arquivos, Ajustes, Conta and Sistema launch the real first-party applications;
- `Ctrl+K` opens the shared application launcher;
- Area controls are backed by `ordax.workspace-store/2` and independent window state;
- `+` creates a real new area subject to the workspace bound;
- power actions remain host-capability driven and require explicit confirmation;
- update status is surfaced from the update watcher rather than inferred by the UI;
- visual updates must remain compatible with live Surface reload/restart and workspace persistence.

## Design-system ownership

`tokens.css` owns semantic color, typography, spacing and state tokens. UI modules consume tokens instead of hard-coding platform-specific visual policy.

The current light identity is the default. The dark identity is a supported theme using the same semantic tokens and composition, not a separate shell.

## Non-goals

The visual reference must not be implemented by embedding the supplied concept image as the desktop background, duplicating the Surface per platform, introducing remote visual dependencies, or hiding non-functional placeholders behind presentation.

New desktop controls must have a real state owner and contract before being presented as available functionality.
