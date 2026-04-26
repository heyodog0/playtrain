# Three.js V2 Plan

## Why a V2

The current system proves the core browser-game thesis in 2D:

- `p5.js` games can be generated as single-file environments
- the games can run headlessly without a browser
- deterministic reset and RL-compatible stepping are practical
- nontrivial physics already works through `Matter.js`

A `Three.js` version is the natural `v2` because it extends the same idea to 3D environments, richer observations, and a broader task family.

## What V2 Should Prove

The point of `v2` is not just "render 3D." It should prove that the same benchmark substrate still works when environments have:

- 3D geometry and camera control
- lighting and materials
- occlusion and depth cues
- 3D navigation / driving / flight / projectile mechanics
- source-level editability with the same rapid generation and refinement loop

The key question is whether browser-native 3D games can still be:

- simple enough to generate and refine reliably
- fast enough to step for RL
- deterministic enough to validate
- self-contained enough to make interventions cheap

## Current WebGPU Status

The repo already contains a real WebGPU / Dawn foundation for this direction.

### Working now

- [`poc/webgpu/smoke-dawn.mjs`](/Users/heyodogo/code/lab/llm-gg/poc/webgpu/smoke-dawn.mjs)
  proves the Dawn WebGPU bindings work locally by creating a device, clearing a texture, and reading pixels back.

- [`poc/webgpu/shims.mjs`](/Users/heyodogo/code/lab/llm-gg/poc/webgpu/shims.mjs)
  sets up the fake browser environment needed for headless `Three.js` execution in Node.js.

- [`poc/webgpu/poc.mjs`](/Users/heyodogo/code/lab/llm-gg/poc/webgpu/poc.mjs)
  attempts a minimal headless `Three.js` render through `WebGPURenderer`, reads pixels back from the render texture, and checks for non-zero output.

### Meaning of the current state

This means the project already has a concrete `Three.js + Dawn + Node` proof-of-concept path, not just a speculative architecture diagram.

What is still missing is the full environment layer:

- a stable runtime contract for generated `Three.js` games
- action injection and deterministic stepping
- an RL wrapper like the current `p5.js` path
- validation and throughput numbers for actual 3D environments

## Why This Is Valuable

If `v1` is "editable 2D browser-native RL environments," then `v2` becomes "editable browser-native 2D/3D RL environments."

That matters because it expands the benchmark in three directions:

1. **Observation complexity**
   3D introduces camera viewpoint, occlusion, lighting variation, and depth-like reasoning pressure.

2. **Mechanic diversity**
   It unlocks navigation, racing, embodied movement, projectile combat, physics puzzles, and other task families that are awkward in pure 2D.

3. **Algorithm relevance**
   Harder 3D tasks are more natural targets for world models, memory, planning, and multimodal control agents than simple reactive PPO baselines.

## What Must Stay True

For `Three.js` to be a good `v2`, it must preserve the parts that make the current system attractive:

- **Single-environment edit locality**
  The logic for a game should still live mostly in one place.

- **Simple authoring surface**
  The environment should be expressible with a constrained `Three.js` template rather than a large asset pipeline.

- **Deterministic reset**
  Same seed plus same actions should still yield the same trajectory.

- **Practical RL throughput**
  It does not need Procgen-level speed, but it cannot collapse into browser-automation speed.

## Suggested Scope

The first `Three.js` version should stay narrow.

Recommended constraints:

- one self-contained file per environment
- primitive geometry first (`BoxGeometry`, `SphereGeometry`, etc.)
- minimal materials
- minimal light types
- no external assets initially
- no post-processing
- no heavy animation pipelines

That keeps the `Three.js` authoring surface closer to the current single-file `p5.js` design.

## Recommended Positioning

`v1` should stand on its own:

- editable 2D browser-game benchmark families
- deterministic headless runtime
- validated RL environments
- `Matter.js` physics support

`v2` should be framed as an extension:

- the same substrate scaled from 2D canvas games to 3D WebGPU-rendered games
- a stronger benchmark family for planning, memory, and world-model-style agents

## Immediate Next Steps

1. Keep the current WebGPU POC working as a local regression test.
2. Define a minimal `Three.js` environment template with the same RL contract as the `p5.js` games.
3. Build one simple 3D game first, not a full catalog.
4. Add determinism and pixel-readback validation for that environment.
5. Measure step throughput before expanding the task family.
