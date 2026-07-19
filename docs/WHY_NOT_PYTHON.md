# Why JS, not Python

**TL;DR:** `PlayTrain` + `gym-gen` + `analogen` is one closed loop — an LLM authors a game in p5.js, a human playtests it in a browser, validation gates it into a catalog, and PPO trains on it headlessly at ALE-parity FPS. The substrate choice isn't *JS over Python*. It's *the only runtime where authoring, playtesting, training, and shipping happen in one artifact*. Python doesn't lose on any single axis — it loses on the conjunction.

## 1. Corpus → LLM fluency → generator quality

The generator is the bottleneck of the pipeline, and the LLM's fluency is downstream of corpus. p5.js is the de facto creative-coding library — designed by the Processing Foundation for "artists, designers, educators, and beginners"[^p5] — with millions of sketches on OpenProcessing, CodePen, itch, and GitHub. Python has no equivalent. Pygame Zero is the closest analog ("a zero-boilerplate games programming framework for Python 3, intended for use in education"[^pgzero]) but its audience is K-12 teachers, not the open creative community. Smaller audience → smaller corpus → weaker LLM fluency at the authoring step. This gap doesn't close with bigger models, because the input distribution stays sparse.

## 2. One artifact, five simultaneous constraints

A `gym-gen` output must be:

- LLM-emittable in one file
- human-playable in a browser
- agent-trainable headlessly
- sandboxable (untrusted LLM code)
- shareable as a URL

The browser stack collapses all five into one runtime. Python splits them across pygame + gym wrapper + renderer + container + repo. **Each seam is where the loop breaks.** Pyodide can run Python in the browser, but it pays a constant interpreter-on-WebAssembly tax[^pyodide] and gives up the "Python is faster" argument in the process — it becomes JS-hosted Python, not Python.

## 3. Dependencies are per-artifact, not per-environment

In JS, `<script src="cdn/matter.js">` is a complete dep declaration. The universal client (browser, or `PlayTrain` + node-canvas[^nodecanvas]) resolves it at load time, sandboxed. Two of `gym-gen`'s 30 games use Matter.js; the other 28 don't; adding it touched zero other games and zero installs on any user's machine.

In Python, deps are per-environment: pygame needs SDL2, pymunk needs a C++ compiler, Box2D bindings have multiple incompatible forks. Every game in the catalog shares one global interpreter with the training stack. Catalog grows → dep conflicts grow → reproducibility decays. The cluster (`analogen` runs on FASRC) needs a separate dep tree from a laptop. `PlayTrain` fetches+caches JS deps once and runs the same code on M4 (MPS) and CUDA; there's no per-game native install.

## 4. The throughput tax doesn't exist anymore

"Python is faster" only matters if Python is faster *for this workload*. The Arcade Learning Environment has been the de facto throughput baseline for Atari-style RL since 2013[^ale]. `PlayTrain` matches ALE-class FPS via headless Node + node-canvas (see `docs/notebooks/all_games_benchmark.py`). Once you've hit ALE parity in JS, the tax is zero.

If a specific validated env ever needs faster speeds — e.g., billion-step training à la Craftax, which achieves a 257× speedup over Python-native Crafter by rewriting in JAX[^craftax] — you transpile downstream. You don't author in JAX upstream and surrender corpus, ergonomics, and the playtest loop.

## 5. Purpose-built RL frameworks lose to substrates parasitic on bigger ecosystems

Griddly is the proof. Built by Chris Bamford et al. (2021) as "an all-encompassing platform for grid-world based research" with a highly optimized C++ core[^griddly], later given a web IDE[^griddlyjs] — technically excellent, designed exactly for grid-world RL authoring, notoriously painful in practice. Its YAML/GDL DSL is mediocre LLM territory, its declarative engine has a ceiling, and its audience (RL researchers) bounds its corpus.

**The pattern: RL envs work best when they're parasitic on substrates built for something bigger.**

| Env | Parasitizes |
|---|---|
| ALE[^ale] | Atari (1979 games for kids) |
| ProcGen[^procgen] | OpenAI's in-house game engine |
| MineRL[^minerl] | Minecraft (~200M players) |
| `PlayTrain` | p5 + browser + creative-coding corpus |
| Griddly[^griddly], Jumanji[^jumanji], Craftax[^craftax] | nothing — bounded by the RL community |

Frameworks in the last row are technically excellent and often faster, but their corpus is bounded by the RL researchers using them. Envs in the rows above inherit corpus, ergonomics, and shareability from a community orders of magnitude larger than RL.

## Counterfactuals

- **"Author in JAX directly."** JAX's functional/jit constraint fights imperative game logic; the LLM is asked to author in the hardest available idiom with the smallest corpus. Wrong direction for novelty.
- **"Port JS games to JAX after generation."** Defensible as a downstream step, not an upstream choice. The generator + playtest loop has to stay where the LLM is fluent.
- **"Build a Python equivalent of p5 + browser."** Possible, but you'd have to reproduce: universal client, per-artifact dep model, sandboxing, *and* bootstrap a non-RL corpus at scale. Pygame Zero shows the shape; nothing in Python's ecosystem has the audience.

## Conclusion

> The only runtime where LLM-author + human-playtest + agent-train is one closed loop, on an artifact whose deps and corpus inherit from an ecosystem orders of magnitude larger than RL itself.

JS is currently the only substrate that's true of. Python doesn't lose on any single axis — it loses on the conjunction.

---

[^p5]: McCarthy, L. et al. *p5.js — A JS client-side library for creating graphic and interactive experiences.* Processing Foundation. <https://p5js.org>
[^pgzero]: Pocock, D. *Pygame Zero documentation.* <https://pygame-zero.readthedocs.io/>
[^pyodide]: Pyodide maintainers. *Is Pyodide slower than native Python?* <https://pyodide.com/is-pyodide-slower-than-native-python/>
[^nodecanvas]: Automattic. *node-canvas: a Cairo backed Canvas implementation for NodeJS.* <https://github.com/Automattic/node-canvas>
[^ale]: Bellemare, M.G., Naddaf, Y., Veness, J., & Bowling, M. (2013). *The Arcade Learning Environment: An Evaluation Platform for General Agents.* arXiv:1207.4708. <https://arxiv.org/abs/1207.4708>
[^procgen]: Cobbe, K., Hesse, C., Hilton, J., & Schulman, J. (2020). *Leveraging Procedural Generation to Benchmark Reinforcement Learning.* ICML 2020. <https://arxiv.org/abs/1912.01588>
[^minerl]: Guss, W.H. et al. (2019). *The MineRL Competition on Sample Efficient Reinforcement Learning using Human Priors.* arXiv:1904.10079. <https://arxiv.org/abs/1904.10079>
[^griddly]: Bamford, C., Huang, S., Lucas, S. (2021). *Griddly: A platform for AI research in games.* arXiv:2011.06363. <https://arxiv.org/abs/2011.06363>
[^griddlyjs]: Bamford, C. et al. (2022). *GriddlyJS: A Web IDE for Reinforcement Learning.* arXiv:2207.06105. <https://arxiv.org/abs/2207.06105>
[^jumanji]: Bonnet, C. et al. (2023). *Jumanji: a Diverse Suite of Scalable Reinforcement Learning Environments in JAX.* arXiv:2306.09884. <https://arxiv.org/abs/2306.09884>
[^craftax]: Matthews, M. et al. (2024). *Craftax: A Lightning-Fast Benchmark for Open-Ended Reinforcement Learning.* ICML 2024. arXiv:2402.16801. <https://arxiv.org/abs/2402.16801>
