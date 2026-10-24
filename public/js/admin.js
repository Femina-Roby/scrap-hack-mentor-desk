import { rpc, esc, fmtTime, toast, tableLabel, FORMS, RUBRIC, RUBRIC_TOTAL, CONFIG, JUDGING } from './shared.js';

const EV = CONFIG.event, ST = CONFIG.judging.stages;
const SLUG = String(EV.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
document.title = `${EV.name} · Organizer`;
{ const b = document.querySelector('.brand'); if (b) b.innerHTML = `${esc(EV.name)}<small>Organizer · Mentor desk</small>`; }

const $main = document.getElementById('main');
const $top = document.getElementById('top');
let pw = (() => { try { return localStorage.getItem('md_admin') || ''; } catch { return ''; } })();
let timer = null;

const api = (action, args) => rpc(`o.${action}`, args, { 'X-Admin': pw }).catch(e => {
  if (e.status === 401) { pw = ''; try { localStorage.removeItem('md_admin'); } catch {} gate(e.message); }
  throw e;
});
const stamp = () => { document.getElementById('updated').textContent = `Updated ${fmtTime(new Date().toISOString())}`; };
const download = (name, text, type = 'text/csv') => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

function gate(msg = '') {
  clearInterval(timer);
  $top.hidden = true;
  $main.innerHTML = `<form class="gate card" id="g">
    <div class="eyebrow">Organizer</div><h1 class="out-text" style="font-size:2.6rem">${esc(EV.name)}</h1>
    ${msg ? `<div class="notice warn small">${esc(msg)}</div>` : ''}
    <label class="field"><span class="label">Organizer password</span><input class="input" type="password" name="pw" autofocus></label>
    <button class="btn btn-primary">Open dashboard</button></form>`;
  document.getElementById('g').onsubmit = async e => {
    e.preventDefault();
    pw = e.target.pw.value;
    try { await api('setup'); try { localStorage.setItem('md_admin', pw); } catch {} route(); } catch (err) { if (err.status !== 401) toast(err.message, true); }
  };
}

// ---------------- Live ----------------

async function viewLive() {
  const load = async () => {
    let d;
    try { d = await api('live'); } catch (e) { return; }
    stamp();
    const night = d.config.stage === 'night';
    const live = night ? d.config.liveRound : -1;
    const t = d.totals;
    const mentorOpts = d.mentors.filter(m => m.active).map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    $main.innerHTML = `
      ${d.demo ? `<div class="notice info"><b>Public demo.</b> Click anything: open rounds${JUDGING ? ', switch to judging' : ''}, edit teams. Everything resets to a fresh event every hour. Backup and restore are switched off.</div>` : ''}
      ${d.config.practice && !d.demo ? `<div class="notice warn row-inline" style="justify-content:space-between"><span><b>Practice data is loaded.</b> Mentors see a "Practice run" banner. Before the event, go to Setup → Reset event data.</span><a class="btn btn-sm" href="#/setup">Setup</a></div>` : ''}
      <div class="row-inline" style="justify-content:space-between">
        <h1 class="display">Live</h1>
        <div class="row-inline small"><span><b>${t.teams}</b> teams</span>·<span><b>${t.people}</b> people</span>·<span><b>${t.active}</b> mentors active</span>·<span>target <b>${t.target}</b> each</span></div>
      </div>
      <section>
        <div class="row-inline" style="justify-content:space-between;margin-bottom:10px"><span class="eyebrow">Rounds · click to make a round live for all mentors</span>
          ${live > 0 ? `<button class="link small" data-round="0">Pause all check-ins</button>` : `<span class="small muted">${night ? 'No round live' : 'Morning judging is on'}</span>`}</div>
        <div class="grid g4">${d.rounds.map(r => (d.config.skippedRounds || []).includes(r.n) ? `
          <div class="round" style="opacity:.55;box-shadow:none;border-style:dashed;cursor:default">
            <span class="eyebrow">${r.n} · ${esc(r.title)} · SKIPPED</span>
            <span class="t" style="text-decoration:line-through">${esc(r.time)}</span>
            <span class="small">${r.n === 2 ? 'Its questions are in check-in 3' : 'Not running'}</span>
            <button class="link small" data-unskip="${r.n}" style="align-self:flex-start">Un-skip</button>
          </div>` : `
          <button class="round${r.n === live ? ' live' : ''}" data-round="${r.n}">
            <span class="eyebrow">${r.n} · ${esc(r.title)}${r.n === live ? ' · LIVE' : ''}</span>
            <span class="t">${esc(r.time)}</span>
            <span class="small">${r.done || r.n <= d.config.liveRound ? `<b>${r.done} / ${t.teams}</b> done${r.away ? ` · ${r.away} away` : ''}` : 'Not started'}</span>
            <span class="bar"><i style="width:${t.teams ? Math.round(r.done / t.teams * 100) : 0}%"></i></span>
          </button>`).join('')}</div>
      </section>
      ${JUDGING ? `<section>
        <div class="row-inline" style="justify-content:space-between;margin-bottom:10px"><span class="eyebrow">Morning judging · click to switch every mentor's phone</span>
          <a class="link small" href="#/scores">See scores →</a></div>
        <div class="grid g4">${[
          ...(CONFIG.judging.booths === false ? [] : [['booths', `Round 1 · ${ST.booths.title}`, ST.booths.time, 'Judges see every project and nominate']]),
          ['shortlist', ST.shortlist.title, ST.shortlist.time, `Star ~${CONFIG.judging.shortlistSize} finalists on the Finalists tab`],
          ['finals', 'Round 2 · Finalist scoring', ST.finals.time, `Judges score each finalist out of ${RUBRIC_TOTAL}`],
          ['done', 'Close scoring', ST.done.time, 'Lock scores for deliberation'],
        ].map(([k, title, time, sub]) => `
          <button class="round${d.config.stage === k ? ' live' : ''}" data-stage="${k}">
            <span class="eyebrow">${title}${d.config.stage === k ? ' · LIVE' : ''}</span>
            <span class="t">${time}</span><span class="small">${sub}</span>
          </button>`).join('')}</div>
      </section>` : ''}
      <div class="grid g2">
        <section class="card">
          <h2>Needs attention · ${d.attention.length}</h2>
          <div style="margin-top:8px">${d.attention.length ? d.attention.map(a => `
            <div class="att">
              <div><a href="#/teams/${a.teamId}"><b>${esc(a.team)}</b></a>${a.table ? ` <span class="tag">${esc(tableLabel(a.table))}</span>` : ''} <span class="muted">· ${esc(a.what)}</span>
                <div class="small muted">${a.kind === 'flag' ? `open ${a.minutes} min · ${a.takenBy ? `${esc(a.takenBy)} on it` : '<b style="color:var(--red)">no one on it</b>'}` : ''}
                  ${a.kind === 'away' ? a.ats.map(fmtTime).join(', ') : ''}${a.note ? ` · “${esc(a.note)}”` : ''}</div></div>
              <div class="row-inline" style="flex-wrap:nowrap">${a.kind === 'flag' ? `
                <select class="sel-sm" data-assign="${a.flagId}"><option value="">Assign…</option>${mentorOpts}</select>
                <button class="btn btn-sm" data-resolve="${a.flagId}">Resolve</button>` : `<a class="btn btn-sm" href="#/teams/${a.teamId}">Open</a>`}</div>
            </div>`).join('') : '<p class="muted" style="padding:12px 0">All quiet.</p>'}</div>
          <p class="small faint" style="margin-top:8px">From open help requests, “On track = No” at check-in 2 or 3, unclear plan at check-in 1, and teams away 2+ times.</p>
        </section>
        <section class="card">
          <h2>Mentors${live ? ` · round ${live}` : ''}</h2>
          ${live ? (() => { const n = d.mentors.filter(m => m.now?.nudge).length; return n ? `<div class="notice warn small" style="margin-top:8px"><b>${n} mentor${n === 1 ? '' : 's'} may need a nudge.</b> Shown first below.</div>` : `<div class="notice small" style="margin-top:8px">Everyone is moving.</div>`; })() : ''}
          <div style="overflow-x:auto"><table style="margin-top:8px"><thead><tr><th>Mentor</th><th>Now</th><th>Done</th><th></th></tr></thead><tbody>
          ${[...d.mentors].sort((a, b) => (b.now?.nudge ? 1 : 0) - (a.now?.nudge ? 1 : 0)).map(m => `<tr><td><b>${esc(m.name)}</b><div class="small faint">${esc(m.skills.join(', ') || m.college || '')}</div></td>
            <td class="small">${m.now ? `<span style="${m.now.nudge ? 'color:var(--red);font-weight:700' : m.now.busy ? 'color:var(--blue-deep)' : ''}">${esc(m.now.text)}</span>` : `<span class="faint">${m.active ? '–' : 'Paused'}</span>`}</td><td><b>${m.done}</b></td>
            <td><button class="btn btn-sm" data-pause="${esc(m.id)}" data-active="${m.active}">${m.active ? 'Pause' : 'Resume'}</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No mentors yet. Share the app link.</td></tr>'}
          </tbody></table></div>
          <p class="small faint" style="margin-top:8px">Nudge = on one team 15+ min, no check-in 10+ min into the round, or quiet for 20+ min. Paused mentors don't count toward the per-mentor target.</p>
        </section>
      </div>
      ${live ? `<section class="card">
        <div class="row-inline" style="justify-content:space-between"><h2>Unchecked in round ${live} · ${d.unchecked.length}</h2>
          <input class="input sm" id="uf" placeholder="Filter…" style="max-width:240px"></div>
        <div id="ul" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin-top:12px"></div>
      </section>` : ''}`;
    const ul = document.getElementById('ul');
    if (ul) {
      const draw = f => {
        ul.innerHTML = d.unchecked.filter(u => !f || u.name.toLowerCase().includes(f)).map(u =>
          `<a href="#/teams/${u.id}" class="notice small" style="text-decoration:none;padding:10px 12px"><b>${esc(u.name)}</b> <span class="muted">· ${u.table ? `${esc(tableLabel(u.table))} · ` : ''}${esc(u.type)}${u.awayAt ? ` · away ${fmtTime(u.awayAt)}` : ''}</span></a>`).join('');
      };
      draw('');
      document.getElementById('uf').oninput = e => draw(e.target.value.toLowerCase());
    }
    $main.querySelectorAll('[data-round]').forEach(b => b.onclick = async () => {
      const n = Number(b.dataset.round);
      if (n === live) return;
      const msg = n === 0 ? 'Pause all check-ins? Mentor phones will show "check-ins open soon".' : `Make check-in ${n} live for every mentor now?`;
      if (!confirm(msg)) return;
      await api('setRound', { n }).catch(e => toast(e.message, true));
      toast(n ? `Check-in ${n} is live` : 'Check-ins paused'); load();
    });
    $main.querySelectorAll('[data-unskip]').forEach(b => b.onclick = async () => {
      const n = Number(b.dataset.unskip);
      if (!confirm(`Un-skip check-in ${n}? You can then make it live like any other round.`)) return;
      await api('saveConfig', { skippedRounds: (d.config.skippedRounds || []).filter(x => x !== n) }).catch(e => toast(e.message, true));
      load();
    });
    $main.querySelectorAll('[data-stage]').forEach(b => b.onclick = async () => {
      const k = b.dataset.stage;
      if (k === 'shortlist') { location.hash = '#/finalists'; return; }
      if (k === d.config.stage) return;
      const msg = { booths: 'Start booth judging? Mentor phones switch to the judging screen.', finals: 'Open finalist scoring? Judges will see only the starred teams.', done: 'Close scoring? Judges can no longer change scores.' }[k];
      if (!confirm(msg)) return;
      await api('setStage', { stage: k }).catch(e => toast(e.message, true));
      toast('Switched'); load();
    });
    $main.querySelectorAll('[data-assign]').forEach(s => s.onchange = async () => {
      if (!s.value) return;
      await api('assignFlag', { id: s.dataset.assign, mentorId: s.value }).catch(e => toast(e.message, true));
      toast('Assigned'); load();
    });
    $main.querySelectorAll('[data-resolve]').forEach(b => b.onclick = async () => {
      await api('resolveFlag', { id: b.dataset.resolve }).catch(e => toast(e.message, true)); load();
    });
    $main.querySelectorAll('[data-pause]').forEach(b => b.onclick = async () => {
      await api('setMentor', { id: b.dataset.pause, active: b.dataset.active !== 'true' }).catch(e => toast(e.message, true)); load();
    });
  };
  await load();
  timer = setInterval(() => { if (!document.hidden && !document.activeElement?.matches('input,select')) load(); }, 10000);
}

// ---------------- Finalists ----------------

const TAGS = { potential: 'Potential', watchlist: 'Watchlist', attention: 'Needs attention', notready: 'Not ready', discovery: 'Booth discovery' };
let boardFilter = 'all';
let boardSort = 'signal';

async function viewFinalists() {
  const load = async () => {
    let d;
    try { d = await api('board'); } catch { return; }
    stamp();
    const rows = d.rows;
    const count = k => rows.filter(r => r.tags.includes(k)).length;
    let shown = boardFilter === 'all' ? rows : boardFilter === 'noms' ? rows.filter(r => r.noms) : rows.filter(r => r.tags.includes(boardFilter));
    if (boardSort === 'noms') shown = [...shown].sort((a, b) => (b.starred - a.starred) || (b.noms - a.noms) || (b.points - a.points));
    const starred = rows.filter(r => r.starred).length;
    const status = r => r.starred ? '<b style="color:var(--orange-deep)">Finalist</b>' : r.tags[0] ? TAGS[r.tags[0]] : '<span class="faint">–</span>';
    const pts = (v, p) => v ? `${esc(v)} <span class="faint small">+${p}</span>` : '<span class="faint">–</span>';
    $main.innerHTML = `
      <div class="row-inline" style="justify-content:space-between">
        <div><h1 class="display">Who should judges see?</h1><p class="small muted">Ranked by mentor signal. Does not feed the ${RUBRIC_TOTAL} judging marks.</p></div>
        <div class="stat" style="text-align:right"><b>${starred} / 20</b><span class="small muted">starred as finalists</span></div>
      </div>
      <div class="row-inline" style="justify-content:space-between">
        <div class="filters">
          <button class="chip${boardFilter === 'all' ? ' on' : ''}" data-f="all">All ${rows.length}</button>
          ${Object.entries(TAGS).filter(([k]) => k !== 'discovery').map(([k, l]) => `<button class="chip${boardFilter === k ? ' on' : ''}" data-f="${k}">${l} · ${count(k)}</button>`).join('')}
          ${CONFIG.judging.booths === false ? '' : `<button class="chip${boardFilter === 'noms' ? ' on' : ''}" data-f="noms">Booth nominated · ${rows.filter(r => r.noms).length}</button>
          <button class="chip${boardFilter === 'discovery' ? ' on' : ''}" data-f="discovery" title="Low mentor points, but nominated by 2+ judges who hadn't seen them overnight">Booth discoveries · ${count('discovery')}</button>`}
        </div>
        <label class="small row-inline">Sort by <select class="sel-sm" id="sort"><option value="signal">Mentor signal</option><option value="noms"${boardSort === 'noms' ? ' selected' : ''}>Booth nominations</option></select></label>
        <div class="row-inline">
          <button class="btn btn-sm" id="lock">${d.picksLocked ? 'Unlock top-two picks' : 'Lock top-two picks'}</button>
          <button class="btn btn-sm btn-primary" id="exp">Export must-see list</button>
        </div>
      </div>
      <div class="tablecard"><table>
        <thead><tr><th>#</th><th></th><th>Team</th><th>Points</th><th>Pool call</th><th>Final rating</th><th>Top-two</th><th>Demo-ready</th><th>Strengths</th><th>Mentors</th><th>Booth noms</th><th>Status</th></tr></thead>
        <tbody>${shown.map((r, i) => `<tr class="click${boardFilter === 'all' && i === 19 ? ' cut' : ''}" data-id="${r.id}">
          <td class="mono">${i + 1}</td>
          <td><button class="star${r.starred ? ' on' : ''}" data-star="${r.id}" aria-label="Star as finalist">${r.starred ? '★' : '☆'}</button></td>
          <td><b>${esc(r.name)}</b><div class="small faint">${r.table ? `${esc(tableLabel(r.table))} · ` : ''}${esc(r.type)}${r.buildType ? ` · ${esc(r.buildType.toLowerCase())}` : ''}</div></td>
          <td><b style="font-size:1.15rem">${r.points}</b></td>
          <td>${pts(r.rec2am, r.rec2am === 'Yes' ? 1 : r.rec2am === 'Maybe' ? 0.5 : 0)}</td>
          <td>${pts(r.rating, r.rating === '4' ? 2 : r.rating === '3' ? 1 : 0)}</td>
          <td>${r.picks ? `${r.picks} <span class="faint small">+${r.picks}</span>` : '<span class="faint">–</span>'}</td>
          <td>${esc(r.demoReady || '–')}</td>
          <td class="small">${Object.entries(r.strengths).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `<span class="tag">${esc(k)} ×${n}</span>`).join('')}</td>
          <td>${r.mentorsSeen}</td><td title="Fresh = nominated by a judge who never checked them overnight">${r.noms ? `<b>${r.noms}</b>${r.nomsFresh ? ` <span class="small" style="color:var(--green)">${r.nomsFresh} fresh</span>` : ' <span class="small faint">repeat</span>'}` : '<span class="faint">–</span>'}</td><td>${status(r)}</td></tr>`).join('') || '<tr><td colspan="12" class="muted">Nothing here yet.</td></tr>'}</tbody>
      </table></div>
      <p class="small faint">Orange dashed line = top-${CONFIG.judging.shortlistSize} cut. ★ = your manual finalist pick (final say). Points: check-in 3 pool call Yes +1, Maybe +0.5 · final rating 4 +2, 3 +1 · each top-two pick +1. Ties: picks → final rating → demo-ready. Booth noms = judges who nominated the team at 7 AM. Starred teams are the finalists judges score. Click a row for the team timeline.</p>`;
    $main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { boardFilter = b.dataset.f; load(); });
    document.getElementById('sort').onchange = e => { boardSort = e.target.value; load(); };
    $main.querySelectorAll('[data-star]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      if (!b.classList.contains('on') && d.stage === 'booths' && !window.__boothWarned) {
        if (!confirm('Booth nominations are still coming in. Star finalists now anyway?')) return;
        window.__boothWarned = true;
      }
      await api('star', { id: b.dataset.star, starred: !b.classList.contains('on') }).catch(err => toast(err.message, true)); load();
    });
    $main.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { location.hash = `#/teams/${tr.dataset.id}`; });
    document.getElementById('lock').onclick = async () => {
      await api('saveConfig', { picksLocked: !d.picksLocked }).catch(e => toast(e.message, true));
      toast(d.picksLocked ? 'Picks unlocked' : 'Picks locked'); load();
    };
    document.getElementById('exp').onclick = async () => {
      const r = await api('exportFinalists').catch(e => toast(e.message, true));
      if (r) download(`${SLUG}-finalists.csv`, r.csv);
    };
  };
  await load();
  timer = setInterval(() => { if (!document.hidden) load(); }, 20000);
}

// ---------------- Teams + timeline ----------------

const ANSWER_LABELS = Object.fromEntries(Object.entries(FORMS).map(([n, f]) => [n, Object.fromEntries(f.questions.filter(q => q.id).map(q => [q.id, q.label.replace(/\s*\(.*?\)\s*$/, '')]))]));

const approachLabel = v => v.kind === 'checkin' ? `Check-in ${v.round}` : v.kind === 'away' ? `Away at ${v.round ? `check-in ${v.round}` : fmtTime(v.at)}` : 'Help';
const approachTag = m => `<span class="tag" title="${esc(m.visits.map(v => `${approachLabel(v)} · ${fmtTime(v.at)}`).join('\n'))}"><b>${esc(m.name)}</b> · ${esc(m.visits.map(approachLabel).join(', '))}</span>`;

// Add a team (team = null) or edit one: name, code, people. Renders in place of the timeline.
function teamEditor(team) {
  const tl = document.getElementById('tl');
  document.getElementById('tlist').innerHTML = '';
  let people = team ? team.members.map(m => ({ name: m.name || '', college: m.college || '' })) : [{ name: '', college: '' }];
  const form = { name: team?.name || '', code: team?.code || '', table: team?.table_no || '', hidden: !!team?.hidden };
  const back = () => { location.hash = team ? `#/teams/${team.id}` : '#/teams'; if (team) viewTeams(String(team.id)); };
  const sync = () => {
    form.name = document.getElementById('tn').value; form.code = document.getElementById('tc').value; form.table = document.getElementById('tt').value;
    form.hidden = document.getElementById('th')?.checked ?? form.hidden;
    tl.querySelectorAll('[data-p]').forEach(row => {
    const i = Number(row.dataset.p);
      people[i] = { name: row.querySelector('[data-k="name"]').value, college: row.querySelector('[data-k="college"]').value };
    });
  };
  const render = () => {
    tl.innerHTML = `<section class="card" style="display:flex;flex-direction:column;gap:16px;max-width:760px">
      <h2 style="font-size:1.6rem">${team ? `Edit ${esc(team.name)}` : 'Add a team'}</h2>
      <div class="row-inline" style="gap:12px;align-items:flex-end">
        <label class="field" style="flex:2;min-width:220px"><span class="label">Team name</span><input class="input sm" id="tn" value="${esc(form.name)}"></label>
        <label class="field" style="flex:1;min-width:120px"><span class="label">Code <span class="faint">(optional)</span></span><input class="input sm" id="tc" value="${esc(form.code)}" placeholder="e.g. T-012"></label>
        <label class="field" style="flex:1;min-width:120px"><span class="label">Table</span><input class="input sm" id="tt" value="${esc(form.table)}" placeholder="e.g. 14 or UPPER 3"></label>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <span class="label">People · ${people.length} <span class="faint small">(${people.length === 1 ? 'solo' : people.length === 2 ? 'duo' : people.length ? 'team' : `${team?.type || 'team'}, names not added yet`})</span></span>
        ${people.map((p, i) => `<div class="row-inline" data-p="${i}" style="gap:8px">
          <input class="input sm" data-k="name" placeholder="Name" value="${esc(p.name)}" style="flex:1;min-width:160px">
          <input class="input sm" data-k="college" placeholder="College" value="${esc(p.college)}" style="flex:1;min-width:160px">
          <button class="btn btn-sm" data-rm="${i}" aria-label="Remove ${esc(p.name || 'person')}" ${people.length === 1 && !team ? 'disabled' : ''}>Remove</button>
        </div>`).join('')}
        <button class="link" id="addp" style="align-self:flex-start">+ Add person</button>
        <span class="small faint">College matters: judges connected to that college won't score this team.</span>
      </div>
      ${team ? `<label class="row-inline small" style="gap:8px"><input type="checkbox" id="th"${form.hidden ? ' checked' : ''}> <b>Hide from mentors</b> <span class="faint">Not shown in any mentor list, search, help or judging, and left out of round counts. Its data stays here.</span></label>` : ''}
      <div class="row-inline" style="gap:10px">
        <button class="btn btn-primary btn-sm" id="save">${team ? 'Save changes' : 'Add team'}</button>
        <button class="btn btn-sm" id="cancel">Cancel</button>
        ${team ? `<button class="link" id="del" style="margin-left:auto;color:var(--red)">Delete team</button>` : ''}
      </div>
    </section>`;
    tl.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { sync(); people.splice(Number(b.dataset.rm), 1); render(); });
    document.getElementById('addp').onclick = () => {
      sync(); people.push({ name: '', college: people[people.length - 1]?.college || '' }); render();
      tl.querySelector(`[data-p="${people.length - 1}"] [data-k="name"]`).focus();
    };
    document.getElementById('cancel').onclick = back;
    document.getElementById('save').onclick = async e => {
      sync();
      e.target.disabled = true;
      try {
        const r = await api('saveTeam', { id: team?.id, name: form.name, code: form.code, table: form.table, type: team?.type, members: people, hidden: team ? form.hidden : undefined });
        toast(team ? 'Team saved' : 'Team added');
        location.hash = `#/teams/${r.id}`;
        if (team) viewTeams(String(r.id));
      } catch (err) { toast(err.message, true); e.target.disabled = false; }
    };
    const del = document.getElementById('del');
    if (del) del.onclick = async () => {
      const typed = prompt(`Delete ${team.name}? This also removes its check-ins, help requests, nominations and scores. Type the team name to confirm.`);
      if (typed == null) return;
      if (typed.trim().toLowerCase() !== team.name.toLowerCase()) return toast('Name did not match. Nothing deleted.', true);
      try { await api('deleteTeam', { id: team.id }); toast(`${team.name} deleted`); location.hash = '#/teams'; } catch (err) { toast(err.message, true); }
    };
  };
  render();
  if (!team) document.getElementById('tn').focus();
}

