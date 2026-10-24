// Shared by the mentor app and the organizer dashboard.
import CONFIG from '../event.config.js';
export { CONFIG };

// judging.enabled: false turns off top-two picks, finalists, booths and scoring (check-ins and help only).
export const JUDGING = CONFIG.judging?.enabled !== false;

// Brand colours from the config (tints are mixed from them).
{
  const t = CONFIG.theme || {}, root = document.documentElement.style;
  if (t.primary) { root.setProperty('--blue', t.primary); root.setProperty('--blue-tint', `color-mix(in srgb, ${t.primary} 9%, #fff)`); }
  if (t.primaryDeep) root.setProperty('--blue-deep', t.primaryDeep);
  if (t.accent) { root.setProperty('--orange', t.accent); root.setProperty('--orange-tint', `color-mix(in srgb, ${t.accent} 8%, #fff)`); }
  if (t.accentDeep) root.setProperty('--orange-deep', t.accentDeep);
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtTime = iso => iso
  ? new Date(iso).toLocaleTimeString(CONFIG.event.locale || undefined, { timeZone: CONFIG.event.timezone || undefined, hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()
  : '';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// POST /api/rpc with retries on network failure (patchy venue Wi-Fi).
export async function rpc(action, args = {}, headers = {}, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch('/api/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ action, args }),
      });
      const data = await res.json().catch(() => ({}));
      netState(true);
      if (!res.ok) { const e = new Error(data.error || 'Something went wrong'); e.status = res.status; throw e; }
      return data;
    } catch (e) {
      if (e.status) throw e;
      lastErr = e;
      netState(false);
      if (i < retries) await sleep(800 * (i + 1));
    }
  }
  const e = new Error('No connection. Check Wi-Fi and try again.');
  e.network = true; e.cause = lastErr;
  throw e;
}

function netState(ok) {
  let el = document.getElementById('net');
  if (ok) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'net'; el.className = 'net';
    el.textContent = 'Weak connection · retrying…';
    document.body.appendChild(el);
  }
  el.hidden = false;
}

let toastTimer;
export function toast(msg, err = false) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('err', err);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export const SKILLS = CONFIG.skills;

// Where a team sits. Plain: "15" -> "Table 15". With floorTables on:
// "15" -> "Lower · Table 15", "UPPER 10" -> "Upper · Table 10", "UPPER" -> "Upper floor".
export const tableLabel = t => {
  t = String(t || '').trim();
  if (!t) return '';
  if (!CONFIG.floorTables) return /^\d/.test(t) ? `Table ${t}` : t;
  const m = t.match(/^(upper|lower)?\s*(?:floor)?\s*(?:table)?\s*([\w-]*)$/i);
  if (!m) return t;
  const floor = (m[1] || (/^\d/.test(m[2]) ? 'lower' : '')).toLowerCase();
  const F = floor ? floor[0].toUpperCase() + floor.slice(1) : '';
  if (!m[2]) return F ? `${F} floor` : t;
  return F ? `${F} · Table ${m[2]}` : t;
};

// Check-in forms, per round. See docs/CONFIG.md.
export const FORMS = CONFIG.forms;

export const visible = (q, answers) => {
  if (!q.showIf) return true;
  const [k, v] = q.showIf;
  return Array.isArray(v) ? v.includes(answers[k]) : answers[k] === v;
};

export const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

// Morning judging rubric. Judges tap one of six levels per criterion.
export const RUBRIC = CONFIG.rubric;
export const RUBRIC_TOTAL = RUBRIC.reduce((a, r) => a + r.max, 0);
export const levels = max => [0, 1, 2, 3, 4, 5].map(i => Math.round((max / 5) * i * 10) / 10);
