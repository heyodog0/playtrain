#!/usr/bin/env bash
# Download the run data the curve figures, the env-cost figure and the hyperparameter
# check read (TensorBoard events, run configs, per-command timings; ~120 MB) into
# reproduction/figures/outputs/. Everything else runs from what is committed.
set -euo pipefail
cd "$(dirname "$0")/figures"
URL="https://github.com/heyodog0/playtrain/releases/download/paper-v2/playtrain-reproduction-data.tar.gz"
SHA256="0579411f25555b48035d919c8679edcbc383f1e2258096850ef7cbfd0338d126"
[ -f outputs/percmd.json ] && [ -f outputs/_suite4_curves.json ] && { echo "run data already present"; exit 0; }
tmp=$(mktemp)
curl -fL --progress-bar -o "$tmp" "$URL"
echo "$SHA256  $tmp" | shasum -a 256 -c - >/dev/null || { echo "checksum mismatch" >&2; exit 1; }
tar -xzf "$tmp" && rm -f "$tmp"
echo "run data in reproduction/figures/outputs/"
