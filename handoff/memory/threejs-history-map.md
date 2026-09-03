---
name: threejs-history-map
description: "Where the removed Three.js/3D runtime lives in playtrain git history, key measured numbers, and the plan doc for reviving it"
metadata: 
  node_type: memory
  type: project
  originSessionId: 083632c2-5793-4aa9-9833-93af5034eef0
  modified: 2026-08-23T01:32:09.641Z
---

The full 3D path was built and removed 2026-07-19 for repo leanness (`293a751`, `ec89afa`), not failure. Full plan: `playtrain/PLAYTRAIN_3D_PLAN.md` (untracked, written 2026-08-22).

**Recovery points (tags in the local clone — don't GC before extracting):**
- `threejs-archive` (I created it, = `44268c8` = `ec89afa^`): last tree with `runtime/three/` (Dawn/WebGPU shim, ThreeGameEnv, IPC worker, atlas vec prototype, **three-cpu-fast software rasterizer prototype**), `src/playtrain/runtime/three.py`, `tools/validate_three.py`, 16 games in `examples/games/threejs/`.
- `293a751^` / `pre-lean-refactor-2026-07-19`: THREE_GAME_TEMPLATE.md + THREE_COMPLEX_TEMPLATE.md + gen-three tooling + threejs catalogs.

**Key facts:** 16/16 games passed all 5 validation checks incl. byte-identical same-machine pixel determinism; Dawn single-env full RL step median ~1700 FPS at 84×84 on M4 Pro (916–2733); atlas vec amortizes the ~0.21ms GPU map-stall and used Float32Array(7) per-env action vectors (continuous-action lead); contract is Discrete(15) via `globalThis.currentAction` (no key plumbing); three.js was pinned 0.184.0 for a WGSL codegen bug (`ffdcc7b`). Ryan's cleanup rationale was leanness only ("recoverable via tag").

Relates to [[action-space-appendix-facts]] (Discrete(15) = just another named space, trainers unchanged).
