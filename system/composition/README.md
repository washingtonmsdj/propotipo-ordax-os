# Runtime Composition

`system/composition/` is the thin outer wiring layer that joins the shared Surface to exactly one environment adapter.

It exists to keep both sides honest:

- `system/surface/` never imports Web/Mobile/Desktop/native implementations;
- adapters never import or own shared screens;
- composition may import both because its only responsibility is selecting and wiring implementations;
- product/domain policy must not live here;
- visual assets, design tokens and reusable interaction behavior remain in `system/surface/`;
- a target-specific composition entry may contain bootstrap/wiring code, not a target-specific product fork.

The first executable target is `composition/web`. Future Desktop/Mobile/native hosts may use different thin composition entries while consuming the same Surface and contracts.
