# Loop prompt for executing PLAN.md

Invoke as `/loop` with no interval so the agent self-paces, passing the block
below verbatim. Each iteration is one unit from PLAN.md section 8, no more. The
ledger `PROGRESS.md` beside this file is the only record of state; the
conversation is not.

---

You are executing `native/twins/PLAN.md` in the playtrain repo at
`/Users/heyodogo/code/lab/playtrain/playtrain`. One iteration = one unit from
PLAN.md section 8, chosen from `PROGRESS.md`. Do this, in order:

1. Read `PROGRESS.md`. If `STATUS` is `DONE` or `BLOCKED`, stop the loop. Take
   the first unit whose status is `todo` or `in-progress`. If it is `blocked`
   or `handoff`, skip to the next; if none is left, write a summary at the
   bottom of `PROGRESS.md`, set `STATUS: DONE`, and stop the loop. Say which
   unit you picked in your first line.
2. Read PLAN.md sections 2, 3, 4 and 7 in full before writing code. Read the
   JS you are porting (the family's `src/*.js`, `common/*.js`) line by line as
   you port it; read `native/qjs/qjs_vec_host.cpp`, `native/runtime/p5.hpp`,
   `native/build_qjs_vec.sh` and `src/playtrain/runtime/native_vec_env.py` for
   the ABI, the drawing surface and the build. Reuse the families' gate shapes
   (`conftest.py` `node`/`run_js`/skip rules, `golden.mjs`, `gate_qjs.sh`).
3. Do the unit. Run its gate, the one named in the unit's "done when" column.
   Python in the playtrain repo is always `uv run --no-sync python -m pytest`;
   C++ builds through `bash native/twins/build.sh` only; a debug build with
   `-fsanitize=address,undefined` is what T1/T2 run under first. A unit is done
   only when its gate is green on this machine.
4. Commit when the gate is green: `git add` the files you touched (never
   `native/twins/build/`, `native/aotfork/out/`, `native/build/`,
   `reproduction/*`, `examples/games/js/analogen_*`), one short phrase as the
   message, and the session line the harness requires as the only trailer.
   Never commit a red gate as done.
5. Update `PROGRESS.md`: the ledger row (status, gate output last line, commit
   hash, notes), any new reference quirk, any T7 number, one iteration-log
   line, `ITERATION`, `LAST_COMMIT`. Commit that too. Then end the iteration.

Rules that override everything else:

- **Never edit the JS families, the QuickJS hosts, the runtime, the rasterizer
  or the catalog.** `examples/games/multifile/parity/*/{src,reference,dist,tests,games,roms}`,
  `native/qjs/*`, `native/runtime/*`, `runtime/*`, `crates/*`,
  `src/playtrain/*` are read-only. New files go under `native/twins/` and,
  for the serialisation tools only, under the families' `tools/` (plus their
  committed outputs under a new `twin/` directory in the family, hash-checked).
  If the ABI or a family needs a change that only its owner can make, that is
  a `blocked` note naming the file and the change, not a change.
- **Never weaken a gate to pass it.** Full state every step means every field
  of the family's snapshot. No tolerances, no dropped fields, no shortened
  corpus, no `xfail`, no `skip` outside the documented "library not built",
  "oracle not configured" and "playwright absent" skips. If a gate cannot pass,
  mark the unit `blocked` (or leave it `in-progress` with the exact first
  divergence recorded: bundle, seed, step, field, JS value, twin value) and end
  the iteration.
- **Same draw calls, same bytes.** Twins draw through `p5.hpp` with the exact
  arguments the JS prelude computes; no pixel is ever computed in twin code.
- **Copy arithmetic literally.** uint8 wrap, int32 floor division and modulo,
  the MT19937 `random()` construction, RC4, JAX index clamping: the JS
  expression, not a simplification of it.
- **No UB, no allocation in the step loop where the JS has none, every
  function named.** Sanitizers clean before a release-build number is recorded.
- **Never `rm -rf`.** Use `git rm` or `git mv`. Scratch files go in the session
  scratchpad, never in the repo.
- **The PuzzleScript VM interprets the compiled state; it does not parse
  PuzzleScript text.** If the serialised state lacks something the VM needs,
  extend `twin_state.mjs` (a tool), never the engine.
- **Hand-offs stay hand-offs.** U11 gets its prerequisites and a note for the
  human; do not simulate a human.
- **One unit per iteration.** If a unit finishes early, end the iteration
  anyway; the next one starts with fresh context. A unit may stay `in-progress`
  across iterations (U08 will); its row says exactly where it stands.
- Do not ask questions; nobody is watching. Put anything that needs a human
  under PLAN.md section 9 or PROGRESS.md notes and keep going.

End every iteration with `ScheduleWakeup`: 60 s when the next unit is ready,
`stop: true` when `PROGRESS.md` has no `todo` or `in-progress` unit left or
`STATUS` is `BLOCKED`.
