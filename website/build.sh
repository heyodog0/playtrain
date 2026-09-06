#!/usr/bin/env bash
# Assemble the project page into website/site/.
#
#   website/build.sh          build
#   website/build.sh serve    build, then serve on :8000
#
# The landing page and docs/ are hand-written static HTML. The generated play/
# directory is the self-contained browser tester for the bundled game catalog,
# produced by tools/build-pages.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=website/site
rm -rf "$OUT"
mkdir -p "$OUT"
cp website/index.html website/style.css website/favicon.svg "$OUT/"
# The header clips. Figures are kept in website/figures/ but no longer shipped:
# the page was cut back to the abstract and the playable demo, so nothing
# references them. Restore that line if a paper figure goes back on the page.
# Keep the clip galleries in step with what is actually in rollouts/.
python3 website/galleries.py

cp -R website/rollouts "$OUT/rollouts"
rm -f "$OUT/rollouts/README.md"
# cp -R website/figures "$OUT/figures"
cp -R website/docs "$OUT/docs"

# The in-page player: PlayTrain's browser shim + website/player.mjs, plus the
# game sources it fetches at runtime.
node tools/build-embed.mjs --out "$OUT"

# The standalone tester (one page per game, self-contained) stays available at
# /play/ for sharing single games and for browsers where the player fails.
node tools/build-pages.mjs --out "$OUT/play" --title "PlayTrain games"

# The page links to paper.pdf. Drop the compiled PDF at website/paper.pdf and it
# ships; without it that one link 404s.
if [ -f website/paper.pdf ]; then
  cp website/paper.pdf "$OUT/"
else
  echo "warning: no website/paper.pdf — the Paper link will 404" >&2
fi
echo playtrain.org > "$OUT/CNAME"
echo "built -> $OUT"

if [ "${1:-}" = "serve" ]; then
  # website/serve.py sends Cache-Control: no-store, so an edited stylesheet or
  # player shows up on an ordinary reload instead of needing a hard refresh.
  exec python3 website/serve.py 8000 "$OUT"
fi
