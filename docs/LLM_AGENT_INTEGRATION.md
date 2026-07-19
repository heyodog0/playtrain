# LLM/VLM Agent Integration Plan

A plan for making node-gym a first-class substrate for LLM and VLM game-playing agents, enabling **tri-modal agent comparison** (humans + RL-trained agents + LLM/VLM agents) on byte-exact identical environments under controlled variant manipulations.

This is parallel to (not part of) `VGDL_PLAN.md`. VGDL expands *what games* the substrate covers; this plan expands *which agent classes* can consume the substrate.

## Why this matters

The dissertation arc (`DISSERTATION_ARC.md`) is structured around the Lake-manifesto question: *do machines learn and think like people, and what cognitive architecture brings them closer?* When that manifesto was written (2017), the comparison was between hand-engineered cognitive models, deep RL agents, and humans. **LLM and VLM agents were not yet a class.** They are now, and they bring a property neither RL agents nor cognitive models have: **broad linguistic + world-knowledge priors from pretraining.**

A three-class comparison — humans, RL agents, LLM/VLM agents — on the same controlled variant manipulations isolates *which aspects* of human-like generalization come from:

- **Learned task-specific representation** (RL agents have this)
- **Linguistic / pretraining priors** (LLM agents have this; RL agents don't)
- **Both, plus innate cognitive structure** (humans)

This makes Paper 2's empirical landscape substantially richer. A common pairwise comparison ("humans vs. RL agents") reveals only that something is missing in the RL agent; tri-modal comparison localizes *what* is missing and whether linguistic priors close the gap.

Concrete predictions to test:

- LLM/VLM agents handle **visual variants** well (visual priors from pretraining) but fail on **role-shuffling** (no structure-mapping engine without specific prompting)
- Humans handle **role-shuffling** via structure mapping but degrade under heavy **parametric variation**
- RL agents do the opposite — robust to parametric variation, brittle to visual changes
- LLM/VLM agents may *understand* the task verbally but still fail behaviorally (the "knows-the-rule-but-can't-execute" gap)

These are falsifiable predictions, and node-gym's variant axes are the right stimulus apparatus to test them.

## Landscape of existing LLM/VLM game-agent harnesses

Survey of how current harnesses interface with environments:

| Harness | Env source | API style | Notable limits |
|---|---|---|---|
| **VideoGameBench**[^videogamebench] | GameBoy / GBC / DOS ROMs | Screenshot + button press, real-time | ROM licensing; 23 fixed games; no variants |
| **BALROG**[^balrog] | NetHack, Crafter, MiniHack, BabaIsAI, BabyAI, TextWorld | Gym-compatible wrapper | ~5 envs; no controlled variants across them |
| **PokeGym** | Pokémon Legends Z-A | Memory scanning + RGB | Single game; ROM-dependent |
| **JARVIS-VLA**[^jarvis-vla] | Minecraft via Mineflayer | Screenshot + keyboard/mouse | Minecraft-specific; not generalizable substrate |
| **Voyager**[^voyager] | Minecraft via Mineflayer | LLM emits JS skills consumed by Mineflayer | Minecraft-specific; demonstrates "LLM emits code" loop |
| **Cradle**[^cradle] | OS-level GUI applications | Screenshot + mouse/keyboard | Open-world; uncontrolled |
| **Anthropic / OpenAI Computer Use** | Generic desktop OS | Screenshot + mouse/keyboard | Same |

Common pattern: **whoever has the cleanest screenshot + action + reset interface with permissive licensing wins adoption**. ROM-based benchmarks are increasingly painful (licensing, deterministic eval, reproducible state). node-gym sits in the sweet spot — if the integration layer exists.

What's structurally missing across all existing harnesses:

1. **Controlled variant axes for the same task.** No harness lets you ask "does this LLM agent's behavior survive a role permutation while everything else is identical?"
2. **Byte-exact reproducibility across human, RL, and LLM-agent runs.** ROM emulators drift; OS-level captures aren't reproducible; even gym-compatible envs lack cross-runtime guarantees.
3. **Cheap re-rollout determinism.** LLM tokens are expensive. If the env is non-deterministic or non-replayable, every analysis costs new tokens.
4. **No ROM/IP encumbrance for derivative training or eval distribution.**

node-gym addresses all four, and the integration work is glue rather than substantive new substrate.

## What node-gym already provides

Most of the substrate is in place; the LLM-agent angle is largely an exposure problem:

- ✅ Gym/gymnasium-compatible Python wrapper
- ✅ Deterministic reset + seed (mulberry32 + fixed timestep + strict shim)
- ✅ Frame buffer output (Cairo today; WASM/JAX planned)
- ✅ Discrete action space, per-game manifest
- ✅ Browser-headless equivalence (same env for human study and headless agents)
- ✅ Multi-env runtime (C₁) for parallel rollouts
- ✅ Clean licensing — LLM/DSL-authored content with no ROM entanglement

## What integration glue is needed

The gap between "node-gym exists" and "any LLM agent harness can plug it in" is small but specific:

### 1. HTTP/WebSocket bridge for non-Python harnesses

Currently the gym wrapper is Python-native. LLM-agent frameworks in Node, Rust, or harnesses that call provider APIs directly (`anthropic.messages.create(...)`, `openai.chat.completions.create(...)`) are blocked.

A small HTTP server (~200 LOC) exposing:

```
POST /reset      { game, seed, variant }       → { obs_b64, info }
POST /step       { action }                     → { obs_b64, reward, done, info }
GET  /render     ?format={png|jpeg|raw|numpy}   → image bytes
GET  /games                                     → [game_manifest, ...]
GET  /games/:id/manifest                         → { action_space, task_description, ... }
POST /trajectory/record   { trajectory_id }     → start recording for cheap replay
GET  /trajectory/:id/replay                      → recorded actions for re-analysis
```

Solves polyglot harnesses; ~2-3 days of work.

### 2. Standard screenshot encoding endpoints

Different agents want different formats:

| Format | Consumer |
|---|---|
| PNG base64 | Direct VLM API calls (Claude vision, GPT-4V, Gemini) |
| Raw uint8 ndarray | numpy-native Python harnesses |
| JPEG | Bandwidth-constrained / mobile harnesses |
| BMP | Some legacy emulator-compat tools |

~half a day of plumbing.

### 3. Structured-action mode

Most LLM agents emit JSON like `{"action": "move_up"}` rather than discrete integer IDs. A small wrapper translates structured ↔ discrete given a per-game action manifest:

```js
// game manifest
export const ACTIONS = {
  move_up:    { id: 0, description: "Move agent up one cell" },
  move_down:  { id: 1, description: "Move agent down one cell" },
  move_left:  { id: 2, description: "Move agent left one cell" },
  move_right: { id: 3, description: "Move agent right one cell" },
  pickup:     { id: 4, description: "Pick up item at current cell" },
  drop:       { id: 5, description: "Drop carried item at current cell" },
};
```

The bridge accepts either `{"action": 4}` or `{"action": "pickup"}`. LLM agents get human-readable action vocabularies; descriptions feed into prompts. ~1 day of work.

### 4. Natural-language task descriptions per game

LLM agents are typically conditioned on instructions. Each game declares:

```js
export const TASK = {
  short: "Reach the gold token.",
  long: "You are an agent in a grid world. Your goal is to reach the gold token at the end of the room. You must use the key to unlock the door, and avoid the enemy. You can carry up to two items at once.",
  hints: ["The sword kills the enemy.", "Boots let you pass the barrier.", "The key unlocks the door."],
};
```

LLM-authored via gym-gen; ~5 minutes per base game; variants inherit from the base.

### 5. Adapter packages for 2-3 popular harnesses

- `node-gym-balrog` — drop-in BALROG-compatible gym wrapper exposing node-gym envs in BALROG's expected format
- `node-gym-videogamebench` — VideoGameBench-compatible "screenshot + button press" wrapper for the subset of node-gym games that fit the format
- `node-gym-anthropic-computer-use` — reference integration showing Claude with Computer Use tools driving a node-gym game via the HTTP bridge

Each is ~1-2 days of work after the bridge exists.

### 6. Trajectory recording + replay format

LLM-agent eval is expensive; deterministic replay lets you re-analyze trajectories without re-querying the LLM. Standard format:

```jsonl
{"t": 0, "obs_hash": "...", "action": "pickup", "reward": 0, "done": false, "info": {...}}
{"t": 1, "obs_hash": "...", "action": "move_up", "reward": 0, "done": false, "info": {...}}
...
```

`obs_hash` lets you verify byte-exact replay against the recorded run. Allows the same trajectory to be analyzed by multiple downstream tools (cognitive process inference, behavioral statistics, qualitative annotation) at zero LLM-token cost.

## Total integration effort

| Component | Effort |
|---|---|
| HTTP/WS bridge | 2-3 days |
| Screenshot encoding endpoints | 0.5 day |
| Structured-action mode | 1 day |
| Task descriptions (10 reference games) | 1 day (LLM-authored, validated) |
| BALROG adapter | 1-2 days |
| VideoGameBench-compat adapter | 1-2 days |
| Anthropic Computer Use reference integration | 1-2 days |
| Trajectory recording + replay format | 1-2 days |
| Documentation + examples | 2-3 days |

**Total: ~2-3 weeks** of focused work for a clean, harness-friendly node-gym agent bridge with 2-3 reference adapters and 10 task-described games.

## Tri-modal agent comparison as research methodology

The cog-sci payoff — where this connects back to the dissertation arc — is a structured empirical methodology:

> *On the same node-gym envs under identical variant manipulations, compare:*
>
> 1. **Humans** (via browser playtest on Prolific/MTurk)
> 2. **RL-trained agents** (PPO + IMPALA-CNN, possibly Slot-Attention or other architectures)
> 3. **LLM/VLM agents** (Claude, GPT, Gemini, etc. via the HTTP bridge)
>
> *Extract from each: behavior + (where applicable) cognitive-process posteriors via the inference machinery from `DISSERTATION_ARC.md`. Use variant axes to isolate which env properties cause generalization failure differentially across agent classes.*

This is a substantially stronger claim than any agent-class-individually study could make. It speaks directly to the Lake-manifesto question with the new class of agent (LLM/VLM) that didn't exist when the manifesto was written.

### Specific findings shape this enables

| Finding shape | What it implies |
|---|---|
| LLM handles visual variants; humans handle role-shuffle; RL agent handles parametric — all fail elsewhere | Generalization is decomposable across agent classes; each class has a distinct strength |
| LLM agent verbally describes the role-binding correctly but fails to act on it | "Knows-the-rule-but-can't-execute" gap; suggests behavioral grounding ≠ linguistic understanding |
| Resource-rational inference recovers similar planning depth for humans and LLM agents but not RL agents | LLMs may be performing computation closer to human bounded planning than RL agents do |
| LLM agent improves on role-shuffle with chain-of-thought prompting but not without | Structure-mapping is *recoverable* via explicit reasoning, not implicit in LLM representations |

Any of these is a real cog-sci contribution and a real LLM-evals contribution simultaneously.

## Strategic placement in the dissertation arc

This doesn't displace the existing arc; it strengthens Paper 2 specifically.

### Update to Paper 2 experimental design

The current `DISSERTATION_ARC.md` Paper 2 design proposes "3-4 candidate agent architectures" + paired human study. Augment with:

- **Agent class 3**: LLM/VLM agents (Claude, GPT, Gemini) accessed via the bridge
- **Comparison dimension expanded** from "RL architectures vs. humans" to "RL architectures × LLM/VLM models × humans, across variant axes"

This is a substantive expansion but not a scope blowup — the bridge is cheap (~2-3 weeks), the LLM-agent runs are cheap relative to human studies (no IRB, no per-participant cost beyond tokens), and the analytical machinery is the same.

### New Phase 2 deliverable

Add to `DISSERTATION_ARC.md` Infrastructure Roadmap Phase 2:

> *Agent harness bridge + 2-3 reference adapters. Pilot LLM-agent runs on AnaloGen Setting 2; preliminary three-class behavioral comparison.*

### Industry outreach

The bridge + tri-modal methodology is *directly* relevant to:

- **Anthropic** (Computer Use team) — node-gym is a controlled-variant testbed for Computer Use evals beyond OS apps
- **OpenAI** (agents team) — same
- **DeepMind** (Genie / agentic-RL teams) — Genie produces uncontrolled diversity; node-gym produces controlled diversity for evals
- **BALROG / VideoGameBench authors** — possible upstream contribution rather than just a parallel benchmark

This is the engineering-side internship pitch from `DISSERTATION_ARC.md`'s Strategic Positioning section, made concrete with deployable infrastructure.

## Caveats and risks

1. **Token cost for LLM-agent evals.** A full variant-axis sweep across N variants × M models × K seeds gets expensive quickly. Trajectory recording + replay mitigates re-analysis cost but not initial-run cost. Budget needed; possibly model-provider grant outreach.
2. **LLM-agent harness API drift.** Anthropic/OpenAI/Google APIs change; the adapter layer needs maintenance. Keep adapters thin and the bridge stable.
3. **VLM resolution / token-budget issues.** node-gym renders at 64×64 by default; some VLMs perform better on higher resolutions. May need a config knob for render resolution in the bridge.
4. **Real-time games don't fit LLM latency.** LLMs respond in ~1-5 seconds per call; games requiring sub-second reaction (a few VGDL games, possibly some p5 games) are not testable with current API-based LLM agents. Curate accordingly or implement a "step paused while agent thinks" mode (which VideoGameBench Lite also uses).
5. **Agent class fairness.** Comparing LLM agents to RL agents trained for millions of steps isn't apples-to-apples. The variant-axis methodology partially addresses this (both are tested on unseen variants), but framing matters in writeup.

## Open questions

1. **Should the bridge be node-gym-internal or its own project?** If other JS-based RL envs adopt similar interfaces, a generic `js-rl-agent-bridge` package serves the community better than a node-gym-specific one. Defer this decision until after the bridge exists.
2. **Should LLM-emitted-code (Voyager-style skills) be supported?** Currently the integration is screenshot-in / action-out. Voyager-style "LLM emits JS skill, env executes it" is a much richer interaction model. The shim profile makes this tractable in principle (LLM emits shim-bounded JS, sandbox executes within the runtime). Defer until v2.
3. **Per-game prompt templates vs. universal prompts.** Some harnesses use universal prompts; others have per-game scaffolding. Which is the right default for node-gym's task descriptions? Likely both — short universal description + per-game hints.
4. **Should the bridge expose intermediate state (inventory, score, internal flags) or only pixels?** Some LLM-agent harnesses augment pixels with structured state ("you are carrying: key, sword"). Strictly more information; arguably less interesting cognitively. Configurable, with pixel-only as the default.
5. **Reward signal exposure.** Some harnesses pass reward to the LLM agent each step; others only at episode end. Affects what agents learn / can react to. Configurable.

## Concrete next steps

1. **Spike the HTTP/WS bridge.** ~3 days. Get `POST /reset`, `POST /step`, `GET /render` working against one game.
2. **Write task descriptions for 5 reference games** (AnaloGen grid + 4 others from gym-gen). LLM-authored via gym-gen, validated by hand.
3. **Build the BALROG adapter.** Tests the bridge against a real harness. ~2 days.
4. **Pilot LLM-agent run.** Claude / GPT on AnaloGen `nomemory_grid_v5` with role-shuffle variants. ~1 day of running + analysis. **Goal: a first behavioral data point on "do LLM agents handle role-shuffling?"** This is a sanity-check finding before scaling to a full study.
5. **Decide:** based on pilot, whether to expand to full tri-modal study (Paper 2 expansion) or treat as a methods note.

## Sources and references

- [VideoGameBench: Can Vision-Language Models complete popular video games?](https://arxiv.org/html/2505.18134v3)
- [BALROG: Benchmarking Agentic LLM/VLM Reasoning On Games](https://arxiv.org/abs/2411.13543)
- [JARVIS-VLA: post-training large VLMs to play visual games](https://github.com/CraftJarvis/JARVIS-VLA)
- [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://voyager.minedojo.org/)
- [Cradle: Empowering Foundation Agents Towards General Computer Control](https://baai-agents.github.io/Cradle/)
- [Anthropic Computer Use docs](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use)
- [OpenAI gym / gymnasium standards](https://gymnasium.farama.org/)

## Footnotes

[^videogamebench]: Anand, S. et al. (2025). *VideoGameBench: Can Vision-Language Models complete popular video games?* arXiv:2505.18134.
[^balrog]: Paglieri, D. et al. (2024). *BALROG: Benchmarking Agentic LLM/VLM Reasoning On Games.* arXiv:2411.13543.
[^jarvis-vla]: CraftJarvis (2024). *JARVIS-VLA: Post-training large VLMs to play visual games via keyboard and mouse.*
[^voyager]: Wang, G., Xie, Y., Jiang, Y., Mandlekar, A., Xiao, C., Zhu, Y., Fan, L., & Anandkumar, A. (2023). *Voyager: An Open-Ended Embodied Agent with Large Language Models.* arXiv:2305.16291.
[^cradle]: Tan, W. et al. (2024). *Cradle: Empowering Foundation Agents Towards General Computer Control.* arXiv:2403.03186.
