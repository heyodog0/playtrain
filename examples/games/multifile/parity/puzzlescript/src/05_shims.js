// ---- Host shims for the vendored PuzzleScript engine ----
// What src/tests/run_tests_node.js (the reference's own node runner) installs before loading the engine, written
// so the same file works in node, QuickJS (qjs_host: no performance, no document) and the browser (real document
// and localStorage already exist; only the missing names are added). Shims add globals the engine expects from a
// browser; they never change engine behaviour. Every function has a name.
var psShimNoop = function psShimNoop() {};
// Where does this script's top-level `let` live? As a classic script (browser <script>, qjs_host, a node vm script) it
// is in the global lexical environment and code built with `new Function` can see it. Under an indirect eval, as
// PlayTrain's play page loads a game, `let`/`const` are scoped to the eval and `new Function` code cannot see them;
// the engine builds its rule matchers with `new Function`, so the bundler emits accessor bridges guarded by this flag.
let psShimProbe = 1;
var psShimEvalScoped = (function psShimDetectEvalScope() {
  try { return (new Function('return typeof psShimProbe'))() === 'undefined'; } catch (e) { return true; }
})();
var psShimGlobal = (typeof globalThis !== 'undefined') ? globalThis : this;

if (typeof console === 'undefined') {                           // qjs_host defines no console at all
  psShimGlobal.console = { log: psShimNoop, warn: psShimNoop, error: psShimNoop, info: psShimNoop };
}
if (typeof performance === 'undefined') {                       // globalVariables.js tick_lazy_function_generation
  psShimGlobal.performance = { now: function psShimPerformanceNow() { return Date.now(); } };
}
if (typeof localStorage === 'undefined') {                      // storagewrapper.js
  psShimGlobal.psShimStorage = {};
  psShimGlobal.localStorage = {
    getItem: function psShimGetItem(k) { return Object.prototype.hasOwnProperty.call(psShimGlobal.psShimStorage, k) ? psShimGlobal.psShimStorage[k] : null; },
    setItem: function psShimSetItem(k, v) { psShimGlobal.psShimStorage[k] = String(v); },
    removeItem: function psShimRemoveItem(k) { delete psShimGlobal.psShimStorage[k]; },
  };
}
if (typeof document === 'undefined') {
  psShimGlobal.document = {
    URL: 'playtrain://puzzlescript',
    body: { classList: { contains: function psShimContains() { return false; } }, addEventListener: psShimNoop, removeEventListener: psShimNoop },
    createElement: function psShimCreateElement() { return { style: {}, innerHTML: '', textContent: '', getContext: function psShimGetContext() { return null; } }; },
    getElementById: function psShimGetElementById() { return null; },
  };
}
if (typeof window === 'undefined') psShimGlobal.window = psShimGlobal;
if (typeof lastDownTarget === 'undefined') psShimGlobal.lastDownTarget = null;
if (typeof canvas === 'undefined') psShimGlobal.canvas = null;
if (typeof input === 'undefined') psShimGlobal.input = psShimGlobal.document.createElement('TEXTAREA');
// The IDE / audio / console hooks the engine calls. In the browser page these do not exist either (PlayTrain's
// page is not the PuzzleScript editor), so they are defined unconditionally when absent.
var psShimHooks = ['canvasResize', 'redraw', 'consolePrintFromRule', 'consolePrint', 'console_print_raw', 'consoleError', 'consoleCacheDump',
  'addToDebugTimeline', 'killAudioButton', 'showAudioButton', 'regenSpriteImages', 'jumpToLine', 'printLevel', 'playSound'];
for (var psShimI = 0; psShimI < psShimHooks.length; psShimI++) {
  if (typeof psShimGlobal[psShimHooks[psShimI]] === 'undefined') psShimGlobal[psShimHooks[psShimI]] = psShimNoop;
}
if (typeof forceRegenImages === 'undefined') psShimGlobal.forceRegenImages = false;
if (typeof levelString === 'undefined') psShimGlobal.levelString = '';
if (typeof inputString === 'undefined') psShimGlobal.inputString = '';
if (typeof outputString === 'undefined') psShimGlobal.outputString = '';
if (typeof editor === 'undefined') psShimGlobal.editor = { getValue: function psShimEditorGetValue() { return psShimGlobal.levelString; } };
if (typeof PuzzleScriptTestAssertions === 'undefined') psShimGlobal.PuzzleScriptTestAssertions = { push: psShimNoop, equal: psShimNoop };
if (typeof UnitTestingThrow === 'undefined') psShimGlobal.UnitTestingThrow = function psShimUnitTestingThrow(e) { throw e; };
// Audio: the engine's own `muted` state (set by the prelude) returns from playSound before any of this is reached;
// these inert stand-ins only guarantee that no other path can throw ReferenceError where the browser globals are absent.
if (typeof Audio === 'undefined') psShimGlobal.Audio = function psShimAudio() { this.src = ''; this.play = psShimNoop; this.pause = psShimNoop; };
