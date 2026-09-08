// Ground-truth binding extractor.
//
// Loads an analogen grid game JS file in a bare sandbox, calls resetGame(seed),
// and prints the per-seed visual->role binding as JSON to stdout. This is the
// authoritative reference used to validate the pure-Python replica in
// src/analogen/bindings.py (run tests/test_bindings.py to compare).
//
// resetGame() / shuffleRoles() / initRoom() touch no p5 APIs (only setup/draw/
// drawTile/draw* do, and those are never called here), so the module runs in a
// minimal context with just Math + console. The game declares toolMapping /
// valueMapping with top-level `let`, which do NOT attach to the context global,
// so we append an exporter that closes over them.
//
// Usage:
//   node tools/dump_bindings_node.mjs <game.js> [nSeeds] [startSeed]
import fs from 'node:fs';
import vm from 'node:vm';
import process from 'node:process';

const gamePath = process.argv[2];
const nSeeds = parseInt(process.argv[3] ?? '2000', 10);
const startSeed = parseInt(process.argv[4] ?? '0', 10);

if (!gamePath) {
  process.stderr.write('usage: node tools/dump_bindings_node.mjs <game.js> [nSeeds] [startSeed]\n');
  process.exit(2);
}

const src = fs.readFileSync(gamePath, 'utf8');
const harness = src + `
;globalThis.__dump = function(seed) {
  resetGame(seed);
  return { tool: toolMapping, value: valueMapping };
};`;

const sandbox = { Math, console };
vm.createContext(sandbox);
vm.runInContext(harness, sandbox);

const out = [];
for (let i = 0; i < nSeeds; i++) {
  const s = startSeed + i;
  out.push({ seed: s, ...sandbox.__dump(s) });
}
process.stdout.write(JSON.stringify(out));
