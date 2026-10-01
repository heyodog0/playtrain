// ---- human-only keys: undo (Z) and restart (R) ----
// Not actions. The action space stays ps6 (four directions, ACTION, NOOP) and the env never calls this:
// GameEnv drives draw() through the sidecar's keys, and humanKey is reached only from the play page's own
// keydown handler (tools/play-templates.mjs), the same arrangement as craftax_fp's relativeArrow. It exists
// because a puzzle without undo is unplayable by hand: one bad push and the only way back was a new seed.
// Each call does exactly what the reference's test runner does for its "undo" / "restart" inputs
// (reference/tests/testingFrameWork.js): DoUndo(false, true) or DoRestart(), then the again loop. Both engine
// functions honour the game's own `noundo` / `norestart` metadata (octat declares noundo), so a game that
// forbids them still does. After a win the episode is over, and the keys do nothing.
const PS_HUMAN_UNDO = 90, PS_HUMAN_RESTART = 82;

function humanKey(code) {
  if (!psCompiled || gameState !== 'PLAYING') return false;
  if (code === PS_HUMAN_UNDO) DoUndo(false, true);
  else if (code === PS_HUMAN_RESTART) DoRestart();
  else return false;
  psRunAgains();
  return true;
}

// ---- human-only level choice ----
// The env picks the level from the seed (playable[seed % n], resetGame in 90_prelude.js), which is right for an agent and
// wrong for a person: the page's Reset drew a new seed and so a different level every time. These let the play
// page show "Level i / n" and move between levels; the env never calls them, so which level an agent gets for a
// seed is unchanged. Indices here are into the PLAYABLE list (message screens are not levels).
function humanLevels() {
  return { count: psPlayableLevels().length, current: Math.max(0, psPlayableLevels().indexOf(psLevelIndex)) };
}

function humanSetLevel(i) {
  if (!psCompiled) psCompile();
  const pl = psPlayableLevels();
  const k = ((i % pl.length) + pl.length) % pl.length;
  psLevelIndex = pl[k];
  psLoadLevel(psLevelIndex, psSeed);
  score = 0; lives = 1; gameState = 'PLAYING';
  return k;
}
