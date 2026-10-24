import { rpc, esc, fmtTime, toast, tableLabel, FORMS, SKILLS, visible, ICON_SEARCH, RUBRIC, RUBRIC_TOTAL, levels, CONFIG, JUDGING } from './shared.js';

const EV = CONFIG.event, COPY = CONFIG.copy;
document.title = `${EV.name} · ${EV.tagline || 'Mentor desk'}`;

const $main = document.getElementById('main');
const $top = document.getElementById('top');
const $tabs = document.getElementById('tabs');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
let token = store.get('md_token');
let me = null;
let lastQuery = '';
let pollTimer = null;

const api = (action, args) => rpc(action, args, token ? { 'X-Token': token } : {}).catch(e => {
  if (e.status === 401 && action !== 'join') { token = null; store.set('md_token', null); go('#/'); }
  throw e;
});
const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };
const phoneLink = p => p ? `<a href="tel:${esc(p.replace(/\s/g, ''))}">${esc(p)}</a>` : 'an organizer';
const membersLine = t => {
  const names = (t.members || []).map(m => m.name).filter(n => n.toLowerCase() !== (t.name || '').toLowerCase()).join(' · ');
  return [tableLabel(t.table), names || (t.type === 'duo' ? 'Duo' : t.type === 'team' ? 'Team' : ''), t.type === 'solo' ? 'solo' : ''].filter(Boolean).join(' · ');
};
const tableTag = t => t.table ? `<div style="font-weight:800;font-size:1.15rem;color:var(--orange-deep);margin-bottom:6px">📍 ${esc(tableLabel(t.table))}</div>` : '';

function header({ back, title } = {}) {
  if (back) {
    $top.innerHTML = `<a class="back" href="${back}">← Back</a>${title ? `<span class="eyebrow">${esc(title)}</span>` : ''}`;
  } else {
    $top.innerHTML = `<a class="brand" href="#/">${esc(EV.name)}<small>${esc([EV.tagline, EV.route].filter(Boolean).join(' · '))}</small></a>
      ${me ? `<a class="who" href="#/me" aria-label="Your profile">${esc(me.name.split(' ')[0])} ▾</a>` : ''}`;
  }
}
function tabs(active) {
  $tabs.hidden = !active;
  for (const t of $tabs.querySelectorAll('.tab')) t.classList.toggle('on', t.dataset.tab === active);
}
function setHelpBadge(n) {
  const b = document.getElementById('helpBadge');
  b.hidden = !n; b.textContent = n || '';
}
// New help request for my skills: vibrate, pulse the Help badge, and keep a banner up until they open Help.
const helpSeen = { get: () => Number(store.get('md_help_seen') || 0), set: id => store.set('md_help_seen', String(id)) };
function helpAlert(f) {
  let el = document.getElementById('helpAlert');
  if (!f) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('a');
    el.id = 'helpAlert';
    el.href = '#/help';
    el.className = 'notice warn';
    el.style.cssText = 'display:block;margin:0 16px;border-radius:0 0 14px 14px;border-top:0;text-decoration:none;color:inherit';
    el.onclick = () => helpAlert(null);
    $top.after(el);
  }
  el.innerHTML = `<b>Help needed · ${esc(f.type)}</b> · ${esc(f.team)}${f.table ? ` · <b>${esc(tableLabel(f.table))}</b>` : ''} <span style="float:right;font-weight:700">Open →</span>`;
}
async function checkHelp() {
  if (!token || document.hidden) return;
  const p = await api('ping').catch(() => null);
  if (!p) return;
  setHelpBadge(p.help);
  const n = p.newest;
  // First check on this phone: remember where we are, no alarm for requests already open.
  if (store.get('md_help_seen') == null) return helpSeen.set(n ? n.id : 0);
  if (!n) return helpAlert(null);
  if (n.id <= helpSeen.get()) return;
  helpSeen.set(n.id);
  if (location.hash === '#/help') return;
  try { navigator.vibrate?.([200, 100, 200]); } catch {}
  const b = document.getElementById('helpBadge');
  b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
  helpAlert(n);
}
setInterval(checkHelp, 15000);

const loading = () => { $main.innerHTML = '<div class="loading"><span class="spin"></span></div>'; };
function fail(e) {
  $main.innerHTML = `<div class="notice warn"><b>Couldn't load.</b> ${esc(e.message)}</div><button class="btn" id="retry">Try again</button>`;
  document.getElementById('retry').onclick = route;
}
const pollEvery = (ms, fn) => { pollTimer = setInterval(() => { if (!document.hidden) fn(); }, ms); };

function practiceBanner(on, demo) {
  let el = document.getElementById('practice');
  if (!on) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'practice';
    el.className = 'notice warn small';
    el.style.cssText = 'margin:0 16px;border-radius:0 0 14px 14px;border-top:0;text-align:center';
    el.innerHTML = demo ? '<b>Public demo · dummy teams.</b> Try anything. Everything resets every hour.' : '<b>Practice run · dummy teams.</b> Try anything. It all gets wiped before the event.';
    $top.after(el);
  }
}

// ---------------- join / profile ----------------

