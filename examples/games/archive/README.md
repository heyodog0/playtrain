# Archived coinrun variants (archived 2026-07-11)

Only the plain `coinrun.js` ships in `../js/` now. These experimental variants
were moved out to keep the game catalog simple (one canonical version per game):

- `coinrun_fast.js` — flat-Uint8Array int-tile-grid + run-batching rewrite.
  Obs bit-exact to `coinrun.js`, ~1.4× faster in the QuickJS host. Kept as the
  reference for the representation-rewrite pattern (see
  `../../../native/HANDOFF-coinrun-perf.md`).
- `coinrun_fast_layered.js` — the layer-cache **receipt**: identical logic to
  `coinrun_fast.js`, terrain rendered into an offscreen layer then rescaled to
  obs res. Proves the layer-cache wall (obs diverges, logic identical).
- `coinrun_nocall.js`, `coinrun_nodraw.js` — profiling stubs (frame decomposition).
