#!/usr/bin/env node
// The reference's 770 tests through the BUNDLE's engine: the same concatenation tools/bundle_puzzlescript.mjs
// produces (src/0*.js shims, reference/js in the reference's load order, src/9*.js prelude) plus the vendored test
// data and a copy of run_tests_node.js's loop, run as one script in a fresh vm context.
//   node tests/run_reference_tests.mjs            # run under node; exit 0 iff Failed 0 and Errors 0
//   node tests/run_reference_tests.mjs --emit f   # write the flat script (with the loop) to f for another JS engine
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const srcs = readdirSync(join(ROOT, 'src')).filter(f => f.endsWith('.js')).sort();
export const SOURCES = [...srcs.filter(f => f < '9').map(f => join(ROOT, 'src', f)), ...manifest.reference.engine_load_order.map(f => join(ROOT, 'reference', f)), ...srcs.filter(f => f >= '9').map(f => join(ROOT, 'src', f))];
const TESTS = manifest.reference.reference_tests.files.map(f => join(ROOT, 'reference', f));
let code = '';
for (const p of [...SOURCES, ...TESTS]) code += `\n// ---- ${p.slice(ROOT.length + 1)} ----\n` + readFileSync(p, 'utf8') + '\n';
// run_tests_node.js's override (debug.js's version needs a DOM) and its loop, verbatim in substance.
code += `
// ---- reference test loop (src/tests/run_tests_node.js) ----
stripHTMLTags = function psTestStripHTMLTags(html_str) { return html_str.replace(/<\\/?[a-zA-Z][^>]*>/g, '').trim(); };
var psTestOut = (typeof print === 'function') ? print : console.log;
var psTestLog = console.log; console.log = function psTestSilent() {};
var passed = 0, failed = 0, errored = 0, failures = [];
for (var ti = 0; ti < testdata.length; ti++) {
  var name = testdata[ti][0];
  try { if (runTest(testdata[ti][1], name)) passed++; else { failed++; failures.push('FAIL: ' + name); } }
  catch (err) { errored++; failures.push('ERROR: ' + name + ': ' + err.message); }
}
for (var ei = 0; ei < errormessage_testdata.length; ei++) {
  var ename = errormessage_testdata[ei][0];
  try { if (runCompilationTest(errormessage_testdata[ei][1], ename)) passed++; else { failed++; failures.push('FAIL: [err] ' + ename); } }
  catch (err) { errored++; failures.push('ERROR: [err] ' + ename + ': ' + err.message); }
}
console.log = psTestLog;
psTestOut('Passed:  ' + passed); psTestOut('Failed:  ' + failed); psTestOut('Errors:  ' + errored);
psTestOut('Total:   ' + (passed + failed + errored) + ' tests');
for (var fi = 0; fi < failures.length && fi < 40; fi++) psTestOut('  ' + failures[fi]);
if (typeof psTestResult !== 'undefined') psTestResult.ok = (failed === 0 && errored === 0 && passed > 0);
`;
const args = process.argv.slice(2);
if (args.includes('--emit')) { writeFileSync(args[args.indexOf('--emit') + 1], code); console.log('wrote', args[args.indexOf('--emit') + 1], code.length, 'bytes'); process.exit(0); }
const ctx = { console, psTestResult: { ok: false } }; ctx.globalThis = ctx; vm.createContext(ctx);
const t0 = Date.now();
vm.runInContext(code, ctx, { filename: 'puzzlescript_bundle_tests.js' });
console.log(`  (${((Date.now() - t0) / 1000).toFixed(2)} s, node)`);
process.exit(ctx.psTestResult.ok ? 0 : 1);