async function viewJoin(edit = false) {
  tabs(null);
  header(edit ? { back: '#/', title: 'Your mentor card' } : {});
  const boot = await rpc('boot').catch(() => ({ codeRequired: false }));
  const p = edit ? me : { name: '', college: '', skills: [] };
  $main.innerHTML = `
    ${edit ? '' : `<div class="hero-join">
      ${EV.route ? `<div class="route">${esc(EV.route)}</div>` : ''}
      <h1 class="out-text">Hello, mentor</h1>
      <p class="muted" style="margin-top:8px">${esc(COPY.joinLead)}</p>
    </div>`}
    <form class="card" id="f" style="display:flex;flex-direction:column;gap:18px" novalidate>
      <label class="field"><span class="label">Your name</span>
        <input class="input" name="name" autocomplete="name" value="${esc(p.name)}" required></label>
      <label class="field"><span class="label">${esc(COPY.collegeLabel || "College you're connected to")} <span class="faint small">(optional)</span></span>
        <input class="input" name="college" placeholder="e.g. your alma mater" value="${esc(p.college)}">
        <span class="hint">Teams from this college are skipped for you, ${JUDGING ? 'to keep judging fair' : 'so every team gets fresh eyes'}. Leave blank if none.</span></label>
      <div class="field"><span class="label">What can you help with?</span>
        <div class="chips" id="skills">${SKILLS.map(s => `<button type="button" class="chip${p.skills.includes(s) ? ' on' : ''}" aria-pressed="${p.skills.includes(s)}">${s}</button>`).join('')}</div>
        <span class="hint">When a mentor flags a team that needs one of these, it shows at the top of your Help tab.</span></div>
      ${!edit && boot.codeRequired ? `<label class="field"><span class="label">Event code</span>
        <input class="input" name="code" autocapitalize="none" autocomplete="off" placeholder="From the organizer"></label>` : ''}
      <button class="btn btn-primary" type="submit">${edit ? 'Save' : "I'm ready to mentor"}</button>
    </form>
    ${edit ? `<a class="btn" href="#/brief">How it works</a><button class="link center" id="out">Sign out of this phone</button>` : ''}`;
  const f = document.getElementById('f');
  f.querySelectorAll('.chip').forEach(c => c.onclick = () => { c.classList.toggle('on'); c.setAttribute('aria-pressed', c.classList.contains('on')); });
  f.onsubmit = async ev => {
    ev.preventDefault();
    const btn = f.querySelector('[type=submit]');
    const data = {
      name: f.name.value, college: f.college.value, code: f.code?.value,
      skills: [...f.querySelectorAll('.chip.on')].map(c => c.textContent),
    };
    btn.disabled = true;
    try {
      if (edit) { await api('profile', data); toast('Saved'); }
      else { const r = await rpc('join', data); token = r.token; store.set('md_token', token); store.set('md_briefed', null); }
      go(edit ? '#/' : '#/brief');
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
  const out = document.getElementById('out');
  if (out) out.onclick = () => {
    if (!confirm('Sign out? You will need to set up your card again.')) return;
    token = null; me = null; store.set('md_token', null); go('#/');
  };
}

// ---------------- home: round + search ----------------

const PILL = {
  due: s => s.awayAt ? `<span class="pill away">Away ${fmtTime(s.awayAt)}</span>` : `<span class="pill due">${s.started ? 'Continue' : 'Due'}</span>`,
  done: s => `<span class="pill done">Done${s.mine ? ' · you' : ''}</span>`,
  busy: s => `<span class="pill busy">🔒 ${esc((s.by || '').split(' ')[0] || 'Taken')}</span>`,
  seen: () => `<span class="pill skip">You saw them</span>`,
  conflict: () => `<span class="pill skip">Skip</span>`,
};
const teamRow = t => t.state.key === 'busy'
  // Someone has started this team: show it, but it can't be opened.
  ? `<div class="row" role="button" tabindex="0" data-busy="${esc(t.state.by)}" style="opacity:.6;cursor:not-allowed">
  <div><div class="nm">🔒 ${esc(t.name)}</div><div class="sub">${esc(membersLine(t))}</div></div>${PILL.busy(t.state)}</div>`
  : `<a class="row" href="#/team/${t.id}">
  <div><div class="nm">${esc(t.name)}</div><div class="sub">${esc(membersLine(t))}</div></div>${PILL[t.state.key](t.state)}</a>`;
document.addEventListener('click', e => {
  const b = e.target.closest('[data-busy]');
  if (b) toast(`${b.dataset.busy} is checking this team right now. Pick another.`);
});

async function viewHome() {
  tabs('teams'); header(); loading();
  let h;
  try { h = await api('home'); } catch (e) { return fail(e); }
  me = h.me; header(); setHelpBadge(h.help);
  practiceBanner(h.practice, h.demo);
  if (JUDGING && h.judging) return viewJudgeHome(h);
  const s = h.stats;
  if (!h.round) {
    $main.innerHTML = `
      <div class="card blue round-card"><span class="eyebrow">Before kickoff</span>
        <div class="title">Check-ins open soon</div>
        <p>${esc(COPY.waiting)}</p></div>
      <p class="muted center">Meanwhile, walk around and say hi to the teams.</p>`;
    pollEvery(15000, async () => { const n = await api('home').catch(() => null); if (n?.round) route(); });
    return;
  }
  const pct = Math.min(100, Math.round((s.mine / Math.max(s.target, 1)) * 100));
  $main.innerHTML = `
    <section class="card blue round-card">
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="eyebrow">Check-in ${h.round.n} of 4 · live</span><span class="mono small">${esc(h.round.time)}</span></div>
      <div class="title">${esc(FORMS[h.round.n].title)}</div>
      <div class="stats"><span><b>You: ${s.mine}</b> of ${s.target} teams</span><span>Everyone: <b>${s.all} / ${s.teams}</b></span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </section>
    ${JUDGING && h.picks && !h.picks.locked ? `<a class="card" href="#/picks" style="text-decoration:none;display:flex;justify-content:space-between;align-items:center;gap:12px;border-color:var(--orange);box-shadow:4px 4px 0 var(--orange)">
      <div><div class="eyebrow">Before ${esc(h.picks.lockAt)}</div><div style="font-weight:700;font-size:1.1rem">Pick your top two</div>
      <div class="small muted">${h.picks.saved ? `${h.picks.saved} of 2 saved · tap to change` : 'Your top two for the shortlist'}</div></div><span style="font-size:1.6rem">→</span></a>` : ''}
    <div class="search">${ICON_SEARCH}
      <input class="input" id="q" type="search" placeholder="Team or member name" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" value="${esc(lastQuery)}" aria-label="Search team or member name">
      <button class="clear" id="clr" aria-label="Clear" ${lastQuery ? '' : 'hidden'}>×</button></div>
    <section id="res" class="list"></section>
    <a class="link center" href="#/mine">Your teams tonight</a>
    <a class="link center" href="#/brief">How it works · house rules</a>`;
  const q = document.getElementById('q'), clr = document.getElementById('clr'), res = document.getElementById('res');
  let seq = 0, t;
  const load = async () => {
    const my = ++seq;
    let r;
    try { r = await api('search', { q: lastQuery }); } catch (e) { res.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    if (my !== seq) return;
    if (!lastQuery) {
      res.innerHTML = r.due
        ? `<div class="sec-title"><span class="eyebrow">Still due · ${r.due}</span><span class="small faint">or search above</span></div>${r.results.map(teamRow).join('')}`
        : `<div class="notice info center"><b>Every team is done for this round.</b><br>Nice work. Check the Help tab.</div>`;
    } else {
      res.innerHTML = r.results.length ? r.results.map(teamRow).join('') : `<p class="muted center" style="padding:20px 0">No team or member called “${esc(lastQuery)}”.</p>`;
    }
  };
  q.oninput = () => { lastQuery = q.value.trim(); clr.hidden = !lastQuery; clearTimeout(t); t = setTimeout(load, 180); };
  clr.onclick = () => { q.value = ''; lastQuery = ''; clr.hidden = true; load(); q.focus(); };
  load();
  pollEvery(20000, async () => {
    if (document.activeElement === q) return;
    const n = await api('home').catch(() => null);
    if (!n) return;
    if (n.round?.n !== h.round.n) return route();
    setHelpBadge(n.help);
    load();
  });
}

// ---------------- your teams ----------------

async function viewMine() {
  tabs('teams'); header({ back: '#/', title: 'Your teams tonight' }); loading();
  let d;
  try { d = await api('mine'); } catch (e) { return fail(e); }
  const what = v => v.kind === 'checkin' ? `Check-in ${v.round}` : v.kind === 'away' ? 'Found away' : v.kind === 'followup' ? 'Follow-up' : 'Helped';
  $main.innerHTML = d.teams.length ? `
    <p class="muted small">Teams you've checked, found away, or helped. Tap one to go back to it.</p>
    <section class="list">${d.teams.map(t => `<a class="row" href="#/team/${t.id}">
      <div><div class="nm">${esc(t.name)}</div><div class="sub">${esc(t.visits.map(v => `${what(v)} ${fmtTime(v.at)}`).join(' · '))}</div></div>
      <span class="pill skip">${t.visits.length}</span></a>`).join('')}</section>`
    : `<div class="notice info center">No teams yet. Teams you check or help will show up here.</div>`;
}

// ---------------- team card ----------------

async function viewTeam(id) {
  tabs(null); header({ back: '#/' }); loading();
  let d;
  try { d = await api('team', { id }); } catch (e) { return fail(e); }
  const { team, state: st, round } = d;
  header({ back: '#/', title: round ? `Check-in ${round.n} · ${round.time}` : '' });
  const idea = d.prev.idea;
  const banner = {
    done: s => '',
    busy: s => `<div class="notice info" style="font-size:1.05rem"><b>🔒 Locked · ${esc(s.by)} is checking this team right now.</b><br>Pick another team. It unlocks if they cancel or leave it for 10 minutes.</div>`,
    seen: s => `<div class="notice warn"><b>You checked them in round ${s.round}.</b> Leave them for another mentor so they get fresh eyes.</div>`,
    conflict: s => `<div class="notice warn"><b>Skip this one.</b> ${esc(s.reason)}. Keeps it fair.</div>`,
    due: s => s.awayAt ? `<div class="notice">Not at their spot at ${fmtTime(s.awayAt)}. Still due.</div>` : '',
  };
  const canStart = st && st.key === 'due';
  const soft = st && (st.key === 'seen' || st.key === 'conflict');
  $main.innerHTML = `
    <section class="card">
      <div class="mono small faint">${esc(team.code || '')} · ${esc(team.type)}</div>
      <h1 class="display" style="font-size:2rem;margin:4px 0 10px">${esc(team.name)}</h1>
      ${tableTag(team)}<div class="members">${team.members.map(m => `<div><b>${esc(m.name)}</b> <span>· ${esc(m.college || '')}</span></div>`).join('')}</div>
      ${st?.key === 'done' ? `<div style="margin-top:12px;padding:10px 12px;border-radius:12px;background:#E6F6EC;border:2px solid var(--green);font-weight:700">
        ✓ Already checked for check-in ${round.n}<div class="small" style="font-weight:400">by ${esc(st.mine ? 'you' : st.by)} at ${fmtTime(st.at)}. Move on to the next team.</div></div>` : ''}
      ${(d.checkins || []).length ? `<div style="margin-top:12px;display:flex;flex-direction:column;gap:4px">${d.checkins.map(c => `<div class="small" style="${c.status === 'done' ? 'color:var(--green);font-weight:700' : c.status === 'live' ? 'color:var(--orange-deep);font-weight:700' : 'color:var(--ink-faint)'}">
        ${c.status === 'done' ? '✓' : c.status === 'live' ? '●' : '○'} Check-in ${c.n}${c.status === 'done' ? ` · ${esc(c.by || 'a mentor')}, ${fmtTime(c.at)}` : c.status === 'live' ? (st?.key === 'busy' ? ` · 🔒 being checked by ${esc(st.by)}` : ' · not yet, open now') : c.status === 'missed' ? ' · missed' : ' · later'}</div>`).join('')}</div>` : ''}
    </section>
    ${!round ? `<div class="notice info">No check-in round is open yet.</div>` : banner[st.key](st)}
    ${idea ? `<section class="card soft" style="display:flex;flex-direction:column;gap:10px">
      <span class="eyebrow">${esc(COPY.ideaHeading)}</span>
      <div class="quote">“${esc(idea.building)}”</div>
      ${idea.theme ? `<div class="small"><b>${esc(COPY.themeLinkLabel)}:</b> ${esc(idea.theme)}</div>` : ''}
      ${idea.goal ? `<div class="small"><b>${esc(COPY.goalLabel)}:</b> ${esc(idea.goal)}</div>` : ''}
    </section>` : ''}
    ${d.approached.length ? `<section class="card soft" style="display:flex;flex-direction:column;gap:8px">
      <span class="eyebrow">Mentors who've been here · ${d.approached.length}</span>
      ${d.approached.map(m => `<div class="small"><b>${esc(m.name)}</b> <span class="muted">· ${esc(m.visits.map(v => `${v.kind === 'checkin' ? `Check-in ${v.round}` : v.kind === 'away' ? 'Found away' : v.kind === 'followup' ? 'Follow-up' : 'Help'} ${fmtTime(v.at)}`).join(', '))}</span></div>`).join('')}
    </section>` : ''}
    ${(d.followups || []).length ? `<section class="card soft" style="display:flex;flex-direction:column;gap:8px">
      <span class="eyebrow">Follow-up notes · ${d.followups.length}</span>
      ${d.followups.map(f => `<div class="small"><b>${esc(f.by || 'A mentor')}</b> <span class="faint">${fmtTime(f.at)}</span><div>${esc(f.note)}</div></div>`).join('')}
    </section>` : ''}
    ${d.openHelp ? `<a class="notice warn" href="#/help" style="text-decoration:none">This team has an open help request →</a>` : ''}
    <div class="actions" id="acts">
      ${canStart ? `<button class="btn btn-primary" id="start">${st.started ? 'Continue' : 'Start'} check-in ${round.n}</button>
        <div class="more">
          <button class="link" id="away">Not at their spot</button>
          <a class="link" href="#/raise/${team.id}">Ask for help</a>
        </div>
        <button class="link faint small" id="know">I know this team personally</button>`
      : `<a class="btn" href="#/">Back to search</a>
        ${d.checkedByMe ? `<button class="link" id="fu">Follow up with this team</button>` : ''}
        ${soft ? `<button class="link faint small" id="anyway">Check anyway</button>` : ''}
        ${round && st.key !== 'done' && st.key !== 'busy' ? '' : `<a class="link" href="#/raise/${team.id}">Ask for help for this team</a>`}`}
    </div>
    <div id="fuBox" hidden class="card" style="display:flex;flex-direction:column;gap:12px">
      <label class="field"><span class="label">Follow-up note</span>
        <textarea class="textarea" id="fuNote" placeholder="e.g. Sensor issue fixed, demo flow now works end to end"></textarea>
        <span class="hint">For continuity: other mentors and organizers see it. It isn't a check-in and doesn't affect the shortlist.</span></label>
      <button class="btn btn-primary" id="fuSave">Save follow-up</button>
    </div>
    <div id="anywayBox" hidden class="card" style="display:flex;flex-direction:column;gap:12px">
      <label class="field"><span class="label">Why check anyway?</span>
        <input class="input" id="reason" placeholder="e.g. no one else is free"><span class="hint">The organizer will see this.</span></label>
      <button class="btn btn-primary" id="start2">Start check-in ${round?.n || ''}</button>
    </div>`;
  const start = async reason => {
    try { await api('start', { id: team.id, reason }); go(`#/form/${team.id}/${round.n}`); }
    catch (e) { toast(e.message, true); }
  };
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('start', e => { e.target.disabled = true; start().finally(() => (e.target.disabled = false)); });
  on('away', async () => {
    try { await api('away', { id: team.id }); toast(`Logged · ${team.name} not at their spot`); lastQuery = ''; go('#/'); } catch (e) { toast(e.message, true); }
  });
  on('fu', () => { document.getElementById('fuBox').hidden = false; document.getElementById('fuNote').focus(); });
  on('fuSave', async e => {
    const note = document.getElementById('fuNote').value.trim();
    if (!note) return toast('Add a short note', true);
    e.target.disabled = true;
    try { await api('followUp', { id: team.id, note }); toast(`Follow-up saved · ${team.name}`); viewTeam(team.id); } catch (err) { toast(err.message, true); e.target.disabled = false; }
  });
  on('know', async () => {
    if (!confirm(`Skip ${team.name} because you know them? Another mentor will check them.`)) return;
    try { await api('knowTeam', { id: team.id }); toast('Got it. Skipping this team.'); lastQuery = ''; go('#/'); } catch (e) { toast(e.message, true); }
  });
  on('anyway', () => { document.getElementById('anywayBox').hidden = false; document.getElementById('reason').focus(); });
  on('start2', () => {
    const r = document.getElementById('reason').value.trim();
    if (!r) return toast('Add a short reason', true);
    start(r);
  });
}

// ---------------- check-in form ----------------

const NOTE_LABELS = CONFIG.noteLabels;

async function viewForm(id, round) {
  tabs(null); loading();
  round = Number(round);
  const form = FORMS[round];
  let d;
  try { d = await api('team', { id }); } catch (e) { return fail(e); }
  const { team } = d;
  const draftKey = `md_draft_${id}_${round}`;
  let answers = {};
  try { answers = JSON.parse(store.get(draftKey) || '{}'); } catch {}
  $top.innerHTML = `<button class="back link" id="cancel" style="text-decoration:none;color:var(--ink)">✕ Cancel</button><span class="eyebrow">Check-in ${round} · ${esc(d.round?.time || '')}</span>`;

  let lockMsg = '';
  const render = () => {
    const ctx = (d.prev.notes || []).length ? `<section class="card soft" style="display:flex;flex-direction:column;gap:12px">
      <span class="eyebrow">Earlier mentor notes</span>
      ${d.prev.notes.map(c => `<div style="display:flex;flex-direction:column;gap:4px">
        <div class="small faint">Check-in ${c.round} · ${esc(FORMS[c.round].title)} · ${esc(c.by || 'a mentor')}, ${fmtTime(c.at)}</div>
        ${Object.entries(c.notes).map(([k, v]) => `<div class="small"><b>${esc(NOTE_LABELS[k] || k)}:</b> ${esc(v)}</div>`).join('')}
      </div>`).join('')}
    </section>` : '';
    $main.innerHTML = `
      ${lockMsg}<div class="form-head"><div style="font-weight:800;font-size:1.15rem">${esc(team.name)}</div>
        <div class="small muted">${esc(team.code || '')} · ${esc(membersLine(team))}</div></div>
      <div><h2 class="display" style="font-size:1.8rem">${esc(form.title)}</h2><p class="muted small" style="margin-top:4px">${esc(form.hint)}</p></div>
      ${ctx}
      <form id="f" style="display:flex;flex-direction:column;gap:24px" novalidate>
        ${form.questions.map(q => q.section ? `<div class="sec">${esc(q.section)}</div>` : visible(q, answers) ? question(q) : '').join('')}
        <button class="btn btn-primary" type="submit" id="submit">Submit check-in</button>
      </form>`;
    bind();
  };
  const question = q => {
    const v = answers[q.id];
    let body = '';
    if (q.type === 'text') {
      body = `<textarea class="textarea" data-q="${q.id}" rows="2" placeholder="${esc(q.ph || '')}">${esc(v || '')}</textarea>`;
    } else if (q.type === 'one') {
      body = `<div class="opts${q.inline ? ' inline' : ''}" role="radiogroup">${q.options.map(([val, extra]) => {
        const label = q.numbered ? `<span class="num">${val}</span>${esc(extra)}` : `${extra ? `<span class="dot ${extra}"></span>` : ''}${esc(val)}`;
        return `<button type="button" class="opt${v === val ? ' on' : ''}" role="radio" aria-checked="${v === val}" data-q="${q.id}" data-v="${esc(val)}">${label}</button>`;
      }).join('')}</div>`;
    } else {
      const arr = v || [];
      body = `<div class="chips">${q.options.map(o => `<button type="button" class="chip${arr.includes(o) ? ' on' : ''}" aria-pressed="${arr.includes(o)}" data-q="${q.id}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
    }
    return `<div class="q" id="q_${q.id}"><span class="label">${esc(q.label)}${q.req ? ' <span class="req">*</span>' : ''}</span>${body}${q.hint ? `<span class="hint">${esc(q.hint)}</span>` : ''}</div>`;
  };
  const save = () => store.set(draftKey, JSON.stringify(answers));
  const bind = () => {
    const f = document.getElementById('f');
    f.querySelectorAll('textarea').forEach(t => t.oninput = () => { answers[t.dataset.q] = t.value; save(); t.closest('.q').classList.remove('missing'); });
    f.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      answers[b.dataset.q] = b.dataset.v; save();
      const needsRerender = form.questions.some(q => q.showIf && q.showIf[0] === b.dataset.q);
      if (needsRerender) { const y = scrollY; render(); scrollTo(0, y); return; }
      b.parentElement.querySelectorAll('.opt').forEach(o => { o.classList.toggle('on', o === b); o.setAttribute('aria-checked', o === b); });
      b.closest('.q').classList.remove('missing');
    });
    f.querySelectorAll('.chip').forEach(c => c.onclick = () => {
      const arr = new Set(answers[c.dataset.q] || []);
      arr.has(c.dataset.v) ? arr.delete(c.dataset.v) : arr.add(c.dataset.v);
      answers[c.dataset.q] = [...arr]; save();
      c.classList.toggle('on'); c.setAttribute('aria-pressed', c.classList.contains('on'));
    });
    f.onsubmit = async ev => {
      ev.preventDefault();
      const missing = form.questions.filter(q => q.req && visible(q, answers) && !String(answers[q.id] || '').trim());
      document.querySelectorAll('.q.missing').forEach(e => e.classList.remove('missing'));
      if (missing.length) {
        missing.forEach(q => document.getElementById(`q_${q.id}`)?.classList.add('missing'));
        document.getElementById(`q_${missing[0].id}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
        return toast(`${missing.length} question${missing.length > 1 ? 's' : ''} left`, true);
      }
      const out = {};
      for (const q of form.questions) if (q.id && visible(q, answers) && answers[q.id] != null) out[q.id] = answers[q.id];
      const btn = document.getElementById('submit');
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Saving…';
      try {
        await api('submit', { id: team.id, round, answers: out });
        store.set(draftKey, null);
        lastQuery = '';
        toast(`Saved · ${team.name}`);
        go(round === 4 && JUDGING ? '#/picks' : '#/');
      } catch (e) {
        toast(e.network ? 'Not sent. Your answers are kept, try again.' : e.message, true);
        btn.disabled = false; btn.textContent = 'Submit check-in';
      }
    };
  };
  document.getElementById('cancel').onclick = async () => {
    const hasAnswers = Object.values(answers).some(v => Array.isArray(v) ? v.length : String(v || '').trim());
    if (hasAnswers && !confirm('Leave this check-in? Your answers stay saved on this phone.')) return;
    api('cancel', { id: team.id }).catch(() => {});
    go(`#/team/${team.id}`);
  };
  render();
  // Keep the team locked to this mentor while the form is open (the lock would lapse after 10 min).
  const keep = async () => {
    const k = await api('keep', { id: team.id }).catch(() => null);
    if (!k) return;
    const msg = k.held ? '' : `<div class="notice warn"><b>${k.submitted ? `${esc(k.by)} already submitted this team.` : `${esc(k.by || 'Another mentor')} has this team now.`}</b>
      Your answers are saved on this phone. ${k.submitted ? 'Go back and pick another team.' : 'Talk to them before you submit.'}</div>`;
    if (msg !== lockMsg) { lockMsg = msg; const y = scrollY; render(); scrollTo(0, y); }
  };
  keep();
  pollEvery(30000, keep);
  formKeep = keep;
}
let formKeep = null;
document.addEventListener('visibilitychange', () => { if (!document.hidden && formKeep && location.hash.startsWith('#/form/')) formKeep(); });

// ---------------- help ----------------

async function viewHelp() {
  tabs('help'); header(); loading();
  const load = async () => {
    let d;
    try { d = await api('help'); } catch (e) { return fail(e); }
    setHelpBadge(d.list.filter(f => f.status === 'open').length);
    helpAlert(null);
    const top = Math.max(0, ...d.list.map(f => f.id));
    if (top > helpSeen.get()) helpSeen.set(top);
    const card = f => `<article class="card help-card${f.status === 'open' && f.minutes >= 15 ? ' hot' : ''}">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div><a href="#/team/${f.teamId}" style="font-weight:800;font-size:1.1rem;text-decoration:none">${esc(f.team)}</a>${f.table ? `<div class="small" style="font-weight:700;color:var(--orange-deep)">📍 ${esc(tableLabel(f.table))}</div>` : ''}</div>
        <span class="pill${f.status === 'open' && f.minutes >= 15 ? ' hot' : ''}">${esc(f.type)} · ${f.minutes} min</span></div>
      ${f.note ? `<div>${esc(f.note)}</div>` : ''}
      <div class="meta">${f.auto ? `From check-in ${f.round}` : 'Raised'}${f.raisedBy ? ` by ${esc(f.raisedBy)}` : ''}${f.match && f.status === 'open' ? ' · <b style="color:var(--blue)">matches your skills</b>' : ''}</div>
      ${f.mine ? `<button class="btn btn-sm btn-blue" data-resolve="${f.id}" style="align-self:flex-start">Mark as sorted</button>`
        : f.status === 'open' ? `<button class="btn btn-sm btn-primary" data-take="${f.id}" style="align-self:flex-start">I'll go help</button>`
        : `<div class="small muted">${esc(f.takenBy || 'Someone')} is on it</div>`}
    </article>`;
    $main.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h1 class="display" style="font-size:2rem">Help requests</h1>
        <a class="btn btn-sm" href="#/raise">+ Ask</a></div>
      <p class="small muted">Mentors raise these for teams during check-ins. Pick up any you can help with. Ones matching your skills are on top. After 15 minutes with no one on it, a request turns red and organizers step in.</p>
      ${d.list.length ? `<div class="list" style="gap:16px">${d.list.map(card).join('')}</div>` : `<div class="notice center">No open requests right now. When a mentor asks for help with a team, it shows up here.</div>`}
      <div class="notice safety"><b>Safety or medical?</b> Don't type it. Call ${phoneLink(d.phone)} now.</div>`;
    $main.querySelectorAll('[data-take]').forEach(b => b.onclick = async () => {
      try { await api('take', { id: b.dataset.take }); toast("It's yours. Go find them."); load(); } catch (e) { toast(e.message, true); load(); }
    });
    $main.querySelectorAll('[data-resolve]').forEach(b => b.onclick = async () => {
      try { await api('resolve', { id: b.dataset.resolve }); toast('Marked as sorted'); load(); } catch (e) { toast(e.message, true); }
    });
  };
  await load();
  pollEvery(20000, load);
}

const FLAG_TYPES = CONFIG.helpTypes.map(([t]) => t);

async function viewRaise(teamId) {
  tabs(null); header({ back: teamId ? `#/team/${teamId}` : '#/help', title: 'Ask for help' }); loading();
  let team = null, phone = '';
  if (teamId) { try { const d = await api('team', { id: teamId }); team = d.team; phone = d.phone; } catch (e) { return fail(e); } }
  else { phone = (await rpc('boot').catch(() => ({}))).organizerPhone; }
  let type = null;
  $main.innerHTML = `
    <h1 class="display" style="font-size:2rem">Ask for help</h1>
    <div class="field"><span class="label">Team</span>
      ${team ? `<div class="input" style="font-weight:700">${esc(team.name)} <span class="faint small">${esc(team.code || '')}</span></div>`
      : `<div class="search">${ICON_SEARCH}<input class="input" id="tq" placeholder="Search team or member" autocomplete="off"></div><div class="list" id="tres"></div>`}
    </div>
    <div class="field"><span class="label">What's wrong?</span>
      <div class="opts">${FLAG_TYPES.map(t => `<button type="button" class="opt" data-t="${t}">${t}</button>`).join('')}</div></div>
    <label class="field"><span class="label">Note and where they're sitting</span>
      <textarea class="textarea" id="note" placeholder="e.g. GPS not reading. Near the window, left side."></textarea></label>
    <button class="btn btn-primary" id="send">Send</button>
    <div class="notice safety"><b>Safety or medical?</b> Don't use this. Call ${phoneLink(phone)}.</div>`;
  $main.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    type = b.dataset.t;
    $main.querySelectorAll('[data-t]').forEach(o => o.classList.toggle('on', o === b));
  });
  const tq = document.getElementById('tq');
  if (tq) {
    let t;
    tq.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      const q = tq.value.trim();
      const res = document.getElementById('tres');
      if (!q) { res.innerHTML = ''; return; }
      const r = await api('search', { q }).catch(() => ({ results: [] }));
      res.innerHTML = r.results.slice(0, 5).map(x => `<button type="button" class="row" data-id="${x.id}" style="text-align:left"><div><div class="nm">${esc(x.name)}</div><div class="sub">${esc(membersLine(x))}</div></div></button>`).join('');
      res.querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
        team = r.results.find(x => String(x.id) === b.dataset.id);
        tq.parentElement.outerHTML = `<div class="input" style="font-weight:700">${esc(team.name)}</div>`;
        res.innerHTML = '';
      });
    }, 200); };
  }
  document.getElementById('send').onclick = async e => {
    if (!team) return toast('Pick the team first', true);
    if (!type) return toast("Pick what's wrong", true);
    e.target.disabled = true;
    try { await api('raise', { id: team.id, type, note: document.getElementById('note').value }); toast('Sent to mentors and organizers'); go('#/help'); }
    catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
}

