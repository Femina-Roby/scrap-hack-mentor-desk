import { randomUUID, randomBytes } from 'node:crypto';
import { sql, transaction } from './db.js';
import EVENT from '../public/event.config.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = msg => { throw new HttpError(400, msg); };

const LOCK_MINUTES = 10;
// Public demo (DEMO_MODE=1): data resets to a seeded event every hour; backup/restore are off.
const DEMO = !!process.env.DEMO_MODE;
const DEMO_RESET_MINUTES = Number(process.env.DEMO_RESET_MINUTES) || 60;
// Everything event-specific comes from public/event.config.js (see docs/CONFIG.md).
const SKILLS = EVENT.skills;
// "Ask for help" type -> mentor skills it gets routed to ('A|B' = either).
const FLAG_SKILL = Object.fromEntries(EVENT.helpTypes.filter(([, k]) => k));
// The round-1 `plan` answer that puts a team on the organizers' attention list (the red option).
const RED_PLAN = (EVENT.forms[1]?.questions.find(q => q.id === 'plan')?.options || []).find(o => o[1] === 'r')?.[0] || null;

const DEFAULT_CONFIG = {
  liveRound: 0,
  rounds: EVENT.rounds.map(({ n, title, time }) => ({ n, title, time })),
  organizerPhone: '',
  picksLockAt: EVENT.judging.picksLockAt,
  picksLocked: false,
  stage: 'night', // night | booths | finals | done
};

// Morning judging rubric from the config. Marks are stored per criterion in scores.marks.
export const RUBRIC = EVENT.rubric.map(({ id, max }) => ({ id, max }));
const RUBRIC_TOTAL = RUBRIC.reduce((a, r) => a + r.max, 0);
// Score rows carry marks as JSON; spread them so code can read s[criterion].
const flatScore = s => ({ ...(s.marks || {}), ...s });