async function viewTeams(id) {
  $main.innerHTML = `<div class="row-inline"><h1 class="display">Teams</h1>
      <input class="input sm" id="tq" placeholder="Search any team or member…" style="max-width:360px;margin-left:auto">
      <a class="btn btn-sm btn-primary" href="#/teams/new">+ Add team</a></div>
    <div id="tlist" class="filters"></div><div id="tl"></div>`;
  const tq = document.getElementById('tq'), tlist = document.getElementById('tlist');
  const search = async () => {
    const r = await api('teams', { q: tq.value }).catch(() => ({ rows: [] }));
    tlist.innerHTML = r.rows.map(t => `<a class="chip${String(t.id) === String(id) ? ' on' : ''}" style="text-decoration:none;display:inline-flex;align-items:center" href="#/teams/${t.id}">${t.hidden ? '🚫 ' : ''}${esc(t.name)}</a>`).join('');
  };
  // No team picked: every team with the mentors who approached it.
  const overview = async () => {
    const r = await api('approaches', { q: tq.value }).catch(e => { toast(e.message, true); return { rows: [] }; });
    tlist.innerHTML = '';
    document.getElementById('tl').innerHTML = `<div class="tablecard"><table>
      <thead><tr><th>Team</th><th>Mentors</th><th>Who approached</th></tr></thead>
      <tbody>${r.rows.map(t => `<tr class="click" data-id="${t.id}">
        <td><b>${esc(t.name)}</b>${t.hidden ? ' <span class="tag">hidden from mentors</span>' : ''}<div class="small faint mono">${esc(t.code || '')}${t.table_no ? ` · ${esc(tableLabel(t.table_no))}` : ''}</div></td>
        <td><b>${t.mentors.length}</b></td>
        <td class="small">${t.mentors.map(approachTag).join(' ') || '<span class="faint">No one yet</span>'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No teams.</td></tr>'}</tbody>
    </table></div>
    <p class="small faint">Approached = checked in, found them away, or took a help request for them. Click a row for the full timeline.</p>`;
    document.querySelectorAll('#tl tr.click').forEach(tr => tr.onclick = () => { location.hash = `#/teams/${tr.dataset.id}`; });
  };
  let st; tq.oninput = () => { clearTimeout(st); st = setTimeout(id ? search : overview, 200); };
  if (!id) return overview();
  if (id === 'new') return teamEditor(null);
  search();
  const d = await api('timeline', { id }).catch(e => { toast(e.message, true); return null; });
  if (!d) return;
  const { team, summary: s } = d;
  const brief = () => {
    const r4 = d.checkins.find(c => c.round === 4)?.answers || {};
    const r1 = d.checkins.find(c => c.round === 1)?.answers || {};
    return `${team.name} (${team.code})\nBuilt: ${r4.built || '–'}\nStrongest: ${r4.strongest || '–'}\nWeakest: ${r4.weakest || '–'}\n${CONFIG.copy.themeLinkLabel}: ${r1.theme || '–'}`;
  };
  const card = n => {
    const c = d.checkins.find(x => x.round === n);
    const vis = d.visits.filter(v => v.round === n);
    const fus = (d.followups || []).filter(f => f.round === n);
    const fl = d.flags.filter(f => f.round === n);
    const x = (attr, id, what) => `<button class="link small" ${attr}="${id}" aria-label="Delete ${what}" title="Delete" style="float:right;color:var(--red)">×</button>`;
    const extras = [
      ...vis.map(v => `<div class="greycard">${x('data-delvisit', v.id, 'away mark')}Away · ${fmtTime(v.at)} · ${esc(v.mentor || '')}</div>`),
      ...fus.map(f => `<div class="greycard">Follow-up · ${fmtTime(f.at)} · ${esc(f.mentor || '')}<div>“${esc(f.note)}”</div></div>`),
      ...fl.map(f => `<div class="greycard">${x('data-delflag', f.id, 'help request')}Help: ${esc(f.type)}${f.note ? ` · “${esc(f.note)}”` : ''} · ${f.status === 'resolved' ? `resolved ${fmtTime(f.resolvedAt)}${f.takenBy ? ` by ${esc(f.takenBy)}` : ''}` : f.takenBy ? `${esc(f.takenBy)} on it` : 'open'}</div>`),
    ].join('');
    if (!c) return `<div style="display:flex;flex-direction:column;gap:8px"><div class="card soft"><span class="eyebrow">Check-in ${n}</span><p class="faint">Not checked yet</p></div>${extras}</div>`;
    const a = c.answers;
    return `<div style="display:flex;flex-direction:column;gap:8px"><div class="card" data-card="${n}">
      <div class="row-inline" style="justify-content:space-between;gap:8px"><span class="eyebrow">${fmtTime(c.at)} · ${esc(c.mentor || '')}</span>
        <span style="white-space:nowrap"><button class="link small" data-editci="${n}">Edit</button> <button class="link small" data-moveci="${n}">Move</button> <button class="link small" data-delci="${n}" style="color:var(--red)">Delete</button></span></div>
      ${c.editedAt ? `<div class="small faint">Edited by an organizer at ${fmtTime(c.editedAt)}</div>` : ''}
      ${c.override ? `<div class="greycard">Checked anyway: “${esc(c.override)}”</div>` : ''}
      ${FORMS[n].questions.filter(q => q.id && a[q.id] != null && String(a[q.id]).length).map(q => `<div class="kv"><b>${esc(ANSWER_LABELS[n][q.id])}</b>${esc(Array.isArray(a[q.id]) ? a[q.id].join(' · ') : a[q.id])}</div>`).join('')}
    </div>${extras}</div>`;
  };
  document.getElementById('tl').innerHTML = `
    <section class="card" style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;align-items:center">
      <div><div class="mono small faint">${esc(team.code)} · ${team.table_no ? `<b style="color:var(--orange-deep)">${esc(tableLabel(team.table_no))}</b> · ` : ''}${[esc(team.type), team.members.map(m => esc(m.name)).join(', '), esc([...new Set(team.members.map(m => m.college).filter(Boolean))].join(' / '))].filter(Boolean).join(' · ')}</div>
        <h2 style="font-size:2rem">${esc(team.name)}${team.hidden ? ' <span class="tag" style="font-size:.8rem;vertical-align:middle">🚫 hidden from mentors</span>' : ''}</h2>
        <div class="small muted">${JUDGING ? `${s.points} pts · demo-ready ${esc(s.demoReady || '–')} · ${s.mentorsSeen} different mentors · ${s.picks} top-two pick${s.picks === 1 ? '' : 's'}` : `${s.mentorsSeen} different mentors · showcase-ready ${esc(s.demoReady || '–')}`}</div>
        ${s.pickNotes.map(p => `<div class="small">★ ${esc(p.by || '')}: “${esc(p.why)}”</div>`).join('')}</div>
      <div class="row-inline">
        ${JUDGING ? `<button class="btn btn-sm${s.starred ? ' btn-primary' : ''}" id="st">${s.starred ? '★ Finalist' : '☆ Mark as finalist'}</button>
        <button class="btn btn-sm" id="cb">Copy judge brief</button>` : ''}
        <button class="btn btn-sm" id="ed">Edit team</button></div>
    </section>
    <section class="card" style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
      <span class="eyebrow">Mentors who approached · ${d.approached.length}</span>
      ${d.approached.length ? `<div class="small">${d.approached.map(approachTag).join(' ')}</div>` : '<p class="faint small">No one yet.</p>'}
    </section>
    <div class="tl" style="margin-top:16px">${[1, 2, 3, 4].map(card).join('')}</div>
    ${d.flags.filter(f => !f.round).length ? `<div style="margin-top:12px">${d.flags.filter(f => !f.round).map(f => `<div class="greycard">Help: ${esc(f.type)} · ${esc(f.status)}</div>`).join('')}</div>` : ''}`;
  document.getElementById('ed').onclick = () => teamEditor(team);
  // Edit / delete what mentors entered.
  const tlEl = document.getElementById('tl');
  tlEl.querySelectorAll('[data-delci]').forEach(b => b.onclick = async () => {
    const n = Number(b.dataset.delci), c = d.checkins.find(x => x.round === n);
    if (!confirm(`Delete ${c.mentor || 'this mentor'}'s check-in ${n} for ${team.name}? The team becomes due again for check-in ${n}. This can't be undone.`)) return;
    try { await api('deleteCheckin', { teamId: team.id, round: n }); toast(`Check-in ${n} deleted`); viewTeams(String(team.id)); } catch (e) { toast(e.message, true); }
  });
  tlEl.querySelectorAll('[data-moveci]').forEach(b => b.onclick = async () => {
    const n = Number(b.dataset.moveci), c = d.checkins.find(x => x.round === n);
    const q = prompt(`Move ${c.mentor || 'this'}'s check-in ${n} from ${team.name} to which team? Type its name or code.`);
    if (!q) return;
    const r = await api('teams', { q }).catch(() => ({ rows: [] }));
    const exact = r.rows.find(t => t.name.toLowerCase() === q.trim().toLowerCase() || (t.code || '').toLowerCase() === q.trim().toLowerCase());
    const target = exact || (r.rows.length === 1 ? r.rows[0] : null);
    if (!target) return toast(r.rows.length ? `${r.rows.length} teams match “${q}”. Type the exact name or code.` : `No team matches “${q}”`, true);
    if (!confirm(`Move check-in ${n} (and the help requests it created) from ${team.name} to ${target.name}${target.table_no ? ` · ${tableLabel(target.table_no)}` : ''}?\n\n${team.name} becomes due again for check-in ${n}.`)) return;
    try { const m = await api('moveCheckin', { fromId: team.id, toId: target.id, round: n }); toast(`Moved to ${m.to}${m.help ? ` with ${m.help} help request${m.help === 1 ? '' : 's'}` : ''}`); location.hash = `#/teams/${target.id}`; }
    catch (e) { toast(e.message, true); }
  });
  tlEl.querySelectorAll('[data-delvisit]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this "not at their spot" mark?')) return;
    try { await api('deleteVisit', { id: b.dataset.delvisit }); toast('Deleted'); viewTeams(String(team.id)); } catch (e) { toast(e.message, true); }
  });
  tlEl.querySelectorAll('[data-delflag]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this help request? It disappears from every mentor\'s Help tab.')) return;
    try { await api('deleteFlag', { id: b.dataset.delflag }); toast('Help request deleted'); viewTeams(String(team.id)); } catch (e) { toast(e.message, true); }
  });
  tlEl.querySelectorAll('[data-editci]').forEach(b => b.onclick = () => {
    const n = Number(b.dataset.editci), c = d.checkins.find(x => x.round === n), a = { ...c.answers };
    const box = tlEl.querySelector(`[data-card="${n}"]`);
    const field = q => {
      const v = a[q.id];
      if (q.type === 'text') return `<textarea class="input sm" data-f="${q.id}" rows="2" style="width:100%;resize:vertical">${esc(v || '')}</textarea>`;
      if (q.type === 'one') return `<select class="sel-sm" data-f="${q.id}" style="width:100%"><option value="">–</option>${q.options.map(([val, extra]) => `<option value="${esc(val)}"${v === val ? ' selected' : ''}>${esc(q.numbered ? `${val} · ${extra}` : val)}</option>`).join('')}</select>`;
      const arr = v || [];
      return `<div class="small" data-f="${q.id}" data-many="1">${q.options.map(o => `<label style="display:inline-flex;gap:4px;margin:2px 10px 2px 0"><input type="checkbox" value="${esc(o)}"${arr.includes(o) ? ' checked' : ''}>${esc(o)}</label>`).join('')}</div>`;
    };
    box.innerHTML = `<span class="eyebrow">Editing check-in ${n} · ${esc(c.mentor || '')}</span>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
      ${FORMS[n].questions.filter(q => q.id).map(q => `<label style="display:flex;flex-direction:column;gap:4px"><b class="small">${esc(ANSWER_LABELS[n][q.id])}</b>${field(q)}</label>`).join('')}
      <div class="row-inline" style="gap:8px"><button class="btn btn-sm btn-primary" data-save>Save</button><button class="btn btn-sm" data-cancel>Cancel</button></div></div>`;
    box.querySelector('[data-cancel]').onclick = () => viewTeams(String(team.id));
    box.querySelector('[data-save]').onclick = async e => {
      const out = {};
      box.querySelectorAll('[data-f]').forEach(el => {
        const k = el.dataset.f;
        if (el.dataset.many) { const vals = [...el.querySelectorAll('input:checked')].map(i => i.value); if (vals.length) out[k] = vals; }
        else if (el.value.trim()) out[k] = el.value.trim();
      });
      e.target.disabled = true;
      try { await api('editCheckin', { teamId: team.id, round: n, answers: out }); toast(`Check-in ${n} saved`); viewTeams(String(team.id)); }
      catch (err) { toast(err.message, true); e.target.disabled = false; }
    };
  });
  document.getElementById('st').onclick = async () => { await api('star', { id: team.id, starred: !s.starred }); viewTeams(id); };
  document.getElementById('cb').onclick = async () => {
    try { await navigator.clipboard.writeText(brief()); toast('Judge brief copied'); } catch { prompt('Copy this:', brief()); }
  };
}

