---
name: playtrain-website
description: The playtrain.org site lives in playtrain/website (MkDocs Material + custom landing + embedded playable games); design intent and deploy path
metadata:
  type: project
---

Built 2026-09-03 in `playtrain/website/` (uncommitted at the time, working tree on
branch native-tuning). MkDocs Material, the same stack as astral uv's docs, restyled
flat: white/near-black, one vermillion accent, Inter + JetBrains Mono. Landing page is
`overrides/home.html`; the Play tab is `tools/build-pages.mjs` output copied into
`docs/play/` (gitignored) by `website/build.sh`. `just site` / `just site-serve`.
Deploy: `.github/workflows/site.yml` to GitHub Pages with CNAME playtrain.org (the
paper's \author block already prints that URL). The existing `vercel.json` is the
password-gated playtest site and was left alone.

**Why:** Ryan wanted a project page that doubles as a real docs site (refs: vera.csail.mit.edu,
uv docs) and explicitly not a copy of his aigamestore.org (text-heavy, Home/Games/Leaderboard nav).
Goal is a site people use, so the playable catalog is front and center.

**How to apply:** keep landing numbers to what the paper abstract claims (0.9M decisions/s,
<$0.20 per game); see [[playtrain-benchmark-results]] before adding any EnvPool/ProcGen ratio.
Keep the flat style; do not reintroduce Material's coloured header.