async function getConfig() {
  const [row] = await sql(`SELECT value FROM config WHERE key = 'event'`);
  return { ...DEFAULT_CONFIG, ...(row?.value || {}) };
}
async function setConfig(patch) {
  const next = { ...(await getConfig()), ...patch };
  await sql(
    `INSERT INTO config (key, value) VALUES ('event', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(next)]
  );
  return next;
}

const collegeKey = c => {
  const k = String(c || '').split(',')[0].trim().toLowerCase();
  return k === 'none' ? '' : k;
};
const clean = (s, max = 600) => String(s ?? '').trim().slice(0, max);
const intId = v => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) bad('Bad id');
  return n;
};
const skillMatches = (skill, skills) => !!skill && skill.split('|').some(s => skills.includes(s));

// Answers from earlier check-ins shown to later mentors: facts and notes only, no ratings.
const NOTE_KEYS = EVENT.noteKeys;

// ---------- per-round context for computing "can I check this team?" ----------

async function roundContext(round, mentor) {
  const [teams, done, locks, mineEarlier, conflicts, visits, mentors] = await Promise.all([
    sql(`SELECT id, code, name, type, members, table_no FROM teams WHERE NOT coalesce(hidden, false) ORDER BY name`),
    sql(`SELECT team_id, mentor_id, at FROM checkins WHERE round = $1`, [round]),
    sql(`SELECT team_id, mentor_id FROM locks WHERE round = $1 AND expires_at > now()`, [round]),
    // Match by name too, so a mentor who signed in again on a new card keeps their history.
    sql(`SELECT c.team_id, max(c.round) AS round FROM checkins c LEFT JOIN mentors m ON m.id = c.mentor_id
         WHERE (c.mentor_id = $1 OR lower(trim(m.name)) = lower(trim($3))) AND c.round < $2 GROUP BY c.team_id`, [mentor.id, round, mentor.name]),
    sql(`SELECT team_id FROM conflicts WHERE mentor_id = $1`, [mentor.id]),
    sql(`SELECT team_id, max(at) AS at FROM visits WHERE round = $1 GROUP BY team_id`, [round]),
    sql(`SELECT id, name FROM mentors`),
  ]);
  const names = new Map(mentors.map(m => [m.id, m.name]));
  return {
    teams,
    names,
    done: new Map(done.map(d => [d.team_id, d])),
    locks: new Map(locks.map(l => [l.team_id, l])),
    seen: new Map(mineEarlier.map(s => [s.team_id, Number(s.round)])),
    declared: new Set(conflicts.map(c => c.team_id)),
    away: new Map(visits.map(v => [v.team_id, v.at])),
    myCollege: collegeKey(mentor.college),
    mentorId: mentor.id,
  };
}

function stateFor(team, ctx) {
  const done = ctx.done.get(team.id);
  if (done) return { key: 'done', by: ctx.names.get(done.mentor_id) || 'a mentor', at: done.at, mine: done.mentor_id === ctx.mentorId };
  const lock = ctx.locks.get(team.id);
  if (lock && lock.mentor_id !== ctx.mentorId) return { key: 'busy', by: ctx.names.get(lock.mentor_id) || 'a mentor' };
  const base = { awayAt: ctx.away.get(team.id) || null, started: !!lock };
  if (ctx.seen.has(team.id)) return { ...base, key: 'seen', round: ctx.seen.get(team.id) };
  if (ctx.declared.has(team.id)) return { ...base, key: 'conflict', reason: 'You said you know this team' };
  if (ctx.myCollege && (team.members || []).some(m => collegeKey(m.college) === ctx.myCollege)) {
    return { ...base, key: 'conflict', reason: `From a college you’re connected to (${team.members.find(m => collegeKey(m.college) === ctx.myCollege).college})` };
  }
  return { ...base, key: 'due' };
}

// Same rule as conflictFor, for many mentors at once: declared "I know this team", or a member from their college.
function connectedCheck(mentors, conflicts) {
  const declared = new Set(conflicts.map(c => `${c.mentor_id}:${c.team_id}`));
  const college = new Map(mentors.map(m => [m.id, collegeKey(m.college)]));
  return (mentorId, team) => declared.has(`${mentorId}:${team.id}`)
    || (!!college.get(mentorId) && (team.members || []).some(x => collegeKey(x.college) === college.get(mentorId)));
}

async function conflictFor(team, mentor) {
  const [declared] = await sql(`SELECT 1 FROM conflicts WHERE mentor_id = $1 AND team_id = $2`, [mentor.id, team.id]);
  if (declared) return 'You said you know this team';
  const mine = collegeKey(mentor.college);
  const hit = mine && (team.members || []).find(m => collegeKey(m.college) === mine);
  return hit ? `From a college you’re connected to (${hit.college})` : null;
}

// Spread mentors out: each mentor gets the due list in a different, stable order.
function spreadOrder(teams, mentorId) {
  const h = s => {
    let x = 2166136261;
    for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
    // Final mix: plain FNV keeps neighbouring team ids next to each other.
    x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
    return x >>> 0;
  };
  return [...teams].sort((a, b) => h(`${mentorId}:${a.id}`) - h(`${mentorId}:${b.id}`));
}

const cleanAnswers = answers => {
  const safe = {};
  for (const [k, v] of Object.entries(answers || {})) {
    if (!/^[a-zA-Z]{1,24}$/.test(k)) continue;
    safe[k] = Array.isArray(v) ? v.slice(0, 12).map(x => clean(x, 60)) : clean(v, 600);
  }
  return safe;
};

const teamOut = t => ({ id: t.id, code: t.code, name: t.name, type: t.type, members: t.members, table: t.table_no || '' });

// ---------- mentor actions ----------

async function mentorFromToken(token) {
  if (!token) throw new HttpError(401, 'Please sign in');
  const [m] = await sql(`SELECT * FROM mentors WHERE token = $1`, [token]);
  if (!m) throw new HttpError(401, 'Please sign in again');
  return m;
}

const mentorOut = m => ({ id: m.id, name: m.name, college: m.college, skills: m.skills, active: m.active });

export const publicActions = {
  async boot() {
    const cfg = await getConfig();
    return { demo: DEMO, codeRequired: !!process.env.MENTOR_CODE, organizerPhone: cfg.organizerPhone, picksLockAt: cfg.picksLockAt, rounds: cfg.rounds, skills: SKILLS };
  },

  async join({ code, name, college, skills }) {
    if (process.env.MENTOR_CODE && clean(code).toLowerCase() !== process.env.MENTOR_CODE.toLowerCase()) bad('That event code is not right. Ask an organizer.');
    name = clean(name, 60);
    if (!name) bad('Add your name');
    const id = randomUUID();
    const token = randomBytes(24).toString('hex');
    const sk = (Array.isArray(skills) ? skills : []).filter(s => SKILLS.includes(s));
    await sql(`INSERT INTO mentors (id, token, name, college, skills) VALUES ($1,$2,$3,$4,$5)`, [id, token, name, clean(college, 120), sk]);
    return { token };
  },
};

export const mentorActions = {
  async home(_, me) {
    const cfg = await getConfig();
    const round = cfg.liveRound;
    const [[{ teams }], [{ active }], [{ done_all: all }], [{ mine }], [{ help }]] = await Promise.all([
      sql(`SELECT count(*)::int AS teams FROM teams WHERE NOT coalesce(hidden, false)`),
      sql(`SELECT count(*)::int AS active FROM mentors WHERE active`),
      sql(`SELECT count(*)::int AS done_all FROM checkins WHERE round = $1`, [round]),
      sql(`SELECT count(*)::int AS mine FROM checkins WHERE round = $1 AND mentor_id = $2`, [round, me.id]),
      sql(`SELECT count(*)::int AS help FROM flags WHERE status = 'open'`),
    ]);
    let picks = null;
    if (round === 4) {
      const [p] = await sql(`SELECT first_team, second_team FROM picks WHERE mentor_id = $1`, [me.id]);
      picks = { saved: [p?.first_team, p?.second_team].filter(Boolean).length, locked: cfg.picksLocked, lockAt: cfg.picksLockAt };
    }
    let judging = null;
    if (cfg.stage === 'booths' || cfg.stage === 'finals' || cfg.stage === 'done') {
      const [[{ noms }], [{ scored }], [{ finalists }]] = await Promise.all([
        sql(`SELECT count(*)::int AS noms FROM nominations WHERE mentor_id = $1`, [me.id]),
        sql(`SELECT count(*)::int AS scored FROM scores s JOIN shortlist f ON f.team_id = s.team_id AND f.starred WHERE s.mentor_id = $1`, [me.id]),
        sql(`SELECT count(*)::int AS finalists FROM shortlist WHERE starred`),
      ]);
      judging = { stage: cfg.stage, noms, scored, finalists };
    }
    return {
      me: mentorOut(me),
      practice: !!cfg.practice, demo: DEMO,
      judging,
      round: round ? cfg.rounds.find(r => r.n === round) : null,
      phone: cfg.organizerPhone,
      stats: { teams, active, all, mine, target: Math.ceil(teams / Math.max(active, 1)) },
      help,
      picks,
    };
  },

  async search({ q }, me) {
    const cfg = await getConfig();
    const round = cfg.liveRound;
    if (!round) return { round: 0, results: [], due: 0 };
    const ctx = await roundContext(round, me);
    q = clean(q, 60).toLowerCase();
    const withState = ctx.teams.map(t => ({ ...teamOut(t), state: stateFor(t, ctx) }));
    const due = withState.filter(t => t.state.key === 'due');
    if (!q) {
      // Teams already found away go to the back (longest-ago first), so mentors aren't sent back to the same empty spot.
      const order = spreadOrder(due, me.id).sort((a, b) => (a.state.awayAt ? new Date(a.state.awayAt).getTime() : 0) - (b.state.awayAt ? new Date(b.state.awayAt).getTime() : 0));
      return { round, due: due.length, results: order.slice(0, 8) };
    }
    const words = q.split(/\s+/).filter(Boolean);
    const hay = t => [t.name, t.code, t.table ? `table ${t.table}` : '', ...(t.members || []).map(m => m.name)].join(' ').toLowerCase();
    const results = withState.filter(t => words.every(w => hay(t).includes(w)));
    const rank = { due: 0, seen: 1, conflict: 1, busy: 2, done: 3 };
    results.sort((a, b) => rank[a.state.key] - rank[b.state.key] || a.name.localeCompare(b.name));
    return { round, due: due.length, results: results.slice(0, 30) };
  },

  async team({ id }, me) {
    id = intId(id);
    const cfg = await getConfig();
    const round = cfg.liveRound;
    const [team] = await sql(`SELECT * FROM teams WHERE id = $1`, [id]);
    if (!team || team.hidden) throw new HttpError(404, 'Team not found');
    const [ctx, idea, last, help, approached, allChecks, follows, [mineAny]] = await Promise.all([
      round ? roundContext(round, me) : null,
      sql(`SELECT c.round, c.answers, c.at, m.name AS by FROM checkins c LEFT JOIN mentors m ON m.id = c.mentor_id WHERE c.team_id = $1 AND c.round < $2 ORDER BY c.round`, [id, round || 0]),
      sql(`SELECT max(at) AS at FROM (SELECT at FROM checkins WHERE team_id = $1 UNION ALL SELECT at FROM visits WHERE team_id = $1) x`, [id]),
      sql(`SELECT count(*)::int AS n FROM flags WHERE team_id = $1 AND status <> 'resolved'`, [id]),
      approachesBy(id),
      sql(`SELECT c.round, c.at, m.name AS by FROM checkins c LEFT JOIN mentors m ON m.id = c.mentor_id WHERE c.team_id = $1`, [id]),
      sql(`SELECT f.note, f.at, m.name AS by FROM followups f LEFT JOIN mentors m ON m.id = f.mentor_id WHERE f.team_id = $1 ORDER BY f.at`, [id]),
      sql(`SELECT 1 AS yes FROM checkins WHERE team_id = $1 AND mentor_id = $2 LIMIT 1`, [id, me.id]),
    ]);
    // Every check-in round for this team: done (by whom, when), live now, or later. Skipped rounds left out.
    const skipped = cfg.skippedRounds || [];
    const roundsStatus = cfg.rounds.filter(r => !skipped.includes(r.n)).map(r => {
      const c = allChecks.find(x => x.round === r.n);
      return { n: r.n, title: r.title, status: c ? 'done' : r.n === round ? 'live' : r.n < round ? 'missed' : 'later', by: c?.by || null, at: c?.at || null };
    });
    const prev = {};
    // Earlier mentors' notes (what they saw), never their ratings or recommendations.
    prev.notes = idea.filter(c => NOTE_KEYS[c.round]).map(c => ({
      round: c.round, by: c.by, at: c.at,
      notes: Object.fromEntries(NOTE_KEYS[c.round].filter(k => c.answers[k]).map(k => [k, c.answers[k]])),
    }));
    const r1 = idea.find(c => c.round === 1);
    if (r1) {
      const a = r1.answers;
      prev.idea = { building: a.building, theme: a.theme, goal: a.goal, by: r1.by, at: r1.at };
    }
    return {
      round: round ? cfg.rounds.find(r => r.n === round) : null,
      team: teamOut(team),
      state: ctx ? stateFor(team, ctx) : null,
      prev,
      approached: approached.get(id) || [],
      checkins: roundsStatus,
      followups: follows.map(f => ({ by: f.by, note: f.note, at: f.at })),
      checkedByMe: !!mineAny,
      lastSeen: last[0]?.at || null,
      openHelp: help[0].n,
      phone: cfg.organizerPhone,
    };
  },

  async start({ id, reason }, me) {
    id = intId(id);
    const { liveRound: round } = await getConfig();
    if (!round) bad('No check-in round is open yet');
    const ctx = await roundContext(round, me);
    const team = ctx.teams.find(t => t.id === id); // hidden teams aren't in ctx.teams
    if (!team) throw new HttpError(404, 'Team not found');
    const st = stateFor(team, ctx);
    if (st.key === 'done') bad(`Already checked by ${st.by}`);
    if (st.key === 'busy') bad(`${st.by} is checking this team right now`);
    reason = clean(reason, 200);
    if ((st.key === 'seen' || st.key === 'conflict') && !reason) bad('Add a short reason to check anyway');
    const rows = await sql(
      `INSERT INTO locks (team_id, round, mentor_id, override, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '${LOCK_MINUTES} minutes')
       ON CONFLICT (team_id, round) DO UPDATE SET mentor_id = EXCLUDED.mentor_id, override = EXCLUDED.override, expires_at = EXCLUDED.expires_at,
         started_at = CASE WHEN locks.mentor_id = EXCLUDED.mentor_id THEN locks.started_at ELSE now() END
       WHERE locks.expires_at < now() OR locks.mentor_id = EXCLUDED.mentor_id
       RETURNING team_id`,
      [id, round, me.id, reason || null]
    );
    if (!rows.length) bad('Another mentor just started this team');
    return { round };
  },

  // Called every 30s while the check-in form is open: keeps this mentor's lock alive (or takes it back
  // if it lapsed and nobody else has the team). Tells the form if someone else has it now.
  async keep({ id }, me) {
    id = intId(id);
    const { liveRound: round } = await getConfig();
    if (!round) return { held: false, reason: 'No check-in round is open' };
    const [done] = await sql(`SELECT c.mentor_id, m.name FROM checkins c LEFT JOIN mentors m ON m.id = c.mentor_id WHERE c.team_id = $1 AND c.round = $2`, [id, round]);
    if (done && done.mentor_id !== me.id) return { held: false, by: done.name, submitted: true };
    const rows = await sql(
      `INSERT INTO locks (team_id, round, mentor_id, expires_at) VALUES ($1, $2, $3, now() + interval '${LOCK_MINUTES} minutes')
       ON CONFLICT (team_id, round) DO UPDATE SET mentor_id = EXCLUDED.mentor_id, expires_at = EXCLUDED.expires_at,
         started_at = CASE WHEN locks.mentor_id = EXCLUDED.mentor_id THEN locks.started_at ELSE now() END,
         override = CASE WHEN locks.mentor_id = EXCLUDED.mentor_id THEN locks.override ELSE NULL END
       WHERE locks.mentor_id = EXCLUDED.mentor_id OR locks.expires_at < now()
       RETURNING team_id`, [id, round, me.id]);
    if (rows.length) return { held: true };
    const [other] = await sql(`SELECT m.name FROM locks l LEFT JOIN mentors m ON m.id = l.mentor_id WHERE l.team_id = $1 AND l.round = $2`, [id, round]);
    return { held: false, by: other?.name || 'Another mentor' };
  },

  // Revisit a team you've already checked: a short note for continuity. Not a check-in, no points.
  async followUp({ id, note }, me) {
    id = intId(id);
    note = clean(note, 400);
    if (!note) bad('Add a short note');
    const [team] = await sql(`SELECT id FROM teams WHERE id = $1 AND NOT coalesce(hidden, false)`, [id]);
    if (!team) throw new HttpError(404, 'Team not found');
    const { liveRound } = await getConfig();
    await sql(`INSERT INTO followups (team_id, mentor_id, round, note) VALUES ($1, $2, $3, $4)`, [id, me.id, liveRound || null, note]);
    return {};
  },

  async cancel({ id }, me) {
    id = intId(id);
    await sql(`DELETE FROM locks WHERE team_id = $1 AND mentor_id = $2`, [id, me.id]);
    return {};
  },

  async away({ id }, me) {
    id = intId(id);
    const { liveRound: round } = await getConfig();
    if (!round) bad('No check-in round is open yet');
    await sql(`INSERT INTO visits (team_id, round, mentor_id) VALUES ($1, $2, $3)`, [id, round, me.id]);
    await sql(`DELETE FROM locks WHERE team_id = $1 AND mentor_id = $2`, [id, me.id]);
    return {};
  },

  async knowTeam({ id }, me) {
    id = intId(id);
    await sql(`INSERT INTO conflicts (mentor_id, team_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me.id, id]);
    await sql(`DELETE FROM locks WHERE team_id = $1 AND mentor_id = $2`, [id, me.id]);
    return {};
  },

  async submit({ id, round, answers }, me) {
    id = intId(id);
    round = Number(round);
    if (![1, 2, 3, 4].includes(round)) bad('Bad round');
    if (!answers || typeof answers !== 'object') bad('Missing answers');
    const safe = cleanAnswers(answers);
    const [existing] = await sql(`SELECT mentor_id FROM checkins WHERE team_id = $1 AND round = $2`, [id, round]);
    if (existing && existing.mentor_id !== me.id) {
      const [m] = await sql(`SELECT name FROM mentors WHERE id = $1`, [existing.mentor_id]);
      bad(`${m?.name || 'Another mentor'} already submitted this team for check-in ${round}`);
    }
    const [lock] = await sql(`SELECT override, started_at FROM locks WHERE team_id = $1 AND round = $2 AND mentor_id = $3`, [id, round, me.id]);
    await sql(
      `INSERT INTO checkins (team_id, round, mentor_id, override, answers, started_at) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (team_id, round) DO UPDATE SET answers = EXCLUDED.answers, at = now()`,
      [id, round, me.id, lock?.override || null, JSON.stringify(safe), lock?.started_at || null]
    );
    await sql(`DELETE FROM locks WHERE team_id = $1 AND round = $2`, [id, round]);

    // Auto help requests.
    const open = await sql(`SELECT type FROM flags WHERE team_id = $1 AND status <> 'resolved'`, [id]);
    const openTypes = new Set(open.map(f => f.type));
    if (round === 1 && Array.isArray(safe.help)) {
      for (const s of safe.help.filter(s => SKILLS.includes(s))) {
        const type = `${s} help`;
        if (!openTypes.has(type)) {
          await sql(`INSERT INTO flags (team_id, type, skill, note, raised_by, source, round) VALUES ($1,$2,$3,$4,$5,'checkin',1)`,
            [id, type, s, `Asked for ${s} help at check-in 1`, me.id]);
        }
      }
    }
    if ((round === 2 || round === 3) && safe.onTrack === 'No' && !openTypes.has('Off track')) {
      await sql(`INSERT INTO flags (team_id, type, skill, note, raised_by, source, round) VALUES ($1,'Off track',NULL,$2,$3,'checkin',$4)`,
        [id, safe.whyNot || '', me.id, round]);
    }
    return { ok: true };
  },

  // Polled by every mentor screen: open help count, and the newest open request matching this mentor's skills.
  async ping(_, me) {
    const rows = await sql(`SELECT f.id, f.type, f.skill, f.raised_by, t.name AS team, t.table_no FROM flags f JOIN teams t ON t.id = f.team_id WHERE f.status = 'open' AND NOT coalesce(t.hidden, false) ORDER BY f.id DESC`);
    const mine = rows.find(f => f.raised_by !== me.id && skillMatches(f.skill, me.skills));
    return { help: rows.length, newest: mine ? { id: mine.id, type: mine.type, team: mine.team, table: mine.table_no || '' } : null };
  },

  // Teams this mentor has been to tonight: check-ins, found away, help requests they took.
  async mine(_, me) {
    const rows = await sql(`
      SELECT x.team_id, x.kind, x.round, x.at FROM (
        SELECT team_id, 'checkin' AS kind, round, at FROM checkins WHERE mentor_id = $1
        UNION ALL SELECT team_id, 'away', round, at FROM visits WHERE mentor_id = $1
        UNION ALL SELECT team_id, 'followup', round, at FROM followups WHERE mentor_id = $1
        UNION ALL SELECT team_id, 'help', round, coalesce(resolved_at, at) FROM flags WHERE taken_by = $1
      ) x ORDER BY x.at`, [me.id]);
    if (!rows.length) return { teams: [] };
    const teams = await sql(`SELECT id, code, name, type, members, table_no FROM teams WHERE id = ANY($1::int[])`, [[...new Set(rows.map(r => r.team_id))]]);
    const out = teams.map(t => {
      const visits = rows.filter(r => r.team_id === t.id).map(r => ({ kind: r.kind, round: r.round, at: r.at }));
      return { ...teamOut(t), visits, lastAt: visits[visits.length - 1].at };
    });
    out.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    return { teams: out };
  },

  async help(_, me) {
    const rows = await sql(
      `SELECT f.*, t.name AS team, t.code, t.table_no, r.name AS raised_name, k.name AS taken_name,
              extract(epoch FROM now() - f.at)::int AS age
       FROM flags f JOIN teams t ON t.id = f.team_id
       LEFT JOIN mentors r ON r.id = f.raised_by LEFT JOIN mentors k ON k.id = f.taken_by
       WHERE f.status <> 'resolved' AND NOT coalesce(t.hidden, false) ORDER BY f.at`
    );
    const cfg = await getConfig();
    const list = rows.map(f => ({
      id: f.id, teamId: f.team_id, team: f.team, code: f.code, table: f.table_no || '', type: f.type, note: f.note,
      raisedBy: f.raised_name, takenBy: f.taken_name, status: f.status, minutes: Math.floor(f.age / 60),
      mine: f.taken_by === me.id, match: skillMatches(f.skill, me.skills), auto: f.source === 'checkin', round: f.round,
    }));
    const score = f => (f.mine ? 0 : f.status === 'open' ? (f.match ? 1 : 2) : 3);
    list.sort((a, b) => score(a) - score(b) || b.minutes - a.minutes);
    return { list, phone: cfg.organizerPhone };
  },

  async raise({ id, type, note }, me) {
    id = intId(id);
    type = clean(type, 40);
    if (!type) bad('Pick what is wrong');
    const { liveRound } = await getConfig();
    await sql(`INSERT INTO flags (team_id, type, skill, note, raised_by, round) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, type, FLAG_SKILL[type] || null, clean(note, 400), me.id, liveRound || null]);
    return {};
  },

  async take({ id }, me) {
    id = intId(id);
    const rows = await sql(`UPDATE flags SET status = 'taken', taken_by = $2, taken_at = now() WHERE id = $1 AND status = 'open' RETURNING id`, [id, me.id]);
    if (!rows.length) bad('Someone already took this one');
    return {};
  },

  async resolve({ id }) {
    id = intId(id);
    await sql(`UPDATE flags SET status = 'resolved', resolved_at = now() WHERE id = $1`, [id]);
    return {};
  },

  async picks(_, me) {
    const cfg = await getConfig();
    const [teams, [p]] = await Promise.all([
      // Any team this mentor checked tonight, most recent first, with the round and a one-line idea.
      sql(`SELECT t.id, t.code, t.name, t.table_no, max(c.round) AS round, max(c.at) AS last,
                  (SELECT coalesce(c1.answers->>'building', '') FROM checkins c1 WHERE c1.team_id = t.id AND c1.round = 1) AS idea
           FROM checkins c JOIN teams t ON t.id = c.team_id
           WHERE c.mentor_id = $1 AND NOT coalesce(t.hidden, false) GROUP BY t.id ORDER BY max(c.at) DESC`, [me.id]),
      sql(`SELECT * FROM picks WHERE mentor_id = $1`, [me.id]),
    ]);
    return {
      open: cfg.liveRound === 4, locked: cfg.picksLocked, lockAt: cfg.picksLockAt,
      teams: teams.map(t => ({ id: t.id, code: t.code, name: t.name, table: t.table_no || '', round: Number(t.round), idea: t.idea || '' })),
      first: p?.first_team ? { teamId: p.first_team, why: p.first_why } : null,
      second: p?.second_team ? { teamId: p.second_team, why: p.second_why } : null,
    };
  },

  async savePicks({ first, second }, me) {
    const cfg = await getConfig();
    if (EVENT.judging.enabled === false) bad('This event has no top-two picks');
    if (cfg.picksLocked) bad('Picks are locked now');
    const mine = new Set((await sql(`SELECT team_id FROM checkins WHERE mentor_id = $1`, [me.id])).map(r => r.team_id));
    const norm = p => {
      if (!p?.teamId) return null;
      const teamId = intId(p.teamId);
      if (!mine.has(teamId)) bad('You can only pick teams you checked tonight');
      const why = clean(p.why, 300);
      if (!why) bad('Add a line on why for each pick');
      return { teamId, why };
    };
    const a = norm(first), b = norm(second);
    if (!a) bad('Pick at least one team');
    if (b && a.teamId === b.teamId) bad('Pick two different teams');
    await sql(
      `INSERT INTO picks (mentor_id, first_team, first_why, second_team, second_why) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (mentor_id) DO UPDATE SET first_team = $2, first_why = $3, second_team = $4, second_why = $5, at = now()`,
      [me.id, a.teamId, a.why, b?.teamId || null, b?.why || null]
    );
    return {};
  },

  // ----- morning judging -----

  async judgeList({ q }, me) {
    const cfg = await getConfig();
    const [teams, starred, noms, scores, declared, ideas, mineChecked] = await Promise.all([
      sql(`SELECT id, code, name, type, members, table_no FROM teams WHERE NOT coalesce(hidden, false) ORDER BY name`),
      sql(`SELECT team_id FROM shortlist WHERE starred`),
      sql(`SELECT team_id FROM nominations WHERE mentor_id = $1`, [me.id]),
      sql(`SELECT team_id, total FROM scores WHERE mentor_id = $1`, [me.id]),
      sql(`SELECT team_id FROM conflicts WHERE mentor_id = $1`, [me.id]),
      sql(`SELECT team_id, round, answers->>'building' AS building, answers->>'built' AS built FROM checkins WHERE round IN (1, 4)`),
      sql(`SELECT DISTINCT team_id FROM checkins WHERE mentor_id = $1`, [me.id]),
    ]);
    const checked = new Set(mineChecked.map(r => r.team_id));
    // One line on the project: what they said at check-in 1, else what was built by the final review.
    const idea = new Map();
    for (const r of ideas.sort((a, b) => a.round - b.round)) if (!idea.has(r.team_id) && (r.building || r.built)) idea.set(r.team_id, r.building || r.built);
    const star = new Set(starred.map(r => r.team_id));
    const nom = new Set(noms.map(r => r.team_id));
    const sc = new Map(scores.map(r => [r.team_id, r.total]));
    const dec = new Set(declared.map(r => r.team_id));
    const mine = collegeKey(me.college);
    const rows = teams.map(t => ({
      ...teamOut(t),
      starred: star.has(t.id), nominated: nom.has(t.id), score: sc.get(t.id) ?? null, idea: idea.get(t.id) || '', seen: checked.has(t.id),
      conflict: dec.has(t.id) || (!!mine && (t.members || []).some(m => collegeKey(m.college) === mine)),
    }));
    if (cfg.stage === 'finals' || cfg.stage === 'done') return { stage: cfg.stage, results: rows.filter(r => r.starred) };
    const nominated = rows.filter(r => r.nominated);
    q = clean(q, 60).toLowerCase();
    if (!q) {
      // Booths: strong teams (night signal) this judge hasn't seen, then every other team they haven't
      // seen (per-judge order so judges spread out), then the ones they checked tonight.
      const signal = (await boardData()).filter(r => r.points > 0).slice(0, EVENT.judging.shortlistSize).map(r => r.id);
      const byId = new Map(rows.map(r => [r.id, r]));
      const open = rows.filter(r => !r.conflict);
      return {
        stage: cfg.stage, nominated, target: EVENT.judging.nominationTarget || 0,
        // Strong teams from the night that this judge hasn't seen: their favourites already count via picks.
        mustSee: signal.map(id => byId.get(id)).filter(r => r && !r.conflict && !r.seen),
        unseen: spreadOrder(open.filter(r => !r.seen), me.id),
        seen: open.filter(r => r.seen),
      };
    }
    const words = q.split(/\s+/).filter(Boolean);
    const hay = t => [t.name, t.code, t.table ? `table ${t.table}` : '', ...(t.members || []).map(m => m.name)].join(' ').toLowerCase();
    return { stage: cfg.stage, results: rows.filter(t => words.every(w => hay(t).includes(w))).slice(0, 30), nominated };
  },

  async judgeTeam({ id }, me) {
    id = intId(id);
    const cfg = await getConfig();
    const [[team], answers, [star], [nom], [score]] = await Promise.all([
      sql(`SELECT * FROM teams WHERE id = $1`, [id]),
      sql(`SELECT round, answers FROM checkins WHERE team_id = $1 AND round IN (1, 4)`, [id]),
      sql(`SELECT starred FROM shortlist WHERE team_id = $1`, [id]),
      sql(`SELECT 1 FROM nominations WHERE mentor_id = $1 AND team_id = $2`, [me.id, id]),
      sql(`SELECT * FROM scores WHERE mentor_id = $1 AND team_id = $2`, [me.id, id]),
    ]);
    if (!team || team.hidden) throw new HttpError(404, 'Team not found');
    const r1 = answers.find(a => a.round === 1)?.answers || {};
    const r4 = answers.find(a => a.round === 4)?.answers || {};
    return {
      stage: cfg.stage,
      team: teamOut(team),
      // What the team is building, in their words. No mentor ratings, so nobody is anchored.
      about: { building: r1.building || null, theme: r1.theme || null, built: r4.built || null },
      finalist: !!star?.starred,
      nominated: !!nom,
      score: score ? Object.fromEntries([...RUBRIC.map(r => [r.id, score.marks?.[r.id]]), ['note', score.note], ['total', score.total]]) : null,
      conflict: await conflictFor(team, me),
    };
  },

  async nominate({ id, on }, me) {
    id = intId(id);
    const cfg = await getConfig();
    if (cfg.stage !== 'booths') bad(EVENT.judging.booths === false ? 'This event has no booth round' : 'Nominations are closed');
    const [team] = await sql(`SELECT * FROM teams WHERE id = $1 AND NOT coalesce(hidden, false)`, [id]);
    if (!team) throw new HttpError(404, 'Team not found');
    if (on && await conflictFor(team, me)) bad('You can’t nominate a team you’re connected to');
    if (on) await sql(`INSERT INTO nominations (mentor_id, team_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me.id, id]);
    else await sql(`DELETE FROM nominations WHERE mentor_id = $1 AND team_id = $2`, [me.id, id]);
    return {};
  },

  async score({ id, marks, note }, me) {
    id = intId(id);
    const cfg = await getConfig();
    if (cfg.stage !== 'finals') bad(cfg.stage === 'done' ? 'Scoring is closed' : 'Scoring opens with the finalist presentations');
    const [team] = await sql(`SELECT t.* FROM teams t JOIN shortlist f ON f.team_id = t.id AND f.starred WHERE t.id = $1 AND NOT coalesce(t.hidden, false)`, [id]);
    if (!team) bad('This team is not a finalist');
    if (await conflictFor(team, me)) bad('You can’t score a team you’re connected to');
    const vals = Object.fromEntries(RUBRIC.map(r => {
      const v = Math.round(Number(marks?.[r.id]) * 10) / 10;
      if (marks?.[r.id] == null || !Number.isFinite(v)) bad('Give a mark for every criterion');
      if (v < 0 || v > r.max) bad(`${r.id} must be between 0 and ${r.max}`);
      return [r.id, v];
    }));
    const total = Math.round(Object.values(vals).reduce((a, b) => a + b, 0) * 10) / 10;
    await sql(
      `INSERT INTO scores (mentor_id, team_id, marks, total, note) VALUES ($1,$2,$3::jsonb,$4,$5)
       ON CONFLICT (mentor_id, team_id) DO UPDATE SET marks = EXCLUDED.marks, total = EXCLUDED.total, note = EXCLUDED.note, at = now()`,
      [me.id, id, JSON.stringify(vals), total, clean(note, 300)]
    );
    return { total };
  },

  async profile({ name, college, skills }, me) {
    name = clean(name, 60);
    if (!name) bad('Add your name');
    const sk = (Array.isArray(skills) ? skills : []).filter(s => SKILLS.includes(s));
    await sql(`UPDATE mentors SET name = $2, college = $3, skills = $4 WHERE id = $1`, [me.id, name, clean(college, 120), sk]);
    return {};
  },
};