// ---------------- Scores (morning, 50 marks) ----------------

async function viewScores() {
  const load = async () => {
    let d;
    try { d = await api('results'); } catch { return; }
    stamp();
    const stageNote = { night: `Scoring has not opened yet. Open it on the Live tab at ${ST.finals.time.split(/[–-]/)[0]}.`, booths: 'Booth judging is on. Scoring opens with the finalist presentations.', finals: 'Scoring is open. Judges can still change scores.', done: 'Scoring is closed.' }[d.stage];
    $main.innerHTML = `
      <div class="row-inline" style="justify-content:space-between">
        <div><h1 class="display">Scores</h1><p class="small muted">Average of each judge’s score out of ${RUBRIC_TOTAL}. Judges connected to a team don’t score it, so averages stay fair.</p></div>
        <button class="btn btn-sm btn-primary" id="exp">Download all score sheets (CSV)</button>
      </div>
      <div class="notice ${d.stage === 'finals' ? 'info' : ''} small">${stageNote}</div>
      <div class="tablecard"><table>
        <thead><tr><th>#</th><th>Finalist</th><th>Avg / ${RUBRIC_TOTAL}</th><th title="Each judge's marks measured against their own average and spread, then put back on /${RUBRIC_TOTAL}">Normalised</th>${RUBRIC.map(r => `<th>${esc(r.label)} <span class="faint">/${r.max}</span></th>`).join('')}<th>Judges</th><th>Still to score</th></tr></thead>
        <tbody>${d.rows.map((r, i) => `<tr class="click" data-open="${r.id}">
          <td class="mono">${r.avg == null ? '–' : i + 1}</td>
          <td><b>${esc(r.name)}</b><div class="small faint">${esc(r.code || '')} · ${r.table ? `${esc(tableLabel(r.table))} · ` : ''}${esc(r.type)}</div></td>
          <td><b style="font-size:1.3rem">${r.avg ?? '–'}</b></td>
          <td>${r.normalised ?? '–'}${r.normalisedRank && r.avg != null && r.normalisedRank !== i + 1 ? `<div class="small" style="color:var(--orange-deep)">#${r.normalisedRank} normalised</div>` : ''}</td>
          ${RUBRIC.map(c => `<td>${r.criteria[c.id] ?? '<span class="faint">–</span>'}</td>`).join('')}
          <td>${r.judges}</td>
          <td class="small">${r.waiting.length ? esc(r.waiting.join(', ')) : '<span style="color:var(--green);font-weight:700">All in</span>'}${r.abstain.length ? `<div class="faint">Abstain: ${esc(r.abstain.join(', '))}</div>` : ''}</td>
        </tr>
        <tr data-sheet="${r.id}" hidden><td></td><td colspan="${RUBRIC.length + 6}">
          ${r.sheets.length ? `<table style="background:var(--bg-soft)"><tr><th>Judge</th>${RUBRIC.map(c => `<th>${esc(c.label)}</th>`).join('')}<th>Total</th><th>Note</th></tr>
          ${r.sheets.map(sh => `<tr${sh.excluded ? ' class="faint" style="text-decoration:line-through"' : ''}><td>${esc(sh.judge || '')}${sh.excluded ? ' <span class="tag" style="text-decoration:none">not counted · connected</span>' : ''}</td>${RUBRIC.map(c => `<td>${sh[c.id]}</td>`).join('')}<td><b>${sh.total}</b></td><td class="small">${esc(sh.note)}</td><td><button class="link small" data-delscore="${esc(sh.judgeId)}" data-team="${r.id}" data-label="${esc(`${sh.judge || 'this judge'}'s ${sh.total}/${RUBRIC_TOTAL} for ${r.name}`)}" style="color:var(--red);text-decoration:none">Delete</button></td></tr>`).join('')}</table>` : '<span class="muted small">No scores yet.</span>'}
        </td></tr>`).join('') || `<tr><td colspan="${RUBRIC.length + 6}" class="muted">No finalists yet. Star teams on the Finalists tab.</td></tr>`}</tbody>
      </table></div>
      <p class="small faint">Click a row to see each judge’s sheet. Ties: higher “${esc(RUBRIC[0]?.label || '')}”, then “${esc(RUBRIC[1]?.label || '')}”. Normalised = each judge's marks measured against their own average and spread (evens out generous vs strict judges); it matters most when judges scored different teams. Ranking uses the average. Scores are a guide for deliberation; the panel makes the final call.</p>`;
    $main.querySelectorAll('[data-delscore]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      if (!confirm(`Delete ${b.dataset.label}? The team's average is recalculated without it. This can't be undone.`)) return;
      try { await api('deleteScore', { teamId: b.dataset.team, mentorId: b.dataset.delscore }); toast('Score deleted'); load(); } catch (err) { toast(err.message, true); }
    });
    $main.querySelectorAll('[data-open]').forEach(tr => tr.onclick = () => {
      const sh = $main.querySelector(`[data-sheet="${tr.dataset.open}"]`); sh.hidden = !sh.hidden;
    });
    document.getElementById('exp').onclick = async () => {
      const r = await api('exportScores').catch(e => toast(e.message, true));
      if (r) download(`${SLUG}-scores.csv`, r.csv);
    };
  };
  await load();
  timer = setInterval(() => { if (!document.hidden && !$main.querySelector('[data-sheet]:not([hidden])')) load(); }, 15000);
}