// ---------------- top-two picks ----------------

async function viewPicks() {
  tabs('teams'); header({ back: '#/', title: 'Top two' }); loading();
  let d;
  try { d = await api('picks'); } catch (e) { return fail(e); }
  const intro = `<div><div class="eyebrow">Top-two picks</div><h1 class="display" style="font-size:2rem;margin-top:4px">Your top two for the shortlist</h1></div>`;
  if (!d.teams.length) {
    $main.innerHTML = `${intro}<div class="notice">Your picks open once you've checked some teams. You can pick any team you checked tonight.</div><a class="btn" href="#/">Back to teams</a>`;
    return;
  }
  const label = t => [t.name, tableLabel(t.table), t.idea && (t.idea.length > 38 ? t.idea.slice(0, 36) + '…' : t.idea)].filter(Boolean).join(' · ');
  const opt = sel => `<option value="">Pick a team</option>${d.teams.map(t => `<option value="${t.id}"${sel === t.id ? ' selected' : ''}>${esc(label(t))}</option>`).join('')}`;
  const slot = (n, p) => `<div class="card" style="display:flex;flex-direction:column;gap:12px">
      <span class="eyebrow">Choice ${n}</span>
      <select class="select" id="t${n}" ${d.locked ? 'disabled' : ''}>${opt(p?.teamId)}</select>
      <textarea class="textarea" id="w${n}" placeholder="Why? One line" ${d.locked ? 'disabled' : ''}>${esc(p?.why || '')}</textarea></div>`;
  $main.innerHTML = `${intro}
    <p class="muted">From any of the ${d.teams.length} team${d.teams.length > 1 ? 's' : ''} you checked tonight, in any round (most recent first). This is the strongest signal we use.</p>
    ${d.locked ? `<div class="notice warn">Picks are locked now. Thank you!</div>` : ''}
    ${slot(1, d.first)}${d.teams.length > 1 ? slot(2, d.second) : ''}
    ${d.locked ? '' : `<button class="btn btn-primary" id="save">Save my picks</button><p class="small muted center">You can change them until ${esc(d.lockAt)}.</p>`}
    <a class="link center" href="#/">Back to teams</a>`;
  const save = document.getElementById('save');
  if (save) save.onclick = async () => {
    const v = n => ({ teamId: document.getElementById(`t${n}`)?.value || null, why: document.getElementById(`w${n}`)?.value || '' });
    save.disabled = true;
    try { await api('savePicks', { first: v(1), second: v(2) }); toast('Picks saved'); go('#/'); }
    catch (e) { toast(e.message, true); save.disabled = false; }
  };
}

