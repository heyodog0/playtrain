# Release checklist

Working doc for the public release. **Delete this file before publishing.**
`[you]` = needs your decision or your account. `[me]` = I can execute.

---

## A. Blockers — public release cannot happen until these are done

- [x] **A1. Participant data** — DONE: 30 anonymized sessions in
      `reproduction/data/study/` (392 KB gzipped), produced by
      `reproduction/anonymize_study_data.py`; verified no id, UA, session id,
      completion code or absolute timestamp survives. Raw `dist/` still to delete (B1).
      ~~`[you]`~~ — `dist/study-data/`, 30 files, 30 Prolific IDs
      + userAgent + screen + consent timestamps; 5 set `doNotRecontact: true`.
      Decide: publish nothing, or publish anonymized (opaque ids, no UA/screen/session).
- [~] **A2. Fresh history** `[you]` — private repo renamed to `playtrain-dev`. Still to do:
      create the fresh public `playtrain`. — A1 is in git history, so deleting it in a new
      commit does not remove it. Rename the private repo to `playtrain-dev`, create a
      fresh public `playtrain` at the same URL (keeps every link already written).
- [ ] **A3. ProcGen attribution** `[me]` — `games/procgen_src/` is 17 verbatim OpenAI
      files with no license header. MIT requires the notice. Add `LICENSE` + provenance
      README, or drop the directory.
- [ ] **A4. Hardcoded password** `[me]` — `middleware.js:24`. Deleting the file
      (see B3) resolves it.
- [x] **A5. Catalog divergence** — RESOLVED: `examples/games/js` is canonical.
      Evidence: all 87 paper configs set `native_games_dir` to it, `study-audit.mjs`
      defaults to it, the runtime defaults to it, and the `PLAYTRAIN_GAMES_DIR` export
      in the Slurm launchers is dead (points at a path that does not exist, and the
      explicit arg wins anyway). `games/js` is the generation workspace: no longer
      bundled in the wheel, now carries a README saying so.

## B. Cuts — ~675 files / 33 MB → ~300 files / ~3 MB

- [x] **B1. Delete** — DONE: `handoff/`, 5 `docs/` files, 4 root plans,
      `tools/HANDOFF.md`, `raw_vec_bench.py`, `plot_compare.py`, `website/`, raw `dist/`.
      ~~`[me]`~~ — `handoff/` (58), `docs/` except `REPRO.md` (5),
      the 4 root `*_PLAN.md`, `tools/HANDOFF.md`, `benchmarks/raw_vec_bench.py`,
      `benchmarks/plot_compare.py`.
- [x] **B2. Move `website/` out** — DONE: `heyodog0/playtrain-website` (private),
      252 files, built `site/` excluded. Delete `website/` from this repo in B1.
      ~~`[you]`~~ — 92 files, 18.2 MB, 55% of the repo.
      Own repo or `gh-pages` branch.
- [x] **B3. Delete deployment glue** — DONE: `middleware.js`, `vercel.json`. ~~`[me]`~~ — `middleware.js`, `vercel.json`.
- [x] **B4. Relocate to reproduction** — DONE: `generation-logs/` (167),
      `llm_cost.json` + `.tex`, study harness (18 files incl. `session.js`),
      `fig_schematic.py`. `count_tokens.py` and `.gitignore` repointed. ~~`[me]`~~ — `games/logs/` (167 files, 3.7 MB),
      `results/` (2), study harness (`tools/study-*`, `STUDY.md`, `build-study.mjs`,
      `verify-replay.mjs`, `replay-video.mjs`, `api/session.js`).
- [x] **B5. Trim the justfile** — DONE: 232 -> 169 lines, 33 recipes; `install`
      no longer needs pnpm (`install-web` does), dropped `share`/`sync-analogen`/
      16 study recipes/`site`+`site-serve`, added `wheel`. Your WIP is in
      `git stash@{0}`. ~~`[me]`~~ — split `install` from `install-web`, drop
      `sync-analogen` (names a private repo) and `share` (deploys to your Vercel),
      move the `study-*` block with B4, add `just wheel`.

## C. Packaging and publish

- [x] **C1. Native wheels** — build hook, `py3-none-<platform>` tag, four wheel-mode
      path fixes, `PLAYTRAIN_ARCH`, CI workflow with smoke test. Verified in a clean venv.
- [x] **C2. uv-native** — PEP 723 `examples/quickstart.py`, `uvx playtrain`,
      `playtrain[gen]` extra, git-URL dependency replaced.
