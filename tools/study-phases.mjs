#!/usr/bin/env node
// Walk the participant journey and screenshot every phase in order, then emit a
// self-contained page of the whole sequence with captions. This is the "show someone
// what the study actually looks like" tool -- an advisor, a co-author, an IRB amendment
// -- as opposed to study-shots.mjs, which shoots a few screens at five display sizes to
// check layout.
//
//   node tools/study-phases.mjs
//   node tools/study-phases.mjs --size 1440x820 --out dist/study-phases
//
// It builds its OWN copy of the site into a temp dir, pointed at a local capture endpoint
// and a fake completion URL, so the outro shows what a real participant sees ("your
// session was recorded", completion code, Prolific handoff) rather than the upload-failed
// fallback. Nothing here touches the deployed site.
//
// Gameplay shots come from block pages opened DIRECTLY, not through the debug menu, so no
// debug badge appears in a screenshot meant for someone else's eyes.
//
// Needs playwright (npx playwright install chromium). Dev-only.

import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, extname, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const OUT = resolve(arg('--out', join(REPO_ROOT, 'dist', 'study-phases')));
const SITE = resolve(arg('--site', join(REPO_ROOT, 'dist', 'study-phases-site')));
const [W, H] = arg('--size', '1440x820').split('x').map(Number);
const SKIP_BUILD = process.argv.includes('--no-build');

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  console.error('playwright not installed. run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Serve the site and swallow the session POSTs, so the outro reaches its success path.
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.json': 'application/json', '.txt': 'text/plain' };
let uploads = 0;
const server = createServer((req, res) => {
  if (req.method === 'POST') {
    uploads++;
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end('{"ok":true}');
    });
    return;
  }
  let p = join(SITE, decodeURIComponent(req.url.split('?')[0]));
  if (!extname(p)) p = join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream',
                       'cache-control': 'no-store' });
  res.end(readFileSync(p));
});
await new Promise(r => server.listen(0, r));
const PORT = server.address().port;
const BASE = `http://localhost:${PORT}`;