// ---------------- briefing (shown once after joining, then from "How it works") ----------------

const ST = CONFIG.judging.stages;
const BOOTHS = CONFIG.judging.booths !== false;
const MORNING = [
  ...(BOOTHS ? [[ST.booths.time, `Round 1 · ${ST.booths.title}`, ST.booths.text]] : []),
  [ST.shortlist.time, ST.shortlist.title, ST.shortlist.text],
  [ST.finals.time, `${BOOTHS ? 'Round 2 · ' : ''}${ST.finals.title}`, ST.finals.text],
  [ST.done.time, ST.done.title, ST.done.text],
];

const morning = () => `
    <section class="card" style="display:flex;flex-direction:column;gap:2px">
      <span class="eyebrow" style="margin-bottom:6px">Morning · you judge</span>
      ${MORNING.map(([t, title, body]) => `<div style="display:flex;gap:12px;padding:10px 0;border-top:2px dashed var(--line)">
        <span class="mono small" style="width:76px;flex-shrink:0;color:var(--blue);font-weight:700">${t}</span>
        <div><b>${title}</b><div class="small muted">${body}</div></div></div>`).join('')}
      <p class="small faint" style="margin-top:6px">${BOOTHS ? 'Your notes from tonight become a must-see list. At the booths, look hardest at teams you haven’t seen: your favourites already count through your top-two picks.' : 'Your notes from tonight and your top-two picks build the shortlist.'}</p>
    </section>
    <section class="card" style="display:flex;flex-direction:column;gap:12px">
      <span class="eyebrow">Scored out of ${RUBRIC_TOTAL} marks</span>
      ${RUBRIC.map(({ label: k, max: n }) => `<div style="display:grid;grid-template-columns:1fr 90px 28px;gap:10px;align-items:center">
        <span class="small" style="font-weight:700">${k}</span>
        <span class="bar" style="color:var(--ink);height:12px"><i style="width:${n / Math.max(...RUBRIC.map(r => r.max)) * 100}%"></i></span>
        <span class="mono" style="color:var(--blue);font-weight:700;text-align:right">${n}</span></div>`).join('')}
      ${COPY.rubricNote ? `<div class="notice info small">${COPY.rubricNote}</div>` : ''}
    </section>`;

