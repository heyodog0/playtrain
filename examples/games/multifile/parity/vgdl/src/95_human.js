// ---- human-only level choice (same contract as parity/puzzlescript/src/95_human.js) ----
// The env picks the level from the seed (VG_LEVELS[seed % n], resetGame in 90_prelude.js); these let the play
// page show "Level i / n" and move between levels instead. The env never calls them, so which level an agent
// gets for a seed is unchanged. A level is loaded exactly as the __vgdl.resetLevel gate hook loads one.
function humanLevels() {
  return { count: VG_LEVELS.length, current: vgLevelIdx };
}

function humanSetLevel(i) {
  const n = VG_LEVELS.length;
  const k = ((i % n) + n) % n;
  const seed = (Date.now() >>> 0);   // a person gets fresh randomness each (re)load, as Reset gives them
  vgPrepare();
  vgLevelIdx = k;
  if (VG_PROFILE === 'rcrl') rcReset(VG_LEVELS[k], seed); else vgReset(VG_LEVELS[k], seed);
  vgFitLevel();
  vgPickBackground();
  score = 0; lives = 1; gameState = 'PLAYING';
  return k;
}
