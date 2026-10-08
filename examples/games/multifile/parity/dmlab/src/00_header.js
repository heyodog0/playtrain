// DMLab-30 on PlayTrain - a fast first-person port of DeepMind Lab's maze
// levels (examples/games/multifile/parity/dmlab/PLAN.md).
//
// GENERATED BUNDLE WARNING: if you are reading this inside dist/dmlab_*.js, do
// not edit it. Edit src/ and re-run tools/bundle_multifile.py.
//
// What is DMLab's and what is not:
//   * layouts, textures, decals, spawns and goals are DATA that DMLab generated
//     (reference/dumps, compiled by tools/compile_level.py) - nothing here
//     generates a maze;
//   * movement is a Quake-3-style walk written from its published behaviour and
//     fitted to DMLab's own trajectories (40_pmove.js, PROGRESS.md U04);
//   * pixels come from one rasterizer primitive, rs_maze_view (maze.rs);
//   * textures are derived from DMLab's //assets, CC BY 4.0
//     (games/dmlab_assets/ATTRIBUTION.md). No GPL code is copied or translated.