- [~] **C3. Claim PyPI names** `[you]` — account created; pending publishers being
      configured. NOTE: a pending publisher does NOT reserve the name — it is only
      claimed by the first real upload.
- [ ] **C4. AVX2 decision** `[you]` — wheels default to `x86-64-v2`; `v3` is ~6% faster
      but SIGILLs on pre-Haswell. Confirm or override.
- [ ] **C5. Trainers standalone** `[me]` — verify `pip install playtrain-trainers`
      resolves from PyPI with no sibling checkout.
- [~] **C6. Tag `v0.1.0`, publish** `[you]` — trusted-publishing job added to
      `wheels.yml` (tags only, gated on the smoke test). Needs: a GitHub environment
      named `pypi` in the repo, the public repo to exist, and A5 settled first.

## D. Docs

- [x] **D1. README** — rewritten, 96 lines, minimal style. Placeholders remain:
      paper title, arXiv link, bibtex.
- [~] **D2. `REPRO.md` → `REPRODUCING.md`** `[me]` — moved to root. Still **stale**:
      last touched Aug 10, predates the EnvPool reframing, adv2, and the engine tier.
      Needs a rewrite once the numbers freeze.
- [ ] **D3. `benchmarks/README.md` staleness** `[me]` — refers to "Figure 2(a)/(b)"
      and quotes bigfish 207,757 f/s. Same freeze dependency as D2.
- [ ] **D4. `CONTRIBUTING.md`** `[me]` — the justfile, native build, tests, adding a game.
- [ ] **D5. `AGENTS.md`** `[me]` — orientation for agent readers: API surface, catalog,
      and the pitfalls found today (`reset(seeds)` positional; don't name a checkout
      `playtrain`; engine tier degrades silently without clang).
- [ ] **D6. `CHANGELOG.md`** `[me]` — with a separate **Environment changes** section,
      so future papers can cite a tag and say what moved.
- [ ] **D7. `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue templates** `[me]`.

## E. Notebook

- [x] **E1. Cut the scaling cell** — DONE: replaced with `lscpu` + a single-thread
      number, so the hardware explains itself. ~~`[me]`~~ — Colab is 1 physical core + HT; it measured
      44% efficiency, which reads as a refutation of the paper's 99-100%.
- [x] **E2. Reframe the training cell** — DONE: 300k steps, framed as throughput +
      loop-wiring, with the 1.79M-step flat-return result stated. ~~`[me]`~~ — 1.79M steps produced no learning
      (return flat 87.5 → 95.5 vs random ~79). Make it a throughput/smoke run.
- [x] **E3. Fix the source/env mismatch** — DONE: reads `examples/games/js`, and the
      clone now lands in `/content/src` so it cannot shadow the package. ~~`[me]`~~
- [ ] **E4. Host the checkpoint** `[you]` — step 5 downloads from a release asset URL
      that does not exist yet.
- [ ] **E5. Real Colab run** `[me]` — re-run end to end once the repos are public.

## F. Reproduction folder

- [ ] **F1. Skeleton** `[me]` — `reproduction/{README,data,figures,measure}`, split
      tier 1 (redraw from committed data, laptop, minutes) from tier 2 (re-measure,
      cluster hardware).
- [ ] **F2. Fold in `playtrain-paper`** `[you]` — ~19 MB, 16 MB of which is three
      learning-curve JSONs. One fewer repo to discover.
- [ ] **F3. Cull its `tools/`** `[me]` — ~30 scripts; keep only those drawing a paper artifact.
- [ ] **F4. `analogen` dependency** `[you]` — `REPRO.md` cites `heyodog0/analogen`
      branch `handoff-2026-08-09` for the JAX baseline. Publish it or give that figure
      another reproduction path.

## G. After the preprint

- [ ] **G1. `ci.yml`** — tests + `gate_qjs.sh` + `gate_async.py` on every PR.
- [ ] **G2. Catalog checksums in CI** — obs-stream hash per game per seed. This is the
      class of bug A5 is; nothing crashed.
- [ ] **G3. Nightly** — wheel build + clean-container install + `quickstart.py`.
      NOT throughput: GitHub runners are too noisy (your own nodes vary 1.56x).
- [ ] **G4. Self-hosted perf job** — fixed hardware, track relative change over time.
- [ ] **G5. State-vector observations** — design note. `getGameState()` already exists
      in the contract; widening it skips the rasterizer (9.5-43% of the profile).
      The LLM that writes the game can write its state schema.
- [ ] **G6. `playtrain train`** — one command that trains an agent, no config file.

---

## Open, needs you

