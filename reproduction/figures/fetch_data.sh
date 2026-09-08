#!/usr/bin/env bash
# Download the data the paper figures are drawn from.
#
# The figures read TensorBoard event files, per-run configs, curve JSONs and
# rendered game frames. That is 1.1 GB across 4,511 files, so it is published as a
# release asset instead of being committed. Cloning this repo does not download it.
#
#   bash reproduction/figures/fetch_data.sh
#
# Unpacks to reproduction/figures/outputs/. Safe to re-run: it skips the download
# if the archive is already present and its checksum matches.
set -euo pipefail

REPO="heyodog0/playtrain"
TAG="figure-data-v1"
ASSET="playtrain-figure-data.tar.gz"
SHA256="03b4c1697d1c1fb7f807ef63c95ba572269872777eef147c4e547fe6a27a8323"

cd "$(dirname "$0")"

verify() {
  local got
  if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$1" | cut -d' ' -f1)
  else got=$(shasum -a 256 "$1" | cut -d' ' -f1); fi
  [ "$got" = "$SHA256" ]
}

if [ -f "$ASSET" ] && verify "$ASSET"; then
  echo "archive already present and verified"
else
  echo "downloading $ASSET (277 MB)..."
  curl -fL --progress-bar -o "$ASSET" \
    "https://github.com/$REPO/releases/download/$TAG/$ASSET"
  # A wrong checksum means the asset was replaced. Do not unpack it: the figures
  # would redraw from data that is not what the paper reports.
  verify "$ASSET" || { echo "checksum mismatch, refusing to unpack" >&2; exit 1; }
fi

echo "unpacking..."
tar xzf "$ASSET"
echo "done. outputs/ now holds $(find outputs -type f | wc -l | tr -d ' ') files."
echo
echo "Redraw the main figure with:"
echo "  cd reproduction/figures"
echo "  uv run --no-project --with matplotlib --with numpy --with pillow --with tensorboard \\"
echo "     python tools/plot_main_composite.py outputs/figs/fig_main.png"
