# PROGRESS — CHIP-8 on PlayTrain (Octax parity)

The only record of state. `LOOP.md` reads this first every iteration.

STATUS: RUNNING
ITERATION: 3
BRANCH: chip8 (from vgdl @ 0f341a0)
LAST_COMMIT: 087c13f

## Ledger

| unit | status | gate output (last line) | commit | notes for the next iteration |
|---|---|---|---|---|
| U00 commit vgdl, branch chip8 | done | `9 passed, 3 skipped in 153.81s` | 0f341a0 (vgdl), af2e251 (chip8 harness) | vgdl committed as 306 files; `reproduction/*`/`REPRODUCING.md` edits were not present in the tree; skips = playwright, qjs_host not built, RC_RL oracle. `uv run --no-sync pytest` cannot spawn the binary here: use `uv run --no-sync python -m pytest` |
| U01 scaffold + oracle | done | `2 passed in 1.85s` (2 skipped without CHIP8_ORACLE_PY/CHIP8_OCTAX) | 83321ba | Oracle venv is in the session scratchpad (`uv venv -p 3.12 octax-venv`; `jax[cpu]~=0.6.1 flax~=0.10.6 numpy~=2.2.6 opencv-python-headless~=4.11.0 pillow~=11.2.1`; got jax 0.6.2); re-create it and re-clone Octax @ 3aa53b5 when the scratchpad is gone. Run gates with `CHIP8_OCTAX=<checkout> CHIP8_ORACLE_PY=<venv>/bin/python`. Octax imports cv2 and PIL at package import, hence the two image libs. 39 ROMs copied; sha1 of the pinned files is the reference (metadata hashes wrong for flight_runner, spacejam, worm, all levelled). Display hash = packbits of display[x][y] C-order, sha1. Oracle ~1.4 s per invocation (JIT). |
| U02 CPU core + opcode vectors | done | `193/193 vectors match (15 legacy-mode)`; pytest `3 passed` | 087c13f | `tests/export_vectors.py` wraps `octax.execute` while Octax's own 69 tests run (all pass) and records every call -> `tests/vectors/octax_tests.json` (193 vectors, incl. 11 CXNN and 15 legacy-mode; the CPU carries a `modern` flag so legacy vectors replay too). Because CXNN needs threefry, `src/10_threefry.js` already has split + bits + randint8 (block fn copied from craftax); U03 is now: move the block fn to `../../common/`, G2 over 10k keys, keep craftax green. Probed live: FX29 is uint8 end to end (V=40 -> I=24); legacy FX55 bumps I unmasked (0xFFF -> 4111); any EXNN other than A1 acts as EX9E; 5XYN/9XYN ignore N. |
| U03 threefry split + randint | todo | | | craftax's `16_threefry.js` has the block function and `threefrySplit` |
| U04 env step + 3 games lockstep | todo | | | |
| U05 prelude, bundles, sidecars, goldens | todo | | | |
| U06 all 22 games lockstep | todo | | | |
| U07 cross-engine gate, runtime, benchmark | todo | | | |
| U08 browser smoke | todo | | | playwright-core: `npm i playwright-core` in a scratch dir; Chromium under `~/Library/Caches/ms-playwright/` |
| U09 report + docs | todo | | | |
| U10 human handoff | handoff | | | |

Status values: `todo`, `in-progress`, `done`, `blocked`, `handoff`.

## Numbers

(G9 results go here: game, steps/s 1 env / 1 thread, 20 env / 10 thr, QuickJS.)

## Reference quirks found

(Anything Octax does that a CHIP-8 reference manual would not predict, with the ROM and step where it was seen.)

- Timers with `disable_delay=False` (16 of 22 games; `create_environment` default) underflow: `max(t-1, 0)` in uint8, 0 -> 255. Seen: tetris seed 3 sound 0 -> 255 -> 254 (steps 1-2), delay 0 -> 255 (step 4); cavern1 seed 2 sound 0 -> 255 (step 1). manifest.json reference_quirks.
- Every 8XYN writes VF (8XY0-3 and undefined N set 0; X == F: the flag wins). FX29 address is uint8 arithmetic. BXNN jumps to (NN + VX) & 0xFFF. Stack has no bounds check (17th push dropped, pointer 17; pop at 0 -> pointer -1, reads/zeroes stack[15]). fetch clamps reads, pc unmasked uint16. All probed live in U01 (alu.py, misc.py, control_flow.py, stack.py, emulator.py).
- Module `metadata.roms` sha1 does not match the shipped file for flight_runner, spacejam, worm; levelled games carry metadata for unrelated files. cavern4a/4b are not loadable via create_environment.
- Random brix play terminates at step 38 (V14 == 4 after the first lost life); lockstep gates must step past terminated (`--no-stop`) or stop at it consistently on both sides (decide in U04).

## Iteration log

(one line per iteration: `N | unit | what changed | gate`)
1 | U00 | committed vgdl branch (306 files), branched chip8, committed harness | vgdl pytest 9 passed 3 skipped
2 | U01 | Octax cloned + venv, manifest.json (22 games, 39 ROM sha1s, 10 quirks), roms/, tests/oracle.py + conftest + G0 test; PLAN section 2 corrected (timers, VF, FX29, BXNN, stack, disable_delay default) | G0 2 passed
3 | U02 | src/10_threefry.js, src/20_cpu.js, exporter + 193 vectors, replay gate, conftest.run_js | G1 193/193