if (!SKIP_BUILD) {
  const r = spawnSync(process.execPath, [join(__dirname, 'build-study.mjs'),
    '--out', SITE,
    '--upload', `${BASE}/api/session/`,
    // Stands in for https://app.prolific.com/submissions/complete?cc=<code> so the handoff
    // screen is the real one. It is never followed -- we shoot the page before the redirect.
    '--completion', `${BASE}/prolific-completion-page`,
  ], { stdio: 'ignore' });
  if (r.status !== 0) { console.error('build-study.mjs failed'); process.exit(r.status ?? 1); }
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const shots = [];
let n = 0;

async function shoot(page, slug, title, caption) {
  const file = `${String(++n).padStart(2, '0')}-${slug}.png`;
  await page.screenshot({ path: join(OUT, file) });
  shots.push({ file, title, caption });
  console.log(`  ${file.padEnd(28)} ${title}`);
}

const newPage = () => browser.newPage({ viewport: { width: W, height: H } });

// Every screen below is reached the way a participant reaches it -- the debug menu is
// deliberately not used anywhere, so nothing in these images shows a state a participant
// could not be in (and no debug panel or badge can leak into a shot meant for someone else).

async function consentThroughQuiz(page) {
  await page.evaluate(() => { const s = document.getElementById('consent-scroll'); s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(150);
  await page.check('#agree');
  await page.click('#consent-next');
  for (let i = 0; i < 12; i++) {
    if (await page.isVisible('#s-quiz')) break;
    await page.click('#instr-next');
    await page.waitForTimeout(80);
  }
}

console.log(`\nphases at ${W}x${H} -> ${OUT}`);

// --- 1. pre-flight, on a desktop and on a phone ----------------------------
{
  const page = await newPage();
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(350);          // mid fps-probe
  await shoot(page, 'device-check', 'Pre-flight device check',
    'Runs before the consent form, not after: rejecting someone who has just read 2,000 words of consent ' +
    'is a bad experience and a wasted recruitment slot. It measures delivered frame rate over 1.5 s and ' +
    'requires 55 fps, because a machine that cannot sustain 60 yields fewer environment steps in the same ' +
    '100 seconds of play.');
  await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(1200);
  await shoot(page, 'device-rejected', 'Ineligible device (phone or tablet)',
    'Touch-only devices are turned away with an explanation and told to return the study so someone else ' +
    'can take it. The games need a physical keyboard, and the action space is defined over arrow keys and ' +
    'space.');
  await page.close();
}

// --- 2. consent -----------------------------------------------------------
{
  const page = await newPage();
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(2400);
  await shoot(page, 'consent-top', 'Consent form',
    'Harvard University Area IRB consent text, in a scroll box. The Continue button stays disabled until ' +
    'the form has actually been scrolled to the bottom, matching the lab\'s other online studies. ' +
    'Compensation and duration are interpolated from study-config.json so they cannot drift out of sync ' +
    'with the protocol.');
  await page.evaluate(() => { const s = document.getElementById('consent-scroll'); s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(200);
  await shoot(page, 'consent-agree', 'Consent — agreement checkboxes',
    'The checkboxes only appear once the form has been read to the end. The second one is optional and ' +
    'records a request not to be contacted about future studies.');
  await page.close();
}

// --- 3. instructions ------------------------------------------------------
{
  const page = await newPage();
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(2400);
  await page.evaluate(() => { const s = document.getElementById('consent-scroll'); s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(150);
  await page.check('#agree');
  await page.click('#consent-next');
  const CAPS = [
    'What the participant will do: eight games, 100 seconds each, and an explicit statement that nobody ' +
    'has played these games before so doing badly is expected. That framing matters — the human baseline ' +
    'is meant to be novice performance, not practised performance.',
    'The round structure. Without this, a participant who loses once assumes the game is over and stops ' +
    'trying. The timer pauses during between-round score cards, so summary time is not taken out of play ' +
    'time.',
    'The goal, stated as scoring across all rounds rather than a single best run — the agent is evaluated ' +
    'as a mean over episodes, so the human instruction has to match.',
    'Controls, and the honest statement of the action-space limit: one direction at a time, and no ' +
    'simultaneous move-and-act in some games. Presented as a game rule so quantisation does not read as ' +
    'a broken harness.',
    'What is recorded: key presses and scores only, identified by Prolific ID.',
  ];
  for (let i = 0; i < CAPS.length; i++) {
    await shoot(page, `instructions-${i + 1}`, `Instructions ${i + 1} of ${CAPS.length}`, CAPS[i]);
    if (i < CAPS.length - 1) { await page.click('#instr-next'); await page.waitForTimeout(120); }
  }
  await page.close();
}

// --- 4. comprehension check ----------------------------------------------
{
  const page = await newPage();
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(2400);
  await consentThroughQuiz(page);
  await shoot(page, 'quiz', 'Comprehension check',
    'Four questions, each targeting something that would corrupt the data if misunderstood: the round ' +
    'structure, the round length, the goal, and the one-direction-at-a-time constraint. Attempts are ' +
    'recorded per session.');
  const nq = await page.evaluate(() => document.querySelectorAll('#quiz-body .q').length);
  for (let q = 0; q < nq; q++) await page.check(`input[name=q${q}][value="${q === 0 ? 0 : 1}"]`);
  await page.click('#quiz-submit');
  await page.waitForTimeout(300);
  await shoot(page, 'quiz-failed', 'Comprehension check — wrong answer',
    'A wrong answer sends the participant back through the instructions rather than letting them guess ' +
    'again. The point is that they read it, not that they eventually click the right radio button.');
  await page.close();
}

// --- 5. Prolific ID fallback ---------------------------------------------
{
  const page = await newPage();
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(2400);
  await consentThroughQuiz(page);
  const nq = await page.evaluate(() => document.querySelectorAll('#quiz-body .q').length);
  for (let q = 0; q < nq; q++) await page.check(`input[name=q${q}][value="1"]`);
  await page.click('#quiz-submit');
  await page.waitForTimeout(300);
  await shoot(page, 'prolific-id', 'Prolific ID (fallback only)',
    'Most participants never see this screen: the study link carries PROLIFIC_PID and the harness takes it ' +
    'silently. It appears only when the link arrives without a usable ID — a link copied into another ' +
    'browser, or a Prolific URL saved with the placeholder unsubstituted — where the alternative would be ' +
    'a dead end mid-study.');
  await page.close();
}

// --- 6. controls screens and gameplay, from block pages opened directly ---
const GAMES = [
  ['practice', 'Warm-up: pong (not scored)',
   'A warm-up outside the scored set, so the participant learns the harness — timer, rounds, auto-restart, ' +
   'score card — before anything counts. Practising one of the eight scored games would hand it an ' +
   'advantage the other seven never get.', 'ArrowUp'],
  ['breakout', 'breakout',
   'Suite replica. The canvas is a fixed 600 px on every participant\'s screen rather than viewport-filling, ' +
   'so visual angle does not vary between subjects; the game still rasterises at its native 400x400 and the ' +
   'pixels shown are the pixels the rasteriser produced.', 'ArrowRight'],
  ['caveflyer', 'caveflyer',
   'The diagnostic game: its greedy checkpoint scores below random, so human play at native resolution is ' +
   'what separates "the agent is bad" from "the observation destroys the information this game needs".',
   'ArrowUp'],
  ['caveflyer-obs', 'caveflyer at the agent\'s 64x64 observation',
   'The same game rendered at the resolution the policy actually sees, integer-upscaled with nearest ' +
   'neighbour so no interpolation is invented. A human score here brackets how much of the agent\'s ' +
   'deficit is perceptual rather than behavioural.', 'ArrowUp'],
];
for (const [slug, title, caption, key] of GAMES) {
  const page = await newPage();
  await page.goto(`${BASE}/block/${slug}/`);
  await page.waitForTimeout(600);
  await shoot(page, `controls-${slug}`, `Controls screen — ${title}`,
    'Shown before every block. The controls differ per game, and this is where the action-space limit for ' +
    'this particular game is stated.');
  await page.click('#go');
  await page.keyboard.down(key);
  await page.waitForTimeout(1400);
  await page.keyboard.up(key);
  await page.waitForTimeout(400);
  await shoot(page, `play-${slug}`, `Playing — ${title}`, caption);
  await page.close();
}

// --- 7. between-rounds score card ----------------------------------------
{
  const page = await newPage();
  await page.goto(`${BASE}/block/breakout/`);
  await page.click('#go');
  await page.keyboard.down('ArrowRight');
  // Wait for a card from a round that actually SCORED -- a zero card shows nothing about
  // what the screen is for. breakout truncates at 2000 frames (~33 s) at the latest, so
  // this terminates either way; fall back to any card if none of them scored.
  let scored = false;
  for (let i = 0; i < 900; i++) {
    scored = await page.evaluate(() => {
      const r = document.getElementById('roundend');
      return r.classList.contains('show') && +document.getElementById('r-pts').textContent > 0;
    });
    if (scored) break;
    await page.waitForTimeout(50);
  }
  await page.keyboard.up('ArrowRight');
  await shoot(page, 'round-score', 'Between-rounds score card',
    'Not decoration: a game can score and terminate on the same frame — caveflyer awards +10 and sets WIN ' +
    'together — so without freezing on the final frame the participant never sees what the round earned, ' +
    'and "score as many points as you can" becomes an instruction with no feedback behind it. The freeze ' +
    'pauses the block clock and its total is budgeted, so a fast-dying player cannot spend more of the ' +
    'session reading score cards than playing. It dims the frozen frame rather than replacing it: every ' +
    'game here draws a near-black background, so the opaque white card this started as made each round ' +
    'boundary a full-canvas flash — a +230-of-255 step in mean luminance, firing as often as twice a ' +
    'second on the games people lose fastest, wrecking dark adaptation right before the next round. The ' +
    'dimmed version steps by about 10.' + (scored ? '' : ' (no scoring round captured this run)'));
  await page.close();
}

// --- 8. outro / Prolific handoff -----------------------------------------
// A GENUINE finish, not the debug menu's jump-to-outro: the debug path suppresses the
// completion redirect, so it renders the no-Prolific variant of this screen and would
// misrepresent what a participant sees. Instead, a second build with 2-second blocks gets
// played all the way through for real, which takes about half a minute. Nothing on this
// screen mentions durations, so the short blocks do not show.
{
  const cfg = JSON.parse(readFileSync(join(__dirname, 'study-config.json'), 'utf8'));
  cfg.blockSeconds = 2;
  cfg.practice.seconds = 2;
  const fastCfg = join(SITE, '..', 'study-phases-fastcfg.json');
  writeFileSync(fastCfg, JSON.stringify(cfg));
  const r = spawnSync(process.execPath, [join(__dirname, 'build-study.mjs'),
    '--config', fastCfg, '--out', join(SITE, 'fast'),
    '--upload', `${BASE}/api/session/`,
    '--completion', `${BASE}/prolific-completion-page`,
  ], { stdio: 'ignore' });
  if (r.status !== 0) { console.error('fast build failed'); process.exit(r.status ?? 1); }

  const page = await newPage();
  await page.goto(`${BASE}/fast/`);
  await page.waitForTimeout(2400);
  await consentThroughQuiz(page);
  const nq = await page.evaluate(() => document.querySelectorAll('#quiz-body .q').length);
  for (let q = 0; q < nq; q++) await page.check(`input[name=q${q}][value="1"]`);
  await page.click('#quiz-submit');
  await page.waitForTimeout(250);
  await page.fill('#pid', '5f8a1c2b3d4e5f60718293a4');
  await page.click('#pid-next');
  for (let i = 0; i < 14; i++) {
    if (await page.isVisible('#s-outro')) break;
    const f = page.frames()[1];
    if (!f) break;
    try {
      await f.waitForSelector('#go', { timeout: 3000 });
      await f.click('#go');
      await page.waitForTimeout(2600);
    } catch { /* the shell advanced the frame under us */ }
    await page.waitForTimeout(400);
  }
  // Shoot inside the 2.5 s window where it says it is returning them to Prolific.
  for (let i = 0; i < 60; i++) {
    const msg = await page.textContent('#outro-msg').catch(() => '');
    if (/Prolific/.test(msg || '')) break;
    await page.waitForTimeout(100);
  }
  await shoot(page, 'outro', 'Completion and Prolific handoff',
    'The completion URL is followed only after a successful upload — redirecting on a failed upload would ' +
    'mark the participant complete on Prolific while their data was gone. If the upload fails they get a ' +
    'download button and the completion code instead, so a bad network never costs a paid session.');
  await page.close();
}

await browser.close();
server.close();

// ---------------------------------------------------------------------------
// One self-contained page: images inlined as data URIs so it can be mailed,
// dropped in a slide deck, or published without carrying a folder of PNGs.
// ---------------------------------------------------------------------------
const css = `
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --mut:#666; --line:#e3e3e3; --card:#fafafa; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141414; --fg:#f0f0f0; --mut:#a0a0a0; --line:#2e2e2e; --card:#1c1c1c; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:48px 24px 96px; background:var(--bg); color:var(--fg);
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         line-height:1.6; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 28px; font-weight: 650; margin: 0 0 8px; letter-spacing: -0.01em; }
  .sub { color: var(--mut); font-size: 16px; margin: 0 0 40px; }
  figure { margin: 0 0 52px; }
  figure img { width: 100%; display:block; border: 1px solid var(--line); border-radius: 6px;
               background: var(--card); }
  figcaption { margin-top: 14px; }
  .n { color: var(--mut); font-size: 13px; font-variant-numeric: tabular-nums; letter-spacing: .04em;
       text-transform: uppercase; }
  .t { font-size: 19px; font-weight: 600; margin: 2px 0 6px; }
  .c { color: var(--mut); font-size: 15px; max-width: 78ch; }
`;
const body = shots.map((s, i) => `
  <figure>
    <img src="data:image/png;base64,${readFileSync(join(OUT, s.file)).toString('base64')}"
         alt="${s.title}">
    <figcaption>
      <div class="n">${String(i + 1).padStart(2, '0')} / ${shots.length}</div>
      <div class="t">${s.title}</div>
      <div class="c">${s.caption}</div>
    </figcaption>
  </figure>`).join('\n');

const header = `
  <h1>PlayTrain human-baseline study — participant walkthrough</h1>
  <p class="sub">Every phase a participant sees, in order, captured at ${W}&times;${H}.
     Generated by <code>tools/study-phases.mjs</code>.</p>`;

writeFileSync(join(OUT, 'index.html'),
  `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>PlayTrain study — participant walkthrough</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style></head><body><div class="wrap">${header}${body}</div></body></html>`);

// Body-only twin, for publishing where the host supplies the document skeleton.
writeFileSync(join(OUT, 'walkthrough.fragment.html'),
  `<style>${css}</style>\n<div class="wrap">${header}${body}</div>`);

const kb = (f) => (readFileSync(join(OUT, f)).length / 1024).toFixed(0);
console.log(`\n${shots.length} phases -> ${join(OUT, 'index.html')} (${kb('index.html')} KB, self-contained)`);
console.log(`upload POSTs absorbed during capture: ${uploads}`);
