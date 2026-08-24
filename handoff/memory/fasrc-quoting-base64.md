---
name: fasrc-quoting-base64
description: fasrc "..." strips quote characters from embedded scripts — send them base64
metadata:
  type: feedback
---

Running `fasrc "python3 - <<'PY' ... PY"` silently **strips quote characters**
from the embedded script. `price.pop("shapepair")` arrived on the cluster as
`price.pop(shapepair)`; the job died with NameError and the previous (stale but
plausible-looking) output file stayed in place, so the failure read as "my
change had no effect" rather than "my change never ran". Backslashes and `%`
mangle the same way.

**Why:** the outer double quotes make the local shell interpret the payload
before it is ever sent.

**How to apply:** write the script to a local file, then
`B=$(base64 < f.py | tr -d '\n'); fasrc "... echo $B | base64 -d > /tmp/f.py && python f.py"`.
Have the script `compile()` itself or assert its anchors before doing work, so
a mangled or mismatched patch fails immediately instead of three minutes into a
Slurm job. See [[playtrain-figure-pipeline-traps]].
