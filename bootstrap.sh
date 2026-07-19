#!/usr/bin/env bash
# Bootstrap script for PlayTrain: ensures uv, pnpm, and just are installed.
# Idempotent — skips any tool already on PATH.
#
# Usage:  ./bootstrap.sh
# Then:   just install && just test

set -euo pipefail

say() { printf "  \033[1;34m%s\033[0m %s\n" "$1" "$2"; }

echo "==> PlayTrain bootstrap: ensuring uv, pnpm, just"

# ---- uv ---------------------------------------------------------------------
if command -v uv >/dev/null 2>&1; then
  say "uv:" "already installed ($(uv --version))"
else
  say "uv:" "installing via astral.sh..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

# ---- pnpm -------------------------------------------------------------------
if command -v pnpm >/dev/null 2>&1; then
  say "pnpm:" "already installed ($(pnpm --version))"
elif command -v corepack >/dev/null 2>&1; then
  say "pnpm:" "enabling via corepack..."
  corepack enable
  corepack prepare pnpm@latest --activate
else
  say "pnpm:" "installing via get.pnpm.io..."
  curl -fsSL https://get.pnpm.io/install.sh | sh -
fi

# ---- just -------------------------------------------------------------------
if command -v just >/dev/null 2>&1; then
  say "just:" "already installed ($(just --version))"
elif command -v brew >/dev/null 2>&1; then
  say "just:" "installing via homebrew..."
  brew install just
elif command -v cargo >/dev/null 2>&1; then
  say "just:" "installing via cargo..."
  cargo install just
else
  say "just:" "installing prebuilt binary to ~/.local/bin..."
  mkdir -p "$HOME/.local/bin"
  curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh \
    | bash -s -- --to "$HOME/.local/bin"
  export PATH="$HOME/.local/bin:$PATH"
fi

echo
echo "==> done. Open a new shell (or 'source ~/.zshrc') so PATH picks up new tools."
echo "    Then:  just install && just test"
