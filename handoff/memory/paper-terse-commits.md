---
name: paper-terse-commits
description: Ryan wants extremely terse commit messages and no Co-Authored-By trailer on the paper repos
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4dc4b283-70be-487c-a981-f272b2041ace
  modified: 2026-08-01T19:31:25.313Z
---

Commit messages on the paper repos must be **extremely terse and simple** —
"Preprint mode", "Add authors", "Cite mulberry32", "Tighten listing width" — and
must carry **no authorship trailer** of any kind.

**Why:** he asked for this explicitly, and it overrides the default instruction
to append `Co-Authored-By: Claude`.

**How to apply:** one short phrase, no body, no trailer. Commit with
`git -c commit.gpgsign=false commit -qm "..."`. Push only when asked, and see
[[overleaf-github-sync]] for the fetch-first rule.