// ---------- organizer actions ----------

const pointsOf = (r3, r4, pickCount) =>
  (r3?.recommend === 'Yes' ? 1 : r3?.recommend === 'Maybe' ? 0.5 : 0) +
  (r4?.rating === '4' ? 2 : r4?.rating === '3' ? 1 : 0) +
  pickCount;

// Every mentor who went to a team: check-ins, "not at their spot" visits, and help requests they took.
async function approachesBy(teamId = null) {
  const rows = await sql(`
    SELECT x.team_id, x.mentor_id, m.name, x.kind, x.round, x.at FROM (
      SELECT team_id, mentor_id, 'checkin' AS kind, round, at FROM checkins
      UNION ALL SELECT team_id, mentor_id, 'away', round, at FROM visits
      UNION ALL SELECT team_id, mentor_id, 'followup', round, at FROM followups
      UNION ALL SELECT team_id, taken_by, 'help', round, coalesce(resolved_at, at) FROM flags WHERE taken_by IS NOT NULL
    ) x LEFT JOIN mentors m ON m.id = x.mentor_id
    WHERE $1::int IS NULL OR x.team_id = $1 ORDER BY x.at`, [teamId]);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.team_id)) out.set(r.team_id, new Map());
    const byMentor = out.get(r.team_id);
    if (!byMentor.has(r.mentor_id)) byMentor.set(r.mentor_id, { name: r.name || 'Removed mentor', visits: [] });
    byMentor.get(r.mentor_id).visits.push({ kind: r.kind, round: r.round, at: r.at });
  }
  return new Map([...out].map(([t, m]) => [t, [...m.values()]]));
}