// ---------------- Mentors (how the night went, per mentor) ----------------

let mentorSort = 'checkins', mentorOpen = null;
async function viewMentorStats() {
  const load = async () => {
    let d;
    try { d = await api('mentorStats'); } catch { return; }
    stamp();
    const s = d.summary;
    const m1 = v => v == null ? '–' : `${v} min`;
    const tile = (v, k, sub = '') => `<div class="tile"><span class="v">${v}</span><span class="k">${k}</span>${sub ? `<span class="s">${sub}</span>` : ''}</div>`;
    const sorters = {
      checkins: (a, b) => b.checkins - a.checkins,
      avg: (a, b) => (b.avgMinutes ?? -1) - (a.avgMinutes ?? -1),
      time: (a, b) => (b.timeOnTeams ?? 0) - (a.timeOnTeams ?? 0),
      last: (a, b) => new Date(a.last || 0) - new Date(b.last || 0),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    const rows = [...d.rows].sort(sorters[mentorSort]);
    const max = Math.max(1, ...rows.map(r => r.checkins));
    const ago = t => { if (!t) return '–'; const m = Math.floor((Date.now() - new Date(t)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : fmtTime(t); };
    const what = i => i.kind === 'checkin' ? `Check-in ${i.round}${i.override ? ' · checked anyway' : ''}${i.recommend ? ` · pool: ${i.recommend}` : ''}`
      : i.kind === 'away' ? `Found away (check-in ${i.round})` : i.kind === 'followup' ? `Follow-up: ${i.what}` : i.kind === 'help' ? `Help: ${i.what}${i.open ? ' · still on it' : ''}` : `Started check-in ${i.round}, never submitted`;
    const detail = r => `<tr data-detail="${esc(r.id)}"><td colspan="12" style="background:var(--bg-soft)">
      <table style="background:transparent"><thead><tr><th>When</th><th>Team</th><th>Where</th><th>What</th><th class="rn">Time spent</th><th class="rn">Gap before</th></tr></thead><tbody>
      ${r.items.map(i => `<tr><td class="mono small">${fmtTime(i.end || i.start)}</td><td><a href="#/teams/${i.teamId}"><b>${esc(i.team)}</b></a></td>
        <td class="small">${esc(tableLabel(i.table))}</td><td class="small">${esc(what(i))}</td>
        <td class="rn">${i.minutes != null ? `${i.minutes} min${i.estimated ? ' <span class="tag">est.</span>' : ''}` : '<span class="faint">–</span>'}</td><td class="rn faint">${i.gap != null ? `${i.gap} min` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing yet.</td></tr>'}
      </tbody></table></td></tr>`;
    $main.innerHTML = `
      <div class="row-inline" style="justify-content:space-between;align-items:flex-end">
        <div><h1 class="display">Mentors</h1><p class="small muted">How each mentor is spending the night. Updates every 30 seconds. Click a mentor to see every team they've been to.</p></div>
        <label class="small row-inline">Sort by <select class="sel-sm" id="msort">
          ${[['checkins', 'Most check-ins'], ['avg', 'Longest per check-in'], ['time', 'Most time on teams'], ['last', 'Quiet longest'], ['name', 'Name']].map(([v, l]) => `<option value="${v}"${mentorSort === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select></label>
      </div>
      <div class="tiles">
        ${tile(s.checkins, 'check-ins done', `by ${s.mentors} active mentors`)}
        ${tile(m1(s.avgMinutes), 'average check-in', s.measured ? `Start → Submit, ${s.measured} timed` : 'timed from 12:40 AM on')}
        ${tile(m1(s.medianGap), 'typical gap between check-ins', 'includes walking to the next team')}
        ${tile(s.helpResolved, 'help requests resolved', s.medianResolve != null ? `typically ${s.medianResolve} min after being raised · ${s.helpOpen} open` : `${s.helpOpen} open`)}
        ${tile(s.helpMinutes != null ? `${Math.round(s.helpMinutes)} min` : '–', 'spent helping teams', s.medianHelp != null ? `typically ${s.medianHelp} min per request${s.helpEstimated ? ' · some estimated' : ''}` : 'from “I’ll go help” to Resolved')}
        ${tile(s.abandoned, 'check-ins started, never submitted', 'the team stays due for others')}
        ${tile(s.teamsNeverVisited, 'teams no mentor has visited', `of ${s.teams}`)}
      </div>
      <div class="tablecard"><table>
        <thead><tr><th>Mentor</th><th>Check-ins</th><th class="rn">Avg per check-in</th><th class="rn">Typical gap</th><th class="rn">Time on teams</th><th class="rn">Away</th><th class="rn">Help taken</th><th class="rn">Helping</th><th class="rn">Not submitted</th><th class="rn">Note length</th><th class="rn">Pool “Yes”</th><th>Last active</th></tr></thead>
        <tbody>${rows.map(r => `<tr class="click" data-m="${esc(r.id)}">
          <td><b>${esc(r.name)}</b>${r.active ? '' : ' <span class="tag">paused</span>'}<div class="small faint">${esc(r.skills.join(', '))}</div></td>
          <td style="min-width:130px" title="${[1, 2, 3, 4].map(n => `Check-in ${n}: ${r.byRound[n]}`).join(' · ')}"><b>${r.checkins}</b> <span class="small faint">· ${r.teams} teams</span>
            <span class="mbar" style="width:${Math.round(r.checkins / max * 100)}%"></span></td>
          <td class="rn">${m1(r.avgMinutes)}${r.measured ? `<div class="small faint">${r.measured} timed</div>` : ''}</td>
          <td class="rn">${m1(r.medianGap)}</td>
          <td class="rn">${m1(r.timeOnTeams)}</td>
          <td class="rn">${r.away || '<span class="faint">0</span>'}</td>
          <td class="rn">${r.helpTaken ? `${r.helpResolved}/${r.helpTaken} done${r.medianResolve != null ? `<div class="small faint">${r.medianResolve} min to close</div>` : ''}` : '<span class="faint">0</span>'}</td>
          <td class="rn">${r.helpMinutes != null ? `${r.helpMinutes} min${r.helpEstimated ? '<div class="small faint">incl. estimates</div>' : ''}` : '<span class="faint">–</span>'}${r.stillHelping ? `<div class="small" style="color:var(--orange-deep)">${r.stillHelping} still open</div>` : ''}</td>
          <td class="rn">${r.abandoned ? `<b style="color:var(--red)">${r.abandoned}</b>` : '<span class="faint">0</span>'}</td>
          <td class="rn">${r.noteChars != null ? `${r.noteChars} chars` : '–'}</td>
          <td class="rn">${r.recommendYes != null ? `${r.recommendYes}%` : '–'}</td>
          <td class="small">${ago(r.last)}</td></tr>
          ${mentorOpen === r.id ? detail(r) : ''}`).join('') || '<tr><td colspan="12" class="muted">No mentors yet.</td></tr>'}</tbody>
      </table></div>
      <p class="small faint">Avg per check-in = Start to Submit (timed for check-ins from 12:40 AM on). Typical gap = time between a mentor's check-ins in the same round, breaks over 45 min left out; it includes walking and finding the team. Helping = from “I’ll go help” to Resolved. For help picked up before 12:40 AM the start is estimated as the later of when it was raised and the mentor’s previous action (marked est.); only resolved requests count. Time on teams = timed check-ins + helping. Note length = characters typed per check-in. Pool “Yes” = share of their check-in 3s sending the team to the final pool, useful for spotting very generous or very strict mentors.</p>`;
    document.getElementById('msort').onchange = e => { mentorSort = e.target.value; load(); };
    $main.querySelectorAll('[data-m]').forEach(tr => tr.onclick = () => { mentorOpen = mentorOpen === tr.dataset.m ? null : tr.dataset.m; load(); });
  };
  await load();
  timer = setInterval(() => { if (!document.hidden) load(); }, 30000);
}

// ---------------- Setup ----------------

async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  await new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = ok; s.onerror = () => no(new Error('Could not load the spreadsheet reader'));
    document.head.appendChild(s);
  });
  return window.XLSX;
}

async function parseFile(file) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const hi = grid.findIndex(r => r.some(c => /name/i.test(String(c))));
  if (hi < 0) throw new Error('No header row with a "Name" column found');
  const head = grid[hi].map(h => String(h).trim().toLowerCase());
  const find = (...res) => head.findIndex(h => res.some(re => re.test(h)));
  const col = {
    teamNo: find(/team\s*(no|num|#|id|code)/, /^(sl|s)\.?\s*no/),
    teamName: find(/team\s*name/, /^team$/),
    name: find(/^(participant|member|full)?\s*name$/, /participant/, /^name/),
    college: find(/college|institution|institute|university|school/),
  };
  if (col.name < 0) throw new Error('No "Name" column found');
  return grid.slice(hi + 1).map(r => ({
    teamNo: col.teamNo >= 0 ? String(r[col.teamNo]).trim() : '',
    teamName: col.teamName >= 0 ? String(r[col.teamName]).trim() : '',
    name: String(r[col.name]).trim(),
    college: col.college >= 0 ? String(r[col.college]).trim() : '',
  })).filter(r => r.name);
}

async function viewSetup() {
  let d;
  try { d = await api('setup'); } catch { return; }
  const c = d.config;
  const link = `${location.origin}/`;
  $main.innerHTML = `
    <div><h1 class="display">Setup</h1><p class="muted">Do this before 5 PM on the 10th.</p></div>
    <div class="grid g2">
      <section class="card" style="display:flex;flex-direction:column;gap:14px">
        <span class="eyebrow">Step 1 · Load teams</span>
        <label class="drop" id="drop"><input type="file" id="file" accept=".csv,.xlsx,.xls" hidden>
          <b>Drop CSV or XLSX here</b><div class="small muted">or click to choose · one row per person: Team no. · Team name · Name · College</div></label>
        <p class="small muted">Rows with the same team name become one team. Blank team name = solo. Re-uploading updates names and never deletes a team.</p>
        <div id="preview"></div>
        <div class="row-inline"><span class="small"><b>${d.counts.teams}</b> teams · <b>${d.counts.people}</b> people · <b>${d.counts.solos}</b> solos loaded</span>
          <span class="spacer"></span><button class="link small" id="demo">Load practice data (${CONFIG.practiceTeams.length} dummy teams)</button></div>
      </section>
      <section class="card" style="display:flex;flex-direction:column;gap:12px">
        <span class="eyebrow">Step 2 · Rounds</span>
        ${c.rounds.map((r, i) => `<div class="row-inline"><span class="mono small" style="width:90px">Check-in ${r.n}</span>
          <input class="input sm" data-rt="${i}" value="${esc(r.title)}" style="flex:2;min-width:140px"><input class="input sm" data-rh="${i}" value="${esc(r.time)}" style="flex:1;min-width:90px"></div>`).join('')}
        <p class="small muted">Times are labels only. A round starts when you make it live on the Live tab.</p>
        <button class="btn btn-sm" id="saveRounds" style="align-self:flex-start">Save rounds</button>
      </section>
      <section class="card" style="display:flex;flex-direction:column;gap:12px">
        <span class="eyebrow">Step 3 · Invite mentors</span>
        <p>Send mentors the link and the event code. They open it on their phone, type the code once, and fill the mentor card.</p>
        <div class="row-inline"><span class="small" style="width:90px">Link</span><input class="input sm mono" readonly value="${esc(link)}" style="flex:1"></div>
        ${d.codeRequired ? `<div class="row-inline"><span class="small" style="width:90px">Event code</span><input class="input sm mono" readonly value="${esc(d.mentorCode)}" style="flex:1;font-weight:700;font-size:1.1rem"></div>`
          : '<p class="small muted">No event code is set, so anyone with the link can join as a mentor.</p>'}
        <button class="btn btn-sm btn-primary" id="copyLink" style="align-self:flex-start">Copy invite message</button>
        <p class="small faint">The code only stops strangers who find the link from joining. Share it with mentors only.</p>
        <table><thead><tr><th>Mentor</th><th>College</th><th>Skills</th><th></th></tr></thead><tbody>
        ${d.mentors.map(m => `<tr><td><b>${esc(m.name)}</b>${m.active ? '' : ' <span class="small faint">(paused)</span>'}</td><td class="small">${esc(m.college || 'None')}</td><td class="small">${esc(m.skills.join(', '))}</td>
          <td style="white-space:nowrap"><button class="link small" data-pause="${esc(m.id)}" data-active="${m.active}">${m.active ? 'Pause' : 'Resume'}</button> <button class="link small" data-remove="${esc(m.id)}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No one has joined yet.</td></tr>'}
        </tbody></table>
      </section>
      <section class="card" style="display:flex;flex-direction:column;gap:12px">
        <span class="eyebrow">Step 4 · Safety and wrap-up</span>
        <label class="field"><span class="label">Organizer phone (shown on every mentor screen)</span><input class="input sm" id="phone" value="${esc(c.organizerPhone)}" placeholder="+91 …"></label>
        ${JUDGING ? `<label class="field"><span class="label">Top-two picks lock at (label shown to mentors)</span><input class="input sm" id="lockAt" value="${esc(c.picksLockAt)}"></label>` : ''}
        <button class="btn btn-sm" id="saveSafety" style="align-self:flex-start">Save</button>
        <hr style="border:0;border-top:2px dashed var(--line);width:100%">
        <div class="row-inline"><button class="btn btn-sm btn-primary" id="csv">Download all check-ins (CSV)</button>
          <span class="spacer"></span><button class="link small" id="reset" style="color:var(--red)">Reset event data…</button></div>
        <hr style="border:0;border-top:2px dashed var(--line);width:100%">
        <span class="label">Backup and restore</span>
        <p class="small muted" style="margin:0">A backup is one file with everything: teams, mentors, check-ins, help requests, picks, nominations, scores and settings. Take one before each big step (e.g. before opening ${JUDGING ? 'judging' : 'a round'}). Keep it private: it lets mentors sign in.</p>
        <div class="row-inline"><button class="btn btn-sm btn-primary" id="bk">Download backup</button>
          <button class="btn btn-sm" id="rs">Restore from backup…</button>
          <input type="file" id="rsfile" accept=".json,application/json" hidden></div>
      </section>
    </div>`;

  const file = document.getElementById('file'), drop = document.getElementById('drop'), preview = document.getElementById('preview');
  const handle = async f => {
    if (!f) return;
    let rows;
    try { rows = await parseFile(f); } catch (e) { preview.innerHTML = `<div class="notice warn small">${esc(e.message)}</div>`; return; }
    const groups = new Map(); let solo = 0;
    for (const r of rows) { const k = r.teamName ? r.teamName.toLowerCase() : `s${++solo}`; groups.set(k, (groups.get(k) || 0) + 1); }
    const sizes = [...groups.values()];
    preview.innerHTML = `<div class="notice info" style="display:flex;flex-direction:column;gap:10px">
      <div class="mono small">${esc(f.name)}</div>
      <div class="row-inline" style="gap:24px">
        <div class="stat"><b>${groups.size}</b><span class="small">teams</span></div><div class="stat"><b>${rows.length}</b><span class="small">people</span></div>
        <div class="stat"><b>${sizes.filter(n => n === 2).length}</b><span class="small">duos</span></div><div class="stat"><b>${sizes.filter(n => n === 1).length}</b><span class="small">solos</span></div>
        ${sizes.some(n => n > 2) ? `<div class="stat"><b>${sizes.filter(n => n > 2).length}</b><span class="small">3+ people</span></div>` : ''}
      </div>
      <div class="small muted">First rows: ${rows.slice(0, 3).map(r => esc(`${r.teamName || '(solo)'} · ${r.name} · ${r.college}`)).join(' | ')}</div>
      <button class="btn btn-primary btn-sm" id="doImport" style="align-self:flex-start">Import ${groups.size} teams</button></div>`;
    document.getElementById('doImport').onclick = async e => {
      e.target.disabled = true;
      try { const r = await api('importTeams', { rows }); toast(`Imported · ${r.added} new, ${r.updated} updated`); viewSetup(); }
      catch (err) { toast(err.message, true); e.target.disabled = false; }
    };
  };
  file.onchange = () => handle(file.files[0]);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files[0]); };

  const on = (id, fn) => { document.getElementById(id).onclick = fn; };
  on('demo', async () => { const r = await api('seedDemo').catch(e => toast(e.message, true)); if (r) { toast(`Practice data loaded · ${r.added} dummy teams · check-in 1 open`); viewSetup(); } });
  on('saveRounds', async () => {
    const rounds = c.rounds.map((r, i) => ({ title: $main.querySelector(`[data-rt="${i}"]`).value, time: $main.querySelector(`[data-rh="${i}"]`).value }));
    await api('saveConfig', { rounds }).then(() => toast('Rounds saved')).catch(e => toast(e.message, true));
  });
  const invite = `${EV.name} · Mentor Desk\nOpen on your phone: ${link}${d.codeRequired ? `\nEvent code: ${d.mentorCode}` : ''}\nSet up your card once${JUDGING ? ": it's for mentoring tonight and judging in the morning" : ''}. Read the short briefing before you start.`;
  on('copyLink', async () => { try { await navigator.clipboard.writeText(invite); toast('Invite copied. Paste it in the mentors group.'); } catch { prompt('Copy this:', invite); } });
  on('saveSafety', async () => {
    await api('saveConfig', { organizerPhone: document.getElementById('phone').value, picksLockAt: document.getElementById('lockAt')?.value })
      .then(() => toast('Saved')).catch(e => toast(e.message, true));
  });
  on('csv', async () => { const r = await api('exportCsv').catch(e => toast(e.message, true)); if (r) download(`${SLUG}-checkins.csv`, r.csv); });
  const stampName = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`; };
  const takeBackup = async label => {
    const b = await api('backup');
    download(`${SLUG}-backup-${label ? `${label}-` : ''}${stampName()}.json`, JSON.stringify(b), 'application/json');
    return b;
  };
  on('bk', async e => {
    e.target.disabled = true;
    try { const b = await takeBackup(); toast(`Backup saved · ${b.tables.teams.length} teams, ${b.tables.mentors.length} mentors, ${b.tables.checkins.length} check-ins`); }
    catch (err) { toast(err.message, true); }
    e.target.disabled = false;
  });
  const rsfile = document.getElementById('rsfile');
  on('rs', () => { rsfile.value = ''; rsfile.click(); });
  rsfile.onchange = async () => {
    const f = rsfile.files[0];
    if (!f) return;
    let backup;
    try { backup = JSON.parse(await f.text()); } catch { return toast('That file is not a backup (not JSON)', true); }
    if (backup?.app !== 'mentor-desk' || !backup.tables) return toast('That file is not a Mentor Desk backup', true);
    const n = t => (backup.tables[t] || []).length;
    const when = new Date(backup.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const v = prompt(`Restore the backup from ${when}?\n\n${n('teams')} teams · ${n('mentors')} mentors · ${n('checkins')} check-ins · ${n('flags')} help requests · ${n('nominations')} nominations · ${n('scores')} scores\n\nThis REPLACES everything live now. A backup of the current data downloads first, just in case. Mentors who joined after this backup will need to join again.\n\nType RESTORE to confirm.`);
    if (v !== 'RESTORE') return;
    try {
      await takeBackup('before-restore');
      await api('restore', { backup, confirm: 'RESTORE' });
      toast(`Restored backup from ${when}`);
    } catch (err) { return toast(err.message, true); }
    viewSetup();
  };
  on('reset', async () => {
    const v = prompt('This deletes ALL check-ins, help requests, picks and stars, removes demo teams, and stops the live round. Mentors and imported teams stay.\n\nType RESET to confirm.');
    if (v !== 'RESET') return;
    await api('reset', { confirm: 'RESET' }).then(() => toast('Event data reset')).catch(e => toast(e.message, true));
    viewSetup();
  });
  $main.querySelectorAll('[data-pause]').forEach(b => b.onclick = async () => {
    await api('setMentor', { id: b.dataset.pause, active: b.dataset.active !== 'true' }).catch(e => toast(e.message, true)); viewSetup();
  });
  $main.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this mentor? Their past check-ins stay.')) return;
    await api('removeMentor', { id: b.dataset.remove }).catch(e => toast(e.message, true)); viewSetup();
  });
}

// ---------------- router ----------------

if (!JUDGING) document.querySelectorAll('.nav a[data-p="finalists"], .nav a[data-p="scores"]').forEach(a => a.remove());

async function route() {
  clearInterval(timer);
  if (!pw) return gate();
  $top.hidden = false;
  const [, page = 'live', id] = (location.hash || '#/live').split('/');
  for (const a of document.querySelectorAll('.nav a')) a.classList.toggle('on', a.dataset.p === page);
  if (page === 'finalists' && JUDGING) return viewFinalists();
  if (page === 'scores' && JUDGING) return viewScores();
  if (page === 'mentors') return viewMentorStats();
  if (page === 'teams') return viewTeams(id);
  if (page === 'setup') return viewSetup();
  return viewLive();
}
addEventListener('hashchange', route);
route();
