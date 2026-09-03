# playtrain-claude-memory

Claude Code memory files for the PlayTrain paper work. Private on purpose: these
name unfixed problems in an unpublished paper and describe FASRC cluster internals.

## Restoring on another machine

Claude Code finds these by turning the project's **absolute path** into a folder name:

    /Users/heyodogo2/code/lab/playtrain
        ->  ~/.claude/projects/-Users-heyodogo2-code-lab-playtrain/memory/

So the folder name changes if the username or repo location changes. To restore:

1. Clone the PlayTrain work to `~/code/lab/playtrain` (any username is fine).
2. Start a Claude Code session there once, so the project folder gets created.
3. `ls ~/.claude/projects/` and find the entry matching that path.
4. Copy every `.md` from this repo into that entry's `memory/` subdirectory.

If the username is the same, the folder name already matches and step 4 is a
straight copy. `MEMORY.md` is the index Claude loads each session, so it has to
come across too.

## What is here

| file | what it is for |
|---|---|
| `MEMORY.md` | the index, one line per memory, loaded every session |
| `overleaf-github-sync.md` | the sync hazard, and how to resolve `overleaf-*` branches |
| `fasrc-figure-pipeline.md` | where figures actually regenerate, under `rtruong` |
| `fasrc-benchmark-hazards.md` | `uv sync` eats envpool, nodes differ 1.56x, hetjob traps |
| `playtrain-benchmark-results.md` | measured numbers, and which published ones did not reproduce |
| `playtrain-human-study-plan.md` | the agreed human baseline design, not yet run |
| `paper-open-issues.md` | unresolved problems in the preprint |
| `paper-terse-commits.md` | commit message style |
| `paper-prose-editing-style.md` | how prose edits should be made |
