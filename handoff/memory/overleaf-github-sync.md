---
name: overleaf-github-sync
description: The ICLR paper repo is bidirectionally synced with Overleaf; pushing from the CLI while Overleaf is live causes merge conflicts
metadata: 
  node_type: memory
  type: project
  originSessionId: 4dc4b283-70be-487c-a981-f272b2041ace
  modified: 2026-08-07T19:09:43.770Z
---

`github.com/heyodog0/ICLR-PlayTrain-Fast-LLM-VGEs` (cloned at
`~/code/lab/playtrain/ICLR-PlayTrain-Fast-LLM-VGEs`) is synced with an Overleaf
project that Ryan and at least one collaborator edit live.

**Why:** Overleaf commits the *whole document as its editor holds it*. If GitHub
gains a commit Overleaf hasn't pulled, Overleaf's next push writes its older text
over it — a normal commit, but the effect looks like a revert. When it can't
merge it parks changes on an `overleaf-<timestamp>` branch and blocks with
"Please manually merge…". This happened three times in one session.

**How to apply:** Never push without asking first — say what will be pushed and
wait for an explicit yes, even when the edits themselves were approved and even
when a prior turn in the session involved a push. Approval to edit is not
approval to publish; a push reaches Ryan and the collaborator.
Always `git fetch && git merge --ff-only origin/main` before
editing. After every push, tell Ryan explicitly to **pull in Overleaf** before
anyone types there. To clear an `overleaf-*` branch prompt: merge the branch into
main (it is usually main's content plus a small edit, so `git checkout --theirs`
on the tex is the right resolution), push, then verify with
`git merge-base --is-ancestor origin/overleaf-<ts> origin/main` before telling
him to click continue. Overleaf does **not** force-push. Related:
[[paper-terse-commits]].
