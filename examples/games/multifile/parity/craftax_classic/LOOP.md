# Loop prompt for executing PLAN.md

Invoke as `/loop` with no interval so the agent self-paces, passing the block
below verbatim. Each iteration is one unit of work from PLAN.md section 11, no
more. The ledger `PROGRESS.md` beside this file is the only record of state;
the conversation is not.

---

You are executing `examples/games/multifile/parity/craftax_classic/PLAN.md` in
the playtrain repo on branch `release`. One iteration = one task or one
sub-task from PLAN.md section 11, chosen from `PROGRESS.md`. Do this, in order:

1. Read `PROGRESS.md`. Take the first task whose status is `todo` or
   `in-progress`. If it is `blocked`, skip to the next unblocked task; if all
   remaining tasks are blocked or `handoff`, write a summary at the bottom of
   `PROGRESS.md` and stop the loop.
2. Re-read the PLAN.md sections that task cites before writing code. Sections 1
   and 4 are the specification; if code and PLAN.md disagree, PLAN.md wins
   unless the C header itself contradicts PLAN.md, in which case the C wins and
   you correct PLAN.md in the same commit with a note.
3. Do the task. Run its gate. The gate is the pytest named in the task's "done
   when" column, run with `uv run pytest <path> -q`. A task is done only when
   that gate is green on this machine.
4. Commit when a gate turns green: `git add` the files you touched, one short
   phrase as the message, no trailer other than the session line the harness
   requires. Never commit a red gate as done.
5. Update `PROGRESS.md`: status, the gate output's last line, the commit hash,
   and anything the next iteration must know. Then end the iteration.

Rules that override everything else:

- **Never weaken a gate to pass it.** No tolerances on integer or bit
  comparisons, no fields dropped from the canonical dump, no shortened corpus,
  no `xfail`, no `skip` outside the documented "C driver absent" skip in
  `test_lockstep.py`. If a gate cannot pass, mark the task `blocked` with the
  exact failing comparison (seed, step, field, C value, JS value) and stop the
  iteration.
- **Never edit files under `games/craftax_src/`.** They are the reference. If
  the header needs a stub, put it in `reference/stubs/`.
- **Never change the runtime, hosts, or catalog** beyond the four changes in
  PLAN.md section 3, and only in the task that names them. Anything else is a
  `blocked` note, not a change.
- **The JS mirrors the C function by function.** Same function names in
  camelCase, same call order of `rf`/`ri`, same integer widths via typed arrays.
  When in doubt, make the diff between `craftax_classic.h` and the `src/` file
  readable side by side.
- **`Math.fround` after every float op** in worldgen, intrinsics, light, and
  spawn chance. Math functions are `Math.fround(Math.cos(x))` and friends. No
  `BigInt` anywhere; the 64-bit PCG state is two uint32 words.
- **Python is `uv run` / `uv add`.** Never `pip`, never bare `python`.
- **Never `rm -rf`.** Use `git rm` or `git mv`.
- **Cluster work uses `fasrc '<cmd>'`.** The first call may sit silent up to
  60 s while it authenticates; that is normal. Do not retry a failed auth for
  30 s. Cluster tasks are marked in `PROGRESS.md`; do not run them from the Mac.
- **Hand-offs stay hand-offs.** Tasks marked `handoff` (G6 human session, the
  website look, any browser check) get their prerequisites built and a note on
  what the human should do. Do not simulate a human session.
- **One task per iteration.** If a task finishes early, end the iteration
  anyway. The next iteration picks up the next task with fresh context.
- If you find a bug in the C header, document it in `README.md` under
  "Reference quirks", reproduce it faithfully in JS, and do not fix it.

End every iteration with `ScheduleWakeup`. Pick 60 s when the next task is
ready to start, 1200 s or more when waiting on a cluster job, and `stop: true`
when `PROGRESS.md` has no `todo` or `in-progress` task left.
