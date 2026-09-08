# Generation workspace

**This is not the shipped catalog.** `playtrain-generate`, `playtrain-variant` and
`playtrain-refine` write here, and `just gen-validate` / `just gen-bench` check what
lands. Games are promoted from here into `examples/games/js`, which is what
`GameEnv("breakout")` loads, what the wheel bundles, and what every experiment in the
paper used (all 87 training configs point at it, as does the human study's audit).

The two trees have diverged: 9 games differ, and this copy is the older one in each
case. `breakout.js` here still has the randomized brick wall and 3 lives; the promoted
copy is ALE-aligned with a fixed 6-row wall and 5 lives.

To run something from this directory, point the runtime at it explicitly:

```python
GameEnv(game="games/js/breakout.js")                  # a path, not a name
NativeVecEnv(game="breakout", games_dir="games/js")   # or override the directory
```
