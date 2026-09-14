// Craftax-Classic — a bit-exact port of PufferLib's craftax_classic.h.
//
// GENERATED BUNDLE WARNING: if you are reading this inside
// dist/craftax_classic.js, do not edit it. Edit the files under src/ and
// common/ and re-run `just bundle craftax_classic`.
//
// Parity: full canonical state, every step, against PufferLib
// ocean/craftax_classic/craftax_classic.h at commit 6ffa5b10, built scalar,
// no FMA, with cosf/sinf bound to V8's ieee754. What is NOT matched:
// PufferLib's auto-reset RNG continuation across episodes. The pixels are
// Craftax-Classic-Pixels', byte-identical given Craftax's night key — which
// no host supplies, so the hosts' night frames omit Craftax's static. See
// README.md and manifest.json.
//
// conforms-to: GAME_TEMPLATE.md
