// End-to-end check of a full event: night check-ins, help, finalist points, judging, results, backup.
// Starts the dev server on a throwaway embedded database. Run: npm test
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EVENT from '../public/event.config.js';

const PORT = 3900 + Math.floor(Math.random() * 90);
const dir = mkdtempSync(join(tmpdir(), 'mentor-desk-test-'));
const server = spawn(process.execPath, ['dev.mjs'], { env: { ...process.env, PORT: String(PORT), PGLITE_DIR: dir, DATABASE_URL: '', ADMIN_PASSWORD: '', MENTOR_CODE: '' }, stdio: 'ignore' });
const U = `http://localhost:${PORT}/api/rpc`;
let failed = 0;
const ok = (label, cond, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${label}${extra ? `  (${extra})` : ''}`); if (!cond) failed++; };
const call = async (action, args = {}, h = {}) => {
  const r = await fetch(U, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify({ action, args }) });
  const j = await r.json(); if (!r.ok) throw new Error(`${action}: ${j.error}`); return j;
};
const A = (a, x) => call('o.' + a, x, { 'x-admin': 'admin' });

try {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  const boot = await call('boot');
  ok('rounds and skills come from the config', boot.rounds.length === EVENT.rounds.length && boot.skills.length === EVENT.skills.length);
  const seed = await A('seedDemo');
  ok('practice data loads', seed.added === EVENT.practiceTeams.length, `${seed.added} teams`);

  const T = {};
  for (const n of ['Ana', 'Ben', 'Cal']) T[n] = (await call('join', { name: n, skills: EVENT.skills.slice(0, 2) })).token;
  const M = (n, a, x) => call(a, x, { 'x-token': T[n] });

  await A('setRound', { n: 1 });
  const due = await M('Ana', 'search', { q: '' });
  const [t1, t2] = due.results.map(r => r.id);
  await M('Ana', 'start', { id: t1 });
  const busy = (await M('Ben', 'search', { q: due.results[0].name })).results[0].state.key;
  ok('a started team is locked for other mentors', busy === 'busy');
  const help = EVENT.forms[1].questions.find(q => q.id === 'help')?.options[0];
  await M('Ana', 'submit', { id: t1, round: 1, answers: { building: 'A thing', theme: 'Fits', goal: 'Demo', clarity: 'Very clear', themeRead: 'Strong', plan: 'Ambitious', help: [help] } });
  let live = await A('live');
  ok('a help skill on check-in 1 raises a help request', live.attention.some(a => a.kind === 'flag'));

  await A('saveConfig', { skippedRounds: [2] });
  await A('setRound', { n: 3 });
  const tm = await M('Ben', 'team', { id: t1 });
  ok('later mentors see earlier notes', tm.prev.notes[0]?.notes.building === 'A thing');
  ok('a mentor is not sent back to a team they checked', (await M('Ana', 'team', { id: t1 })).state.key === 'seen');
  await M('Ben', 'start', { id: t1 });
  await M('Ben', 'submit', { id: t1, round: 3, answers: { built: 'X', works: 'Almost complete', changed: 'Improved', onTrack: 'No', whyNot: 'Stuck', recommend: 'Yes', why: 'Great' } });
  live = await A('live');
  ok('"On track: No" alerts organizers', live.attention.some(a => /Off track/.test(a.what)));

  await A('setRound', { n: 4 });
  await M('Cal', 'start', { id: t1 });
  await M('Cal', 'submit', { id: t1, round: 4, answers: { demoReady: 'Yes', built: 'X', strongest: 's', weakest: 'w', rating: '4', why: 'y' } });
  if (EVENT.judging.enabled === false) {
    let noPicks = false; try { await M('Cal', 'savePicks', { first: { teamId: t1, why: 'best' } }); } catch { noPicks = true; }
    ok('judging off: top-two picks are refused', noPicks);
    let noStage = false; try { await A('setStage', { stage: 'finals' }); } catch { noStage = true; }
    ok('judging off: morning stages are refused', noStage);
    await M('Ben', 'followUp', { id: t1, note: 'Sensor fixed, demo works' });
    const fu0 = await M('Cal', 'team', { id: t1 });
    ok('follow-up notes are shared with other mentors', fu0.followups.length === 1);
    const bk0 = await A('backup');
    ok('backup works', (await A('restore', { backup: bk0, confirm: 'RESTORE' })).counts.checkins >= 3);
    throw 'done';
  }
  await M('Cal', 'savePicks', { first: { teamId: t1, why: 'best' } });
  await M('Ana', 'savePicks', { first: { teamId: t1, why: 'saw them at check-in 1' } });
  ok('top-two picks can be any team you checked tonight, not just the final round', (await M('Ana', 'picks')).first?.teamId === t1);
  await M('Ben', 'followUp', { id: t1, note: 'Sensor fixed, demo works' });
  const fu = await M('Cal', 'team', { id: t1 });
  ok('follow-up notes are shared with other mentors', fu.followups.length === 1 && fu.approached.some(a => a.visits.some(v => v.kind === 'followup')));
  const b1 = (await A('board')).rows.find(r => r.id === t1);
  ok('finalist points: pool Yes +1, rating 4 +2, two top-two picks +2', b1.points === 5, `${b1.points}`);

  await A('setStage', { stage: 'booths' });
  const booth = await M('Ana', 'judgeList', { q: '' });
  ok('booth list: teams you checked are separate from teams you haven’t seen', booth.seen.some(r => r.id === t1) && !booth.unseen.some(r => r.id === t1) && booth.unseen.length > 0);
  ok('booth must-see only shows strong teams the judge hasn’t seen', !booth.mustSee.some(r => r.seen));
  await M('Ana', 'nominate', { id: t1, on: true });
  await M('Ana', 'nominate', { id: t2, on: true });
  const brd = (await A('board')).rows;
  ok('nominations are counted fresh vs repeat', brd.find(r => r.id === t1).nomsFresh === 0 && brd.find(r => r.id === t2).nomsFresh === 1);
  for (const id of [t1, t2]) await A('star', { id, starred: true });
  await A('setStage', { stage: 'finals' });
  const full = Object.fromEntries(EVENT.rubric.map(r => [r.id, r.max]));
  const half = Object.fromEntries(EVENT.rubric.map(r => [r.id, r.max / 2]));
  const total = EVENT.rubric.reduce((a, r) => a + r.max, 0);
  ok('judges score with the config rubric', (await M('Ana', 'score', { id: t1, marks: full })).total === total);
  await M('Ben', 'score', { id: t1, marks: half });
  let refused = false; try { await M('Cal', 'score', { id: t1, marks: {} }); } catch { refused = true; }
  ok('an incomplete score sheet is refused', refused);
  const r1 = (await A('results')).rows.find(r => r.id === t1);
  ok('the average is over judges who scored', r1.avg === total * 0.75 && r1.judges === 2, `${r1.avg}`);
  const head = (await A('exportScores')).csv.split('\n')[0];
  ok('scores CSV has one column per criterion', EVENT.rubric.every(r => head.includes(`${r.id}_${r.max}`)), head);

  const bk = await A('backup');
  await A('deleteScore', { teamId: t1, mentorId: r1.sheets[0].judgeId });
  const rr = await A('restore', { backup: bk, confirm: 'RESTORE' });
  ok('backup and restore round-trip', rr.counts.scores === 2 && (await A('results')).rows.find(r => r.id === t1).judges === 2);
} catch (e) {
  if (e !== 'done') { console.error('✗', e.message); failed++; }
} finally {
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
