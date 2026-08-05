#!/usr/bin/env node
// study-feedback.mjs — what participants wrote, as a readable digest or a CSV.
//
//   node tools/study-pull.mjs                              # get the data first
//   node tools/study-feedback.mjs                          # digest to stdout
//   node tools/study-feedback.mjs --csv dist/feedback.csv   # spreadsheet
//
// The free text lives only in the Storage blobs, never in the Firestore summary — it is the one
// place a participant can type something identifying, so it is deliberately kept out of the
// queryable index (see api/session.js). Which means this tool is the way to read it.
//
// CSV quoting is RFC4180: participants write commas, quotes, newlines and emoji, and a naive
// join would corrupt the file at the first sentence containing a comma.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const DIR = resolve(arg('--in', join(REPO, 'dist', 'study-data')));
const CSV = arg('--csv', null);
if (!existsSync(DIR)) { console.error(`no data at ${DIR} — run: node tools/study-pull.mjs`); process.exit(2); }

const NON_PARTICIPANT = /^(probe|playtest|debug|incident|deploycheck|readycheck|smoke|test|anon|final|preflight)/i;
const sessions = readdirSync(DIR).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')))
  .filter(s => !s.debug && !s.standalone && !NON_PARTICIPANT.test(String(s.participantId)))
  .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));

const rows = sessions.map(s => {
  const f = s.feedback || {}, d = s.demographics || {};
  const mins = s.finishedAt && s.consent
    ? ((new Date(s.finishedAt) - new Date(s.consent.at)) / 60000).toFixed(1) : '';
  return {
    participant: s.participantId,
    complete: s.partial === false ? 'yes' : 'no',
    answered_questions: s.feedback ? 'yes' : 'no',
    technical_problems: f.technicalIssueLevel ?? '',
    what_happened: f.technicalIssues ?? '',
    confusing: f.confusingParts ?? '',
    anything_else: f.suggestions ?? '',
    age: d.age ?? '',
    gender: d.gender ?? '',
    gaming_experience: d.gamingExperience ?? '',
    gaming_frequency: d.gamingFrequency ?? '',
    quiz_attempts: s.quiz?.attempts ?? '',
    session_minutes: mins,
  };
});

if (CSV) {
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    const t = String(v ?? '');
    // quote whenever the value could break the row, and double any embedded quote
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const out = [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
  writeFileSync(resolve(CSV), '﻿' + out);   // BOM so Excel opens the emoji correctly
  console.log(`wrote ${resolve(CSV)}  (${rows.length} participants, ${cols.length} columns)`);
} else {
  const wrote = rows.filter(r => r.what_happened || r.confusing || r.anything_else);
  console.log(`${rows.length} participants · ${rows.filter(r => r.answered_questions === 'yes').length} answered the end questions · ${wrote.length} wrote free text\n`);
  const levels = {};
  for (const r of rows) if (r.technical_problems) levels[r.technical_problems] = (levels[r.technical_problems] || 0) + 1;
  console.log('technical problems reported:');
  for (const [k, v] of Object.entries(levels)) console.log(`  ${String(v).padStart(3)} × ${k}`);
  console.log('');
  for (const r of wrote) {
    console.log(`— ${r.participant.slice(0, 8)}  (${r.age || '?'}, plays ${String(r.gaming_frequency || 'n/a').toLowerCase()}, ${r.session_minutes} min)`);
    if (r.what_happened) console.log(`    problems : ${r.what_happened}`);
    if (r.confusing)     console.log(`    confusing: ${r.confusing}`);
    if (r.anything_else) console.log(`    else     : ${r.anything_else}`);
  }
}
