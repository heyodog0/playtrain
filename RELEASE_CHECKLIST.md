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
- [ ] **A5. Catalog divergence** `[you]` — 9 games differ between `examples/games/js`
      (34, default) and `games/js` (73), including `breakout`. Pick one canonical tree.
      Blocks the notebook, which reads one and runs the other.

## B. Cuts — ~675 files / 33 MB → ~300 files / ~3 MB

- [ ] **B1. Delete** `[me]` — `handoff/` (58), `docs/` except `REPRO.md` (5),
      the 4 root `*_PLAN.md`, `tools/HANDOFF.md`, `benchmarks/raw_vec_bench.py`,
      `benchmarks/plot_compare.py`.
- [x] **B2. Move `website/` out** — DONE: `heyodog0/playtrain-website` (private),
      252 files, built `site/` excluded. Delete `website/` from this repo in B1.
      ~~`[you]`~~ — 92 files, 18.2 MB, 55% of the repo.
      Own repo or `gh-pages` branch.
- [ ] **B3. Delete deployment glue** `[me]` — `middleware.js`, `vercel.json`.
- [ ] **B4. Relocate to reproduction** `[me]` — `games/logs/` (167 files, 3.7 MB),
      `results/` (2), study harness (`tools/study-*`, `STUDY.md`, `build-study.mjs`,
      `verify-replay.mjs`, `replay-video.mjs`, `api/session.js`).
- [ ] **B5. Trim the justfile** `[me]` — split `install` from `install-web`, drop
      `sync-analogen` (names a private repo) and `share` (deploys to your Vercel),
      move the `study-*` block with B4, add `just wheel`.

## C. Packaging and publish

- [x] **C1. Native wheels** — build hook, `py3-none-<platform>` tag, four wheel-mode
      path fixes, `PLAYTRAIN_ARCH`, CI workflow with smoke test. Verified in a clean venv.
- [x] **C2. uv-native** — PEP 723 `examples/quickstart.py`, `uvx playtrain`,
      `playtrain[gen]` extra, git-URL dependency replaced.
- [ ] **C3. Claim PyPI names** `[you]` — `playtrain` and `playtrain-trainers` are both free.
- [ ] **C4. AVX2 decision** `[you]` — wheels default to `x86-64-v2`; `v3` is ~6% faster
      but SIGILLs on pre-Haswell. Confirm or override.
- [ ] **C5. Trainers standalone** `[me]` — verify `pip install playtrain-trainers`
      resolves from PyPI with no sibling checkout.
- [ ] **C6. Tag `v0.1.0`, publish** `[you]` — CI builds wheels; upload to PyPI.

## D. Docs

- [x] **D1. README** — rewritten, 96 lines, minimal style. Placeholders remain:
      paper title, arXiv link, bibtex.
- [ ] **D2. `REPRO.md` → `REPRODUCING.md`** `[me]` — promote to root. **Stale**:
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

- [ ] **E1. Cut the scaling cell** `[me]` — Colab is 1 physical core + HT; it measured
      44% efficiency, which reads as a refutation of the paper's 99-100%.
- [ ] **E2. Reframe the training cell** `[me]` — 1.79M steps produced no learning
      (return flat 87.5 → 95.5 vs random ~79). Make it a throughput/smoke run.
- [ ] **E3. Fix the source/env mismatch** `[me]` — depends on A5.
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