async function viewBrief() {
  tabs(null);
  const first = !store.get('md_briefed');
  header(first ? {} : { back: '#/', title: 'How it works' });
  const boot = await rpc('boot').catch(() => ({}));
  const rounds = boot.rounds || [];
  const time = n => esc(rounds.find(r => r.n === n)?.time || '');
  const step = (n, title, body) => `<div style="display:flex;gap:14px;align-items:flex-start">
    <span class="display" style="flex-shrink:0;width:38px;height:38px;border:2.5px solid var(--outline);border-radius:50%;display:grid;place-items:center;font-size:1.2rem;background:var(--orange-tint)">${n}</span>
    <div><b>${title}</b><div class="small muted">${body}</div></div></div>`;
  const round = (n, title, asks) => `<div style="display:flex;gap:12px;padding:10px 0;border-top:2px dashed var(--line)">
    <span class="mono small" style="width:76px;flex-shrink:0;color:var(--blue);font-weight:700">${time(n)}</span>
    <div><b>${title}</b><div class="small muted">${asks}</div></div></div>`;
  $main.innerHTML = `
    <div>
      <div class="route">${esc([EV.route, EV.hours].filter(Boolean).join(' · '))}</div>
      <h1 class="out-text" style="font-size:clamp(2.4rem,11vw,3.2rem);margin-top:6px">${JUDGING ? 'Help first.<br>Judge second.' : 'Help first.<br>Hands off.'}</h1>
      <p class="muted" style="margin-top:10px">${esc(COPY.briefLead)}</p>
    </div>

    <section class="card" style="display:flex;flex-direction:column;gap:2px">
      <span class="eyebrow" style="margin-bottom:6px">Four check-ins through the night</span>
      ${CONFIG.rounds.map(r => round(r.n, esc(r.title), esc(r.asks || ''))).join('')}
      <p class="small faint" style="margin-top:6px">The organizer opens each round. Your phone switches by itself.</p>
    </section>

    <section class="card" style="display:flex;flex-direction:column;gap:16px">
      <span class="eyebrow">How each check-in works</span>
      ${step(1, 'Walk up and find the team', 'Pick one from <b>Still due</b> on your home screen, or type the team name, any member’s name, or their table.')}
      ${step(2, 'The app says go or skip', '<span class="pill due">Due</span> → tap <b>Start</b>. Done, being checked, you saw them, or you’re connected to them → move to the next team.')}
      ${step(3, 'One-minute form', 'Tap the answers, write one or two short lines, submit. Team not there? Tap <b>Not at their spot</b>.')}
    </section>

    <section class="card" style="display:flex;flex-direction:column;gap:16px">
      <span class="eyebrow">House rules</span>
      ${step(1, 'Fresh eyes', `Each round you check teams you haven’t seen yet, so every team gets several independent views${JUDGING ? ' before judging' : ''}. The app enforces it.`)}
      ${step(2, 'No conflicts', 'Skip teams you know personally or from your alma mater. Tap <b>I know this team personally</b>.')}
      ${step(3, 'Your target', 'It is on your home screen. It drops as more mentors join.')}
      ${step(4, 'Stuck team?', 'Teams don’t use this app, you raise it for them: tap <b>Ask for help</b> on the team. Mentors with that skill see it first. If no one picks it up in 15 minutes it turns red and an organizer assigns someone.')}
      ${step(5, 'Solo builders', `have half the hands. ${JUDGING ? 'Judge' : 'Read'} progress for the team size.`)}
      ${step(6, 'Keep it fair', JUDGING ? 'You see what a team said earlier, never other mentors’ ratings. Don’t tell teams how you rated them or hint at the shortlist.' : 'You see what a team said earlier, never other mentors’ ratings. Don’t tell teams how you rated them.')}
    </section>

    <div class="notice safety"><b>Safety or medical?</b> Don't type it in the app. Call ${phoneLink(boot.organizerPhone)} right away.</div>

    ${JUDGING ? `<section class="card" style="border-color:var(--orange);box-shadow:4px 4px 0 var(--orange)">
      <span class="eyebrow">Before ${esc(boot.picksLockAt || CONFIG.judging.picksLockAt)}</span>
      <div style="font-weight:800;font-size:1.15rem;margin-top:4px">Pick your top two</div>
      <p class="small muted" style="margin-top:4px">From any team you checked tonight, choose your top two for the shortlist, with one line on why. This is the strongest signal we use.</p>
    </section>

    ${morning()}` : ''}

    <button class="btn btn-primary" id="gotit">${first ? "Got it, let's start" : 'Back to teams'}</button>`;
  document.getElementById('gotit').onclick = () => { store.set('md_briefed', '1'); go('#/'); };
}