async function boardData() {
  const [teams, checks, picks, flags, stars, mentors, noms] = await Promise.all([
    sql(`SELECT * FROM teams WHERE NOT coalesce(hidden, false) ORDER BY name`),
    sql(`SELECT team_id, round, mentor_id, answers FROM checkins`),
    sql(`SELECT * FROM picks`),
    sql(`SELECT team_id FROM flags WHERE status <> 'resolved'`),
    sql(`SELECT team_id FROM shortlist WHERE starred`),
    sql(`SELECT id, name FROM mentors`),
    sql(`SELECT n.team_id, count(*)::int AS n,
                count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM checkins c WHERE c.team_id = n.team_id AND c.mentor_id = n.mentor_id))::int AS fresh
         FROM nominations n GROUP BY n.team_id`),
  ]);
  // A "fresh" nomination comes from a judge who never checked the team overnight: a real discovery.
  const nomCount = new Map(noms.map(n => [n.team_id, n.n]));
  const nomFresh = new Map(noms.map(n => [n.team_id, n.fresh]));
  const byTeam = new Map(teams.map(t => [t.id, { team: t, rounds: {}, mentors: new Set(), picks: [] }]));
  for (const c of checks) {
    const e = byTeam.get(c.team_id); if (!e) continue;
    e.rounds[c.round] = c.answers; e.mentors.add(c.mentor_id);
  }
  const names = new Map(mentors.map(m => [m.id, m.name]));
  for (const p of picks) {
    for (const [tid, why] of [[p.first_team, p.first_why], [p.second_team, p.second_why]]) {
      const e = tid && byTeam.get(tid); if (e) e.picks.push({ by: names.get(p.mentor_id), why });
    }
  }
  const flagged = new Set(flags.map(f => f.team_id));
  const starred = new Set(stars.map(s => s.team_id));
  const rows = [...byTeam.values()].map(({ team, rounds, mentors: ms, picks: pk }) => {
    const r3 = rounds[3], r4 = rounds[4];
    const points = pointsOf(r3, r4, pk.length);
    const demoReady = r4?.demoReady || null;
    const notReady = demoReady === 'No' || r3?.works === 'Nothing yet';
    const tags = [];
    if (points >= 3 && demoReady !== 'No') tags.push('potential');
    else if (points >= 1 && points <= 2.5) tags.push('watchlist');
    if (flagged.has(team.id)) tags.push('attention');
    if (notReady) tags.push('notready');
    if ((nomFresh.get(team.id) || 0) >= 2 && points < 3) tags.push('discovery');
    const strengths = {};
    for (const s of r3?.strengths || []) strengths[s] = (strengths[s] || 0) + 1;
    return {
      id: team.id, code: team.code, name: team.name, type: team.type, table: team.table_no || '',
      buildType: (rounds[1]?.buildType || []).join(', '),
      points, rec2am: r3?.recommend || null, rating: r4?.rating || null,
      picks: pk.length, pickNotes: pk, demoReady, strengths,
      mentorsSeen: ms.size, starred: starred.has(team.id), tags, noms: nomCount.get(team.id) || 0, nomsFresh: nomFresh.get(team.id) || 0,
    };
  });
  const dr = v => (v === 'Yes' ? 2 : v === 'Partially' ? 1 : 0);
  rows.sort((a, b) =>
    (b.starred - a.starred) || (b.points - a.points) || (b.picks - a.picks) ||
    (Number(b.rating || 0) - Number(a.rating || 0)) || (dr(b.demoReady) - dr(a.demoReady)) || a.name.localeCompare(b.name));
  return rows;
}

