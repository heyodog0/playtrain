---
name: paper-open-issues
description: Known unresolved problems in the PlayTrain preprint as of 2026-08-02
metadata: 
  node_type: memory
  type: project
  originSessionId: cd4c6b8b-fd45-4369-b921-2f401fe36bf4
  modified: 2026-08-03T00:51:57.726Z
---

Still open as of 2026-08-02. Section 2.2 and the Experiments section have both
been reworked; these survived that.

- The title block links `github.com/heyodog0/playtrain` (**private**, 404s) and
  `https://playtrain.org` (**no DNS record**). Both must be live before posting.
  This is the only item that would actually embarrass a preprint.
- **Freeway is being regenerated** because it is too hard. Two numbers depend on
  it and are deliberately out of sync until that lands: the prose says the greedy
  policy beats random on *twenty-one* of 24 while `tab:eval` still shows
  `freeway 0.0 / 0.0` (i.e. twenty), and freeway is currently the "fastest game"
  row at 1.13M in the throughput table.
- Experiments names maze, caveflyer and ninja as failures, then says human play
  resolves the question — but only **caveflyer** will actually be played.
- The Discussion claims an appendix demo re-implementing DMLab in three.js.
  **No such appendix exists.**
- Two appendix pointers in 2.2 promise content Ryan has not written yet: QuickJS
  details point at `app:prompt` (the prompt listing), and the rasterizer says
  "more details are mentioned in the appendix" with no target.
- The action-space flexibility claim points at `app:prompt`, which specifies
  **`Discrete(8)` as fixed for every game**. The observation half is genuinely
  parameterised; the action half is hardcoded at `env.py:131` and the `ACTIONS`
  table in `game-env.mjs:42`.
- `fig:suite_grid`'s caption says 150M steps and one seed, while panel C is 100M
  over three. The text implies they are the same runs.
- `tab:contrast` and `fig:suite_grid` are still uncited. `tab:eval` and
  `tab:hyperparams` were cited during the Learning rewrite.
- The wall-clock sample-efficiency flip between IMPALA and PPO is still commented
  out, and needs PPO throughput measured before it can be claimed.
- Intro claims variation was "confined to level layout and random seeds"; a lit
  review showed this is contestable (XLand, domain randomization, GVGAI/Griddly).
  Neither XLand nor domain randomization appears anywhere in the paper.

See [[overleaf-github-sync]] before pushing, and [[playtrain-benchmark-results]]
for numbers that are settled.

**Added 2026-08-31:** (a) Fig 4A + caption + lines 540-541 + Tables 7-8 must
be rewritten in ONE pass, only after job 43246914 lands (HANDOFF-2026-08-31 §4
has the five-point list and the approved-pending framing). (b) qbert and
aim_trainer diverge from the V8 reference (terminal/reset frames) — touches
the bit-identical claim; uninvestigated. (c) rv2 tuned-build adoption and
build policy are open user decisions that invalidate published numbers if
taken. (d) app:backend prose is being drafted by Ryan (laptop session,
95cbb4b handoff version has state + 7 factual corrections); two-hosts
material CUT by his decision — at most one clause in the gate sentence.