// ---------------- morning judging ----------------

const STAGE = {
  booths: { eyebrow: 'Morning · Round 1', title: ST.booths.title, text: 'See every project. Nominate the ones the panel must see.' },
  finals: { eyebrow: 'Morning · Round 2', title: 'Finalist scoring', text: `Score each finalist out of ${RUBRIC_TOTAL} after their pitch.` },
  done: { eyebrow: 'Morning', title: 'Scoring closed', text: 'Thank you! The panel is deliberating.' },
};

async function viewJudgeHome(h) {
  const j = h.judging, st = STAGE[j.stage];
  const target = CONFIG.judging.nominationTarget || 0;
  const stat = j.stage === 'booths' ? `<span><b>You nominated ${j.noms}</b> team${j.noms === 1 ? '' : 's'}${target ? ` <span style="opacity:.75">· suggested ${target}, optional</span>` : ''}</span>`
    : `<span><b>You scored ${j.scored}</b> of ${j.finalists} finalists</span>`;
  const pct = j.stage === 'booths' ? 0 : Math.round(j.scored / Math.max(j.finalists, 1) * 100);
  $main.innerHTML = `
    <section class="card blue round-card">
      <span class="eyebrow">${st.eyebrow}</span>
      <div class="title">${st.title}</div>
      <p>${st.text}</p>
      <div class="stats">${stat}</div>
      ${j.stage !== 'booths' ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
    </section>
    ${j.stage === 'booths' ? `<div class="search">${ICON_SEARCH}
      <input class="input" id="q" type="search" placeholder="Team or member name" autocomplete="off" spellcheck="false" aria-label="Search team or member name">
      <button class="clear" id="clr" aria-label="Clear" hidden>×</button></div>
      <div class="notice info small">Your favourites already count through your top-two picks. Here, look hardest at <b>teams you haven’t seen</b>: nominate the ones that surprise you.</div>` : ''}
    <section id="res" class="list"></section>
    <a class="link center" href="#/mine">Your teams tonight</a>
    <a class="link center" href="#/brief">How judging works · ${RUBRIC_TOTAL}-mark guide</a>`;
  const res = document.getElementById('res'), q = document.getElementById('q'), clr = document.getElementById('clr');
  const pill = t => t.conflict ? '<span class="pill skip">Connected · skip</span>'
    : j.stage === 'booths' ? (t.nominated ? '<span class="pill due">Nominated</span>' : '<span class="pill skip">View</span>')
    : t.score != null ? `<span class="pill done">${t.score} / ${RUBRIC_TOTAL}</span>` : j.stage === 'finals' ? '<span class="pill due">Score</span>' : '';
  const row = t => `<a class="row" href="#/judge/${t.id}"><div><div class="nm">${esc(t.name)}${j.stage === 'booths' && t.seen ? ' <span class="small faint" style="font-weight:600">· you checked</span>' : ''}</div><div class="sub">${esc(membersLine(t))}</div>${t.idea ? `<div class="small muted" style="margin-top:4px">${esc(t.idea.length > 120 ? t.idea.slice(0, 117) + '…' : t.idea)}</div>` : ''}</div>${pill(t)}</a>`;
  // Booths: the judge's own nominations, always on top.
  const mineBlock = r => j.stage === 'booths' && (r.nominated || []).length
    ? `<div class="sec-title"><span class="eyebrow">Your nominations · ${r.nominated.length}</span><span class="small faint">tap to change</span></div>${r.nominated.map(row).join('')}`
    : '';
  let seq = 0, timer;
  const load = async () => {
    const my = ++seq, query = q?.value.trim() || '';
    let r;
    try { r = await api('judgeList', { q: query }); } catch (e) { res.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    if (my !== seq) return;
    if (r.stage !== j.stage) return route();
    if (j.stage === 'booths' && !query) {
      const sec = (title, note, list) => list.length ? `<div class="sec-title"><span class="eyebrow">${title} · ${list.length}</span><span class="small faint">${note}</span></div>${list.map(row).join('')}` : '';
      res.innerHTML = mineBlock(r)
        + sec('Must-see · new to you', 'strong in tonight’s notes', r.mustSee || [])
        + sec('Teams you haven’t seen', 'fresh eyes count most', (r.unseen || []).filter(t => !(r.mustSee || []).some(m => m.id === t.id)))
        + ((r.seen || []).length ? `<details class="card soft" style="padding:10px 14px"><summary class="eyebrow" style="cursor:pointer">Teams you checked tonight · ${r.seen.length}</summary>
            <div class="list" style="margin-top:10px">${r.seen.map(row).join('')}</div></details>` : '');
    } else if (j.stage === 'booths') {
      res.innerHTML = r.results.length ? r.results.map(row).join('') : `<p class="muted center" style="padding:20px 0">No team or member called “${esc(query)}”.</p>`;
    } else {
      res.innerHTML = r.results.length
        ? `<div class="sec-title"><span class="eyebrow">Finalists · ${r.results.length}</span></div>${r.results.map(row).join('')}`
        : `<div class="notice">The shortlist isn't out yet. It appears here once organizers announce it.</div>`;
    }
  };
  if (q) {
    q.oninput = () => { clr.hidden = !q.value; clearTimeout(timer); timer = setTimeout(load, 180); };
    clr.onclick = () => { q.value = ''; clr.hidden = true; load(); q.focus(); };
  }
  load();
  pollEvery(20000, () => { if (document.activeElement !== q) load(); });
}

async function viewJudgeTeam(id) {
  tabs(null); header({ back: '#/' }); loading();
  let d;
  try { d = await api('judgeTeam', { id }); } catch (e) { return fail(e); }
  const { team, about } = d;
  header({ back: '#/', title: STAGE[d.stage]?.title || '' });
  const aboutCard = (about.building || about.built) ? `<section class="card soft" style="display:flex;flex-direction:column;gap:10px">
      <span class="eyebrow">About the project</span>
      ${about.building ? `<div class="quote">“${esc(about.building)}”</div>` : ''}
      ${about.theme ? `<div class="small"><b>${esc(COPY.themeLinkLabel)}:</b> ${esc(about.theme)}</div>` : ''}
      ${about.built ? `<div class="small"><b>What they built:</b> ${esc(about.built)}</div>` : ''}
    </section>` : '';
  const head = `<section class="card">
      <div class="mono small faint">${esc(team.code || '')} · ${esc(team.type)}${d.finalist ? ' · <b style="color:var(--orange-deep)">finalist</b>' : ''}</div>
      <h1 class="display" style="font-size:2rem;margin:4px 0 10px">${esc(team.name)}</h1>
      ${tableTag(team)}<div class="members">${team.members.map(m => `<div><b>${esc(m.name)}</b> <span>· ${esc(m.college || '')}</span></div>`).join('')}</div>
    </section>`;
  if (d.conflict) {
    $main.innerHTML = `${head}<div class="notice warn"><b>You can't judge this team.</b> ${esc(d.conflict)}. Another judge will cover it.</div><a class="btn" href="#/">Back</a>`;
    return;
  }
  if (d.stage === 'booths') {
    $main.innerHTML = `${head}${aboutCard}
      <div class="actions">${d.nominated
        ? `<div class="notice info center" style="width:100%"><b>Nominated ✓</b> The panel will see your pick.</div><a class="btn" href="#/">Back to teams</a><button class="link" id="un">Remove nomination</button>`
        : `<button class="btn btn-primary" id="nom">Nominate for the shortlist</button><a class="link" href="#/">Not this one</a>`}</div>`;
    const set = on => async () => {
      try { await api('nominate', { id: team.id, on }); toast(on ? `Nominated · ${team.name}` : 'Nomination removed'); go('#/'); } catch (e) { toast(e.message, true); }
    };
    const n = document.getElementById('nom'), u = document.getElementById('un');
    if (n) n.onclick = set(true);
    if (u) u.onclick = set(false);
    return;
  }
  if (!d.finalist) {
    $main.innerHTML = `${head}<div class="notice">This team isn't on the finalist list.</div><a class="btn" href="#/">Back</a>`;
    return;
  }
  const locked = d.stage !== 'finals';
  const marks = { ...(d.score || {}) };
  const total = () => Math.round(RUBRIC.reduce((a, r) => a + (typeof marks[r.id] === 'number' ? marks[r.id] : 0), 0) * 10) / 10;
  $main.innerHTML = `${head}${aboutCard}
    <div><h2 class="display" style="font-size:1.8rem">Score out of ${RUBRIC_TOTAL}</h2>
      <p class="small muted" style="margin-top:4px">${locked ? 'Scoring is closed. This is what you gave.' : 'Tap one mark per line after their pitch. Judge what they built and demoed, never business potential.'}</p></div>
    <form id="f" style="display:flex;flex-direction:column;gap:22px" novalidate>
      ${RUBRIC.map(r => `<div class="q" id="q_${r.id}">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="label">${r.label}</span><span class="mono small faint">out of ${r.max}</span></div>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px">${levels(r.max).map(v =>
          `<button type="button" class="opt${marks[r.id] === v ? ' on' : ''}" style="justify-content:center;padding:10px 0;font-family:'Baloo 2';font-size:1.25rem;font-weight:800" data-c="${r.id}" data-v="${v}" ${locked ? 'disabled' : ''} aria-pressed="${marks[r.id] === v}">${v}</button>`).join('')}</div>
        ${r.hint ? `<span class="hint">${esc(r.hint)}</span>` : ''}
      </div>`).join('')}
      <label class="field"><span class="label">Note for the panel <span class="faint small">(optional)</span></span>
        <textarea class="textarea" id="note" placeholder="One line for deliberation" ${locked ? 'disabled' : ''}>${esc(d.score?.note || '')}</textarea></label>
      <div class="card" style="position:sticky;bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px">
        <div><div class="eyebrow">Total</div><div><span class="display" id="tot" style="font-size:2.2rem">${total()}</span> <span class="muted">/ ${RUBRIC_TOTAL}</span></div></div>
        ${locked ? '' : `<button class="btn btn-primary" type="submit" id="save" style="width:auto">${d.score ? 'Update score' : 'Save score'}</button>`}
      </div>
    </form>`;
  if (locked) return;
  const f = document.getElementById('f');
  f.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
    marks[b.dataset.c] = Number(b.dataset.v);
    f.querySelectorAll(`[data-c="${b.dataset.c}"]`).forEach(o => { o.classList.toggle('on', o === b); o.setAttribute('aria-pressed', o === b); });
    b.closest('.q').classList.remove('missing');
    document.getElementById('tot').textContent = total();
  });
  f.onsubmit = async ev => {
    ev.preventDefault();
    const missing = RUBRIC.filter(r => !Number.isInteger(marks[r.id]));
    if (missing.length) {
      missing.forEach(r => document.getElementById(`q_${r.id}`).classList.add('missing'));
      document.getElementById(`q_${missing[0].id}`).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return toast(`Give a mark for ${missing.map(r => r.label).join(', ')}`, true);
    }
    const btn = document.getElementById('save');
    btn.disabled = true;
    try {
      const r = await api('score', { id: team.id, marks, note: document.getElementById('note').value });
      toast(`Saved · ${team.name} · ${r.total}/${RUBRIC_TOTAL}`); go('#/');
    } catch (e) { toast(e.network ? 'Not sent. Try again.' : e.message, true); btn.disabled = false; }
  };
}

// ---------------- router ----------------

async function route() {
  clearInterval(pollTimer);
  formKeep = null;
  scrollTo(0, 0);
  if (!token) return viewJoin();
  if (!me) { try { me = (await api('home')).me; } catch (e) { if (!token) return viewJoin(); return fail(e); } }
  const [, page, a, b] = (location.hash || '#/').split('/');
  try {
    if (page === 'team') return await viewTeam(a);
    if (page === 'judge' && JUDGING) return await viewJudgeTeam(a);
    if (page === 'form') return await viewForm(a, b);
    if (page === 'help') return await viewHelp();
    if (page === 'raise') return await viewRaise(a);
    if (page === 'picks' && JUDGING) return await viewPicks();
    if (page === 'mine') return await viewMine();
    if (page === 'me') return await viewJoin(true);
    if (page === 'brief' || !store.get('md_briefed')) return await viewBrief();
    return await viewHome();
  } catch (e) { fail(e); }
}
addEventListener('hashchange', route);
route();
checkHelp();
