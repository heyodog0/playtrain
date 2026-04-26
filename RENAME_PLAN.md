# Rename handoff: `browserless-game-rl` → `llm-gamegen`

Mid-rename, the previous Claude session lost its Bash tool (cwd stuck on the deleted `fast-llm-games` path). This file is the handoff so a fresh session can finish.

## Already done (verified)

- ✅ **GitHub repo renamed.** `gh repo rename llm-gamegen -R heyodog0/browserless-game-rl` succeeded. Old URL `github.com/heyodog0/browserless-game-rl` auto-redirects.
- ✅ **GitHub About set.**  
  > ProcGen-style RL benchmark with LLM-generated games. Built on node-gym (the headless runtime); adds the game catalog, multi-game PPO/DQN training, train/test seed splits, and SLURM-based sweep orchestration.
- ✅ **Local directory renamed.** `mv ~/code/lab/fast-llm-games ~/code/lab/llm-gamegen`.
- ✅ **Local git remote updated.** `origin` now points to `git@github.com:heyodog0/llm-gamegen.git`.
- ✅ **README updated:**
  - `# llm-gamegen` header
  - New first-paragraph About (mentions node-gym as runtime)
  - Clone URL updated
  - Games section now describes both p5 (30) and three.js (16)
  - Game-generation bullet now mentions both backends
- ✅ **`pyproject.toml` updated:**
  - `description` mentions p5 + three.js
  - sibling-repo clone comment now says `<parent>/llm-gamegen` instead of `<parent>/fast-llm-games`

## To do in next session

### 1. Commit + push the README + pyproject changes

```bash
cd ~/code/lab/llm-gamegen
git status   # should show: README.md, pyproject.toml, RENAME_PLAN.md
git add README.md pyproject.toml
git commit -m "rename to llm-gamegen; update README + pyproject sibling-repo path"
git push origin main
```

(Also decide whether to keep `RENAME_PLAN.md` in the repo or delete it once the rename is wrapped — `git rm RENAME_PLAN.md` if not.)

### 2. Sweep for any remaining stale references

```bash
cd ~/code/lab/llm-gamegen
grep -rn "browserless-game-rl\|fast-llm-games" \
  --include="*.md" --include="*.py" --include="*.toml" --include="*.json" \
  --include="*.sbatch" --include="*.sh" --include="justfile" \
  . 2>/dev/null | grep -v "^./\(\.venv\|node_modules\|outputs\|archive\|reference\)/"
```

Expected hits (most can be left alone):
- `archive/` — historical, leave as-is.
- `reference/` — external repos, leave as-is.
- `pyproject.toml` `name = "fast-games"` and `[project.scripts] fast-games-*` — **deliberately not changed.** The Python package keeps the `fast_games` namespace because renaming it touches every import in `src/fast_games/**`, every notebook, every sbatch script. Bigger blast radius than is worth it right now. Revisit later if desired.
- `src/fast_games/**` — same reason, package name stays.

Anything else (scripts, sbatch, docs that point at the old GitHub URL or the old local path) should be updated.

### 3. Verify it still works end-to-end

```bash
cd ~/code/lab/llm-gamegen
just sync-all                                # pulls node-gym, reinstalls
uv run fast-games-validate --game flappy_bird --skip-throughput --no-save
uv run fast-games-validate-three --game ball_roller --skip-throughput --no-save
uv run fast-games-bench --backend p5 --game flappy_bird --frames 100 --trials 2 --no-save
```

All four should pass cleanly.

### 4. (Optional, do later) Rename the Python package too

If the `fast_games` ↔ `llm-gamegen` mismatch eventually becomes annoying:

```bash
# Sketch — don't do unless you've got 30 min and willingness to chase imports
cd ~/code/lab/llm-gamegen
git mv src/fast_games src/llm_gamegen
# Update pyproject.toml: [project] name, [project.scripts] entries, [tool.hatch.build.targets.wheel] packages
# Update every `from fast_games...` and `import fast_games...` in src/, tests/, notebooks/, scripts/
# Re-run uv sync, re-run validation, re-run a smoke train
```

This is deliberately deferred — it touches ~50+ files.

## Recap of what changed across both repos this session (before the rename hiccup)

These are already pushed; just FYI for the next session:

- **node-gym** `f6e56b2` + `3a7021a`: extracted `node_gym.validate` and `node_gym.bench` as a parameterized library. CLIs in `tools/` are now thin (~50 lines each). README bench tables replaced with a one-paragraph summary + "run `just bench` yourself" pointer.
- **llm-gamegen** (still pushed under old name `browserless-game-rl` at `ca061fb`): three CLI scripts shrunk 841 → 167 lines by importing the new node-gym library. `vvvvvv.js` resynced to pick up the integer-reward fix.