const csvCell = v => {
  const s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ---------- public demo ----------

// Called before every request when DEMO_MODE is on: once the data is an hour old, wipe and re-seed.
export async function demoTick() {
  if (!DEMO) return;
  const cfg = await getConfig();
  if (cfg.demoResetAt && Date.now() - new Date(cfg.demoResetAt) < DEMO_RESET_MINUTES * 60000) return;
  await setConfig({ demoResetAt: new Date().toISOString() }); // claim the reset first so parallel requests don't repeat it
  for (const t of [...BACKUP_TABLES].filter(t => t !== 'config')) await sql(`DELETE FROM ${t}`);
  await organizerActions.seedDemo();
  // A few mentors and check-ins so the dashboards have something to show.
  const mentors = [['Asha', ['Software', 'AI']], ['Ben', ['Hardware']], ['Chitra', ['Design', 'Idea refinement']]];
  const ids = [];
  for (const [name, skills] of mentors) {
    const id = randomUUID();
    await sql(`INSERT INTO mentors (id, token, name, college, skills) VALUES ($1, $2, $3, '', $4)`, [id, randomBytes(24).toString('hex'), `${name} (demo mentor)`, skills]);
    ids.push(id);
  }
  const teams = await sql(`SELECT id FROM teams ORDER BY id LIMIT 7`);
  const ideas = ['A study buddy that quizzes you on the bus', 'Live crowd map for the college canteen', 'A plant that tweets when it needs water',
    'Voice notes that turn into to-do lists', 'Lost-and-found board with photo matching', 'A tiny game about catching the last train', 'Sign-language letters to text'];
  for (let i = 0; i < teams.length; i++) {
    await sql(`INSERT INTO checkins (team_id, round, mentor_id, answers, started_at, at) VALUES ($1, 1, $2, $3::jsonb, now() - $4 * interval '1 minute', now() - ($4 - 4) * interval '1 minute')`,
      [teams[i].id, ids[i % ids.length], JSON.stringify({ building: ideas[i], theme: 'Fits the theme', goal: 'A working demo', clarity: i % 3 ? 'Very clear' : 'Somewhat clear', themeRead: 'Strong', plan: i === 4 ? (RED_PLAN || 'Ambitious') : 'Ambitious' }), 40 - i * 5]);
  }
  await setConfig({ liveRound: 1, stage: 'night', practice: true, skippedRounds: [], picksLocked: false, liveRoundAt: new Date(Date.now() - 45 * 60000).toISOString() });
}

const BACKUP_TABLES = ['config', 'teams', 'mentors', 'checkins', 'visits', 'followups', 'locks', 'conflicts', 'flags', 'picks', 'nominations', 'scores', 'shortlist'];

export const organizerActions = {
  async live() {
    const cfg = await getConfig();
    const round = cfg.liveRound;
    const [teams, mentors, roundStats, awayStats, flags, offTrack, redPlan, awayTwice, myDone] = await Promise.all([
      sql(`SELECT id, code, name, type, members, table_no FROM teams WHERE NOT coalesce(hidden, false) ORDER BY name`),
      sql(`SELECT id, name, college, skills, active, joined_at FROM mentors ORDER BY joined_at`),
      sql(`SELECT round, count(*)::int AS n FROM checkins GROUP BY round`),
      sql(`SELECT v.round, count(DISTINCT v.team_id)::int AS n FROM visits v WHERE NOT EXISTS (SELECT 1 FROM checkins c WHERE c.team_id = v.team_id AND c.round = v.round) GROUP BY v.round`),
      sql(`SELECT f.*, t.name AS team, k.name AS taken_name, extract(epoch FROM now() - f.at)::int AS age FROM flags f JOIN teams t ON t.id = f.team_id LEFT JOIN mentors k ON k.id = f.taken_by WHERE f.status <> 'resolved' ORDER BY f.at`),
      sql(`SELECT c.team_id, t.name, c.round, c.answers->>'whyNot' AS note FROM checkins c JOIN teams t ON t.id = c.team_id WHERE c.round IN (2, 3) AND c.answers->>'onTrack' = 'No' ORDER BY c.round DESC`),
      sql(`SELECT c.team_id, t.name FROM checkins c JOIN teams t ON t.id = c.team_id WHERE c.round = 1 AND c.answers->>'plan' = $1`, [RED_PLAN]),
      sql(`SELECT v.team_id, t.name, array_agg(v.at ORDER BY v.at) AS ats FROM visits v JOIN teams t ON t.id = v.team_id GROUP BY v.team_id, t.name HAVING count(*) >= 2`),
      sql(`SELECT mentor_id, count(*)::int AS n FROM checkins WHERE round = $1 GROUP BY mentor_id`, [round]),
    ]);
    // Coverage: what each mentor is doing now, so organizers can nudge the quiet ones.
    const [current, lastActs] = await Promise.all([
      sql(`SELECT l.mentor_id, t.name AS team, extract(epoch FROM now() - coalesce(l.started_at, l.expires_at - interval '${LOCK_MINUTES} minutes'))::int AS secs
           FROM locks l JOIN teams t ON t.id = l.team_id WHERE l.round = $1`, [round]),
      sql(`SELECT mentor_id, extract(epoch FROM now() - max(at))::int AS secs FROM (
             SELECT mentor_id, at FROM checkins UNION ALL SELECT mentor_id, at FROM visits
             UNION ALL SELECT raised_by, at FROM flags WHERE raised_by IS NOT NULL
             UNION ALL SELECT taken_by, coalesce(resolved_at, at) FROM flags WHERE taken_by IS NOT NULL
             UNION ALL SELECT mentor_id, coalesce(started_at, expires_at - interval '${LOCK_MINUTES} minutes') FROM locks
           ) x GROUP BY mentor_id`),
    ]);
    const roundMins = round && cfg.liveRoundAt ? Math.floor((Date.now() - new Date(cfg.liveRoundAt)) / 60000) : null;
    const coverage = m => {
      if (!round || !m.active) return null;
      const now = current.filter(c => c.mentor_id === m.id).sort((a, b) => a.secs - b.secs)[0];
      const last = lastActs.find(a => a.mentor_id === m.id);
      const lastMins = last ? Math.floor(last.secs / 60) : null;
      if (now) {
        const mins = Math.floor(now.secs / 60);
        return { busy: true, team: now.team, mins, nudge: mins >= 15, text: `On ${now.team} for ${mins} min` };
      }
      if (!doneBy[m.id] && (roundMins == null || roundMins >= 10)) {
        return { nudge: true, lastMins, text: lastMins == null ? 'Nothing yet tonight' : `No check-in this round · last active ${lastMins < 1 ? 'just now' : `${lastMins} min ago`}` };
      }
      if (lastMins != null && lastMins >= 20) return { nudge: true, lastMins, text: `Quiet for ${lastMins} min` };
      return { nudge: false, lastMins, text: lastMins == null ? 'Just started' : lastMins < 1 ? 'Active just now' : `Active ${lastMins} min ago` };
    };
    const done = Object.fromEntries(roundStats.map(r => [r.round, r.n]));
    const away = Object.fromEntries(awayStats.map(r => [r.round, r.n]));
    const doneBy = Object.fromEntries(myDone.map(r => [r.mentor_id, r.n]));
    const activeCount = mentors.filter(m => m.active).length;

    const attention = [];
    const seen = new Set();
    for (const f of flags) {
      attention.push({ kind: 'flag', flagId: f.id, teamId: f.team_id, team: f.team, what: f.type, note: f.note, minutes: Math.floor(f.age / 60), takenBy: f.taken_name, status: f.status });
      seen.add(f.team_id);
    }
    for (const o of offTrack) if (!seen.has(o.team_id)) { attention.push({ kind: 'offtrack', teamId: o.team_id, team: o.name, what: `Off track at check-in ${o.round}`, note: o.note }); seen.add(o.team_id); }
    for (const a of awayTwice) if (!seen.has(a.team_id)) { attention.push({ kind: 'away', teamId: a.team_id, team: a.name, what: `Away ${a.ats.length} times`, ats: a.ats }); seen.add(a.team_id); }
    for (const r of redPlan) if (!seen.has(r.team_id)) { attention.push({ kind: 'plan', teamId: r.team_id, team: r.name, what: 'Unclear plan at check-in 1' }); seen.add(r.team_id); }

    const tableOf = new Map(teams.map(t => [t.id, t.table_no || '']));
    for (const a of attention) a.table = tableOf.get(a.teamId) || '';

    let unchecked = [];
    if (round) {
      const [checked, awayNow] = await Promise.all([
        sql(`SELECT team_id FROM checkins WHERE round = $1`, [round]),
        sql(`SELECT team_id, max(at) AS at FROM visits WHERE round = $1 GROUP BY team_id`, [round]),
      ]);
      const c = new Set(checked.map(r => r.team_id));
      const aw = new Map(awayNow.map(r => [r.team_id, r.at]));
      unchecked = teams.filter(t => !c.has(t.id)).map(t => ({ id: t.id, code: t.code, name: t.name, type: t.type, table: t.table_no || '', awayAt: aw.get(t.id) || null }));
    }
    return {
      config: cfg,
      totals: { teams: teams.length, people: teams.reduce((s, t) => s + Math.max(t.members?.length || 0, t.type === 'duo' ? 2 : 1), 0), active: activeCount, target: Math.ceil(teams.length / Math.max(activeCount, 1)) },
      rounds: cfg.rounds.map(r => ({ ...r, done: done[r.n] || 0, away: away[r.n] || 0 })),
      attention,
      mentors: mentors.map(m => ({ ...m, done: doneBy[m.id] || 0, now: coverage(m) })),
      roundMins, demo: DEMO,
      unchecked,
    };
  },

  async setRound({ n }) {
    n = Number(n);
    if (![0, 1, 2, 3, 4].includes(n)) bad('Bad round');
    const cfg = await getConfig();
    if ((cfg.skippedRounds || []).includes(n)) bad(`Check-in ${n} is marked as skipped. Un-skip it first.`);
    return setConfig({ liveRound: n, stage: 'night', liveRoundAt: n === cfg.liveRound ? cfg.liveRoundAt : new Date().toISOString() });
  },

  async setStage({ stage }) {
    if (!['night', 'booths', 'finals', 'done'].includes(stage)) bad('Bad stage');
    if (stage !== 'night' && EVENT.judging.enabled === false) bad('This event has no judging');
    if (stage === 'booths' && EVENT.judging.booths === false) bad('This event has no booth round');
    return setConfig({ stage });
  },

  async results() {
    const [teams, scores, mentors, conflicts] = await Promise.all([
      sql(`SELECT t.id, t.code, t.name, t.type, t.members, t.table_no FROM teams t JOIN shortlist f ON f.team_id = t.id AND f.starred WHERE NOT coalesce(t.hidden, false) ORDER BY t.name`),
      sql(`SELECT s.*, m.name AS judge FROM scores s LEFT JOIN mentors m ON m.id = s.mentor_id`).then(r => r.map(flatScore)),
      sql(`SELECT id, name, college, active FROM mentors ORDER BY name`),
      sql(`SELECT mentor_id, team_id FROM conflicts`),
    ]);
    const connected = connectedCheck(mentors, conflicts);
    const rows = teams.map(t => {
      // A judge connected to the team never counts, even if they scored before declaring it.
      // The average is over the judges who did score, so abstaining never pulls a team down.
      const all = scores.filter(s => s.team_id === t.id);
      const counted = all.filter(s => !connected(s.mentor_id, t));
      const exact = k => counted.length ? counted.reduce((a, s) => a + s[k], 0) / counted.length : null;
      const shown = k => exact(k) == null ? null : Math.round(exact(k) * 10) / 10;
      return {
        id: t.id, code: t.code, name: t.name, type: t.type, table: t.table_no || '',
        judges: counted.length,
        avg: exact('total') == null ? null : Math.round(exact('total') * 100) / 100, exact: exact('total'),
        criteria: Object.fromEntries(RUBRIC.map(r => [r.id, shown(r.id)])),
        exactCriteria: Object.fromEntries(RUBRIC.map(r => [r.id, exact(r.id)])),
        sheets: all.map(s => ({ judgeId: s.mentor_id, judge: s.judge, total: s.total, note: s.note, excluded: !counted.includes(s), ...Object.fromEntries(RUBRIC.map(r => [r.id, s[r.id]])) })),
        waiting: mentors.filter(m => m.active && !all.some(s => s.mentor_id === m.id) && !connected(m.id, t)).map(m => m.name),
        abstain: mentors.filter(m => m.active && connected(m.id, t)).map(m => m.name),
      };
    });
    // Normalised score: each judge's totals as z-scores against their own mean and spread across the
    // finalists, averaged per team and put back on the rubric's scale. Evens out generous vs strict judges
    // when teams are scored by different subsets of judges. Shown alongside; ranking stays on the average.
    const byJudge = new Map();
    for (const t of teams) for (const s of scores.filter(x => x.team_id === t.id && !connected(x.mentor_id, t))) {
      if (!byJudge.has(s.mentor_id)) byJudge.set(s.mentor_id, []);
      byJudge.get(s.mentor_id).push(s.total);
    }
    const jstat = new Map([...byJudge].map(([id, v]) => {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return [id, { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1 }];
    }));
    const stats = [...jstat.values()];
    const gm = stats.length ? stats.reduce((a, b) => a + b.m, 0) / stats.length : 0, gsd = stats.length ? stats.reduce((a, b) => a + b.sd, 0) / stats.length : 0;
    for (const r of rows) {
      const counted = scores.filter(x => x.team_id === r.id && !connected(x.mentor_id, teams.find(t => t.id === r.id)));
      r.normalised = counted.length ? Math.round((gm + gsd * counted.reduce((a, s) => a + (s.total - jstat.get(s.mentor_id).m) / jstat.get(s.mentor_id).sd, 0) / counted.length) * 100) / 100 : null;
    }
    const normOrder = [...rows].filter(r => r.normalised != null).sort((a, b) => b.normalised - a.normalised);
    normOrder.forEach((r, i) => { r.normalisedRank = i + 1; });
    // Rank on the exact average; ties: higher first rubric criterion, then the second.
    const [t1, t2] = RUBRIC.map(r => r.id);
    rows.sort((a, b) => (b.exact ?? -1) - (a.exact ?? -1) || (b.exactCriteria[t1] ?? 0) - (a.exactCriteria[t1] ?? 0) || (b.exactCriteria[t2] ?? 0) - (a.exactCriteria[t2] ?? 0));
    for (const r of rows) { delete r.exact; delete r.exactCriteria; }
    return { rows, stage: (await getConfig()).stage };
  },

  // Remove one judge's score sheet for one team (e.g. entered for the wrong team).
  async deleteScore({ teamId, mentorId }) {
    const rows = await sql(`DELETE FROM scores WHERE team_id = $1 AND mentor_id = $2 RETURNING total`, [intId(teamId), String(mentorId)]);
    if (!rows.length) throw new HttpError(404, 'That score sheet no longer exists');
    return { deleted: rows[0].total };
  },

  async exportScores() {
    const [rows, mentors, conflicts] = await Promise.all([
      sql(`SELECT s.*, t.code, t.name AS team, t.members, m.name AS judge FROM scores s JOIN teams t ON t.id = s.team_id LEFT JOIN mentors m ON m.id = s.mentor_id ORDER BY t.name, m.name`).then(r => r.map(flatScore)),
      sql(`SELECT id, college FROM mentors`),
      sql(`SELECT mentor_id, team_id FROM conflicts`),
    ]);
    const connected = connectedCheck(mentors, conflicts);
    const head = ['team_code', 'team', 'judge', ...RUBRIC.map(r => `${r.id}_${r.max}`), `total_${RUBRIC_TOTAL}`, 'counted', 'note', 'at'];
    return { csv: [head.join(','), ...rows.map(r => [r.code, r.team, r.judge, ...RUBRIC.map(x => r[x.id]), r.total,
      connected(r.mentor_id, { id: r.team_id, members: r.members }) ? 'no (connected to team)' : 'yes', r.note, new Date(r.at).toISOString()].map(csvCell).join(','))].join('\n') };
  },

  // Mentors tab: how each mentor spent the night.
  async mentorStats() {
    const cfg = await getConfig();
    const [mentors, checks, visits, flags, locks, teams, follows] = await Promise.all([
      sql(`SELECT id, name, skills, active, joined_at FROM mentors ORDER BY name`),
      sql(`SELECT team_id, round, mentor_id, at, started_at, override, answers FROM checkins ORDER BY at`),
      sql(`SELECT team_id, round, mentor_id, at FROM visits ORDER BY at`),
      sql(`SELECT id, team_id, type, source, raised_by, taken_by, at, taken_at, resolved_at, status FROM flags`),
      sql(`SELECT team_id, round, mentor_id, started_at, expires_at FROM locks`),
      sql(`SELECT id, name, table_no FROM teams`),
      sql(`SELECT team_id, mentor_id, round, note, at FROM followups`),
    ]);
    const team = new Map(teams.map(t => [t.id, t]));
    const mins = (a, b) => (new Date(b) - new Date(a)) / 60000;
    const median = xs => { if (!xs.length) return null; const v = [...xs].sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
    const r1 = x => x == null ? null : Math.round(x * 10) / 10;
    const textLen = a => Object.entries(a || {}).filter(([k, v]) => typeof v === 'string' && !['clarity', 'themeRead', 'plan', 'state', 'onTrack', 'works', 'changed', 'recommend', 'demoReady', 'rating'].includes(k)).reduce((n, [, v]) => n + v.length, 0);
    const now = new Date();
    // Started but never submitted: from an earlier round, or started 20+ min ago.
    const isAbandoned = l => l.round !== cfg.liveRound || mins(l.started_at || new Date(new Date(l.expires_at) - LOCK_MINUTES * 60000), now) >= 20;
    const allDur = [], allGap = [], allResolve = [], allHelp = [];
    const rows = mentors.map(m => {
      const mine = checks.filter(c => c.mentor_id === m.id);
      // Time per check-in: Start -> Submit (recorded from 12:40 AM on). Gap: time since their previous
      // submit in the same round, capped at 45 min so breaks don't count; works for every check-in.
      const items = mine.map((c, i) => {
        const prev = [...mine.slice(0, i)].reverse().find(p => p.round === c.round);
        const dur = c.started_at ? mins(c.started_at, c.at) : null;
        const gap = prev && mins(prev.at, c.at) <= 45 ? mins(prev.at, c.at) : null;
        return { kind: 'checkin', teamId: c.team_id, team: team.get(c.team_id)?.name || '?', table: team.get(c.team_id)?.table_no || '', round: c.round,
          start: c.started_at, end: c.at, minutes: r1(dur), gap: r1(gap), override: c.override, recommend: c.answers?.recommend || null };
      });
      const durs = items.map(i => i.minutes).filter(x => x != null && x >= 0 && x < 120);
      const gaps = items.map(i => i.gap).filter(x => x != null);
      allDur.push(...durs); allGap.push(...gaps);
      const away = visits.filter(v => v.mentor_id === m.id);
      const fu = follows.filter(f => f.mentor_id === m.id);
      for (const f of fu) items.push({ kind: 'followup', teamId: f.team_id, team: team.get(f.team_id)?.name || '?', table: team.get(f.team_id)?.table_no || '', round: f.round, end: f.at, what: f.note });
      for (const v of away) items.push({ kind: 'away', teamId: v.team_id, team: team.get(v.team_id)?.name || '?', table: team.get(v.team_id)?.table_no || '', round: v.round, end: v.at });
      const took = flags.filter(f => f.taken_by === m.id);
      // Raised -> resolved (known for every request); picked up -> resolved only where pickup time was recorded.
      const resolveMins = took.filter(f => f.resolved_at).map(f => mins(f.at, f.resolved_at)).filter(x => x >= 0);
      // Helping time: picked up -> resolved. Before pickup times were recorded, estimate the start as
      // the later of when it was raised and this mentor's last other action before resolving it.
      const myActs = [...mine.map(c => c.at), ...visits.filter(v => v.mentor_id === m.id).map(v => v.at),
        ...flags.filter(f => f.raised_by === m.id).map(f => f.at), ...took.filter(f => f.resolved_at).map(f => f.resolved_at)].map(d => new Date(d));
      const helpSpan = f => {
        if (!f.resolved_at) return null;
        const end = new Date(f.resolved_at);
        if (f.taken_at) return { minutes: mins(f.taken_at, end), estimated: false, start: f.taken_at };
        const before = myActs.filter(d => d < end).sort((a, b) => b - a)[0];
        const start = new Date(Math.max(new Date(f.at), before ? before.getTime() : 0));
        return { minutes: mins(start, end), estimated: true, start };
      };
      const spans = took.map(f => [f, helpSpan(f)]);
      const helpWork = spans.filter(([, h]) => h && h.minutes >= 0).map(([, h]) => h);
      allResolve.push(...resolveMins);
      for (const [f, h] of spans) items.push({ kind: 'help', teamId: f.team_id, team: team.get(f.team_id)?.name || '?', table: team.get(f.team_id)?.table_no || '', what: f.type,
        start: h?.start || f.taken_at || f.at, end: f.resolved_at, minutes: h && h.minutes >= 0 ? r1(h.minutes) : null, estimated: !!h?.estimated, open: !f.resolved_at });
      const abandoned = locks.filter(l => l.mentor_id === m.id && isAbandoned(l));
      for (const l of abandoned) items.push({ kind: 'abandoned', teamId: l.team_id, team: team.get(l.team_id)?.name || '?', table: team.get(l.team_id)?.table_no || '', round: l.round, start: l.started_at });
      items.sort((a, b) => new Date(b.end || b.start) - new Date(a.end || a.start));
      const r3 = mine.filter(c => c.round === 3);
      const acts = [...mine.map(c => c.at), ...away.map(v => v.at), ...took.map(f => f.resolved_at || f.taken_at || f.at)].map(d => new Date(d)).sort((a, b) => a - b);
      const byRound = Object.fromEntries([1, 2, 3, 4].map(n => [n, mine.filter(c => c.round === n).length]));
      const helpMinutes = helpWork.reduce((a, h) => a + h.minutes, 0);
      allHelp.push(...helpWork);
      const minutesTotal = durs.reduce((a, b) => a + b, 0) + helpMinutes;
      return {
        id: m.id, name: m.name, skills: m.skills, active: m.active,
        checkins: mine.length, byRound, teams: new Set(items.filter(i => i.kind !== 'abandoned').map(i => i.teamId)).size,
        avgMinutes: r1(durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null), measured: durs.length,
        medianGap: r1(median(gaps)),
        timeOnTeams: durs.length || helpWork.length ? r1(minutesTotal) : null,
        helpMinutes: helpWork.length ? r1(helpMinutes) : null, helpEstimated: helpWork.some(h => h.estimated), stillHelping: took.filter(f => !f.resolved_at).length,
        away: away.length, followups: fu.length, helpRaised: flags.filter(f => f.raised_by === m.id && f.source !== 'checkin').length,
        helpTaken: took.length, helpResolved: resolveMins.length, medianResolve: r1(median(resolveMins)),
        abandoned: abandoned.length, overrides: mine.filter(c => c.override).length,
        recommendYes: r3.length ? Math.round(r3.filter(c => c.answers?.recommend === 'Yes').length / r3.length * 100) : null,
        noteChars: mine.length ? Math.round(mine.reduce((n, c) => n + textLen(c.answers), 0) / mine.length) : null,
        first: acts[0] || null, last: acts[acts.length - 1] || null,
        items,
      };
    });
    const visited = new Set([...checks.map(c => c.team_id), ...visits.map(v => v.team_id)]);
    return {
      liveRound: cfg.liveRound,
      summary: {
        checkins: checks.length, mentors: mentors.filter(m => m.active).length,
        avgMinutes: r1(allDur.length ? allDur.reduce((a, b) => a + b, 0) / allDur.length : null), measured: allDur.length,
        medianGap: r1(median(allGap)),
        helpResolved: allResolve.length, medianResolve: r1(median(allResolve)),
        helpMinutes: allHelp.length ? r1(allHelp.reduce((a, h) => a + h.minutes, 0)) : null, helpEstimated: allHelp.some(h => h.estimated),
        medianHelp: r1(median(allHelp.map(h => h.minutes))),
        helpOpen: flags.filter(f => f.status === 'open').length,
        abandoned: locks.filter(isAbandoned).length,
        teamsNeverVisited: teams.filter(t => !visited.has(t.id)).length, teams: teams.length,
      },
      rows,
    };
  },

  async setMentor({ id, active }) {
    await sql(`UPDATE mentors SET active = $2 WHERE id = $1`, [String(id), !!active]);
    return {};
  },

  async removeMentor({ id }) {
    await sql(`DELETE FROM mentors WHERE id = $1`, [String(id)]);
    await sql(`DELETE FROM locks WHERE mentor_id = $1`, [String(id)]);
    return {};
  },

  async assignFlag({ id, mentorId }) {
    await sql(`UPDATE flags SET status = 'taken', taken_by = $2, taken_at = now() WHERE id = $1`, [intId(id), String(mentorId)]);
    return {};
  },

  async resolveFlag({ id }) {
    await sql(`UPDATE flags SET status = 'resolved', resolved_at = now() WHERE id = $1`, [intId(id)]);
    return {};
  },

  async board() {
    const cfg = await getConfig();
    return { rows: await boardData(), picksLocked: cfg.picksLocked, stage: cfg.stage };
  },

  async star({ id, starred }) {
    id = intId(id);
    if (starred) await sql(`INSERT INTO shortlist (team_id) VALUES ($1) ON CONFLICT (team_id) DO UPDATE SET starred = true, at = now()`, [id]);
    else await sql(`DELETE FROM shortlist WHERE team_id = $1`, [id]);
    return {};
  },

  async teams({ q }) {
    q = clean(q, 60).toLowerCase();
    const rows = await sql(`SELECT id, code, name, type, members, table_no, hidden FROM teams WHERE ($1 = '' OR search LIKE '%' || $1 || '%' OR lower(coalesce(code,'')) LIKE '%' || $1 || '%') ORDER BY name LIMIT 60`, [q]);
    return { rows };
  },

  // Add or edit one team. Type follows the number of people.
  async saveTeam({ id, code, name, members, table, type: given, hidden }) {
    name = clean(name, 80);
    if (!name) bad('Add a team name');
    code = clean(code, 20) || null;
    table = clean(table, 30);
    const ms = (Array.isArray(members) ? members : [])
      .map(m => ({ name: clean(m?.name, 80), college: clean(m?.college, 120) }))
      .filter(m => m.name);
    if (ms.length > 10) bad('A team can have at most 10 people');
    // Names can be added later; until then the type says how many they are.
    if (!ms.length && !['solo', 'duo', 'team'].includes(given)) bad('Add at least one person');
    const type = ms.length ? (ms.length === 1 ? 'solo' : ms.length === 2 ? 'duo' : 'team') : given;
    const search = [name, table ? `table ${table}` : '', ...ms.map(m => m.name)].join(' ').toLowerCase();
    id = id ? intId(id) : null;
    if (code) {
      const [taken] = await sql(`SELECT name FROM teams WHERE lower(code) = lower($1) AND ($2::int IS NULL OR id <> $2)`, [code, id]);
      if (taken) bad(`Code ${code} is already used by ${taken.name}`);
    }
    const [dup] = await sql(`SELECT 1 FROM teams WHERE lower(name) = lower($1) AND ($2::int IS NULL OR id <> $2)`, [name, id]);
    if (dup) bad(`There is already a team called ${name}`);
    let row;
    if (id) {
      [row] = await sql(`UPDATE teams SET code = coalesce($2, code), name = $3, type = $4, members = $5::jsonb, search = $6, table_no = $7, hidden = coalesce($8, hidden) WHERE id = $1 RETURNING id`,
        [id, code, name, type, JSON.stringify(ms), search, table, hidden == null ? null : !!hidden]);
      if (!row) throw new HttpError(404, 'Team not found');
    } else {
      [row] = await sql(`INSERT INTO teams (code, name, type, members, search, table_no) VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id`,
        [code, name, type, JSON.stringify(ms), search, table]);
      if (!code) await sql(`UPDATE teams SET code = 'S-' || id WHERE id = $1`, [row.id]);
    }
    return { id: row.id };
  },

  // Removes the team and everything recorded about it (check-ins, help requests, scores…).
  async deleteTeam({ id }) {
    id = intId(id);
    for (const t of ['checkins', 'visits', 'followups', 'locks', 'conflicts', 'flags', 'shortlist', 'nominations', 'scores']) await sql(`DELETE FROM ${t} WHERE team_id = $1`, [id]);
    await sql(`UPDATE picks SET first_team = NULL, first_why = NULL WHERE first_team = $1`, [id]);
    await sql(`UPDATE picks SET second_team = NULL, second_why = NULL WHERE second_team = $1`, [id]);
    await sql(`DELETE FROM teams WHERE id = $1`, [id]);
    return {};
  },

  // Organizer corrections to what mentors entered. Deleting a check-in makes the team due again for that round.
  async editCheckin({ teamId, round, answers }) {
    const rows = await sql(`UPDATE checkins SET answers = $3::jsonb, edited_at = now() WHERE team_id = $1 AND round = $2 RETURNING team_id`,
      [intId(teamId), Number(round), JSON.stringify(cleanAnswers(answers))]);
    if (!rows.length) throw new HttpError(404, 'That check-in no longer exists');
    return {};
  },

  // A mentor filed a check-in under the wrong team: move it (and the help requests it created) to the right one.
  async moveCheckin({ fromId, toId, round }) {
    fromId = intId(fromId); toId = intId(toId); round = Number(round);
    if (fromId === toId) bad('Pick a different team');
    const [to] = await sql(`SELECT name FROM teams WHERE id = $1`, [toId]);
    if (!to) throw new HttpError(404, 'Team not found');
    const [taken] = await sql(`SELECT 1 FROM checkins WHERE team_id = $1 AND round = $2`, [toId, round]);
    if (taken) bad(`${to.name} already has a check-in ${round}. Delete one of them first.`);
    const moved = await transaction(async q => {
      const rows = await q(`UPDATE checkins SET team_id = $2, edited_at = now() WHERE team_id = $1 AND round = $3 RETURNING mentor_id`, [fromId, toId, round]);
      if (!rows.length) bad(`No check-in ${round} on that team`);
      const flags = await q(`UPDATE flags SET team_id = $2 WHERE team_id = $1 AND source = 'checkin' AND round = $3 AND raised_by = $4 RETURNING id`, [fromId, toId, round, rows[0].mentor_id]);
      await q(`DELETE FROM locks WHERE team_id = $1 AND round = $2`, [toId, round]);
      return { help: flags.length };
    });
    return { moved: true, to: to.name, ...moved };
  },

  async deleteCheckin({ teamId, round }) {
    await sql(`DELETE FROM checkins WHERE team_id = $1 AND round = $2`, [intId(teamId), Number(round)]);
    return {};
  },

  async deleteVisit({ id }) {
    await sql(`DELETE FROM visits WHERE id = $1`, [intId(id)]);
    return {};
  },

  async deleteFlag({ id }) {
    await sql(`DELETE FROM flags WHERE id = $1`, [intId(id)]);
    return {};
  },

  async approaches({ q }) {
    q = clean(q, 60).toLowerCase();
    const [teams, by] = await Promise.all([
      sql(`SELECT id, code, name, table_no, hidden FROM teams WHERE $1 = '' OR search LIKE '%' || $1 || '%' OR lower(coalesce(code,'')) LIKE '%' || $1 || '%' ORDER BY name`, [q]),
      approachesBy(),
    ]);
    return { rows: teams.map(t => ({ ...t, mentors: by.get(t.id) || [] })) };
  },

  async timeline({ id }) {
    id = intId(id);
    const [[team], checks, visits, flags, board, approached, follows] = await Promise.all([
      sql(`SELECT * FROM teams WHERE id = $1`, [id]),
      sql(`SELECT c.*, m.name AS mentor FROM checkins c LEFT JOIN mentors m ON m.id = c.mentor_id WHERE c.team_id = $1 ORDER BY c.round`, [id]),
      sql(`SELECT v.*, m.name AS mentor FROM visits v LEFT JOIN mentors m ON m.id = v.mentor_id WHERE v.team_id = $1 ORDER BY v.at`, [id]),
      sql(`SELECT f.*, r.name AS raised_name, k.name AS taken_name FROM flags f LEFT JOIN mentors r ON r.id = f.raised_by LEFT JOIN mentors k ON k.id = f.taken_by WHERE f.team_id = $1 ORDER BY f.at`, [id]),
      boardData(),
      approachesBy(id),
      sql(`SELECT f.*, m.name AS mentor FROM followups f LEFT JOIN mentors m ON m.id = f.mentor_id WHERE f.team_id = $1 ORDER BY f.at`, [id]),
    ]);
    if (!team) throw new HttpError(404, 'Team not found');
    return {
      team,
      approached: approached.get(id) || [],
      summary: board.find(r => r.id === id),
      checkins: checks.map(c => ({ round: c.round, mentor: c.mentor, at: c.at, override: c.override, answers: c.answers, editedAt: c.edited_at || null })),
      visits: visits.map(v => ({ id: v.id, round: v.round, mentor: v.mentor, at: v.at })),
      followups: follows.map(f => ({ round: f.round, mentor: f.mentor, note: f.note, at: f.at })),
      flags: flags.map(f => ({ id: f.id, type: f.type, note: f.note, at: f.at, status: f.status, raisedBy: f.raised_name, takenBy: f.taken_name, resolvedAt: f.resolved_at, round: f.round })),
    };
  },

  async saveConfig({ rounds, organizerPhone, picksLockAt, picksLocked, skippedRounds }) {
    const patch = {};
    if (Array.isArray(skippedRounds)) patch.skippedRounds = [...new Set(skippedRounds.map(Number).filter(n => [1, 2, 3, 4].includes(n)))];
    if (Array.isArray(rounds)) patch.rounds = rounds.slice(0, 4).map((r, i) => ({ n: i + 1, title: clean(r.title, 40) || DEFAULT_CONFIG.rounds[i].title, time: clean(r.time, 20) }));
    if (organizerPhone !== undefined) patch.organizerPhone = clean(organizerPhone, 30);
    if (picksLockAt !== undefined) patch.picksLockAt = clean(picksLockAt, 20);
    if (picksLocked !== undefined) patch.picksLocked = !!picksLocked;
    return setConfig(patch);
  },

  async setup() {
    const [cfg, mentors, [counts]] = await Promise.all([
      getConfig(),
      sql(`SELECT id, name, college, skills, active, joined_at FROM mentors ORDER BY joined_at`),
      sql(`SELECT count(*)::int AS teams, coalesce(sum(greatest(jsonb_array_length(members), CASE WHEN type = 'duo' THEN 2 ELSE 1 END)),0)::int AS people,
                  count(*) FILTER (WHERE type = 'solo')::int AS solos FROM teams WHERE NOT coalesce(hidden, false)`),
    ]);
    return { config: cfg, mentors, counts, codeRequired: !!process.env.MENTOR_CODE, mentorCode: process.env.MENTOR_CODE || '' };
  },

  async importTeams({ rows }) {
    if (!Array.isArray(rows) || !rows.length) bad('No rows found in the file');
    const groups = new Map();
    let solo = 0;
    for (const r of rows) {
      const person = clean(r.name, 80);
      if (!person) continue;
      const teamName = clean(r.teamName, 80);
      const key = teamName ? teamName.toLowerCase() : `solo:${++solo}`;
      if (!groups.has(key)) groups.set(key, { name: teamName || person, teamNo: clean(r.teamNo, 20), members: [] });
      const g = groups.get(key);
      if (!g.teamNo && r.teamNo) g.teamNo = clean(r.teamNo, 20);
      g.members.push({ name: person, college: clean(r.college, 120) });
    }
    const existing = await sql(`SELECT id, code, lower(name) AS lname FROM teams`);
    const byCode = new Map(existing.filter(e => e.code).map(e => [e.code, e.id]));
    const byName = new Map(existing.map(e => [e.lname, e.id]));
    const inserts = [], updates = [];
    for (const g of groups.values()) {
      const code = g.teamNo ? (/^\d+$/.test(g.teamNo) ? `T-${g.teamNo.padStart(3, '0')}` : g.teamNo) : null;
      const type = g.members.length === 1 ? 'solo' : g.members.length === 2 ? 'duo' : 'team';
      const search = [g.name, ...g.members.map(m => m.name)].join(' ').toLowerCase();
      const rec = { code, name: g.name, type, members: g.members, search };
      const id = (code && byCode.get(code)) || byName.get(g.name.toLowerCase());
      if (id) updates.push({ id, ...rec }); else inserts.push(rec);
    }
    if (inserts.length) {
      await sql(`INSERT INTO teams (code, name, type, members, search)
                 SELECT code, name, type, members, search FROM jsonb_to_recordset($1::jsonb) AS x(code text, name text, type text, members jsonb, search text)`,
        [JSON.stringify(inserts)]);
    }
    if (updates.length) {
      await sql(`UPDATE teams t SET code = coalesce(x.code, t.code), name = x.name, type = x.type, members = x.members, search = x.search
                 FROM jsonb_to_recordset($1::jsonb) AS x(id int, code text, name text, type text, members jsonb, search text) WHERE t.id = x.id`,
        [JSON.stringify(updates)]);
    }
    await sql(`UPDATE teams SET code = 'S-' || id WHERE code IS NULL`);
    return { added: inserts.length, updated: updates.length, people: rows.length };
  },

  // Practice data so mentors can try the app before the event. "Reset event data" removes it (codes D-xx).
  async seedDemo() {
    const names = EVENT.practiceTeams;
    const people = ['Asha', 'Binu', 'Chitra', 'Dev', 'Esha', 'Fahad', 'Gauri', 'Hari', 'Irfan', 'Jyothi', 'Kiran', 'Lekha', 'Manu', 'Nila',
      'Omar', 'Priya', 'Rahul', 'Sana', 'Tom', 'Uma', 'Vivek', 'Wafa', 'Yadu', 'Zara', 'Anand', 'Bhavya', 'Cyril', 'Diya', 'Eldho', 'Fathima',
      'Gokul', 'Hiba', 'Ishaan', 'Jasmin', 'Kavya', 'Lijo', 'Meera', 'Nihal', 'Ojas', 'Parvathy', 'Rohan', 'Sreya', 'Thomas', 'Vava'];
    const colleges = ['GEC Kozhikode', 'CET, Trivandrum', 'MEC, Kochi', 'NSS CE, Palakkad', 'Christ CE, Thrissur', 'TKM CE, Kollam', 'NIT Calicut', 'MACE, Kothamangalam'];
    const rows = [];
    let p = 0;
    names.forEach((team, i) => {
      const code = `D-${String(i + 1).padStart(2, '0')}`;
      const size = i % 3 === 2 ? 1 : 2;
      const college = colleges[i % colleges.length];
      for (let k = 0; k < size; k++) rows.push({ teamNo: code, teamName: size === 1 ? '' : team, name: `${people[p++ % people.length]} (demo)`, college });
    });
    // Solo rows are named after the person; give them the team name instead so practice reads better.
    for (const r of rows) if (!r.teamName) r.teamName = names[Number(r.teamNo.slice(2)) - 1];
    const out = await organizerActions.importTeams({ rows });
    const demo = await sql(`SELECT id, name FROM teams WHERE code LIKE 'D-%'`);
    const byName = Object.fromEntries(demo.map(t => [t.name, t.id]));
    const open = await sql(`SELECT count(*)::int AS n FROM flags`);
    if (!open[0].n) {
      await sql(`INSERT INTO flags (team_id, type, skill, note, source, at) VALUES
        ($1, 'Hardware issue', 'Hardware', 'Practice: servo keeps resetting the ESP32. Near the stage, left side.', 'flag', now() - interval '18 minutes'),
        ($2, 'Idea unclear', 'Idea refinement', 'Practice: two ideas, can''t pick one. Back row.', 'flag', now() - interval '4 minutes')`,
        [byName[names[6 % names.length]], byName[names[11 % names.length]]]);
    }
    const cfg = await getConfig();
    await setConfig({ practice: true, liveRound: cfg.liveRound || 1, stage: 'night' });
    return out;
  },

  async reset({ confirm, teamsToo }) {
    if (confirm !== 'RESET') bad('Type RESET to confirm');
    for (const t of ['checkins', 'visits', 'followups', 'locks', 'conflicts', 'flags', 'picks', 'shortlist', 'nominations', 'scores']) await sql(`DELETE FROM ${t}`);
    await sql(`DELETE FROM teams WHERE code LIKE 'D-%'`);
    if (teamsToo) await sql(`DELETE FROM teams`);
    await setConfig({ liveRound: 0, picksLocked: false, stage: 'night', practice: false });
    return {};
  },

  // Full copy of every table, downloaded from Setup. Restore puts it all back.
  async backup() {
    if (DEMO) bad('Backups are switched off in the public demo');
    const tables = {};
    for (const t of BACKUP_TABLES) tables[t] = await sql(`SELECT * FROM ${t}`);
    return { app: 'mentor-desk', version: 2, at: new Date().toISOString(), tables };
  },

  async restore({ backup, confirm }) {
    if (DEMO) bad('Restore is switched off in the public demo');
    if (confirm !== 'RESTORE') bad('Type RESTORE to confirm');
    if (backup?.app !== 'mentor-desk' || backup.version !== 2 || typeof backup.tables !== 'object') bad('This is not a Mentor Desk backup file (or it is from an older version)');
    for (const t of BACKUP_TABLES) if (!Array.isArray(backup.tables[t] ?? [])) bad(`Backup is damaged (${t})`);
    // One transaction: if anything fails, the live data stays exactly as it was.
    await transaction(async q => {
      for (const t of BACKUP_TABLES) await q(`DELETE FROM ${t}`);
      // (any error below rolls everything back)
      for (const t of BACKUP_TABLES) {
        const rows = backup.tables[t] || [];
        if (rows.length) await q(`INSERT INTO ${t} SELECT * FROM jsonb_populate_recordset(NULL::${t}, $1::jsonb)`, [JSON.stringify(rows)]);
      }
      for (const t of ['teams', 'flags']) {
        await q(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), coalesce((SELECT max(id) FROM ${t}), 0) + 1, false)`);
      }
    }).catch(e => {
      console.error('restore failed', e);
      bad('Restore failed and nothing was changed. The backup file may be damaged or edited.');
    });
    const counts = Object.fromEntries(BACKUP_TABLES.map(t => [t, (backup.tables[t] || []).length]));
    return { counts, at: backup.at };
  },

  async exportCsv() {
    const rows = await sql(`SELECT c.*, t.code, t.name AS team, m.name AS mentor FROM checkins c JOIN teams t ON t.id = c.team_id LEFT JOIN mentors m ON m.id = c.mentor_id ORDER BY t.name, c.round`);
    const keys = [...new Set(rows.flatMap(r => Object.keys(r.answers || {})))];
    const head = ['team_code', 'team', 'round', 'mentor', 'at', 'check_anyway_reason', ...keys];
    const lines = [head.join(',')];
    for (const r of rows) lines.push([r.code, r.team, r.round, r.mentor, new Date(r.at).toISOString(), r.override, ...keys.map(k => r.answers?.[k])].map(csvCell).join(','));
    return { csv: lines.join('\n') };
  },

  async exportFinalists() {
    const rows = (await boardData()).filter(r => r.starred);
    const head = ['code', 'team', 'type', 'points', 'top_two_picks', 'demo_ready'];
    return { csv: [head.join(','), ...rows.map(r => [r.code, r.name, r.type, r.points, r.picks, r.demoReady].map(csvCell).join(','))].join('\n') };
  },
};

export { mentorFromToken };
