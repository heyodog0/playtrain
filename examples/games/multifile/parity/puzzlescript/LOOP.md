# Loop prompt for executing PLAN.md

Invoke as `/loop` with no interval so the agent self-paces, passing the block
below verbatim. Each iteration is one unit from PLAN.md section 8, no more. The
ledger `PROGRESS.md` beside this file is the only record of state; the
conversation is not.

---

You are executing `examples/games/multifile/parity/puzzlescript/PLAN.md` in the
playtrain repo at `/Users/heyodogo/code/lab/playtrain/playtrain`. One iteration
= one unit from PLAN.md section 8, chosen from `PROGRESS.md`. Do this, in order:

1. Read `PROGRESS.md`. If `STATUS` is `DONE` or `BLOCKED`, stop the loop. Take
   the first unit whose status is `todo` or `in-progress`. If it is `blocked`
   or `handoff`, skip to the next; if none is left, write a summary at the
   bottom of `PROGRESS.md`, set `STATUS: DONE`, and stop the loop. Say which
   unit you picked in your first line.
2. Read PLAN.md sections 2, 3, 4 and 7 in full before writing code, and the
   sibling families `examples/games/multifile/parity/chip8/` and `../vgdl/` for
   the conventions (manifest, bundler, sidecars, goldens, gate scripts, tests,
   conftest `run_js`/`node`/skip rules). Reuse their shapes; do not invent new
   ones. If PLAN.md and the reference source disagree, the reference source wins
   and you correct PLAN.md in the same commit with a note.
3. Do the unit. Run its gate, the one named in the unit's "done when" column.
   Python in the playtrain repo is always `uv run --no-sync python -m pytest`;
   the oracle is the pinned checkout under node. A unit is done only when its
   gate is green on this machine.
4. Commit when the gate is green: `git add` the files you touched (never
   `reproduction/*`, `REPRODUCING.md`, `native/aotfork/out/`,
   `examples/games/js/analogen_*`), one short phrase as the message, and the
   session line the harness requires as the only trailer. Never commit a red
   gate as done.
5. Update `PROGRESS.md`: the ledger row (status, gate output last line, commit
   hash, notes), any new reference quirk, any G10 number, one iteration-log
   line, `ITERATION`, `LAST_COMMIT`. Commit that too. Then end the iteration.

Rules that override everything else:

- **Never edit the vendored reference.** `reference/js/*` and `reference/tests/*`
  are byte-identical to the pinned commit and G0 checks it. Shims add missing
  globals; they never change engine behaviour. If the engine misbehaves under
  QuickJS or in the sandbox, reproduce it, record it under "Reference quirks"
  with the construct and line, and mark the unit `blocked` if the gate cannot
  pass. No monkey-patching of engine functions in the prelude either.
- **Never weaken a gate to pass it.** Full state every step means the whole
  section-2 list. No tolerances, no dropped fields, no shortened corpus, no
  `xfail`, no `skip` outside the documented "checkout not configured",
  "qjs_host not built" and "playwright absent" skips. If a gate cannot pass,
  mark the unit `blocked` with the exact first divergence (game, level, seed,
  step, field, reference value, bundle value) and end the iteration.
- **Never change the runtime, hosts, rasterizer or catalog.** If something is
  genuinely missing, that is a `blocked` note naming the file and the change.
- **Never copy a game whose license is not established**: the corpus is the
  editor-dropdown examples (PLAN section 1). Others go into section 9, not
  `games/`.
- **Every function a table or emitter may reference has a name.**
- **Never `rm -rf`.** Use `git rm` or `git mv`. Scratch files go in the
  session scratchpad, never in the repo.
- **Do not build a compiler, a JIT, a native twin, or an engine of our own.**
  T0 is the whole point; PLAN.md section 6: measure first.
- **Hand-offs stay hand-offs.** U10 gets its prerequisites and a note for the
  human; do not simulate a human.
- **One unit per iteration.** If a unit finishes early, end the iteration
  anyway; the next one starts with fresh context.
- Do not ask questions; nobody is watching. Put anything that needs a human
  under PLAN.md section 9 or PROGRESS.md notes and keep going.

End every iteration with `ScheduleWakeup`: 60 s when the next unit is ready,
`stop: true` when `PROGRESS.md` has no `todo` or `in-progress` unit left or
`STATUS` is `BLOCKED`.
