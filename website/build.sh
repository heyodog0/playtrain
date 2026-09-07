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
# Dev-only browser diagnostic, not linked from the site.
cp website/check.html website/player-check.mjs "$OUT/"
# The header clips. Figures are kept in website/figures/ but no longer shipped:
# the page was cut back to the abstract and the playable demo, so nothing
# references them. Restore that line if a paper figure goes back on the page.
# Keep the clip galleries in step with what is actually in rollouts/.
python3 website/galleries.py

# Clips: ship only the mp4s the page references. The gifs stay in the repo as
# the source the mp4s were derived from and for use in slides or the paper, but
# every browser that can run the player can decode h264, so shipping 15M of
# fallback nobody reaches is not worth it.
mkdir -p "$OUT/rollouts/agent" "$OUT/rollouts/human"
cp website/rollouts/agent/*.mp4 "$OUT/rollouts/agent/"
cp website/rollouts/human/*.mp4 "$OUT/rollouts/human/"
cp website/rollouts/scores.json "$OUT/rollouts/"
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
# Stamp style.css and player.js with a content hash in the page's references.
# A browser that already has the old file cached will not ask again on a normal
# reload, which twice made an edited stylesheet look like a broken site; a new
# query string makes it a different URL, so there is nothing to reuse.
css_v=$(shasum -a 256 "$OUT/style.css" | cut -c1-10)
js_v=$(shasum -a 256 "$OUT/player.js" | cut -c1-10)
/usr/bin/sed -i '' \
  -e "s|href=\"style.css\"|href=\"style.css?v=$css_v\"|g" \
  -e "s|src=\"player.js\"|src=\"player.js?v=$js_v\"|g" \
  "$OUT/index.html"
echo "cache-bust: style.css?v=$css_v  player.js?v=$js_v"

echo playtrain.org > "$OUT/CNAME"
echo "built -> $OUT"

if [ "${1:-}" = "serve" ]; then
  # website/serve.py sends Cache-Control: no-store, so an edited stylesheet or
  # player shows up on an ordinary reload instead of needing a hard refresh.
  exec python3 website/serve.py 8000 "$OUT"
fi
