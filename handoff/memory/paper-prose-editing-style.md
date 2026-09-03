---
name: paper-prose-editing-style
description: "How Ryan wants paper prose edited — minimal diffs in his own wording, and diagnosis before rewriting"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4dc4b283-70be-487c-a981-f272b2041ace
  modified: 2026-08-25T23:56:08.006Z
---

When editing the paper's prose he wants **minimal changes that keep his wording
and sentence shapes**, and he asks "what do you think is wrong?" before wanting a
rewrite. He iterates a sentence many times and will revert edits he did not ask
for.

**Why:** it is his voice and his advisor's feedback loop; wholesale rewrites get
rejected even when clearer. He once asked me to revert a batch of grammar fixes
outright.

**How to apply:** lead with the diagnosis, then offer the revision, then ask
before applying. Distinguish real errors (agreement, splices, undefined refs)
from preference, and never silently fold in content changes — flag them. Two
calibration notes: "one idea per sentence" taken literally produced staccato he
disliked, so combine parallel simple facts and reserve splitting for sentences
carrying three ideas; and he dislikes the "this is X, never Y" construction.
Also avoid `runtime` and `headless` in main text — his advisor flagged both as
too technical; say `PlayTrain` instead.

**Register (2026-08-23):** he asks for prose "boring and clear to the point of
being boring". Minimal commas, and at one point no colons, semicolons, or em
dashes at all — short declaratives, one fact each, parallel shapes. He rejects
abstract phrasing on sight: "summarizes more tightly", "the frame carries X",
"a property of the game rather than a constant" all came back. Say the concrete
mechanism instead, or cut the sentence.

**Reader-centric filter:** strip repo-internal facts from the paper even when
true — frozen indices, how many Python classes accept a parameter, file paths.
The test is whether a reader can observe it. Prose should carry causation;
tables and captions carry the constants. Don't restate in prose what a table
already shows, and check for the same claim appearing in two sections — after
Related Work moved to the appendix, main-text repeats stopped being redundant,
so redundancy checks depend on current section placement.
