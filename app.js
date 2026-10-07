'use strict';
/* Focus Log — everything lives in localStorage under one versioned key. No network calls. */

const KEY = 'focusLog';
const SCHEMA = 6;
const MID_MS = 3 * 60000; // a booster added later than this counts as "mid-session"
const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const GREY = '#8d7f72';
// Themes: the CSS side lives in styles.css under [data-theme]; charts need the accent and a one-hue ramp (lighter = more).
const THEMES = {
  coffee: { name: 'Coffee', bg: '#17110d', acc: '#d9b98a', seq: ['#5c4330', '#86623f', '#b08552', '#d4ab78', '#f2dcb8'] },
  midnight: { name: 'Midnight', bg: '#0b1020', acc: '#e8b86d', seq: ['#5a4424', '#8a6a35', '#b98f4a', '#e0b46a', '#f6dcae'] },
  rose: { name: 'Rose', bg: '#1a0b0e', acc: '#e8b4a0', seq: ['#5e2a30', '#8c4347', '#b96a66', '#dc988c', '#f5cdbd'] },
  blossom: { name: 'Cherry Blossom', bg: '#1b1418', acc: '#f5a9c4', seq: ['#5c3044', '#8a4a66', '#b96c8a', '#e394b1', '#fbc9da'] },
  ivy: { name: 'Ivy', bg: '#0d1510', acc: '#b5d08f', seq: ['#2f4a33', '#4a6e48', '#6f9760', '#9cc083', '#d2e8b8'] },
  royal: { name: 'Royal', bg: '#130d1f', acc: '#e3c06a', seq: ['#5a4a22', '#8a7233', '#b99a48', '#e0c064', '#f6e3a8'] }
};
let SEQ = THEMES.coffee.seq, ACC = THEMES.coffee.acc;
function applyTheme() {
  const k = THEMES[db.settings.theme] ? db.settings.theme : 'coffee', t = THEMES[k];
  SEQ = t.seq; ACC = t.acc;
  document.documentElement.dataset.theme = k;
  document.querySelector('meta[name=theme-color]').content = t.bg;
}
const BREAKS = ['Washroom break', 'Stretch break', 'Walk break', 'Phone break'];
// How much a break counts against focus: washroom is free, stretching or walking counts half,
// a phone break or any other reason counts in full and is also logged as a distraction. Unanswered = half.
const breakWeight = r => !r ? 0.5 : /washroom/i.test(r) ? 0 : /stretch|walk/i.test(r) ? 0.5 : 1;
const BREAK_NOTE = w => w === 0 ? 'does not affect focus' : w < 1 ? 'small effect on focus' : 'counts as a distraction';
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const sum = a => a.reduce((x, y) => x + y, 0);
const avg = (list, fn) => list.length ? sum(list.map(fn)) / list.length : null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const weekStart = t => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); };
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const dowIdx = t => (new Date(t).getDay() + 6) % 7;
const fmtDate = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtShort = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtTime = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const fmtHour = h => (h % 12 || 12) + (h < 12 ? 'am' : 'pm');
const fmtH = min => (min / 60).toFixed(min >= 600 ? 0 : 1) + 'h';
const fmtDur = min => { min = Math.round(min); return min >= 60 ? Math.floor(min / 60) + 'h ' + pad(min % 60) + 'm' : min + 'm'; };
const fmtClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); return (h ? h + ':' + pad(Math.floor(s % 3600 / 60)) : Math.floor(s / 60)) + ':' + pad(s % 60); };
const f1 = v => v == null ? '–' : v.toFixed(1);
const localISO = t => dayKey(t) + 'T' + fmtTime(t);
const getPath = (o, p) => p.split('.').reduce((x, k) => x == null ? x : x[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((x, k) => x[k] ??= {}, o)[last] = v; };
const hashPin = p => { let h = 5381; for (const c of 'fl|' + p) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return String(h); };

/* ---------- data ---------- */
function defaults() {
  const mk = (names, cols) => names.map((name, i) => ({ id: uid() + i, name, color: cols ? cols[i] : PALETTE[i % PALETTE.length] }));
  return {
    schema: SCHEMA,
    subjects: mk(['Math', 'Physics', 'Computer Science', 'Writing']),
    types: mk(['Study', 'Assignment', 'Project', 'Club work']),
    crews: mk(['Alone', 'Bits', 'Weband', 'Others'], ['#898781', '#3987e5', '#d95926', '#199e70']), // v5: who you studied with
    tags: mk(['N-Method', 'E-Boost', 'Music'], ['#9085e9', '#d95926', '#d55181']),
    sessions: [],
    goals: { daily: 2, weekly: 12, subjects: {} },
    deleted: {}, metaU: 0, checkins: {}, moods: [],
    settings: { pin: null, theme: 'coffee', neglectDays: 7, lastSubject: null, lastType: null, lastCrew: null },
    active: null
  };
}
// Bring any older saved shape up to the current schema. Add `if (d.schema < 2) {...}` steps here later.
function migrate(d) {
  const def = defaults();
  if (!d.schema) d.schema = 1;
  for (const k of ['subjects', 'types', 'tags', 'crews', 'sessions']) if (!Array.isArray(d[k])) d[k] = def[k];
  if (d.schema < 2) { // v2 dropped the "Library" and "Phone Away" boosters
    const gone = new Set(d.tags.filter(t => t.name === 'Library' || t.name === 'Phone Away').map(t => t.id));
    d.tags = d.tags.filter(t => !gone.has(t.id));
    for (const x of [...d.sessions, d.active]) if (x && x.tags) x.tags = x.tags.filter(t => !gone.has(t.id));
  }
  d.deleted ||= {}; d.metaU ||= 0; // v3: sync bookkeeping (when things were deleted / when goals and theme last changed)
  d.goals = Object.assign(def.goals, d.goals); d.goals.subjects ||= {};
  d.settings = Object.assign(def.settings, d.settings);
  if (!Array.isArray(d.moods)) d.moods = []; // v6: energy/mood check-ins through the day
  d.checkins ||= {}; // v4: one check-in per day, shared by that day's sessions
  d.sessions.forEach(s => { s.tags ||= []; });
  d.schema = SCHEMA;
  d.sessions.forEach(setFocus); // v4: focus is recomputed from distractions and breaks
  return d;
}
function load() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* corrupt → start fresh */ }
  return migrate(d && typeof d === 'object' ? d : defaults());
}
function saveLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Could not save — storage full?'); }
}
function save() { saveLocal(); scheduleSync(); }
let db;

const UNKNOWN = { id: '', name: 'Deleted', color: GREY };
const subj = id => db.subjects.find(x => x.id === id) || UNKNOWN;
const crew = id => db.crews.find(x => x.id === id) || { id: '', name: '', color: GREY };
const typ = id => db.types.find(x => x.id === id) || { id: '', name: '', color: GREY };
const tagById = id => db.tags.find(x => x.id === id);
const effMin = s => Math.max(0, (s.end - s.start - (s.pausedMs || 0)) / 60000);
const score = s => effMin(s) * (s.focus / 5) * (s.output / 5);
// minutes of break per reason; paused time without a logged reason (manual entries, old sessions) is "Unspecified"
function breakMins(list) {
  const out = {}; let n = 0;
  for (const s of list) {
    let logged = 0;
    for (const p of s.pauses || []) { const m = (p.end - p.start) / 60000; out[p.reason || 'Unspecified'] = (out[p.reason || 'Unspecified'] || 0) + m; logged += m; n++; }
    const rest = (s.pausedMs || 0) / 60000 - logged; if (rest > 0.5) { out.Unspecified = (out.Unspecified || 0) + rest; n++; }
  }
  return { out, n };
}
// Focus is measured, not just self-reported. It starts at 5 and loses points, mostly for distractions:
//  - distractions per hour (your taps, plus every phone/other break): 0.6 each, up to 3.5
//  - weighted break time beyond 15% of the clock: up to 1.5
//  - more than two non-washroom breaks an hour: up to 0.5
//  - each stretch or walk break: a small flat 0.15, up to 0.6
function focusParts(s) {
  const eff = effMin(s), hrs = Math.max(eff, 15) / 60, paused = (s.pausedMs || 0) / 60000, ps = s.pauses || [];
  let logged = 0, weighted = 0, asDist = 0, chop = 0, light = 0;
  for (const p of ps) { const m = (p.end - p.start) / 60000, w = breakWeight(p.reason); logged += m; weighted += m * w; if (w >= 1) asDist++; else if (w > 0 && p.reason) light++; if (w > 0) chop++; }
  const rest = Math.max(0, paused - logged); weighted += rest * 0.5; if (!ps.length && rest >= 1) chop++; // break time with no reason on record
  const dist = (s.distractions || 0) + asDist;
  const lost = Math.min(3.5, dist / hrs * 0.6) + Math.min(1.5, Math.max(0, weighted / ((paused + eff) || 1) - 0.15) * 5) + Math.min(0.5, Math.max(0, chop / hrs - 2) * 0.25) + Math.min(0.6, light * 0.15);
  return { score: Math.round(clamp(5 - lost, 1, 5) * 10) / 10, dist, asDist, weighted, paused };
}
const autoFocus = s => focusParts(s).score;
const distOf = s => focusParts(s).dist; // taps plus breaks that count as distractions
// s.fa = measured score, s.focusSelf = your own optional rating, s.focus = what the stats use (60% measured, 40% yours)
function setFocus(s) {
  if (!('fa' in s) && !('focusSelf' in s)) s.focusSelf = s.focus || null; // session saved before focus was measured
  s.fa = autoFocus(s);
  s.focus = s.focusSelf ? Math.round((0.6 * s.fa + 0.4 * s.focusSelf) * 10) / 10 : s.fa;
  return s;
}
// The check-in day rolls over at 4am, so a 1am session still belongs to the night before it.
const ckDayOf = t => dayKey(t - 4 * 3600e3), ckDay = () => ckDayOf(Date.now());
const tagIds = s => s.tags.map(t => t.id).filter(tagById);

db = load();
applyTheme();

const ui = {
  tipI: Math.floor(Date.now() / 864e5), // a different tip each day; tap to cycle
  tab: 'timer', statsTab: 'overview', cmp: 'focus', pm: 'eff',
  f: { range: '30d', from: '', to: '', subject: '', type: '', tag: '' },
  hist: { subject: '', type: '', tag: '', q: '' },
  setup: false, ck: null, ckEdit: false, start: null, end: { focus: 0, output: 0, note: '', energy: 0, mood: 0 }, now: { energy: 0, mood: 0 },
  modal: null, pinBuf: ''
};
function freshStart() {
  ui.setup = false; ui.startDay = ckDay(); ui.ck ||= blankCk();
  ui.start = {
    subjectId: subj(db.settings.lastSubject).id || db.subjects[0]?.id || '',
    typeId: typ(db.settings.lastType).id || db.types[0]?.id || '',
    crewId: crew(db.settings.lastCrew).id || db.crews[0]?.id || '', // defaults to the first group ("Alone") until you pick another
    task: '', tags: {}, planned: ''
  };
}

/* ---------- small UI pieces ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200); }
function showTip(text, x, y) {
  const t = $('#tip'); t.textContent = text; t.hidden = false;
  const r = t.getBoundingClientRect();
  t.style.left = clamp(x - r.width / 2, 8, innerWidth - r.width - 8) + 'px';
  t.style.top = (y - r.height - 14 < 8 ? y + 18 : y - r.height - 14) + 'px';
}
const hideTip = () => { $('#tip').hidden = true; document.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); };
// In-app confirm sheet: native confirm() is silently blocked in some embedded/home-screen contexts.
let askCb = null;
function ask(msg, cb, label = 'Confirm') {
  askCb = cb;
  let h = $('#ask'); if (!h) { h = document.createElement('div'); h.id = 'ask'; document.body.appendChild(h); }
  h.innerHTML = `<div class="modal" style="z-index:70;align-items:center" data-a="askNo"><div class="sheet still" style="border-radius:22px;width:calc(100% - 48px);max-width:360px;padding:20px"><div style="margin-bottom:16px">${esc(msg)}</div><div class="row"><button class="btn grow" data-a="askNo" data-force>Cancel</button><button class="btn danger grow" data-a="askYes">${esc(label)}</button></div></div></div>`;
}
const rate = (path, val) => `<div class="rate">${[1, 2, 3, 4, 5].map(n => `<button data-a="set" data-n data-path="${path}" data-v="${n}" class="${+val === n ? 'on' : ''}">${n}</button>`).join('')}</div>`;
const pick = (items, path, val, extra = '') => `<div class="chips">${items.map(x => `<button class="chip ${val === x.id ? 'on' : ''}" style="--c:${x.color}" data-a="set" data-keep data-path="${path}" data-v="${x.id}"><i></i>${esc(x.name)}</button>`).join('')}${extra}</div>`;
const tagPills = s => tagIds(s).map(id => { const t = tagById(id); return `<span class="tagpill" style="--c:${t.color}"><i></i>${esc(t.name)}</span>`; }).join('');
const legend = items => `<div class="legend">${items.map(x => `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join('')}</div>`;
const smallN = n => n < 5 ? `<span class="warn">low sample · ${n}</span>` : '';
const options = (items, val, any) => `<option value="">${any}</option>` + items.map(x => `<option value="${x.id}" ${val === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
const tagOptions = (val, any) => options(db.tags, val, any) + `<option value="none" ${val === 'none' ? 'selected' : ''}>No boosters</option>`;

/* ---------- vector icons ---------- */
const ICONS = {
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke-linejoin="round"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
  book: '<path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h12"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.9 2-2 0-1.4 1-2 2.3-2H18a3 3 0 0 0 3-3c0-6-4-11-9-11z"/><circle cx="7.8" cy="11" r=".8"/><circle cx="11" cy="7.5" r=".8"/><circle cx="15.5" cy="8.5" r=".8"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  download: '<path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14"/>',
  upload: '<path d="M12 16V5M7.5 9L12 4.5 16.5 9M5 20h14"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.5 15h9"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7"/>',
  chart: '<path d="M5 20V11M12 20V4M19 20v-7M3 20h18"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  pie: '<path d="M11 4a8.5 8.5 0 1 0 9 9h-9z"/><path d="M14.5 3.5a7 7 0 0 1 6 6h-6z"/>',
  table: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 14.5h16M10 5v14"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  note: '<path d="M5 5h14v10l-4 4H5zM15 19v-4h4M8 9h8M8 12.5h5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 13.8c2.2.6 3.5 2.4 3.5 5.2"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9.5a4.2 4.2 0 0 1-.5 8.5z"/>',
  cup: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h2a2.5 2.5 0 0 1 0 5h-2M8 3v3M12 3v3"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M9 9.5v1M15 9.5v1M8 14q4 4 8 0"/>',
  alert: '<path d="M12 4l9 16H3zM12 10v4.5M12 17.5v.5"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"/>'
};
const ic = (name, size = 18) => `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICONS[name]}</svg>`;
// mood faces: the mouth curves from a frown (1) to a smile (5)
const face = n => { const k = (n - 3) * 1.9; return `<svg class="ic" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 9.5v1M15 9.5v1"/><path d="M8 ${15 - k / 3}Q12 ${15 - k / 3 + k} 16 ${15 - k / 3}"/></svg>`; };
// energy: a battery filled to n fifths
const battery = n => `<svg class="ic" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect x="3" y="7.5" width="16" height="9" rx="2.2"/><path d="M21.5 10.5v3"/><rect x="5" y="9.5" width="${12 * n / 5}" height="5" rx="1" fill="currentColor" stroke="none"/></svg>`;
const scale = (path, val, icon, words) => `<div class="scale">${[1, 2, 3, 4, 5].map(n => `<button class="${+val === n ? 'on' : ''}" data-a="set" data-n data-path="${path}" data-v="${n}" aria-label="${words[n - 1]}">${icon(n)}</button>`).join('')}</div><div class="scaleword">${val ? words[val - 1] : '&nbsp;'}</div>`;
const pips = n => `<span class="pips">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
const emptyState = (icon, text, extra = '') => `<div class="empty"><span class="emptyic">${ic(icon, 30)}</span><div>${text}</div>${extra}</div>`;
const ENERGY = ['Drained', 'Low', 'Okay', 'Good', 'Wired'], MOOD = ['Rough', 'Meh', 'Fine', 'Good', 'Great'];
let TICKS = '';
for (let i = 0; i < 60; i++) { const a = i * 6 * Math.PI / 180, r1 = i % 5 ? 122 : 118; TICKS += `<line class="tick${i % 5 ? '' : ' maj'}" x1="${(130 + Math.cos(a) * r1).toFixed(1)}" y1="${(130 + Math.sin(a) * r1).toFixed(1)}" x2="${(130 + Math.cos(a) * 126).toFixed(1)}" y2="${(130 + Math.sin(a) * 126).toFixed(1)}"/>`; }
const RING_C = 2 * Math.PI * 106;
function sleepHrs(bed, wake) { // 'HH:MM' strings → hours slept, wrapping past midnight
  if (!bed || !wake) return null;
  const m = t => +t.slice(0, 2) * 60 + +t.slice(3), d = (m(wake) - m(bed) + 1440) % 1440;
  return d ? Math.round(d / 15) / 4 : null;
}
const fmtSleep = h => h == null ? '– –' : Math.floor(h) + 'h ' + pad(Math.round(h % 1 * 60)) + 'm';

/* ---------- render root ---------- */
function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.tab));
  $('#view').innerHTML = { timer: viewTimer, stats: viewStats, history: viewHistory, settings: viewSettings }[ui.tab]();
  renderModal();
  tick();
}

let animT;
function animate(dir = '') {
  const v = $('#view'); v.classList.remove('enter', 'fwd', 'back'); void v.offsetWidth; // restart the CSS animations
  v.classList.add('enter'); if (dir) v.classList.add(dir);
  clearTimeout(animT); animT = setTimeout(() => v.classList.remove('enter', 'fwd', 'back'), 1400);
}

// One-line tips from your own last 30 days. Only claims with at least 3 sessions behind each side make the list.
function insights() {
  const now = Date.now(), L = db.sessions.filter(s => s.start >= now - 30 * 864e5), out = [];
  const eff = g => { const m = sum(g.map(effMin)); return m ? sum(g.map(score)) / m * 100 : 0; };
  if (L.length >= 3) {
    const bl = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ i, g: L.filter(s => Math.floor(new Date(s.start).getHours() / 3) === i) })).filter(x => x.g.length >= 3).sort((x, y) => eff(y.g) - eff(x.g));
    if (bl.length >= 2) out.push(`Your sharpest window is <b>${fmtHour(bl[0].i * 3)}–${fmtHour((bl[0].i * 3 + 3) % 24)}</b>: ${Math.round(eff(bl[0].g))}% effective, against ${Math.round(eff(bl[bl.length - 1].g))}% at ${fmtHour(bl[bl.length - 1].i * 3)}.`);
    const cr = db.crews.map(c => ({ c, g: L.filter(s => s.crewId === c.id) })).filter(x => x.g.length >= 3).sort((x, y) => eff(y.g) - eff(x.g));
    if (cr.length >= 2) out.push(`You get the most done <b>${/^alone$/i.test(cr[0].c.name) ? 'on your own' : 'with ' + esc(cr[0].c.name)}</b> (${Math.round(eff(cr[0].g))}% effective), the least ${/^alone$/i.test(cr[cr.length - 1].c.name) ? 'on your own' : 'with ' + esc(cr[cr.length - 1].c.name)} (${Math.round(eff(cr[cr.length - 1].g))}%).`);
    const hi = L.filter(s => s.sleep >= 7), lo = L.filter(s => s.sleep != null && s.sleep < 6);
    if (hi.length >= 3 && lo.length >= 3) out.push(`After 7h or more of sleep your focus averages <b>${f1(avg(hi, s => s.focus))}</b>, against ${f1(avg(lo, s => s.focus))} on under 6h.`);
    const w1 = L.filter(s => s.start >= now - 7 * 864e5), w0 = L.filter(s => s.start < now - 7 * 864e5 && s.start >= now - 14 * 864e5), dph = g => sum(g.map(distOf)) / (sum(g.map(effMin)) / 60 || 1);
    if (w1.length >= 3 && w0.length >= 3) out.push(`Distractions this week: <b>${dph(w1).toFixed(1)} an hour</b>, ${dph(w1) <= dph(w0) ? 'down' : 'up'} from ${dph(w0).toFixed(1)} last week.`);
  }
  const st = streaks(db.sessions), goal = db.goals.daily, today = minsBetween(db.sessions, startOfDay(now), now + 1);
  if (st.cur >= 2) out.push(`You are on a <b>${st.cur}-day streak</b>. Your best so far is ${st.best}.`);
  if (goal && today < goal * 60 && today > 0) out.push(`<b>${fmtDur(goal * 60 - today)}</b> more today reaches your ${goal}h goal.`);
  return out.length ? out : ['Log a few sessions and tips drawn from your own numbers will show up here.'];
}
function milestones() {
  const S = db.sessions, hrs = sum(S.map(effMin)) / 60, best = streaks(S).best, hr = s => new Date(s.start).getHours();
  const M = (icon, name, desc, cur, goal) => ({ icon, name, desc, cur: Math.min(cur, goal), goal, done: cur >= goal });
  return [
    M('play', 'First step', 'Finish your first session', S.length, 1),
    M('clock', '10 hours', 'Log 10 hours in total', hrs, 10), M('clock', '50 hours', 'Log 50 hours in total', hrs, 50), M('trophy', '100 hours', 'Log 100 hours in total', hrs, 100),
    M('flame', '3-day streak', 'Study 3 days in a row', best, 3), M('flame', 'One week', 'Study 7 days in a row', best, 7), M('flame', 'Two weeks', 'Study 14 days in a row', best, 14), M('trophy', '30-day streak', 'Study 30 days in a row', best, 30),
    M('target', 'Deep diver', '10 sessions with focus 4 or higher', S.filter(s => s.focus >= 4).length, 10),
    M('check', 'Clean hour', 'An hour-long session with no distractions', S.some(s => effMin(s) >= 60 && distOf(s) === 0) ? 1 : 0, 1),
    M('sun', 'Early bird', '5 sessions started before 8am', S.filter(s => hr(s) >= 4 && hr(s) < 8).length, 5),
    M('moon', 'Night owl', '5 sessions started after 10pm', S.filter(s => hr(s) >= 22 || hr(s) < 4).length, 5),
    M('smile', 'Well rested', 'Log 7h or more of sleep on 7 days', Object.values(db.checkins).filter(c => c.sleep >= 7).length, 7),
    M('spark', 'Self-aware', 'Log your energy and mood 20 times', db.moods.length, 20)
  ];
}
function spark(vals) { // small area line under the headline numbers
  if (vals.length < 3 || !vals.some(v => v > 0)) return '';
  const W = 300, H = 44, max = Math.max(...vals), d = vals.map((v, i) => (i ? 'L' : 'M') + (i / (vals.length - 1) * W).toFixed(1) + ' ' + (H - 3 - v / max * (H - 10)).toFixed(1)).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="spg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".4"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><path d="${d}L${W} ${H}L0 ${H}Z" fill="url(#spg)"/><path class="draw" pathLength="1" d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

/* ================= TIMER ================= */
function elapsedMs(a, now = Date.now()) { return (a.pauseStart || now) - a.start - a.pausedMs; }
function pausedMs(a, now = Date.now()) { return a.pausedMs + (a.pauseStart ? now - a.pauseStart : 0); }

function viewTimer() {
  const a = db.active;
  if (!a) return viewStart();
  return a.ending ? viewEnd(a) : viewLive(a);
}
function viewStart() {
  if (!db.subjects.length) return `<h1>Today</h1>` + emptyState('book', 'Add a subject in Settings first.');
  return ui.setup ? viewSetup() : viewHome();
}
// Landing screen: today on a dial, one button, and the optional check-in. Options come on the next screen.
function viewHome() {
  const s = ui.start, now = Date.now(), today = db.sessions.filter(x => x.start >= startOfDay(now)), min = sum(today.map(effMin)), goal = db.goals.daily, st = streaks(db.sessions);
  const frac = goal ? clamp(min / 60 / goal, 0, 1) : 0, c = ui.ck, done = db.checkins[ckDay()], lm = lastMood();
  const wk0 = weekStart(now), week = DOW.map((d, i) => { const a0 = addDays(wk0, i); return { name: d, m: minsBetween(db.sessions, a0, addDays(a0, 1)), today: a0 === startOfDay(now) }; }), wmax = Math.max(60, (goal || 0) * 60, ...week.map(w => w.m));
  return `<div class="home">
  <div class="greet"><b>${(h => h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Late night')(new Date().getHours())}</b><span>${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
  <div class="ringwrap"><svg viewBox="0 0 260 260">${TICKS}<circle class="ring-bg" cx="130" cy="130" r="106"/>${goal ? `<circle class="ring-fg ${frac >= 1 ? 'done' : ''}" style="--full:${RING_C}" cx="130" cy="130" r="106" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C * (1 - frac)}"/>` : ''}</svg>
    <div class="ringin"><span class="eyebrow">Today</span><div class="today">${fmtDur(min)}</div><div class="small muted">${goal ? 'of ' + goal + 'h goal' : 'studied'}</div></div></div>
  <div class="trio"><div>${ic('layers')}<b>${today.length}</b><span>session${today.length === 1 ? '' : 's'}</span></div><div>${ic('flame')}<b>${st.cur}</b><span>day streak</span></div><div>${ic('target')}<b>${goal ? Math.round(frac * 100) + '%' : '–'}</b><span>of goal</span></div></div>
  <div class="week">${week.map(w => `<div class="${w.today ? 'on' : ''}" data-tip="${w.name}\n${fmtDur(w.m)}"><i style="height:${Math.max(4, w.m / wmax * 42)}px"></i><span>${w.name[0]}</span></div>`).join('')}</div>
  <button class="btn primary block big" data-a="newSession">${ic('play', 20)}New session</button>
  ${(l => l && subj(l.subjectId).id ? `<button class="quick" data-a="quickStart"><span class="dot" style="background:${subj(l.subjectId).color}"></span><span class="grow">Repeat last<span class="isub">${esc([subj(l.subjectId).name, typ(l.typeId).name, crew(l.crewId).name].filter(Boolean).join(' · '))}</span></span>${ic('play', 16)}</button>` : '')(db.sessions.reduce((m, x) => !m || x.start > m.start ? x : m, null))}
  ${(tips => `<button class="tip" data-a="nextTip">${ic('spark', 17)}<span class="grow">${tips[ui.tipI % tips.length]}</span>${tips.length > 1 ? `<small>${ui.tipI % tips.length + 1}/${tips.length}</small>` : ''}</button>`)(insights())}
  ${done && !ui.ckEdit ? `<button class="ckdone" data-a="ckEdit">${ic('moon', 16)}<span class="grow">Checked in today${ckSummary(done) ? ' · ' + ckSummary(done).replace(/^(\d)/, 'slept $1').toLowerCase() : ''}${done.energy ? ' · energy ' + ENERGY[done.energy - 1].toLowerCase() : ''}${done.mood ? ' · mood ' + MOOD[done.mood - 1].toLowerCase() : ''}</span>${ic('check', 16)}</button>` : `<div class="card checkin">
    <div class="ck-head"><b>Daily check-in</b><span>once a day</span></div>
    ${ckForm('ck', c)}
    <button class="btn block" style="margin-top:10px" data-a="ckSave">${ic('check', 18)}Save check-in</button>
  </div>`}
  <button class="ckdone ${moodDue() ? 'due' : ''}" style="margin-top:10px" data-a="moodOpen">${ic('sun', 16)}<span class="grow">How are you right now?<span class="isub">${lm ? 'Last check ' + ago(lm.t) + (moodWords(lm) ? ' · ' + moodWords(lm) : '') : 'No energy or mood check yet'}</span></span><span class="chev">›</span></button>
  <button class="btn ghost block" style="margin-top:6px" data-a="sleepLog">${ic('moon', 17)}Sleep log · add or fix another day</button>
  <button class="btn ghost block" data-a="addSession">Add a past session</button></div>`;
}
function viewSetup() {
  const s = ui.start, tasks = [...new Set(db.sessions.slice(-40).map(x => x.task).filter(Boolean))].slice(-12);
  return `<div class="row between" style="margin-bottom:6px"><button class="back" data-a="backHome">‹ Back</button></div>
  <h1>New session</h1>
  <div class="group"><span class="lbl">${ic('book', 14)}Subject</span>${pick(db.subjects, 'start.subjectId', s.subjectId)}</div>
  <div class="group"><span class="lbl">${ic('layers', 14)}Type</span>${pick(db.types, 'start.typeId', s.typeId)}
    <input type="text" style="margin-top:12px" placeholder="Working on… (optional)" data-m="start.task" value="${esc(s.task)}" list="tasks">
    <datalist id="tasks">${tasks.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
  ${db.crews.length ? `<div class="group"><span class="lbl">${ic('people', 14)}Studying with <em>· tap again to clear</em></span>
    <div class="chips">${db.crews.map(x => `<button class="chip ${s.crewId === x.id ? 'on' : ''}" style="--c:${x.color}" data-a="set" data-path="start.crewId" data-v="${x.id}"><i></i>${esc(x.name)}</button>`).join('')}</div></div>` : ''}
  <div class="group"><span class="lbl">${ic('spark', 14)}Boosters <em>· leave empty for none</em></span>
    <div class="chips">${db.tags.map(t => `<button class="chip ${s.tags[t.id] ? 'on' : ''}" style="--c:${t.color}" data-a="startTag" data-v="${t.id}"><i></i>${esc(t.name)}</button>`).join('')}</div></div>
  <div class="group"><span class="lbl">${ic('clock', 14)}Planned length</span>
    <div class="row"><div class="seg grow">${[['', 'Open'], ['25', '25m'], ['50', '50m'], ['90', '90m']].map(([v, l]) => `<button class="${String(s.planned) === v ? 'on' : ''}" data-a="set" data-keep data-path="start.planned" data-v="${v}">${l}</button>`).join('')}</div>
    <input type="number" inputmode="numeric" min="1" placeholder="min" style="width:76px" data-m="start.planned" value="${[25, 50, 90].includes(+s.planned) ? '' : esc(s.planned)}"></div></div>
  <button class="btn primary block big" data-a="start">${ic('play', 20)}Start</button>`;
}
function viewLive(a) {
  const sub = subj(a.subjectId), ty = typ(a.typeId);
  return `<div class="live ${a.pauseStart ? 'paused' : ''}">
  <div class="livehead"><span class="dot" style="background:${sub.color}"></span><b>${esc(sub.name)}</b>${ty.name ? `<span class="muted">· ${esc(ty.name)}</span>` : ''}${crew(a.crewId).name ? `<span class="muted">· ${esc(crew(a.crewId).name)}</span>` : ''}</div>
  ${a.task ? `<div class="small muted">${esc(a.task)}</div>` : ''}
  <div class="ringwrap"><svg viewBox="0 0 260 260">${TICKS}<circle class="ring-bg" cx="130" cy="130" r="106"/><circle id="ring" class="ring-fg ${a.planned ? '' : 'sweep'}" cx="130" cy="130" r="106" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/></svg>
    <div class="ringin"><span class="eyebrow" id="tState"></span><div class="elapsed" id="tElapsed">0:00</div><div class="small muted" id="tSub"></div></div></div>
  <div class="live-actions">
    <button class="btn" data-a="pause">${ic(a.pauseStart ? 'play' : 'pause')}${a.pauseStart ? 'Resume' : 'Pause'}</button>
    <button class="btn" data-a="distract">${ic('bolt')}Distraction <span class="badge" id="tDist">${a.distractions}</span></button>
    <button class="btn primary wide" data-a="end">${ic('check', 20)}Finish session</button>
  </div>
  <span class="lbl" style="text-align:left">${ic('spark', 14)}Boosters <em>· tap to add or remove</em></span>
  <div class="chips">${db.tags.map(t => { const on = a.tags.find(x => x.id === t.id); return `<button class="chip ${on ? 'on' : ''}" style="--c:${t.color}" data-a="liveTag" data-v="${t.id}"><i></i>${esc(t.name)}${on ? `<span class="muted small">${on.at < MID_MS ? 'start' : '+' + Math.round(on.at / 60000) + 'm'}</span>` : ''}</button>`; }).join('')}</div>
  </div>`;
}
function viewEnd(a) {
  const e = ui.end, sub = subj(a.subjectId), br = a.pausedMs / 60000, fp = focusParts({ start: a.start, end: a.pauseStart, pausedMs: a.pausedMs, distractions: a.distractions, pauses: (a.pauses || []).filter(p => p.end) }), fa = fp.score;
  return `<div class="done">
    <span class="donebadge">${ic('check', 30)}</span>
    <div class="eyebrow">Session done</div>
    <div class="today">${fmtDur(elapsedMs(a) / 60000)}</div>
    <div class="livehead"><span class="dot" style="background:${sub.color}"></span><b>${esc(sub.name)}</b><span class="muted">· ${fmtTime(a.start)}–${fmtTime(a.pauseStart)}</span></div>
    <div class="sline" style="justify-content:center;margin-top:10px"><span>${ic('bolt', 14)}${a.distractions} distraction${a.distractions === 1 ? '' : 's'}</span>${br >= 1 ? `<span>${ic('cup', 14)}${Math.round(br)}m on break</span>` : ''}</div>
  </div>
  ${(g => g.length >= 3 ? `<div class="sline" style="justify-content:center;margin:12px 0 -6px"><span>${deltaHTML(pctChange(fa, avg(g, s => s.focus)))} focus vs your 30-day average (${f1(avg(g, s => s.focus))})</span></div>` : '')(db.sessions.filter(s => s.start >= Date.now() - 30 * 864e5))}
  <div class="card fscore"><div><span class="eyebrow">Focus score</span><b>${f1(fa)}</b><span class="muted"> / 5</span></div><div class="small muted">${fp.dist} distraction${fp.dist === 1 ? '' : 's'}${fp.asDist ? ` (${a.distractions} tapped + ${fp.asDist} phone/other break${fp.asDist === 1 ? '' : 's'})` : ''} and ${Math.round(br)}m of breaks${br >= 1 ? `, ${Math.round(fp.weighted)}m of it counted` : ''}, over ${fmtDur(elapsedMs(a) / 60000)}.${e.focus ? ` With your rating: <b style="color:var(--text)">${f1(Math.round((0.6 * fa + 0.4 * e.focus) * 10) / 10)}</b>.` : ''}</div></div>
  <span class="lbl">${ic('target', 14)}Your own focus rating <em>· optional</em></span>${rate('end.focus', e.focus)}
  <span class="lbl">${ic('check', 14)}Output <em>· how much got done</em></span>${rate('end.output', e.output)}
  <span class="lbl">${ic('note', 14)}Note <em>· optional</em></span><textarea data-m="end.note" placeholder="What did you get done?">${esc(e.note)}</textarea>
  <span class="lbl">${ic('sun', 14)}How do you feel now? <em>· optional</em></span>
  <div class="card" style="padding:10px 14px 6px"><div class="ck-lbl" style="margin-top:6px">Energy</div>${scale('end.energy', e.energy, battery, ENERGY)}<div class="ck-lbl" style="margin-top:8px">Mood</div>${scale('end.mood', e.mood, face, MOOD)}</div>
  <button class="btn primary block big" data-a="saveActive">${ic('check', 20)}Save session</button>
  <div class="row" style="margin-top:10px"><button class="btn grow" data-a="backToTimer">Back to timer</button><button class="btn danger grow" data-a="discard">Discard</button></div>`;
}
function tick() {
  const a = db.active, el = $('#tElapsed');
  if (!a || !el) return;
  const ms = elapsedMs(a), p = pausedMs(a);
  el.textContent = fmtClock(ms);
  const cur = a.pauses && a.pauses[a.pauses.length - 1];
  $('#tState').textContent = a.pauseStart ? 'Paused' + (cur && !cur.end && cur.reason ? ' · ' + cur.reason : '') : 'Focused';
  const bits = [];
  if (a.planned) { const left = a.planned * 60000 - ms; bits.push(left > 0 ? fmtClock(left) + ' left' : 'goal reached'); }
  if (p > 1000) bits.push(fmtClock(p) + ' on break');
  $('#tSub').textContent = bits.join(' · ');
  // with a planned length the ring fills toward it; without one it sweeps once a minute like a second hand
  const ring = $('#ring'), frac = a.planned ? clamp(ms / (a.planned * 60000), 0, 1) : (ms % 60000) / 60000;
  ring.style.strokeDashoffset = RING_C * (1 - frac); ring.classList.toggle('done', !!a.planned && frac >= 1);
}
setInterval(tick, 500);
// Coming back to the app: pull what the other device logged. On a new day, last night's sleep and the "today" numbers must start over.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (ui.startDay !== ckDay() && !ui.modal) { ui.startDay = ckDay(); ui.ck = blankCk(); ui.ckEdit = false; render(); }
  tick(); syncNow(); maybeAskMood();
});

/* ================= STATS ================= */
function matchF(f) {
  return s => (!f.subject || s.subjectId === f.subject) && (!f.type || s.typeId === f.type) &&
    (!f.tag || (f.tag === 'none' ? !tagIds(s).length : tagIds(s).includes(f.tag)));
}
function rangeBounds(f, list) {
  const now = Date.now(), first = list.length ? Math.min(...list.map(s => s.start)) : now;
  if (f.range === 'all') return [startOfDay(first), now];
  if (f.range === 'custom') return [f.from ? new Date(f.from + 'T00:00').getTime() : startOfDay(first), f.to ? new Date(f.to + 'T23:59:59').getTime() : now];
  return [addDays(startOfDay(now), -(parseInt(f.range) - 1)), now];
}
const pctChange = (cur, prev) => prev ? (cur - prev) / prev * 100 : null;
function deltaHTML(p, good = 1, suffix = '') {
  if (p == null || !isFinite(p)) return '<span class="flat">–</span>';
  if (Math.abs(p) < 0.5) return `<span class="flat">±0%${suffix}</span>`;
  return `<span class="${p * good > 0 ? 'up' : 'down'}">${p > 0 ? '↑ +' : '↓ −'}${Math.abs(p).toFixed(0)}%${suffix}</span>`;
}
function streaks(list) {
  const days = [...new Set(list.map(s => startOfDay(s.start)))].sort((a, b) => a - b), set = new Set(days);
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev != null && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  let t = startOfDay(Date.now()), cur = 0;
  if (!set.has(t)) t = addDays(t, -1);
  while (set.has(t)) { cur++; t = addDays(t, -1); }
  return { cur, best };
}
const minsBetween = (list, a, b) => sum(list.filter(s => s.start >= a && s.start < b).map(effMin));

/* --- chart primitives (plain SVG) --- */
const CW = 340;
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
const fmtTick = v => v >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1);
function frame(H, min, max, ticks, L = 30, R = 6, T = 8, B = 18) {
  let s = '';
  ticks ??= min === 0 && !/^2/.test(String(max).replace(/^0\.0*/, '')) ? 5 : 4; // keeps tick labels round (0,1,2… or 0,0.5,1…)
  for (let i = 0; i <= ticks; i++) {
    const y = H - B - (H - T - B) * i / ticks;
    s += `<line class="grid" x1="${L}" x2="${CW - R}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 5}" y="${y + 3}" text-anchor="end">${fmtTick(min + (max - min) * i / ticks)}</text>`;
  }
  return { s, L, R, T, B, pw: CW - L - R, ph: H - T - B, y: v => H - B - (v - min) / (max - min) * (H - T - B) };
}
function xLabels(labels, xOf, H) {
  const n = labels.length, idx = n <= 7 ? labels.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  return [...new Set(idx)].map(i => `<text class="ax" x="${xOf(i)}" y="${H - 4}" text-anchor="${n > 7 && i === 0 ? 'start' : n > 7 && i === n - 1 ? 'end' : 'middle'}">${esc(labels[i])}</text>`).join('');
}
const svg = (H, inner) => `<svg class="chart" viewBox="0 0 ${CW} ${H}" role="img">${inner}</svg>`;

function stackedBars(buckets) { // [{label, tip, parts:[{color,v}]}]
  const H = 180, max = niceMax(Math.max(...buckets.map(b => sum(b.parts.map(p => p.v))), 0.01));
  const fr = frame(H, 0, max), bw = fr.pw / buckets.length, w = clamp(bw - 2, 1.5, 18);
  let s = fr.s + '<g class="grow">', hits = '';
  buckets.forEach((b, i) => {
    const x = fr.L + bw * i + (bw - w) / 2; let y = fr.y(0);
    const live = b.parts.filter(p => p.v > 0);
    s += '<g class="col">';
    live.forEach((p, j) => {
      const h = p.v / max * fr.ph; y -= h;
      const gap = j < live.length - 1 && h > 3 ? 1.5 : 0, top = j === live.length - 1;
      s += `<rect class="seg" x="${x}" y="${y + gap}" width="${w}" height="${Math.max(0.5, h - gap)}" fill="${p.color}" ${top ? `rx="${Math.min(3, w / 2, h / 2)}"` : ''}/>`;
    });
    s += `<rect class="hit" x="${fr.L + bw * i}" y="${fr.T}" width="${bw}" height="${fr.ph}" data-tip="${esc(b.tip)}"/></g>`;
  });
  return svg(H, s + '</g>' + xLabels(buckets.map(b => b.label), i => fr.L + bw * i + bw / 2, H) + hits);
}
function lineChart({ labels, series, min = 0, max, fmt = f1, H = 160 }) { // series: [{name,color,values}], null = gap
  const all = series.flatMap(x => x.values).filter(v => v != null);
  if (max == null) max = niceMax(Math.max(...all, 0.01));
  const fr = frame(H, min, max), n = labels.length, xOf = i => fr.L + (n === 1 ? fr.pw / 2 : fr.pw * i / (n - 1));
  let s = fr.s, hits = '';
  for (const se of series) {
    let d = '', pen = false;
    se.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + xOf(i).toFixed(1) + ' ' + fr.y(v).toFixed(1); pen = true; });
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pathLength="1" class="draw"/>`;
    se.values.forEach((v, i) => {
      if (v == null) return;
      if (n <= 31) s += `<circle cx="${xOf(i)}" cy="${fr.y(v)}" r="3" fill="${se.color}" stroke="var(--card)" stroke-width="1.5"/>`;
      hits += `<circle class="hit" cx="${xOf(i)}" cy="${fr.y(v)}" r="${clamp(fr.pw / n / 1.5, 5, 14)}" data-tip="${esc(labels[i] + '\n' + se.name + ': ' + fmt(v))}"/>`;
    });
  }
  return svg(H, s + xLabels(labels, xOf, H) + hits);
}
function groupedBars(cats, series, max = 5) { // series: [{name,color,values,ns}]
  const H = 160, fr = frame(H, 0, max, 5), gw = fr.pw / cats.length, bw = Math.min(16, (gw - 10) / series.length);
  let s = fr.s;
  cats.forEach((c, i) => series.forEach((se, j) => {
    const v = se.values[i]; if (v == null) return;
    const x = fr.L + gw * i + gw / 2 - (bw * series.length + 2 * (series.length - 1)) / 2 + j * (bw + 2), y = fr.y(v);
    s += `<g class="col"><rect class="bar" style="animation-delay:${i * 50}ms" x="${x}" y="${y}" width="${bw}" height="${fr.y(0) - y}" rx="3" fill="${se.color}"/><rect class="hit" x="${x - 1}" y="${fr.T}" width="${bw + 2}" height="${fr.ph}" data-tip="${esc(c + '\n' + se.name + ': ' + v.toFixed(2) + (se.ns ? '\n' + se.ns[i] + ' sessions' : ''))}"/></g>`;
  }));
  return svg(H, s + cats.map((c, i) => `<text class="ax" x="${fr.L + gw * i + gw / 2}" y="${H - 4}" text-anchor="middle">${esc(c)}</text>`).join(''));
}
function regression(pts) {
  const n = pts.length; if (n < 3) return null;
  const mx = avg(pts, p => p.x), my = avg(pts, p => p.y);
  const sxx = sum(pts.map(p => (p.x - mx) ** 2)), syy = sum(pts.map(p => (p.y - my) ** 2)), sxy = sum(pts.map(p => (p.x - mx) * (p.y - my)));
  if (!sxx) return null;
  const m = sxy / sxx;
  return { m, b: my - m * mx, r: syy ? sxy / Math.sqrt(sxx * syy) : 0 };
}
function scatter(pts, xName, color) {
  const H = 190, xs = pts.map(p => p.x), x0 = Math.floor(Math.min(...xs)), x1 = Math.max(Math.ceil(Math.max(...xs)), x0 + 1);
  const fr = frame(H, 0, 5, 5), xOf = v => fr.L + (v - x0) / (x1 - x0) * fr.pw, reg = regression(pts);
  let s = fr.s;
  for (let v = x0; v <= x1; v += Math.max(1, Math.ceil((x1 - x0) / 6))) s += `<text class="ax" x="${xOf(v)}" y="${H - 4}" text-anchor="middle">${v}</text>`;
  if (reg) s += `<line x1="${xOf(x0)}" y1="${fr.y(clamp(reg.m * x0 + reg.b, 0, 5))}" x2="${xOf(x1)}" y2="${fr.y(clamp(reg.m * x1 + reg.b, 0, 5))}" stroke="var(--text2)" stroke-width="2" stroke-dasharray="5 4"/>`;
  pts.forEach((p, i) => { const jx = ((i * 7) % 5 - 2) * 1.2, jy = ((i * 3) % 5 - 2) * 1.2; s += `<circle cx="${xOf(p.x) + jx}" cy="${fr.y(p.y) + jy}" r="4.5" fill="${color}" fill-opacity=".8" stroke="var(--card)" stroke-width="1.5"/><circle class="hit" cx="${xOf(p.x) + jx}" cy="${fr.y(p.y) + jy}" r="10" data-tip="${esc(p.tip)}"/>`; });
  return svg(H, s) + `<div class="small muted" style="text-align:center">${esc(xName)} → focus (1–5)</div>`;
}
function pie(parts) { // [{name, color, v, fmt}] — legend sits beside it so small slices stay readable
  parts = parts.filter(p => p.v > 0);
  const tot = sum(parts.map(p => p.v)) || 1, R = 84, c = 90, pt = (a, r = R) => (c + Math.cos(a) * r).toFixed(2) + ' ' + (c + Math.sin(a) * r).toFixed(2);
  let a = -Math.PI / 2, s = '', labels = '';
  for (const p of parts) {
    const f = p.v / tot, a2 = a + f * 2 * Math.PI, tip = esc(p.name + '\n' + p.fmt + ' · ' + Math.round(f * 100) + '%');
    s += f > 0.999 ? `<circle cx="${c}" cy="${c}" r="${R}" fill="${p.color}" data-tip="${tip}"/>`
      : `<path d="M${c} ${c}L${pt(a)}A${R} ${R} 0 ${f > 0.5 ? 1 : 0} 1 ${pt(a2)}Z" fill="${p.color}" stroke="var(--card)" stroke-width="2" stroke-linejoin="round" data-tip="${tip}"/>`;
    if (f >= 0.08) { const [x, y] = pt((a + a2) / 2, R * 0.64).split(' '); labels += `<text x="${x}" y="${+y + 4}" text-anchor="middle">${Math.round(f * 100)}%</text>`; }
    a = a2;
  }
  return `<div class="pie"><svg viewBox="0 0 180 180" role="img">${s}${labels}</svg><div class="pielegend">${parts.map(p => `<div><i style="background:${p.color}"></i><span>${esc(p.name)}</span><b>${p.fmt}</b></div>`).join('')}</div></div>`;
}
function vBars(items, { max, fmt = f1, color = ACC, H = 170 } = {}) { // [{label, value, tip, color, faded}]
  if (max == null) max = niceMax(Math.max(...items.map(i => i.value || 0), 0.01));
  const fr = frame(H, 0, max), gw = fr.pw / items.length, bw = Math.min(30, gw * 0.62), y0 = fr.y(0);
  let s = fr.s;
  items.forEach((it, i) => {
    const cx = fr.L + gw * i + gw / 2, x = cx - bw / 2;
    s += `<text class="ax" x="${cx}" y="${H - 4}" text-anchor="middle">${esc(it.label)}</text>`;
    if (it.value == null) return;
    const y = Math.min(fr.y(it.value), y0 - 1), r = Math.min(4, bw / 2, y0 - y);
    s += `<g class="col"><path class="bar" style="animation-delay:${i * 40}ms" d="M${x} ${y0}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${y0}Z" fill="${it.color || color}" opacity="${it.faded ? 0.45 : 1}"/>`;
    if (items.length <= 8) s += `<text class="vl" x="${cx}" y="${y - 4}" text-anchor="middle">${fmt(it.value)}</text>`;
    s += `<rect class="hit" x="${fr.L + gw * i}" y="${fr.T}" width="${gw}" height="${fr.ph}" data-tip="${esc(it.tip || it.label + ': ' + fmt(it.value))}"/></g>`;
  });
  return svg(H, s);
}
function hBars(items, fmt, max) { // [{name, color, value, tip, extra}]
  max ??= Math.max(...items.map(i => i.value || 0), 0.0001);
  return items.map(i => `<div class="hbar" data-tip="${esc(i.tip || i.name + ': ' + fmt(i.value))}"><span class="name">${esc(i.name)}</span><div class="track"><div class="fill" style="width:${(i.value || 0) / max * 100}%;background:${i.color}"></div></div><span class="val">${i.value == null ? '–' : fmt(i.value)}${i.extra ? `<small>${i.extra}</small>` : ''}</span></div>`).join('');
}
const seqColor = t => SEQ[clamp(Math.floor(t * SEQ.length), 0, SEQ.length - 1)];
const focusColor = v => seqColor((v - 1) / 4.001);
const seqText = t => t >= 0.6 ? '#1c140e' : '#f5ecdf';

/* --- stats shell --- */
const STABS = [['overview', 'Overview'], ['boosters', 'Boosters'], ['patterns', 'Patterns'], ['sleep', 'Sleep'], ['subjects', 'Subjects'], ['goals', 'Goals']];
const STAT_VIEWS = { overview: statsOverview, boosters: statsBoosters, patterns: statsPatterns, sleep: statsSleep, subjects: statsSubjects };
function viewStats() {
  const f = ui.f;
  const head = `<div class="filters">
    <div class="seg">${[['7d', '7d'], ['30d', '30d'], ['90d', '90d'], ['all', 'All'], ['custom', 'Custom']].map(([v, l]) => `<button class="${f.range === v ? 'on' : ''}" data-a="set" data-keep data-path="f.range" data-v="${v}">${l}</button>`).join('')}</div>
    ${f.range === 'custom' ? `<div class="row"><input type="date" data-m="f.from" data-r value="${f.from}"><input type="date" data-m="f.to" data-r value="${f.to}"></div>` : ''}
    <div class="row"><select data-m="f.subject" data-r>${options(db.subjects, f.subject, 'All subjects')}</select><select data-m="f.type" data-r>${options(db.types, f.type, 'All types')}</select><select data-m="f.tag" data-r>${tagOptions(f.tag, 'All boosters')}</select></div>
    <div class="subtabs" style="margin-top:4px">${STABS.map(([v, l]) => `<button class="${ui.statsTab === v ? 'on' : ''}" data-a="set" data-keep data-path="statsTab" data-v="${v}">${l}</button>`).join('')}</div>
  </div>`;
  if (!db.sessions.length) return head + emptyState('chart', 'No sessions yet. Finish one and your stats show up here.', '<button class="btn primary" style="margin-top:18px" data-a="seedDemo">Load 60 demo sessions</button>');
  const base = db.sessions.filter(matchF(f)), [a, b] = rangeBounds(f, base);
  const list = base.filter(s => s.start >= a && s.start <= b);
  if (ui.statsTab === 'goals') return head + statsGoals(base);
  if (!list.length) return head + emptyState('search', 'No sessions match these filters.');
  return head + (STAT_VIEWS[ui.statsTab] || statsOverview)(list, base, a, b);
}

function statsOverview(list, base, a, b) {
  const mins = sum(list.map(effMin)), st = streaks(base), deep = sum(list.filter(s => s.focus >= 4).map(effMin));
  const prev = ui.f.range === 'all' ? [] : base.filter(s => s.start >= a - (b - a) && s.start < a), pm = sum(prev.map(effMin));
  const kpi = (v, l) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  // daily (or weekly, for long ranges) hours stacked by subject
  const days = []; for (let t = startOfDay(a); t <= b; t = addDays(t, 1)) days.push(t);
  const weekly = days.length > 45, slots = weekly ? [...new Set(days.map(weekStart))] : days, slotOf = weekly ? weekStart : startOfDay;
  const subs = [...db.subjects, UNKNOWN], used = subs.filter(sb => list.some(s => subj(s.subjectId).id === sb.id));
  const bk = slots.map(t => {
    const ss = list.filter(s => slotOf(s.start) === t);
    const parts = subs.map(sb => ({ name: sb.name, color: sb.color, v: sum(ss.filter(s => subj(s.subjectId).id === sb.id).map(effMin)) / 60 }));
    return { label: fmtShort(t), parts, tip: (weekly ? 'Week of ' + fmtShort(t) : fmtDate(t)) + '\nTotal: ' + sum(parts.map(p => p.v)).toFixed(1) + 'h' + parts.filter(p => p.v > 0).map(p => '\n' + p.name + ': ' + p.v.toFixed(1) + 'h').join('') };
  });
  // 7-day rolling averages use `base` so the window can reach back before the range start
  const rollH = [], rollF = [];
  for (const d of days) { const w = base.filter(s => s.start >= addDays(d, -6) && s.start < addDays(d, 1)); rollH.push(sum(w.map(effMin)) / 60 / 7); rollF.push(avg(w, s => s.focus)); }
  const now = Date.now(), D = 864e5, hrs = n => [minsBetween(base, now - n * D, now + 1), minsBetween(base, now - 2 * n * D, now - n * D)];
  const foc = n => [avg(base.filter(s => s.start >= now - n * D), s => s.focus), avg(base.filter(s => s.start >= now - 2 * n * D && s.start < now - n * D), s => s.focus)];
  const chg = (l, [cur, prv], f) => `<div class="list-row"><div class="grow">${l}<div class="small muted">${cur == null ? '–' : f(cur)} now · ${prv ? f(prv) : '–'} before</div></div><b>${deltaHTML(pctChange(cur || 0, prv))}</b></div>`;
  const dl = days.map(fmtShort);
  return `<div class="hero"><div class="herorow">
    <div><span class="eyebrow">Time logged</span><div class="xl">${fmtH(mins)}</div><div class="small">${prev.length ? deltaHTML(pctChange(mins, pm)) + ' <span class="muted">vs previous period</span>' : `<span class="muted">${list.length} sessions</span>`}</div></div>
    <div style="text-align:right"><span class="eyebrow">Productivity score</span><div class="xl">${Math.round(sum(list.map(score)))}</div><div class="small muted">${f1(avg(list, score))} per session</div></div></div>${spark(bk.map(x => sum(x.parts.map(p => p.v))))}</div>
  <div class="kpis">${kpi(list.length, 'Sessions')}${kpi(f1(avg(list, s => s.focus)), 'Avg focus')}${kpi(f1(avg(list, s => s.output)), 'Avg output')}${kpi(fmtDur(mins / list.length), 'Avg length')}${kpi(fmtH(deep), 'Deep work')}${kpi(f1(avg(list, distOf)), 'Distractions')}${kpi(st.cur + 'd', 'Streak')}${kpi(st.best + 'd', 'Best streak')}${kpi(fmtDur(sum(list.map(s => (s.pausedMs || 0) / 60000))), 'Break time')}</div>
  <div class="card"><h2>${ic('chart', 17)}${weekly ? 'Hours per week' : 'Hours per day'}<small>Stacked by subject · tap a bar</small></h2>${stackedBars(bk)}${legend(used)}</div>
  <div class="card"><h2>${ic('pie', 17)}Where the time went</h2>${pie(used.map(sb => { const m = sum(list.filter(s => subj(s.subjectId).id === sb.id).map(effMin)); return { name: sb.name, color: sb.color, v: m, fmt: fmtH(m) }; }).sort((x, y) => y.v - x.v))}</div>
  <div class="card"><h2>${ic('trend', 17)}Hours per day<small>7-day rolling average</small></h2>${lineChart({ labels: dl, series: [{ name: 'Hours/day', color: ACC, values: rollH }], fmt: v => v.toFixed(2) + 'h', H: 140 })}</div>
  <div class="card"><h2>${ic('target', 17)}Focus<small>7-day rolling average, scale 1–5</small></h2>${lineChart({ labels: dl, series: [{ name: 'Avg focus', color: ACC, values: rollF }], min: 1, max: 5, fmt: v => v.toFixed(2), H: 140 })}</div>
  <div class="card"><h2>${ic('trend', 17)}Change</h2>${chg('Hours · week over week', hrs(7), fmtH)}${chg('Hours · month over month', hrs(30), fmtH)}${chg('Focus · week over week', foc(7), f1)}${chg('Focus · month over month', foc(30), f1)}</div>
  <div class="card"><h2>${ic('calendar', 17)}Calendar<small>Hours per day, last 20 weeks</small></h2>${calendarHeat(base)}</div>`;
}
function calendarHeat(base) {
  const W = 20, cell = 14, gap = 2, L = 26, T = 14, today = startOfDay(Date.now()), first = addDays(weekStart(today), -7 * (W - 1));
  const per = {}; base.forEach(s => { const k = startOfDay(s.start); per[k] = (per[k] || 0) + effMin(s) / 60; });
  const col = h => !h ? 'var(--card2)' : SEQ[h < 1 ? 0 : h < 2 ? 1 : h < 3 ? 2 : h < 4.5 ? 3 : 4];
  let s = '', lastM = -1;
  for (let w = 0; w < W; w++) {
    const wk = addDays(first, w * 7), m = new Date(wk).getMonth();
    if (m !== lastM) { s += `<text class="ax" x="${L + w * (cell + gap)}" y="9">${new Date(wk).toLocaleDateString(undefined, { month: 'short' })}</text>`; lastM = m; }
    for (let d = 0; d < 7; d++) {
      const t = addDays(wk, d); if (t > today) continue;
      s += `<rect x="${L + w * (cell + gap)}" y="${T + d * (cell + gap)}" width="${cell}" height="${cell}" rx="3" fill="${col(per[t])}" data-tip="${esc(fmtDate(t) + '\n' + (per[t] || 0).toFixed(1) + 'h')}" style="cursor:pointer"/>`;
    }
  }
  [0, 2, 4, 6].forEach(d => s += `<text class="ax" x="0" y="${T + d * (cell + gap) + 11}">${DOW[d]}</text>`);
  return `<svg class="chart" viewBox="0 0 ${L + W * (cell + gap)} ${T + 7 * (cell + gap)}">${s}</svg>
  <div class="legend">${['<1h', '<2h', '<3h', '<4.5h', '4.5h+'].map((l, i) => `<span><i style="background:${SEQ[i]}"></i>${l}</span>`).join('')}</div>`;
}

/* --- boosters --- */
const METRICS = {
  focus: { label: 'Focus', fn: s => s.focus, fmt: v => v.toFixed(2), good: 1, max: 5 },
  output: { label: 'Output', fn: s => s.output, fmt: v => v.toFixed(2), good: 1, max: 5 },
  len: { label: 'Length', fn: effMin, fmt: v => Math.round(v) + 'm', good: 1 },
  dist: { label: 'Distractions', fn: distOf, fmt: v => v.toFixed(1), good: -1 },
  score: { label: 'Score', fn: score, fmt: v => v.toFixed(1), good: 1 }
};
const grpKey = s => tagIds(s).sort().join('+');
function grpName(k) { if (!k) return 'None'; const n = k.split('+').map(id => tagById(id).name); return n.length === 1 ? n[0] + ' only' : n.join(' + '); }
function statsBoosters(list, base, a, b) {
  const groups = new Map(); list.forEach(s => { const k = grpKey(s); (groups.get(k) || groups.set(k, []).get(k)).push(s); });
  const keys = [...groups.keys()].sort((x, y) => (x === '') ? -1 : (y === '') ? 1 : groups.get(y).length - groups.get(x).length);
  const none = groups.get('') || [], baseOf = m => none.length ? avg(none, METRICS[m].fn) : null;
  const MIX = [SEQ[4], SEQ[2], SEQ[1], SEQ[3]];
  let mi = 0; const gcol = {}; keys.forEach(k => gcol[k] = !k ? GREY : k.includes('+') ? MIX[mi++ % MIX.length] : tagById(k).color);
  const M = METRICS[ui.cmp], bs = baseOf(ui.cmp);
  const bars = hBars(keys.map(k => { const g = groups.get(k), v = avg(g, M.fn); return { name: grpName(k), color: gcol[k], value: v, extra: !k ? '<span class="flat">baseline</span>' : bs != null ? deltaHTML(pctChange(v, bs), M.good) : '', tip: grpName(k) + '\n' + M.label + ': ' + M.fmt(v) + '\n' + g.length + ' sessions' + (g.length < 5 ? ' (small sample)' : '') }; }), M.fmt, M.max);
  const table = `<div class="scrollx"><table class="tbl plain"><tr><th>Group</th><th>n</th>${Object.values(METRICS).map(m => `<th>${m.label}</th>`).join('')}</tr>${keys.map(k => {
    const g = groups.get(k);
    return `<tr><td>${esc(grpName(k))} ${smallN(g.length)}</td><td>${g.length}</td>${Object.entries(METRICS).map(([m, X]) => { const v = avg(g, X.fn), b0 = baseOf(m); return `<td>${X.fmt(v)}${k && b0 != null ? `<small>${deltaHTML(pctChange(v, b0), X.good)}</small>` : ''}</td>`; }).join('')}</tr>`;
  }).join('')}</table></div>`;
  const top = keys.slice().sort((x, y) => groups.get(y).length - groups.get(x).length), rest = top.slice(5);
  const share = top.slice(0, 5).map(k => ({ name: grpName(k), color: gcol[k], v: groups.get(k).length, fmt: String(groups.get(k).length) }));
  if (rest.length) share.push({ name: 'Other combos', color: SEQ[0], v: sum(rest.map(k => groups.get(k).length)), fmt: String(sum(rest.map(k => groups.get(k).length))) });

  // booster × subject: avg focus across sessions that include the booster
  const cols = [{ id: 'none', name: 'None' }, ...db.tags], subs = db.subjects.filter(sb => list.some(s => s.subjectId === sb.id));
  const matrix = `<div class="scrollx"><table class="tbl"><tr><th></th>${cols.map(c => `<th>${esc(c.name)}</th>`).join('')}</tr>${subs.map(sb => `<tr><td>${esc(sb.name)}</td>${cols.map(c => {
    const g = list.filter(s => s.subjectId === sb.id && (c.id === 'none' ? !tagIds(s).length : tagIds(s).includes(c.id)));
    if (!g.length) return `<td class="muted">·</td>`;
    const v = avg(g, s => s.focus);
    return `<td class="c" style="background:${focusColor(v)};color:${seqText((v - 1) / 4)};opacity:${g.length < 5 ? .55 : 1}" data-tip="${esc(sb.name + ' × ' + c.name + '\nAvg focus ' + v.toFixed(2) + '\n' + g.length + ' sessions' + (g.length < 5 ? ' (small sample)' : ''))}">${v.toFixed(1)}</td>`;
  }).join('')}</tr>`).join('')}</table></div>`;

  // timing: taken at the start vs added mid-session
  const used = db.tags.filter(t => list.some(s => tagIds(s).includes(t.id)));
  const split = used.map(t => { const w = list.filter(s => tagIds(s).includes(t.id)), at = s => s.tags.find(x => x.id === t.id).at || 0; return [w.filter(s => at(s) < MID_MS), w.filter(s => at(s) >= MID_MS)]; });
  const tSeries = [0, 1].map(j => ({ name: j ? 'Added mid-session' : 'At start', color: PALETTE[j], values: split.map(p => avg(p[j], s => s.focus)), ns: split.map(p => p[j].length) }));
  const lowT = split.some(p => p.some(g => g.length && g.length < 5));

  // usage per week
  const weeks = []; for (let t = weekStart(Math.max(a, addDays(b, -7 * 11))); t <= b; t = addDays(t, 7)) weeks.push(t);
  const usage = used.map(t => ({ name: t.name, color: t.color, values: weeks.map(w => list.filter(s => weekStart(s.start) === w && tagIds(s).includes(t.id)).length) }));
  const trendOf = v => { const h = Math.floor(v.length / 2); if (h < 1) return 'steady'; const p = avg(v.slice(0, h), x => x), c = avg(v.slice(-h), x => x); return c > p * 1.15 ? '↑ rising' : c < p * 0.85 ? '↓ falling' : 'steady'; };
  const totals = hBars(used.map(t => { const n = list.filter(s => tagIds(s).includes(t.id)).length; return { name: t.name, color: t.color, value: n, extra: Math.round(n / list.length * 100) + '% of sessions' }; }).sort((x, y) => y.value - x.value), v => v + '');
  const noB = '<div class="muted small">No booster sessions in this range.</div>';

  return `<div class="card"><h2>${ic('chart', 17)}Compare combos<small>Average per session, vs the “None” baseline</small></h2><div class="chips" style="margin-bottom:12px">${Object.entries(METRICS).map(([k, m]) => `<button class="chip sm ${ui.cmp === k ? 'on' : ''}" data-a="set" data-keep data-path="cmp" data-v="${k}">${m.label}</button>`).join('')}</div>${bars}${none.length ? '' : '<div class="cap">No booster-free sessions in this range, so there is no baseline to compare against.</div>'}</div>
  <div class="card"><h2>${ic('pie', 17)}Share of sessions<small>Which combos you actually use</small></h2>${pie(share)}</div>
  <div class="card"><h2>${ic('table', 17)}All numbers<small>% is the difference vs None · scroll sideways</small></h2>${table}</div>
  <div class="card"><h2>${ic('grid', 17)}Booster × subject<small>Avg focus · faded = fewer than 5 sessions</small></h2>${matrix}</div>
  <div class="card"><h2>${ic('clock', 17)}Timing<small>Avg focus when taken at the start vs added 3+ min in</small></h2>${used.length ? groupedBars(used.map(t => t.name), tSeries) + legend(tSeries) + (lowT ? '<div class="cap"><span class="warn">low sample</span> Some bars have fewer than 5 sessions — tap a bar for its count.</div>' : '') : noB}</div>
  <div class="card"><h2>${ic('chart', 17)}How often<small>Sessions using each booster</small></h2>${used.length ? totals : noB}</div>
  <div class="card"><h2>${ic('trend', 17)}Usage over time<small>Sessions per week</small></h2>${used.length ? lineChart({ labels: weeks.map(fmtShort), series: usage, fmt: v => v + ' sessions', H: 150 }) + legend(usage) + `<div class="cap">${usage.map(u => `<b>${esc(u.name)}</b> ${trendOf(u.values)}`).join(' · ')}</div>` : noB}</div>`;
}

/* --- patterns: time of day, weekday, session length, check-in --- */
function statsPatterns(list, base, a, b) {
  const cellW = 13, cellH = 17, L = 28, T = 12, grid = {};
  list.forEach(s => { const k = dowIdx(s.start) + '-' + new Date(s.start).getHours(); (grid[k] ||= []).push(s); });
  let hm = '';
  for (let d = 0; d < 7; d++) {
    hm += `<text class="ax" x="0" y="${T + d * cellH + 12}">${DOW[d]}</text>`;
    for (let h = 0; h < 24; h++) {
      const g = grid[d + '-' + h], v = g ? avg(g, x => x.focus) : null;
      hm += `<rect x="${L + h * cellW}" y="${T + d * cellH}" width="${cellW - 2}" height="${cellH - 2}" rx="2.5" fill="${g ? focusColor(v) : 'var(--card2)'}" ${g ? `data-tip="${esc(DOW[d] + ' ' + fmtHour(h) + '\nAvg focus ' + v.toFixed(2) + '\n' + g.length + ' session' + (g.length === 1 ? '' : 's'))}" style="cursor:pointer"` : ''}/>`;
    }
  }
  [0, 6, 12, 18, 23].forEach(h => hm += `<text class="ax" x="${L + h * cellW + cellW / 2 - 1}" y="8" text-anchor="middle">${fmtHour(h)}</text>`);
  const fbar = (label, g, extra = '') => ({ label, full: label + extra, value: g.length ? avg(g, x => x.focus) : null, faded: g.length < 5, tip: label + extra + '\nAvg focus ' + f1(avg(g, x => x.focus)) + '\n' + g.length + ' sessions' + (g.length < 5 ? ' (small sample)' : '') });
  const pickBest = items => { const ok = items.filter(i => i.value != null), solid = ok.filter(i => !i.faded), pool = solid.length >= 2 ? solid : ok; return pool.length ? [pool.reduce((m, i) => i.value > m.value ? i : m), pool.reduce((m, i) => i.value < m.value ? i : m)] : []; };
  // 3-hour blocks keep enough sessions per bar to mean something
  const blocks = [0, 1, 2, 3, 4, 5, 6, 7].map(i => fbar(fmtHour(i * 3), list.filter(s => Math.floor(new Date(s.start).getHours() / 3) === i), '–' + fmtHour((i * 3 + 3) % 24)));
  const [bt, wt] = pickBest(blocks);
  const wdays = DOW.map((d, i) => { const g = list.filter(s => dowIdx(s.start) === i), x = fbar(d, g); x.tip += '\n' + fmtH(sum(g.map(effMin))) + ' total'; return x; });
  const [bd] = pickBest(wdays);
  const B = [[0, 20], [20, 40], [40, 60], [60, 90], [90, 120], [120, 1e9]], bl = ['<20m', '20–40', '40–60', '60–90', '90–120', '120m+'];
  const lens = B.map(([lo, hi], i) => fbar(bl[i], list.filter(x => effMin(x) >= lo && effMin(x) < hi)));
  const peak = lens.reduce((bi, it, i) => it.value != null && !it.faded && (bi < 0 || it.value > lens[bi].value) ? i : bi, -1);
  const drop = peak >= 0 ? lens.findIndex((it, i) => i > peak && it.value != null && it.value < lens[peak].value - 0.3) : -1;
  const brk = breakMins(list), brkTot = sum(Object.values(brk.out)), BRK_COL = [PALETTE[0], PALETTE[2], PALETTE[3], PALETTE[7], PALETTE[1]];
  // check-in
  const lvl = key => {
    const gs = [1, 2, 3, 4, 5].map(n => list.filter(s => +s[key] === n));
    if (!gs.some(g => g.length)) return '<div class="muted small">No check-in data in this range.</div>';
    const series = [{ name: 'Focus after', color: PALETTE[0], values: gs.map(g => avg(g, s => s.focus)), ns: gs.map(g => g.length) }, { name: 'Output after', color: PALETTE[1], values: gs.map(g => avg(g, s => s.output)), ns: gs.map(g => g.length) }];
    return groupedBars(['1', '2', '3', '4', '5'], series) + legend(series) + (gs.some(g => g.length && g.length < 5) ? `<div class="cap"><span class="warn">low sample</span> Some levels have fewer than 5 sessions.</div>` : '');
  };
  const faded = '<div class="cap muted">Faded bars have fewer than 5 sessions.</div>';
  // Effectiveness: how much of the clock turned into focused, productive work (score ÷ minutes), 0–100%.
  const effPct = g => { const m = sum(g.map(effMin)); return m ? sum(g.map(score)) / m * 100 : null; };
  const distPh = g => { const m = sum(g.map(effMin)); return m ? sum(g.map(distOf)) / (m / 60) : null; };
  const PLM = { eff: { label: 'Effectiveness', fn: effPct, fmt: v => Math.round(v) + '%', max: 100 }, focus: { label: 'Focus', fn: g => avg(g, s => s.focus), fmt: v => v.toFixed(2), max: 5 }, output: { label: 'Output', fn: g => avg(g, s => s.output), fmt: v => v.toFixed(2), max: 5 }, dist: { label: 'Distractions/hr', fn: distPh, fmt: v => v.toFixed(1) }, hours: { label: 'Hours', fn: g => sum(g.map(effMin)) / 60, fmt: v => v.toFixed(1) + 'h' } };
  const crews = [...db.crews, { id: '', name: 'Not set', color: GREY }].map(p => ({ p, g: list.filter(s => crew(s.crewId).id === p.id) })).filter(x => x.g.length);
  const anyCrew = crews.some(x => x.p.id), M = PLM[ui.pm] || PLM.eff;
  const placeBars = hBars(crews.map(x => ({ name: x.p.name, color: x.p.color, value: M.fn(x.g), extra: x.g.length < 5 ? '<span class="warn">low sample</span>' : '', tip: x.p.name + '\n' + M.label + ': ' + M.fmt(M.fn(x.g)) + '\n' + x.g.length + ' sessions · ' + fmtH(sum(x.g.map(effMin))) })).sort((a, b) => (b.value || 0) - (a.value || 0)), M.fmt, M.max);
  const hourOf = s => new Date(s.start).getHours(), blk = i => list.filter(s => Math.floor(hourOf(s) / 3) === i);
  const tbar = (fn, fmt, word) => [0, 1, 2, 3, 4, 5, 6, 7].map(i => { const g = blk(i), v = g.length ? fn(g) : null; return { label: fmtHour(i * 3), full: fmtHour(i * 3) + '–' + fmtHour((i * 3 + 3) % 24), value: v, faded: g.length < 5, tip: fmtHour(i * 3) + '–' + fmtHour((i * 3 + 3) % 24) + '\n' + word + ' ' + (v == null ? '–' : fmt(v)) + '\n' + g.length + ' sessions' + (g.length < 5 ? ' (small sample)' : '') }; });
  const effBlocks = tbar(effPct, v => Math.round(v) + '%', 'Effectiveness'), distBlocks = tbar(distPh, v => v.toFixed(1) + '/hr', 'Distractions');
  const [bestE, worstE] = pickBest(effBlocks);
  const PARTS = [['Morning', 5, 12], ['Afternoon', 12, 17], ['Evening', 17, 22], ['Night', 22, 29]], partOf = s => { const h = hourOf(s) < 5 ? hourOf(s) + 24 : hourOf(s); return PARTS.findIndex(p => h >= p[1] && h < p[2]); };
  const crewGrid = `<div class="scrollx"><table class="tbl"><tr><th></th>${PARTS.map(p => `<th>${p[0]}</th>`).join('')}</tr>${crews.map(x => `<tr><td>${esc(x.p.name)}</td>${PARTS.map((p, i) => { const g = x.g.filter(s => partOf(s) === i); if (!g.length) return '<td class="muted">·</td>'; const v = effPct(g); return `<td class="c" style="background:${seqColor(v / 100.01)};color:${seqText(v / 100)};opacity:${g.length < 5 ? .55 : 1}" data-tip="${esc(x.p.name + ' · ' + p[0].toLowerCase() + '\nEffectiveness ' + Math.round(v) + '%\nFocus ' + f1(avg(g, s => s.focus)) + ' · output ' + f1(avg(g, s => s.output)) + '\n' + distPh(g).toFixed(1) + ' distractions/hr\n' + g.length + ' sessions' + (g.length < 5 ? ' (small sample)' : ''))}">${Math.round(v)}%</td>`; }).join('')}</tr>`).join('')}</table></div>`;
  // best and worst conditions, preferring combinations with enough sessions behind them
  const combos = crews.filter(x => x.p.id).flatMap(x => PARTS.map((p, i) => ({ name: x.p.name + (p[0] === 'Night' ? ' at night' : ' in the ' + p[0].toLowerCase()), g: x.g.filter(s => partOf(s) === i) }))).filter(c => c.g.length).map(c => ({ ...c, v: effPct(c.g) }));
  const rank = (arr, min) => { const ok = arr.filter(c => c.g.length >= min); return (ok.length >= 2 ? ok : arr).slice().sort((a, b) => b.v - a.v); };
  const pr = rank(crews.filter(x => x.p.id).map(x => ({ name: x.p.name, g: x.g, v: effPct(x.g) })), 3), cr = rank(combos, 3);
  const calm = crews.filter(x => x.p.id && x.g.length >= 3).map(x => ({ name: x.p.name, g: x.g, v: distPh(x.g) })).sort((a, b) => a.v - b.v)[0];
  const line = (icon, label, c, val) => c ? `<div class="list-row"><span class="tile">${ic(icon, 17)}</span><div class="grow">${label}<div class="small muted">${c.g ? c.g.length + ' sessions' + (c.g.length < 5 ? ' · low sample' : '') : ''}</div></div><b style="text-align:right">${esc(c.name)}<div class="small muted" style="font-weight:400">${val}</div></b></div>` : '';
  const best = `<div class="card"><h2>${ic('trophy', 17)}When you work best<small>Effectiveness = share of your time that was focused and productive</small></h2>
    ${line('people', 'Best company', pr[0], pr[0] ? Math.round(pr[0].v) + '% effective' : '')}
    ${line('sun', 'Best time of day', bestE && { name: bestE.full }, bestE ? Math.round(bestE.value) + '% effective' : '')}
    ${line('spark', 'Best combination', cr[0], cr[0] ? Math.round(cr[0].v) + '% effective' : '')}
    ${cr.length > 1 ? line('alert', 'Worst combination', cr[cr.length - 1], Math.round(cr[cr.length - 1].v) + '% effective') : ''}
    ${line('bolt', 'Fewest distractions', calm, calm ? calm.v.toFixed(1) + ' per hour' : '')}
    ${anyCrew ? '' : '<div class="cap">Pick who you are studying with when you start a session and this will also show which company works best.</div>'}</div>`;
  const where = `${best}
  <div class="card"><h2>${ic('people', 17)}By who you study with</h2><div class="chips" style="margin-bottom:12px">${Object.entries(PLM).map(([k, m]) => `<button class="chip sm ${ui.pm === k ? 'on' : ''}" data-a="set" data-keep data-path="pm" data-v="${k}">${m.label}</button>`).join('')}</div>${anyCrew ? placeBars : '<div class="muted small">No sessions with a group set in this range yet.</div>'}</div>
  ${anyCrew ? `<div class="card"><h2>${ic('grid', 17)}Group × time of day<small>Effectiveness · faded = fewer than 5 sessions · tap a cell</small></h2>${crewGrid}</div>` : ''}
  <div class="card"><h2>${ic('trend', 17)}Effectiveness by time of day</h2>${vBars(effBlocks, { max: 100, fmt: v => Math.round(v) + '%' })}${bestE ? `<div class="cap">Best: <b>${bestE.full}</b> (${Math.round(bestE.value)}%)${worstE && worstE !== bestE ? ` · Worst: <b>${worstE.full}</b> (${Math.round(worstE.value)}%)` : ''}</div>` : ''}</div>
  <div class="card"><h2>${ic('bolt', 17)}Distractions by time of day<small>Per hour of work · lower is better</small></h2>${vBars(distBlocks, { fmt: v => v.toFixed(1) })}</div>`;
  return where + `<div class="card"><h2>${ic('sun', 17)}Focus by time of day</h2>${vBars(blocks, { max: 5, fmt: v => v.toFixed(1) })}${bt ? `<div class="cap">Best: <b>${bt.full}</b> (${bt.value.toFixed(2)})${wt && wt !== bt ? ` · Worst: <b>${wt.full}</b> (${wt.value.toFixed(2)})` : ''}</div>` : ''}${blocks.some(x => x.faded && x.value != null) ? faded : ''}</div>
  <div class="card"><h2>${ic('calendar', 17)}Focus by weekday</h2>${vBars(wdays, { max: 5, fmt: v => v.toFixed(1) })}${bd ? `<div class="cap">Best day: <b>${bd.label}</b> (${bd.value.toFixed(2)})</div>` : ''}</div>
  <div class="card"><h2>${ic('grid', 17)}Hour × day<small>Avg focus for every hour you have studied</small></h2><svg class="chart" viewBox="0 0 ${L + 24 * cellW} ${T + 7 * cellH}">${hm}</svg>
    <div class="legend"><span>Focus</span>${SEQ.map((c, i) => `<span><i style="background:${c}"></i>${i + 1}${i < 4 ? '–' + (i + 2) : ''}</span>`).join('')}</div></div>
  <div class="card"><h2>${ic('clock', 17)}Focus by session length<small>When do you start fading?</small></h2>${vBars(lens, { max: 5, fmt: v => v.toFixed(1) })}
    <div class="cap">${peak < 0 ? 'Not enough sessions per length yet.' : `Focus peaks in <b>${bl[peak]}</b> minute sessions` + (drop > 0 ? ` and fades from around <b>${bl[drop]}</b>.` : ', with no clear fade after that.')}</div></div>
  <div class="card"><h2>${ic('cup', 17)}Breaks<small>Paused time by reason</small></h2>${brk.n ? pie(Object.entries(brk.out).sort((x, y) => y[1] - x[1]).map(([name, v], i) => ({ name, v, fmt: fmtDur(v), color: name === 'Unspecified' ? GREY : BRK_COL[[...BREAKS, 'Other'].indexOf(name)] || PALETTE[[4, 6, 7, 5][i % 4]] }))) + `<div class="cap"><b>${brk.n}</b> breaks · <b>${fmtDur(brkTot / brk.n)}</b> average · <b>${(brk.n / list.length).toFixed(1)}</b> per session · breaks are <b>${Math.round(brkTot / (brkTot + sum(list.map(effMin))) * 100)}%</b> of clock time</div>` : '<div class="muted small">No breaks logged in this range.</div>'}</div>
  ${(() => {
    const ms = db.moods.filter(x => x.t >= a && x.t <= b); if (!ms.length) return `<div class="card"><h2>${ic('sun', 17)}Energy and mood through the day</h2><div class="muted small">Log how you feel a few times a day from the Timer screen to see when your energy and mood peak.</div></div>`;
    const bg = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ms.filter(x => Math.floor(new Date(x.t).getHours() / 3) === i)), col = k => bg.map(g => avg(g.filter(x => x[k]), x => x[k]));
    const se = [{ name: 'Energy', color: PALETTE[3], values: col('energy'), ns: bg.map(g => g.length) }, { name: 'Mood', color: PALETTE[4], values: col('mood'), ns: bg.map(g => g.length) }];
    const pk = k => { const v = col(k); let hi = -1, lo = -1; v.forEach((x, i) => { if (x == null) return; if (hi < 0 || x > v[hi]) hi = i; if (lo < 0 || x < v[lo]) lo = i; }); return hi < 0 || hi === lo ? '' : `<b>${k[0].toUpperCase() + k.slice(1)}</b> peaks around ${fmtHour(hi * 3)}–${fmtHour((hi * 3 + 3) % 24)} and dips around ${fmtHour(lo * 3)}–${fmtHour((lo * 3 + 3) % 24)}.`; };
    return `<div class="card"><h2>${ic('sun', 17)}Energy and mood through the day<small>From your ${ms.length} check-in${ms.length === 1 ? '' : 's'} in this range, 1–5</small></h2>${groupedBars([0, 1, 2, 3, 4, 5, 6, 7].map(i => fmtHour(i * 3)), se)}${legend(se)}<div class="cap">${[pk('energy'), pk('mood')].filter(Boolean).join(' ') || 'Check in at a few different times of day to see the pattern.'} ${smallN(ms.length)}</div></div>`;
  })()}
  <div class="card"><h2>${ic('bolt', 17)}Energy before<small>Level 1–5 at check-in → how the session went</small></h2>${lvl('energy')}</div>
  <div class="card"><h2>${ic('smile', 17)}Mood before<small>Level 1–5 at check-in → how the session went</small></h2>${lvl('mood')}</div>`;
}

/* --- sleep: how last night shows up in the work --- */
function statsSleep(list) {
  const has = s => s.sleep != null && s.sleep !== '' && !isNaN(+s.sleep), sl = list.filter(has);
  // the log itself: last 14 days straight from the check-ins, so it shows even on days with no sessions
  const recent = [...Array(14).keys()].reverse().map(i => { const day = ckDayOf(Date.now() - i * 864e5), c = db.checkins[day], bl = ckBlocks(c); return { label: new Date(day + 'T12:00').toLocaleDateString(undefined, { weekday: 'narrow' }), value: c && c.sleep != null ? c.sleep : null, color: c && bl.length > 1 ? PALETTE[6] : undefined, tip: ckDayLabel(day, i) + '\n' + (c && c.sleep != null ? ckSummary(c) + (bl.length ? '\n' + bl.map(b => b.bed + '–' + b.wake).join(', ') : '') : 'Not logged') }; });
  const logCard = `<div class="card"><h2>${ic('moon', 17)}Sleep log<small>Hours slept, last 14 days · violet = split into blocks</small></h2>${vBars(recent, { fmt: v => v.toFixed(1), H: 150 })}<button class="btn block" style="margin-top:12px" data-a="sleepLog">Open sleep log</button></div>`;
  if (sl.length < 3) return logCard + emptyState('moon', 'Log your sleep on days with at least 3 sessions in total to see how it affects your work.');
  // one night per day: the first session that day carries it
  const days = {};
  [...list].sort((x, y) => x.start - y.start).forEach(s => { const d = days[dayKey(s.start)] ||= { min: 0, score: 0, f: 0, o: 0, n: 0, sleep: null, bed: null }; d.min += effMin(s); d.score += score(s); d.f += s.focus; d.o += s.output; d.n++; if (d.sleep == null && has(s)) { d.sleep = +s.sleep; d.bed = s.bed || null; d.sb = s.sb ?? 1; d.energy = s.energy || null; } });
  const nights = Object.values(days).filter(d => d.sleep != null);
  const SB = [[0, 0.01, 'None'], [0.01, 4, '<4h'], [4, 5, '4–5h'], [5, 6, '5–6h'], [6, 7, '6–7h'], [7, 8, '7–8h'], [8, 9, '8–9h'], [9, 99, '9h+']];
  // how the sleep was taken: not at all, in one go, or split into blocks
  const PAT = [['No sleep', d => d.sleep === 0], ['One block', d => d.sleep > 0 && (d.sb || 1) < 2], ['Split sleep', d => d.sleep > 0 && d.sb >= 2]];
  const pg = PAT.map(([, test]) => nights.filter(test)), en = g => g.filter(d => d.energy);
  const patSeries = [{ name: 'Energy', color: PALETTE[3], values: pg.map(g => avg(en(g), d => d.energy)), ns: pg.map(g => en(g).length) }, { name: 'Focus', color: PALETTE[0], values: pg.map(g => g.length ? avg(g, d => d.f / d.n) : null), ns: pg.map(g => g.length) }, { name: 'Output', color: PALETTE[1], values: pg.map(g => g.length ? avg(g, d => d.o / d.n) : null), ns: pg.map(g => g.length) }];
  const patCap = PAT.map(([name], i) => pg[i].length ? `<b>${name}</b>: ${pg[i].length} day${pg[i].length === 1 ? '' : 's'}, ${avg(pg[i], d => d.min / 60).toFixed(1)}h studied${pg[i].length < 5 ? ' <span class="warn">low sample</span>' : ''}` : '').filter(Boolean).join(' · ');
  const bars = (pool, key, fn, fmt, unit) => SB.map(([lo, hi, l]) => { const g = pool.filter(x => +x[key] >= lo && +x[key] < hi); return { label: l, n: g.length, value: g.length ? avg(g, fn) : null, faded: g.length < 5, tip: l + ' of sleep\n' + (g.length ? fmt(avg(g, fn)) : '–') + '\n' + g.length + ' ' + unit + (g.length < 5 ? ' (small sample)' : '') }; });
  const focus = bars(sl, 'sleep', s => s.focus, v => 'Focus ' + v.toFixed(2), 'sessions'), output = bars(sl, 'sleep', s => s.output, v => 'Output ' + v.toFixed(2), 'sessions');
  const hours = bars(nights, 'sleep', d => d.min / 60, v => v.toFixed(1) + 'h studied', 'days'), sc = bars(nights, 'sleep', d => d.score, v => 'Score ' + v.toFixed(0), 'days');
  const top = items => { const ok = items.filter(i => i.value != null), solid = ok.filter(i => !i.faded), pool = solid.length >= 3 ? solid : ok; return pool.length > 1 ? [pool.reduce((m, i) => i.value > m.value ? i : m), pool.reduce((m, i) => i.value < m.value ? i : m)] : []; };
  const cap = (items, fmt, what) => { const [b, w] = top(items); return b && b !== w ? `<div class="cap">Best after <b>${b.label}</b> of sleep (${fmt(b.value)}), worst after <b>${w.label}</b> (${fmt(w.value)}) — ${deltaHTML(pctChange(b.value, w.value))} ${what}.</div>` : ''; };
  const faded = [focus, output, hours, sc].some(x => x.some(i => i.faded && i.value != null)) ? '<div class="cap muted">Faded bars have fewer than 5 sessions or days behind them.</div>' : '';
  const pts = sl.map(s => ({ x: +s.sleep, y: s.focus, tip: fmtDate(s.start) + '\nSleep ' + s.sleep + 'h → focus ' + f1(s.focus) })), reg = regression(pts);
  const strength = r => { const q = Math.abs(r); return q < 0.2 ? 'no clear link' : (q < 0.4 ? 'a weak' : q < 0.6 ? 'a moderate' : 'a strong') + (r > 0 ? ' positive' : ' negative') + ' link'; };
  // bedtime: hours after noon, so 1am sorts after 11pm
  const bedH = b => { const h = +b.slice(0, 2) + +b.slice(3) / 60; return h < 12 ? h + 24 : h; };
  const BB = [[0, 23, 'Before 11'], [23, 24, '11–12'], [24, 25, '12–1am'], [25, 26, '1–2am'], [26, 99, 'After 2']];
  const bedS = sl.filter(s => s.bed), bedN = nights.filter(d => d.bed);
  const bg = BB.map(([lo, hi]) => bedS.filter(s => bedH(s.bed) >= lo && bedH(s.bed) < hi));
  const bedSeries = [{ name: 'Focus', color: PALETTE[0], values: bg.map(g => avg(g, s => s.focus)), ns: bg.map(g => g.length) }, { name: 'Output', color: PALETTE[1], values: bg.map(g => avg(g, s => s.output)), ns: bg.map(g => g.length) }];
  const bedHours = BB.map(([lo, hi, l]) => { const g = bedN.filter(d => bedH(d.bed) >= lo && bedH(d.bed) < hi); return { label: l, value: g.length ? avg(g, d => d.min / 60) : null, faded: g.length < 5, tip: 'In bed ' + l + '\n' + (g.length ? avg(g, d => d.min / 60).toFixed(1) + 'h studied next day' : '–') + '\n' + g.length + ' days' }; });
  const avgBed = bedN.length ? avg(bedN, d => bedH(d.bed)) : null, clock = h => { const m = Math.round(h * 60) % 1440, hh = Math.floor(m / 60); return (hh % 12 || 12) + ':' + pad(m % 60) + (hh < 12 ? 'am' : 'pm'); };
  const kpi = (v, l) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  const energy = bars(nights.filter(d => d.energy), 'sleep', d => d.energy, v => 'Energy ' + v.toFixed(2), 'days');
  return logCard + `<div class="kpis">${kpi(fmtSleep(avg(nights, d => d.sleep)), 'Avg sleep')}${kpi(avgBed == null ? '–' : clock(avgBed), 'Avg bedtime')}${kpi(nights.length, 'Nights logged')}</div>
  <div class="card"><h2>${ic('chart', 17)}Work done by sleep<small>Hours studied on the day after each amount of sleep</small></h2>${vBars(hours, { fmt: v => v.toFixed(1) + 'h' })}${cap(hours, v => v.toFixed(1) + 'h', 'more time studied')}</div>
  <div class="card"><h2>${ic('spark', 17)}Productivity score by sleep<small>Total score for the day</small></h2>${vBars(sc, { fmt: v => v.toFixed(0) })}${cap(sc, v => v.toFixed(0), 'higher score')}</div>
  <div class="card"><h2>${ic('target', 17)}Focus by sleep<small>Average focus score per session, 1–5</small></h2>${vBars(focus, { max: 5, fmt: v => v.toFixed(1) })}${cap(focus, v => v.toFixed(2), 'focus')}</div>
  <div class="card"><h2>${ic('check', 17)}Output by sleep<small>How much you got done per session, 1–5</small></h2>${vBars(output, { max: 5, fmt: v => v.toFixed(1) })}${cap(output, v => v.toFixed(2), 'output')}${faded}</div>
  <div class="card"><h2>${ic('bolt', 17)}Energy by sleep<small>How you rated your energy after each amount of sleep, 1–5</small></h2>${energy.some(x => x.value != null) ? vBars(energy, { max: 5, fmt: v => v.toFixed(1) }) + cap(energy, v => v.toFixed(2), 'energy') : '<div class="muted small">Rate your energy in the check-in to see this.</div>'}</div>
  <div class="card"><h2>${ic('layers', 17)}How you slept<small>No sleep vs one block vs split into blocks</small></h2>${groupedBars(PAT.map(p => p[0]), patSeries)}${legend(patSeries)}<div class="cap">${patCap}</div></div>
  <div class="card"><h2>${ic('spark', 17)}Every session<small>Hours slept against focus</small></h2>${scatter(pts, 'Sleep (hrs)', ACC)}${reg ? `<div class="cap">r = ${reg.r.toFixed(2)}, ${strength(reg.r)}. Each extra hour of sleep ≈ <b>${reg.m >= 0 ? '+' : ''}${reg.m.toFixed(2)}</b> focus. ${smallN(pts.length)}</div>` : ''}</div>
  ${bedS.length >= 3 ? `<div class="card"><h2>${ic('moon', 17)}Bedtime<small>Focus and output by when you went to bed</small></h2>${groupedBars(BB.map(b => b[2]), bedSeries)}${legend(bedSeries)}</div>
  <div class="card"><h2>${ic('moon', 17)}Bedtime and work done<small>Hours studied the next day</small></h2>${vBars(bedHours, { fmt: v => v.toFixed(1) + 'h' })}</div>` : `<div class="card"><h2>${ic('moon', 17)}Bedtime</h2><div class="muted small">Enter bed and wake times in the check-in on at least 3 sessions to see this.</div></div>`}`;
}

/* --- subjects --- */
function statsSubjects(list) {
  const tot = sum(list.map(effMin)) || 1;
  const rows = [...db.subjects, UNKNOWN].map(sb => { const g = list.filter(s => subj(s.subjectId).id === sb.id); return { sb, g, m: sum(g.map(effMin)) }; }).filter(r => r.g.length).sort((x, y) => y.m - x.m);
  const types = db.types.map(t => { const g = list.filter(s => s.typeId === t.id), m = sum(g.map(effMin)); return { name: t.name, color: t.color, v: m, fmt: fmtH(m), g }; }).filter(t => t.g.length).sort((x, y) => y.v - x.v);
  const now = Date.now(), nd = db.settings.neglectDays || 7;
  const neglected = db.subjects.map(sb => { const last = Math.max(0, ...db.sessions.filter(s => s.subjectId === sb.id).map(s => s.start)); return { sb, days: last ? Math.floor((startOfDay(now) - startOfDay(last)) / 864e5) : null }; }).filter(x => x.days == null || x.days >= nd);
  const bar = (fn, fmt, max) => hBars(rows.map(r => ({ name: r.sb.name, color: r.sb.color, value: avg(r.g, fn), extra: r.g.length < 5 ? '<span class="warn">low sample</span>' : '', tip: r.sb.name + '\n' + fmt(avg(r.g, fn)) + '\n' + r.g.length + ' sessions' })), fmt, max);
  return `<div class="card"><h2>${ic('pie', 17)}Time per subject<small>${fmtH(tot)} total</small></h2>${pie(rows.map(r => ({ name: r.sb.name, color: r.sb.color, v: r.m, fmt: fmtH(r.m) })))}</div>
  <div class="card"><h2>${ic('target', 17)}Avg focus per subject</h2>${bar(s => s.focus, v => v.toFixed(2), 5)}</div>
  <div class="card"><h2>${ic('spark', 17)}Productivity score per subject<small>Average per session</small></h2>${bar(score, v => v.toFixed(1))}</div>
  <div class="card"><h2>${ic('layers', 17)}Type of work</h2>${types.length ? pie(types) : '<div class="muted small">No typed sessions in this range.</div>'}</div>
  <div class="card"><h2>${ic('alert', 17)}Neglected<small>Not touched in ${nd}+ days</small></h2>${neglected.length ? neglected.map(x => `<div class="list-row"><span class="dot" style="background:${x.sb.color}"></span><span class="grow">${esc(x.sb.name)}</span><span class="small muted">${x.days == null ? 'never' : x.days + ' days ago'}</span></div>`).join('') : '<div class="small muted">Nothing neglected.</div>'}</div>`;
}

/* --- goals, records, weekly report --- */
function statsGoals(base) {
  const ms = milestones();
  const now = Date.now(), all = db.sessions, today = startOfDay(now), wk = weekStart(now), g = db.goals;
  const bar = (label, min, goalH, color) => { const p = goalH ? clamp(min / 60 / goalH * 100, 0, 100) : 0; return `<div class="row between small"><span>${label}</span><span class="muted">${(min / 60).toFixed(1)} / ${goalH}h${p >= 100 ? ' ✓' : ''}</span></div><div class="prog"><div style="width:${p}%;background:${p >= 100 ? 'var(--good)' : color || 'var(--accent)'}"></div></div>`; };
  let goals = '';
  const ring = (label, min, goalH) => { const f = clamp(min / 60 / goalH, 0, 1), C = 2 * Math.PI * 42; return `<div class="gring"><svg viewBox="0 0 100 100"><circle class="ring-bg" cx="50" cy="50" r="42"/><circle class="ring-fg ${f >= 1 ? 'done' : ''}" style="--full:${C}" cx="50" cy="50" r="42" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - f)}" transform="rotate(-90 50 50)"/></svg><div class="in"><b>${(min / 60).toFixed(1)}h</b><span>of ${goalH}h</span></div><em>${label}</em></div>`; };
  const rings = (g.daily ? ring('Today', minsBetween(all, today, now + 1), g.daily) : '') + (g.weekly ? ring('This week', minsBetween(all, wk, now + 1), g.weekly) : '');
  if (rings) goals += `<div class="grings">${rings}</div>`;
  db.subjects.forEach(sb => {
    const sg = g.subjects[sb.id] || {}, ss = all.filter(s => s.subjectId === sb.id);
    if (sg.daily) goals += bar(esc(sb.name) + ' · today', minsBetween(ss, today, now + 1), sg.daily, sb.color);
    if (sg.weekly) goals += bar(esc(sb.name) + ' · this week', minsBetween(ss, wk, now + 1), sg.weekly, sb.color);
  });
  // records
  let rec = '<div class="muted small">No sessions yet.</div>';
  if (base.length) {
    const longest = base.reduce((m, s) => effMin(s) > effMin(m) ? s : m), per = (fn) => { const o = {}; base.forEach(s => { const k = fn(s.start); o[k] = (o[k] || 0) + effMin(s); }); return Object.entries(o).sort((x, y) => y[1] - x[1])[0]; };
    const bd = per(startOfDay), bw = per(weekStart);
    let run = 0, bestRun = 0; [...base].sort((x, y) => x.start - y.start).forEach(s => { run = s.focus >= 4 ? run + 1 : 0; bestRun = Math.max(bestRun, run); });
    const row = (l, v, sub, icon = 'trophy') => `<div class="list-row"><span class="tile">${ic(icon, 17)}</span><div class="grow">${l}<div class="small muted">${sub}</div></div><b>${v}</b></div>`;
    rec = row('Longest session', fmtDur(effMin(longest)), esc(subj(longest.subjectId).name) + ' · ' + fmtDate(longest.start), 'clock') + row('Best day', fmtH(bd[1]), fmtDate(+bd[0]), 'sun') + row('Best week', fmtH(bw[1]), 'week of ' + fmtShort(+bw[0]), 'calendar') + row('Highest focus streak', bestRun + ' in a row', 'consecutive sessions with focus 4+', 'target') + row('Best day streak', streaks(base).best + ' days', 'consecutive days with a session', 'flame');
  }
  return `<div class="card"><h2>${ic('target', 17)}Goals</h2>${goals || '<div class="muted small">No goals set.</div>'}<div class="small muted">Edit goals in Settings. Per-subject goals are set on each subject.</div></div>
  <div class="card report"><h2>${ic('note', 17)}Weekly report card · last 7 days</h2>${reportCard(base)}</div>
  <div class="card"><h2>${ic('trophy', 17)}Milestones<small>${ms.filter(m => m.done).length} of ${ms.length} earned · tap one for details</small></h2><div class="badges">${ms.map(m => `<div class="mbadge ${m.done ? 'got' : ''}" data-tip="${esc(m.name + '\n' + m.desc + '\n' + (m.done ? 'Earned' : (m.goal > 1 ? Math.floor(m.cur) + ' of ' + m.goal : 'Not yet')))}"><span>${ic(m.icon, 22)}</span><b>${m.name}</b>${m.done ? '' : `<i><u style="width:${m.cur / m.goal * 100}%"></u></i>`}</div>`).join('')}</div></div>
  <div class="card"><h2>${ic('trophy', 17)}Personal records</h2>${rec}</div>`;
}
function reportCard(base) {
  const now = Date.now(), cur = base.filter(s => s.start >= now - 7 * 864e5), prev = base.filter(s => s.start >= now - 14 * 864e5 && s.start < now - 7 * 864e5);
  if (!cur.length) return '<div class="muted small">No sessions in the last 7 days.</div>';
  const m = sum(cur.map(effMin)), pm = sum(prev.map(effMin)), fo = avg(cur, s => s.focus), pf = avg(prev, s => s.focus), ou = avg(cur, s => s.output), po = avg(prev, s => s.output);
  const top = Object.entries(cur.reduce((o, s) => (o[s.subjectId] = (o[s.subjectId] || 0) + effMin(s), o), {})).sort((x, y) => y[1] - x[1])[0];
  const combos = {}; cur.forEach(s => (combos[grpKey(s)] ||= []).push(s));
  let cl = Object.entries(combos).filter(([, g]) => g.length >= 2); if (!cl.length) cl = Object.entries(combos);
  const bc = cl.map(([k, g]) => ({ k, v: avg(g, score), n: g.length })).sort((x, y) => y.v - x.v)[0];
  const hrs = {}; cur.forEach(s => (hrs[Math.floor(new Date(s.start).getHours() / 3)] ||= []).push(s));
  const bt = Object.entries(hrs).map(([k, g]) => ({ k: +k, v: avg(g, s => s.focus), n: g.length })).sort((x, y) => y.v - x.v || y.n - x.n)[0];
  const sc = sum(cur.map(score)), ps = sum(prev.map(score));
  const grade = fo >= 4.2 ? 'A' : fo >= 3.6 ? 'B' : fo >= 3 ? 'C' : fo >= 2.3 ? 'D' : 'E';
  return `<div class="row" style="margin-bottom:8px"><div class="grade">${grade}</div><div class="small muted">Grade from average focus (${f1(fo)}/5) over ${cur.length} sessions.</div></div>
  <ul>
    <li><b>${fmtH(m)}</b> across <b>${cur.length}</b> sessions — ${prev.length ? deltaHTML(pctChange(m, pm)) + ' vs last week (' + fmtH(pm) + ')' : 'no sessions the week before'}.</li>
    <li>Focus <b>${f1(fo)}</b> ${prev.length ? deltaHTML(pctChange(fo, pf)) : ''}, output <b>${f1(ou)}</b> ${prev.length ? deltaHTML(pctChange(ou, po)) : ''}.</li>
    <li>Productivity Score <b>${Math.round(sc)}</b> ${prev.length ? deltaHTML(pctChange(sc, ps)) : ''}.</li>
    <li>Top subject: <b>${esc(subj(top[0]).name)}</b> (${fmtH(top[1])}).</li>
    <li>Best booster combo: <b>${esc(grpName(bc.k))}</b> — avg score ${f1(bc.v)} over ${bc.n} session${bc.n === 1 ? '' : 's'}${bc.n < 5 ? ' <span class="warn">low sample</span>' : ''}.</li>
    <li>Best time: <b>${fmtHour(bt.k * 3)}–${fmtHour((bt.k * 3 + 3) % 24)}</b> (focus ${f1(bt.v)}).</li>
    <li>Distractions per session: <b>${f1(avg(cur, distOf))}</b> ${prev.length ? deltaHTML(pctChange(avg(cur, distOf), avg(prev, distOf)), -1) : ''}.</li>
  </ul>`;
}

/* ================= HISTORY ================= */
function histList() {
  const h = ui.hist, q = h.q.trim().toLowerCase();
  const list = db.sessions.filter(matchF(h)).filter(s => !q || (s.note || '').toLowerCase().includes(q) || (s.task || '').toLowerCase().includes(q)).sort((a, b) => b.start - a.start);
  if (!list.length) return emptyState('search', db.sessions.length ? 'No sessions match.' : 'No sessions yet.');
  const dayTot = {}; list.forEach(s => { const k = dayKey(s.start); dayTot[k] = (dayTot[k] || 0) + effMin(s); });
  let out = '', lastDay = '';
  for (const s of list.slice(0, 300)) {
    const dk = dayKey(s.start), sb = subj(s.subjectId), ty = typ(s.typeId);
    if (dk !== lastDay) { out += `<div class="dayh"><span>${fmtDate(s.start)}</span><span>${fmtDur(dayTot[dk])}</span></div>`; lastDay = dk; }
    out += `<button class="sess" style="--c:${sb.color}" data-a="editSession" data-v="${s.id}">
      <div class="top"><b>${esc(sb.name)}${ty.name ? ` <span class="muted" style="font-weight:400">· ${esc(ty.name)}</span>` : ''}</b><b class="dur">${fmtDur(effMin(s))}</b></div>
      <div class="meta">${fmtTime(s.start)}–${fmtTime(s.end)}${crew(s.crewId).name ? ' · ' + esc(crew(s.crewId).name) : ''}${s.task ? ' · ' + esc(s.task) : ''}</div>
      <div class="sline"><span>Focus ${pips(Math.round(s.focus))}</span><span>Output ${pips(s.output)}</span>${s.distractions ? `<span>${ic('bolt', 13)}${s.distractions}</span>` : ''}${s.pausedMs >= 60000 ? `<span>${ic('cup', 13)}${Math.round(s.pausedMs / 60000)}m</span>` : ''}</div>
      ${tagIds(s).length ? `<div class="tags">${tagPills(s)}</div>` : ''}${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}</button>`;
  }
  return out + (list.length > 300 ? `<div class="small muted" style="text-align:center">Showing latest 300 of ${list.length}. Narrow the filters to see older ones.</div>` : '');
}
function viewHistory() {
  const h = ui.hist;
  return `<div class="row between"><h1>History</h1><button class="btn primary" style="min-height:40px;padding:0 14px" data-a="addSession">${ic('plus', 17)}Add</button></div>
  ${(w => w.length ? `<div class="trio" style="margin:0 0 16px"><div>${ic('clock')}<b>${fmtH(sum(w.map(effMin)))}</b><span>this week</span></div><div>${ic('layers')}<b>${w.length}</b><span>session${w.length === 1 ? '' : 's'}</span></div><div>${ic('target')}<b>${f1(avg(w, s => s.focus))}</b><span>avg focus</span></div></div>` : '')(db.sessions.filter(s => s.start >= weekStart(Date.now())))}
  <div class="search">${ic('search', 17)}<input type="search" placeholder="Search notes and tasks\" data-m="hist.q" data-live="hist" value="${esc(h.q)}"></div>
  <div class="row" style="margin:8px 0 4px"><select data-m="hist.subject" data-r>${options(db.subjects, h.subject, 'All subjects')}</select><select data-m="hist.type" data-r>${options(db.types, h.type, 'All types')}</select><select data-m="hist.tag" data-r>${tagOptions(h.tag, 'All boosters')}</select></div>
  <div id="histList">${histList()}</div>`;
}

/* ================= SETTINGS ================= */
// iOS-style: a grouped list on the root page, each row drills into its own page.
const SET_PAGES = { sync: 'Sync across devices', theme: 'Theme', subjects: 'Subjects', types: 'Types of work', crews: 'Study groups', tags: 'Boosters', goals: 'Goals', backup: 'Backup & export', pin: 'PIN lock', demo: 'Demo data' };
const irow = (label, { value = '', a = '', attrs = '', left = '', cls = '', chev = true } = {}) => `<button class="irow ${cls}" ${a ? `data-a="${a}"` : ''} ${attrs}>${left}<span class="grow">${label}</span>${value !== '' ? `<span class="ival">${value}</span>` : ''}${chev ? '<span class="chev">›</span>' : ''}</button>`;
const igroup = (head, rows, foot = '') => `${head ? `<span class="ihead">${head}</span>` : ''}<div class="ilist">${rows}</div>${foot ? `<div class="ifoot">${foot}</div>` : ''}`;
const tile = (icon, cls = '') => `<span class="tile ${cls}">${ic(icon, 17)}</span>`;
const nav = (p, icon) => ({ a: 'setPage', attrs: `data-v="${p}"`, left: tile(icon) });
function viewSettings() {
  const p = ui.setPage, st = db.settings, g = db.goals;
  if (!p || !SET_PAGES[p]) {
    const demoN = db.sessions.filter(s => s.demo).length;
    const tot = sum(db.sessions.map(effMin)), first = db.sessions.length ? Math.min(...db.sessions.map(x => x.start)) : null;
    return `<h1>Settings</h1>
    <div class="profile"><svg viewBox="0 0 64 64" width="56" height="56"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--card2)" stroke-width="5"/><circle cx="32" cy="32" r="26" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" stroke-dasharray="118 164" transform="rotate(-90 32 32)"/><path d="M25 39v-6M32 39V25M39 39v-9" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/></svg>
      <div><b>Focus Log</b><span>${db.sessions.length} sessions · ${fmtH(tot)} logged${first ? ' · since ' + fmtShort(first) : ''}</span></div></div>
    ${igroup('Appearance', irow('Theme', { ...nav('theme', 'palette'), value: THEMES[st.theme]?.name || 'Coffee' }))}
    ${igroup('Tracking', irow('Subjects', { ...nav('subjects', 'book'), value: db.subjects.length }) + irow('Types of work', { ...nav('types', 'layers'), value: db.types.length }) + irow('Study groups', { ...nav('crews', 'people'), value: db.crews.length }) + irow('Boosters', { ...nav('tags', 'spark'), value: db.tags.length }) + irow('Goals', { ...nav('goals', 'target'), value: g.daily ? g.daily + 'h a day' : 'Off' }))}
    ${igroup('Privacy', irow('PIN lock', { ...nav('pin', 'lock'), value: st.pin ? 'On' : 'Off' }))}
    ${igroup('Data', irow('Backup & export', nav('backup', 'download')) + irow('Demo data', { ...nav('demo', 'flask'), value: demoN || '' }))}
    ${igroup('Devices', irow('Sync across devices', { ...nav('sync', 'cloud'), value: !sync ? 'Off' : sync.err ? 'Problem' : 'On' }))}
    ${igroup('', irow('Reset all data', { a: 'reset', cls: 'danger', chev: false, left: tile('trash', 'bad') }))}
    <div class="ifoot" style="text-align:center">Everything is stored only on this device.</div>`;
  }
  const head = `<button class="back" data-a="setPage" data-v="">‹ Settings</button><h1>${SET_PAGES[p]}</h1>`;
  if (p === 'sync') {
    if (sync) return head + igroup('', `<div class="irow">${tile('cloud')}<span class="grow">Status</span><span class="ival">${syncing ? 'Syncing…' : sync.err ? 'Problem' : 'Up to date'}</span></div><div class="irow">${tile('clock')}<span class="grow">Last synced</span><span class="ival">${sync.last ? fmtShort(sync.last) + ', ' + fmtTime(sync.last) : 'Never'}</span></div><div class="irow">${tile('lock')}<span class="grow">Repo</span><span class="ival">${esc(sync.repo)}</span></div>`, sync.err ? `<span style="color:var(--bad)">${esc(sync.err)}</span>` : 'Syncs when you open the app and a few seconds after every change. Works offline and catches up later.')
      + igroup('', irow('Sync now', { a: 'syncManual', chev: false, left: tile('trend') }) + irow('Turn off sync on this device', { a: 'syncOff', cls: 'danger', chev: false, left: tile('trash', 'bad') }), 'Turning it off keeps everything already on this device and in the repo.');
    const f = ui.syncForm ||= { repo: 'bblDiv/focus-log-data', token: '' };
    return head + `<div class="ifoot" style="margin:0 2px 4px">Keeps your phone and laptop in step by saving your sessions to a private repo on your own GitHub account. Only someone with your token can read it.</div>`
      + igroup('Private repo', `<label class="irow">${tile('lock')}<input type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="owner/repo" data-m="syncForm.repo" value="${esc(f.repo)}" style="flex:1;background:var(--card2);border-color:transparent"></label>`)
      + igroup('Access token', `<label class="irow">${tile('spark')}<input type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste token (github_pat_…)" data-m="syncForm.token" value="${esc(f.token)}" style="flex:1;background:var(--card2);border-color:transparent"></label>`, 'Create it on GitHub: Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Repository access: only this repo. Permissions: Contents → Read and write. The token is stored only on this device.')
      + `<button class="btn primary block" style="margin-top:20px" data-a="syncConnect">${ic('cloud', 18)}Connect and sync</button>`;
  }
  if (p === 'theme') return head + igroup('', Object.entries(THEMES).map(([k, t]) => irow(t.name, { a: 'setTheme', attrs: `data-v="${k}"`, chev: false, value: (st.theme || 'coffee') === k ? '<span class="tick">✓</span>' : '', left: `<i class="sw" style="background:linear-gradient(135deg, ${t.bg} 50%, ${t.acc} 50%)"></i>` })).join(''));
  if (p === 'subjects' || p === 'types' || p === 'tags' || p === 'crews') {
    const foot = { crews: 'Who you study with. Stats compare how effective you are with each group and on your own.', subjects: 'Tap one to rename it, change its colour, set its own daily or weekly goal, or delete it.', types: 'The kind of work a session is: studying, an assignment, a personal project, club work.', tags: 'Things you used during a session. Stats compare your sessions with and without each one.' }[p];
    return head + igroup('', db[p].map(x => { const sg = p === 'subjects' && g.subjects[x.id] || {}; return irow(esc(x.name), { a: 'editItem', attrs: `data-coll="${p}" data-v="${x.id}"`, left: `<span class="dot" style="background:${x.color}"></span>`, value: sg.weekly ? sg.weekly + 'h a week' : sg.daily ? sg.daily + 'h a day' : '' }); }).join('') + irow('Add new', { a: 'editItem', attrs: `data-coll="${p}" data-v=""`, cls: 'accent', chev: false, left: ic('plus', 17) }), foot);
  }
  const num = (label, path, val, step = '0.5', icon = 'target') => `<label class="irow">${tile(icon)}<span class="grow">${label}</span><input type="number" inputmode="decimal" step="${step}" min="0" data-d="${path}" value="${val || ''}" placeholder="Off"></label>`;
  if (p === 'goals') return head + igroup('Hours', num('Daily goal', 'goals.daily', g.daily, '0.5', 'sun') + num('Weekly goal', 'goals.weekly', g.weekly, '0.5', 'calendar'), 'Leave empty to turn a goal off. Goals for a single subject are set on that subject.') + igroup('Neglected subjects', num('Flag after (days)', 'settings.neglectDays', st.neglectDays, '1', 'alert'), 'A subject shows as neglected in Stats once you have not touched it for this many days.');
  if (p === 'backup') return head + igroup('Export', irow('Export backup (JSON)', { a: 'exportJSON', left: tile('upload') }) + irow('Export spreadsheet (CSV)', { a: 'exportCSV', left: tile('table') }), 'The JSON backup holds everything and can be imported again. The CSV is one row per session.') + igroup('Import', `<label class="irow">${tile('download')}<span class="grow">Import a JSON backup</span><span class="chev">›</span><input type="file" id="importFile" accept="application/json,.json" hidden></label>`, 'Importing replaces everything on this device.');
  if (p === 'pin') return head + igroup('', st.pin ? irow('Change PIN', { a: 'setPin', left: tile('lock') }) + irow('Turn PIN off', { a: 'removePin', cls: 'danger', chev: false, left: tile('trash', 'bad') }) : irow('Set a PIN', { a: 'setPin', left: tile('lock') }), 'Asks for a 4-digit PIN each time the app opens. It is a privacy screen, not encryption. If you forget it, the only way back in is to clear the site data.');
  const demoN = db.sessions.filter(s => s.demo).length;
  return head + igroup('', irow('Add 60 demo sessions', { a: 'seedDemo', chev: false, left: tile('flask') }) + (demoN ? irow('Clear demo sessions', { a: 'clearDemo', cls: 'danger', chev: false, value: demoN, left: tile('trash', 'bad') }) : ''), 'Fake sessions to preview the stats. Clearing removes only the demo ones.' + (sync ? ' Sync is on, so demo sessions also show up on your other devices until you clear them.' : ''));
}

/* ================= MODALS ================= */
function renderModal(keepScroll) {
  const m = ui.modal, host = $('#modal'), old = $('.sheet', host), top = old ? old.scrollTop : 0;
  if (!m) { host.innerHTML = ''; return; }
  const body = { session: modalSession, item: modalItem, pin: modalPin, pause: modalPause, sleeplog: modalSleepLog, ck: modalCk, mood: modalMood }[m.kind](m.data);
  host.innerHTML = `<div class="modal" data-a="closeModal"><div class="sheet ${keepScroll ? 'still' : ''}">${body}</div></div>`;
  if (keepScroll) $('.sheet', host).scrollTop = top;
}
function modalSession(d) {
  const tagLbl = v => v == null ? '' : `<span class="muted small">${v === 'mid' ? 'mid' : typeof v === 'number' && v >= MID_MS ? '+' + Math.round(v / 60000) + 'm' : 'start'}</span>`;
  return `<div class="row between"><h1 style="font-size:22px">${d.id ? 'Edit session' : 'Add session'}</h1><button class="btn ghost" data-a="closeModal" data-force>Close</button></div>
  <span class="lbl">Subject</span>${pick(db.subjects, 'modal.data.subjectId', d.subjectId)}
  <span class="lbl">Type</span>${pick(db.types, 'modal.data.typeId', d.typeId)}
  ${db.crews.length ? `<span class="lbl">Studying with</span><div class="chips">${db.crews.map(x => `<button class="chip ${d.crewId === x.id ? 'on' : ''}" style="--c:${x.color}" data-a="set" data-path="modal.data.crewId" data-v="${x.id}"><i></i>${esc(x.name)}</button>`).join('')}</div>` : ''}
  <input type="text" style="margin-top:10px" placeholder="Working on… (optional)" data-m="modal.data.task" value="${esc(d.task)}">
  <span class="lbl">Started</span><input type="datetime-local" data-m="modal.data.date" value="${esc(d.date)}">
  <div class="row" style="margin-top:10px"><div class="grow"><span class="lbl" style="margin-top:0">Study minutes</span><input type="number" inputmode="numeric" min="1" data-m="modal.data.dur" value="${esc(d.dur)}"></div>
    <div class="grow"><span class="lbl" style="margin-top:0">Paused min</span><input type="number" inputmode="numeric" min="0" data-m="modal.data.paused" value="${esc(d.paused)}"></div>
    <div class="grow"><span class="lbl" style="margin-top:0">Distractions</span><input type="number" inputmode="numeric" min="0" data-m="modal.data.distractions" value="${esc(d.distractions)}"></div></div>
  <span class="lbl">Boosters <em>· tap again for “added mid-session”</em></span>
  <div class="chips">${db.tags.map(t => `<button class="chip ${d.tags[t.id] != null ? 'on' : ''}" style="--c:${t.color}" data-a="modalTag" data-v="${t.id}"><i></i>${esc(t.name)}${tagLbl(d.tags[t.id])}</button>`).join('')}</div>
  <span class="lbl">Your own focus rating <em>· optional · the score is worked out from distractions and breaks</em></span>${rate('modal.data.focus', d.focus)}
  <span class="lbl">Output</span>${rate('modal.data.output', d.output)}
  <span class="lbl">Check-in (optional)</span>
  <div class="row"><span class="grow small muted">Sleep (hrs)</span><input type="number" inputmode="decimal" step="0.5" style="width:96px" data-m="modal.data.sleep" value="${esc(d.sleep)}"></div>
  <div class="small muted" style="margin:10px 0 6px">Energy</div>${rate('modal.data.energy', d.energy)}
  <div class="small muted" style="margin:10px 0 6px">Mood</div>${rate('modal.data.mood', d.mood)}
  <span class="lbl">Note</span><textarea data-m="modal.data.note">${esc(d.note)}</textarea>
  <button class="btn primary block" style="margin-top:16px" data-a="saveSession">Save</button>
  ${d.id ? `<button class="btn danger block" style="margin-top:10px" data-a="deleteSession">Delete session</button>` : ''}`;
}
function modalItem(d) {
  const names = { subjects: 'subject', types: 'type', tags: 'booster', crews: 'group' }, n = names[ui.modal.coll];
  return `<div class="row between"><h1 style="font-size:22px">${d.id ? 'Edit' : 'New'} ${n}</h1><button class="btn ghost" data-a="closeModal" data-force>Close</button></div>
  <span class="lbl">Name</span><input type="text" maxlength="30" data-m="modal.data.name" value="${esc(d.name)}" placeholder="Name">
  <span class="lbl">Color</span><div class="swatches">${PALETTE.map(c => `<button style="background:${c}" class="${d.color === c ? 'on' : ''}" data-a="set" data-keep data-path="modal.data.color" data-v="${c}" aria-label="${c}"></button>`).join('')}</div>
  ${ui.modal.coll === 'subjects' ? `<span class="lbl">Goals for this subject (hours, optional)</span><div class="row"><input type="number" inputmode="decimal" step="0.5" min="0" placeholder="Daily" data-m="modal.data.daily" value="${esc(d.daily)}"><input type="number" inputmode="decimal" step="0.5" min="0" placeholder="Weekly" data-m="modal.data.weekly" value="${esc(d.weekly)}"></div>` : ''}
  <button class="btn primary block" style="margin-top:18px" data-a="saveItem">Save</button>
  ${d.id ? `<button class="btn danger block" style="margin-top:10px" data-a="deleteItem">Delete ${n}</button>` : ''}`;
}
const ckDayLabel = (day, i) => i === 0 ? 'Today' : i === 1 ? 'Yesterday' : fmtDate(new Date(day + 'T12:00').getTime());
function modalSleepLog() {
  const rows = [...Array(21).keys()].map(i => {
    const day = ckDayOf(Date.now() - i * 864e5), c = db.checkins[day], bl = ckBlocks(c), logged = c && (c.sleep != null || c.energy || c.mood);
    const detail = !logged ? 'Not logged' : [bl.map(b => b.bed + '–' + b.wake).join(', '), c.energy ? 'energy ' + ENERGY[c.energy - 1].toLowerCase() : '', c.mood ? 'mood ' + MOOD[c.mood - 1].toLowerCase() : ''].filter(Boolean).join(' · ');
    return `<button class="irow" data-a="ckOpen" data-v="${day}">${tile(logged ? 'moon' : 'plus')}<span class="grow">${ckDayLabel(day, i)}<span class="isub">${esc(detail || '—')}</span></span><span class="ival">${logged ? ckSummary(c) : ''}</span><span class="chev">›</span></button>`;
  }).join('');
  return `<div class="row between"><h1 style="font-size:22px">Sleep log</h1><button class="btn ghost" data-a="closeModal" data-force>Close</button></div>
  <div class="small muted" style="margin-bottom:12px">Tap any day to add or fix its sleep. A day's sleep is the sleep you got before that day's work, even if it started at 8am after an all-nighter.</div>
  <div class="ilist" style="margin-top:0;background:var(--card2)">${rows}</div>`;
}
function modalCk(d) {
  const i = [...Array(21).keys()].find(n => ckDayOf(Date.now() - n * 864e5) === d.day);
  return `<div class="row between"><h1 style="font-size:22px">${ckDayLabel(d.day, i)}</h1><button class="btn ghost" data-a="sleepLog">‹ Log</button></div>
  ${ckForm('modal.data', d)}
  <button class="btn primary block" style="margin-top:14px" data-a="ckModalSave">${ic('check', 18)}Save</button>
  ${db.checkins[d.day] ? `<button class="btn danger block" style="margin-top:10px" data-a="ckClear">Clear this day</button>` : ''}`;
}
function modalMood() {
  const n = ui.now, today = db.moods.filter(x => x.t >= startOfDay(Date.now())).reverse();
  return `<div class="row between"><h1 style="font-size:22px">How are you right now?</h1><button class="btn ghost" data-a="closeModal" data-force>Close</button></div>
  <div class="small muted" style="margin-bottom:6px">${fmtTime(Date.now())} · a few of these through the day show when you are at your best.</div>
  <div class="ck-lbl">${ic('bolt', 16)}Energy</div>${scale('now.energy', n.energy, battery, ENERGY)}
  <div class="ck-lbl">${ic('sun', 16)}Mood</div>${scale('now.mood', n.mood, face, MOOD)}
  <button class="btn primary block" style="margin-top:12px" data-a="moodSave">${ic('check', 18)}Log it</button>
  ${today.length ? `<span class="lbl">Today</span><div class="ilist" style="margin-top:0;background:var(--card2)">${today.map(x => `<div class="irow"><span class="grow">${fmtTime(x.t)}<span class="isub">${moodWords(x)}</span></span><button class="rm" style="width:34px;height:34px" data-a="moodDel" data-v="${x.id}" aria-label="Delete this check-in">×</button></div>`).join('')}</div>` : ''}`;
}
function modalPause(d) {
  return `<h1 style="font-size:24px;margin-bottom:4px">Why are you pausing?</h1><div class="small muted" style="margin-bottom:16px">The clock is stopped. Break time is tracked separately.</div>
  ${BREAKS.map(b => `<button class="btn block brk" data-a="pauseReason" data-v="${b}"><span>${b}</span><small>${BREAK_NOTE(breakWeight(b))}</small></button>`).join('')}
  <div class="row"><input type="text" maxlength="40" placeholder="Other reason…" data-m="modal.data.other" value="${esc(d.other)}"><button class="btn primary" data-a="pauseReason" data-v="">Save</button></div>
  <div class="small muted" style="margin-top:8px">Any other reason counts as a distraction.</div>`;
}
function modalPin(d) {
  return `<div class="row between"><h1 style="font-size:22px">Set PIN</h1><button class="btn ghost" data-a="closeModal" data-force>Close</button></div>
  <input type="tel" inputmode="numeric" maxlength="4" pattern="[0-9]*" placeholder="4 digits" data-m="modal.data.pin" value="${esc(d.pin)}" style="text-align:center;font-size:24px;letter-spacing:.4em">
  <button class="btn primary block" style="margin-top:16px" data-a="savePin">Save PIN</button>`;
}
function sessionForm(s) {
  if (!s) return { id: null, subjectId: ui.start.subjectId, typeId: ui.start.typeId, crewId: '', task: '', date: localISO(Date.now() - 3600e3), dur: 50, paused: '', distractions: 0, tags: {}, focus: 0, output: 0, sleep: '', energy: 0, mood: 0, note: '' };
  return { id: s.id, subjectId: s.subjectId, typeId: s.typeId || '', crewId: s.crewId || '', task: s.task || '', date: localISO(s.start), dur: Math.round(effMin(s)), paused: Math.round((s.pausedMs || 0) / 60000) || '', distractions: s.distractions || 0, tags: Object.fromEntries(s.tags.map(t => [t.id, t.at || 0])), focus: s.focusSelf || 0, output: s.output, sleep: s.sleep ?? '', energy: s.energy || 0, mood: s.mood || 0, note: s.note || '' };
}
// A day's sleep can be several blocks (3:30–8:00, then 10:00–12:00) or none at all (all-nighter).
const ckBlocks = c => !c ? [] : Array.isArray(c.blocks) ? c.blocks : c.bed && c.wake ? [{ bed: c.bed, wake: c.wake }] : []; // older check-ins had one bed/wake pair
const blankCk = () => ({ blocks: [{ bed: '', wake: '' }], none: false, energy: 0, mood: 0 });
const ckTotal = f => f.none ? 0 : (sum(f.blocks.map(b => sleepHrs(b.bed, b.wake) || 0)) || null);
// what each session that day carries: total hours, first bedtime, last wake, number of blocks (sb)
const ckFields = c => { const bl = ckBlocks(c), slept = c?.sleep ?? null; return { sleep: slept, bed: bl[0]?.bed ?? null, wake: bl.length ? bl[bl.length - 1].wake : null, sb: slept == null ? null : bl.length, energy: c?.energy ?? null, mood: c?.mood ?? null }; };
const ckFormFrom = day => { const c = db.checkins[day], bl = ckBlocks(c); return { day, blocks: bl.length ? bl.map(b => ({ ...b })) : [{ bed: '', wake: '' }], none: !!c && c.sleep === 0, energy: c?.energy || 0, mood: c?.mood || 0 }; };
const ckSummary = c => { const bl = ckBlocks(c); return c.sleep === 0 ? 'No sleep' : c.sleep ? fmtSleep(c.sleep) + (bl.length > 1 ? ' in ' + bl.length + ' blocks' : '') : ''; };
function ckForm(p, f) { // shared by the home card (p = 'ck') and the sleep-log editor (p = 'modal.data')
  return `<div class="ck-lbl">${ic('moon', 16)}Sleep<b class="slept" id="sleepOut">${f.none ? 'No sleep' : fmtSleep(ckTotal(f))}</b></div>
    ${f.none ? '' : f.blocks.map((b, i) => `<div class="sleep">
      <label><span>${i ? 'Slept again at' : 'Went to bed'}</span><input type="time" data-m="${p}.blocks.${i}.bed" data-live="sleep" data-p="${p}" value="${esc(b.bed)}"></label>
      <label><span>Woke up</span><input type="time" data-m="${p}.blocks.${i}.wake" data-live="sleep" data-p="${p}" value="${esc(b.wake)}"></label>
      ${f.blocks.length > 1 ? `<button class="rm" data-a="ckRm" data-p="${p}" data-v="${i}" aria-label="Remove this block">×</button>` : ''}</div>`).join('')}
    <div class="chips" style="margin-top:10px">${f.none ? '' : `<button class="chip sm dash" data-a="ckAdd" data-p="${p}">+ Another sleep block</button>`}<button class="chip sm ${f.none ? 'on' : ''}" data-a="ckNone" data-p="${p}">No sleep</button></div>
    <div class="ck-lbl">${ic('bolt', 16)}Energy</div>${scale(p + '.energy', f.energy, battery, ENERGY)}
    <div class="ck-lbl">${ic('sun', 16)}Mood</div>${scale(p + '.mood', f.mood, face, MOOD)}`;
}
// Save one day's check-in and stamp it onto every session of that day. Returns false (with a toast) if it isn't valid.
function saveCheckin(day, f) {
  const blocks = f.none ? [] : f.blocks.filter(b => b.bed || b.wake);
  if (blocks.some(b => !sleepHrs(b.bed, b.wake))) { toast('Each sleep block needs a bed time and a wake time'); return false; }
  const sleep = f.none ? 0 : blocks.length ? Math.round(sum(blocks.map(b => sleepHrs(b.bed, b.wake))) * 4) / 4 : null;
  if (sleep == null && !f.energy && !f.mood) { toast('Add your sleep, energy or mood first'); return false; }
  const ck = db.checkins[day] = { blocks, sleep, energy: f.energy || null, mood: f.mood || null, u: Date.now() };
  const put = x => { const f = ckFields(ck); Object.assign(x, { sleep: f.sleep, bed: f.bed, wake: f.wake, sb: f.sb }); if (x.energy == null) x.energy = f.energy; if (x.mood == null) x.mood = f.mood; };
  for (const x of db.sessions) if (ckDayOf(x.start) === day) { put(x); x.u = Date.now(); }
  if (db.active && ckDayOf(db.active.start) === day) put(db.active);
  save(); return true;
}
const MOOD_GAP = 3 * 3600e3; // ask again after three hours
function logMood(energy, mood, t = Date.now()) { if (!energy && !mood) return false; db.moods.push({ id: uid(), t, energy: energy || null, mood: mood || null, u: Date.now() }); db.moods.sort((x, y) => x.t - y.t); return true; }
const lastMood = (before = Date.now()) => { for (let i = db.moods.length - 1; i >= 0; i--) if (db.moods[i].t <= before) return db.moods[i]; return null; };
const moodDue = () => { const l = lastMood(); return !l || Date.now() - l.t >= MOOD_GAP; };
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.floor(m / 60) + 'h ago' : Math.floor(m / 1440) + 'd ago'; };
const moodWords = x => [x.energy ? 'energy ' + ENERGY[x.energy - 1].toLowerCase() : '', x.mood ? 'mood ' + MOOD[x.mood - 1].toLowerCase() : ''].filter(Boolean).join(' · ');
// The app can't send reminders while it is closed, so it asks when you open it and it has been a while.
function maybeAskMood() {
  if (ui.modal || db.active || !$('#lock').hidden || !moodDue()) return;
  if (Date.now() - (db.settings.moodAsked || 0) < MOOD_GAP) return; // already asked recently and you dismissed it
  db.settings.moodAsked = Date.now(); saveLocal();
  ui.now = { energy: 0, mood: 0 }; ui.modal = { kind: 'mood', data: {} }; renderModal();
}
const ckRepaint = el => el.dataset.p === 'ck' ? render() : renderModal(true);
const numOrNull = v => v === '' || v == null || isNaN(+v) ? null : +v;

/* ================= LOCK ================= */
function renderLock() {
  const l = $('#lock');
  l.innerHTML = `<span class="donebadge" style="margin-bottom:-10px">${ic('lock', 28)}</span><div class="muted">Enter PIN</div><div class="dots">${[0, 1, 2, 3].map(i => `<i class="${i < ui.pinBuf.length ? 'on' : ''}"></i>`).join('')}</div>
  <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => k === '' ? '<span></span>' : `<button data-a="pinKey" data-v="${k}">${k}</button>`).join('')}</div>`;
}

/* ================= EXPORT / IMPORT ================= */
async function download(name, text, mime) {
  const file = new File([text], name, { type: mime });
  // iOS home-screen apps handle the share sheet more reliably than a download link
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function toCSV() {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['date', 'start', 'end', 'subject', 'type', 'studied_with', 'task', 'effective_min', 'paused_min', 'breaks', 'boosters', 'booster_added_at_min', 'distractions', 'focus_score', 'focus_measured', 'focus_self', 'output', 'productivity_score', 'sleep_hrs', 'bedtime', 'wake', 'energy', 'mood', 'planned_min', 'note'];
  const rows = [...db.sessions].sort((a, b) => a.start - b.start).map(s => [dayKey(s.start), fmtTime(s.start), fmtTime(s.end), subj(s.subjectId).name, typ(s.typeId).name, crew(s.crewId).name, s.task, effMin(s).toFixed(1), ((s.pausedMs || 0) / 60000).toFixed(1), (s.pauses || []).map(p => (p.reason || 'Unspecified') + ' ' + ((p.end - p.start) / 60000).toFixed(1) + 'm').join(' | '),
    tagIds(s).map(id => tagById(id).name).join(' | '), s.tags.filter(t => tagById(t.id)).map(t => Math.round((t.at || 0) / 60000)).join(' | '), s.distractions || 0, s.focus, s.fa, s.focusSelf || '', s.output, score(s).toFixed(1), s.sleep, s.bed, s.wake, s.energy || '', s.mood || '', s.planned, s.note].map(q).join(','));
  return [head.join(','), ...rows].join('\n');
}
function importFile(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !Array.isArray(d.sessions) || !Array.isArray(d.subjects)) throw 0;
      ask(`Replace everything on this device with the backup (${d.sessions.length} sessions)?`, () => { const pin = db.settings.pin; db = migrate(d); db.settings.pin = pin; db.active = null; save(); applyTheme(); freshStart(); render(); toast('Backup imported'); }, 'Replace');
    } catch (e) { toast('That file is not a valid backup'); }
  };
  r.readAsText(file); input.value = '';
}
function seedDemo() {
  const now = Date.now(), R = Math.random, T = db.tags, hours = [7, 8, 9, 10, 11, 14, 15, 16, 19, 20, 21, 22], prob = [.35, .3, .3];
  if (!db.subjects.length) return toast('Add a subject first');
  const nights = {};
  for (let i = 0; i < 60; i++) {
    const hour = hours[Math.floor(R() * hours.length)];
    let start = addDays(startOfDay(now), -Math.floor(R() * 45)) + hour * 3600e3 + Math.floor(R() * 40) * 60000;
    if (start > now - 4 * 3600e3) start -= 864e5;
    const night = nights[dayKey(start)] ||= (() => { const sl = Math.round((5 + R() * 4) * 2) / 2, b = Math.round((22 + R() * 4.5) * 4) / 4, hm = h => pad(Math.floor(h) % 24) + ':' + pad(Math.round(h % 1 * 60)); const r = R(); return r < .06 ? { sleep: 0, bed: null, wake: null, sb: 0, late: true } : { sleep: sl, bed: hm(b), wake: hm(b + sl), sb: r < .25 ? 2 : 1, late: b >= 25 }; })();
    const sleep = night.sleep, has = T.map((_, j) => R() < (prob[j] ?? .2));
    const tags = T.filter((_, j) => has[j]).map(t => ({ id: t.id, at: R() < .3 ? Math.round((8 + R() * 25)) * 60000 : 0 }));
    const pi = Math.floor(R() * db.crews.length), pl = db.crews[pi], pEff = [.4, .3, -.6, -.2][pi] ?? 0;
    const len = Math.round(25 + R() * 70 + (has[1] ? 15 : 0)), paused = R() < .5 ? Math.round(R() * 8) * 60000 : 0;
    const fr = 2.6 + (sleep - 7) * .35 + (has[0] ? .6 : 0) + (has[1] ? .3 : 0) + (hour < 12 ? .4 : hour >= 21 ? -.5 : 0) - (len > 80 ? .4 : 0) - (night.late ? .4 : 0) + (R() - .5) * 1.6;
    const focus = clamp(Math.round(fr + pEff), 1, 5), self = R() < .6 ? focus : null;
    db.moods.push({ id: uid() + 'm' + i, u: Date.now(), demo: true, t: start - 5 * 60000, energy: clamp(Math.round(4.3 - Math.abs(hour - 10) * .22 + (sleep - 7) * .3 + (R() - .5) * 1.4), 1, 5), mood: clamp(Math.round(3.4 + (hour >= 21 ? -.6 : 0) + (R() - .5) * 2), 1, 5) });
    db.sessions.push(setFocus({
      id: uid() + i, u: Date.now(), demo: true, subjectId: db.subjects[Math.floor(R() * db.subjects.length)].id, crewId: pl ? pl.id : '', typeId: db.types.length ? db.types[Math.floor(R() * R() * db.types.length)].id : '', task: '',
      start, end: start + len * 60000 + paused, pausedMs: paused, pauses: paused ? [{ start: start + 6e5, end: start + 6e5 + paused, reason: [...BREAKS, 'Other'][Math.floor(R() * 5)] }] : [], tags, distractions: Math.max(0, Math.round(4 - focus * .6 - (has[2] ? .8 : 0) + R() * 3)),
      focusSelf: self, fa: 0, output: clamp(Math.round(fr + (R() - .5) * 2), 1, 5), note: '', sleep, bed: night.bed, wake: night.wake, sb: night.sb, energy: clamp(Math.round(sleep - 4 + (R() - .5) * 2), 1, 5), mood: clamp(Math.round(3 + (R() - .5) * 3), 1, 5), planned: null
    }));
  }
  db.moods.sort((x, y) => x.t - y.t);
  save(); render(); toast('Added 60 demo sessions');
}

/* ================= SYNC (private GitHub repo) ================= */
// The token lives under its own key so it never ends up in a backup file or in the synced data.
const SYNC_KEY = 'focusLog.sync', SYNC_FILE = '/contents/data.json';
let sync = null; try { sync = JSON.parse(localStorage.getItem(SYNC_KEY)); } catch (e) { /* not set up */ }
let syncing = false, syncT, syncAgain = false;
function saveSync() { sync ? localStorage.setItem(SYNC_KEY, JSON.stringify(sync)) : localStorage.removeItem(SYNC_KEY); }
// what gets shared: everything except this device's own bits (PIN, running timer, today's check-in)
const syncDoc = () => ({ schema: SCHEMA, subjects: db.subjects, types: db.types, tags: db.tags, crews: db.crews, sessions: db.sessions, goals: db.goals, shared: { theme: db.settings.theme, neglectDays: db.settings.neglectDays }, deleted: db.deleted, checkins: db.checkins, moods: db.moods, metaU: db.metaU || 0 });
const b64e = str => { const b = new TextEncoder().encode(str); let o = ''; for (let i = 0; i < b.length; i += 0x8000) o += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(o); };
const b64d = str => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/\s/g, '')), c => c.charCodeAt(0)));
const gh = (path, opt = {}) => fetch('https://api.github.com/repos/' + sync.repo + path, { cache: 'no-store', ...opt, headers: { Authorization: 'Bearer ' + sync.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.headers || {}) } });
const ghErr = st => st === 401 ? 'GitHub rejected the token. It may have expired.' : st === 403 ? 'The token is not allowed to write to this repo.' : st === 404 ? 'Repo not found, or the token cannot see it.' : 'GitHub error ' + st;
async function pullRemote() {
  const r = await gh(SYNC_FILE);
  if (r.status === 404) { const rr = await gh(''); if (!rr.ok) throw new Error(ghErr(rr.status)); return { doc: null, sha: null, text: '' }; } // repo is fine, file not created yet
  if (!r.ok) throw new Error(ghErr(r.status));
  const j = await r.json();
  const text = j.content ? b64d(j.content) : await (await gh(SYNC_FILE, { headers: { Accept: 'application/vnd.github.raw' } })).text(); // files over 1 MB come back without content
  let doc = null; try { doc = JSON.parse(text); } catch (e) { /* unreadable → treat as empty and overwrite */ }
  return { doc, sha: j.sha, text };
}
// Fold the remote copy into this device. Newest edit of each item wins; a deletion beats any older edit.
function mergeRemote(r) {
  const before = JSON.stringify(syncDoc()), now = Date.now();
  for (const coll of ['subjects', 'types', 'tags', 'crews']) {
    const rem = Array.isArray(r[coll]) ? r[coll] : [], remap = {};
    // two devices each start with their own "Math": same name, different id → keep the remote one, repoint local sessions
    for (const ri of rem) { const li = db[coll].find(x => x.id !== ri.id && !rem.some(y => y.id === x.id) && x.name.trim().toLowerCase() === String(ri.name).trim().toLowerCase()); if (li) remap[li.id] = ri.id; }
    if (Object.keys(remap).length) {
      db[coll] = db[coll].filter(x => !remap[x.id]);
      for (const s of [...db.sessions, db.active]) {
        if (!s) continue; let hit = false;
        if (coll === 'subjects' && remap[s.subjectId]) { s.subjectId = remap[s.subjectId]; hit = true; }
        if (coll === 'types' && remap[s.typeId]) { s.typeId = remap[s.typeId]; hit = true; }
        if (coll === 'crews' && remap[s.crewId]) { s.crewId = remap[s.crewId]; hit = true; }
        if (coll === 'tags') s.tags.forEach(t => { if (remap[t.id]) { t.id = remap[t.id]; hit = true; } });
        if (hit && s !== db.active) s.u = now;
      }
      if (coll === 'subjects') for (const [a, b] of Object.entries(remap)) { if (db.goals.subjects[a] && !db.goals.subjects[b]) db.goals.subjects[b] = db.goals.subjects[a]; delete db.goals.subjects[a]; }
    }
    const m = new Map(db[coll].map(x => [x.id, x]));
    for (const ri of rem) { const l = m.get(ri.id); if (!l || (ri.u || 0) > (l.u || 0)) m.set(ri.id, ri); }
    db[coll] = [...m.values()];
  }
  const m = new Map(db.sessions.map(x => [x.id, x]));
  for (const rs of Array.isArray(r.sessions) ? r.sessions : []) { rs.tags ||= []; const l = m.get(rs.id); if (!l || (rs.u || 0) > (l.u || 0)) m.set(rs.id, rs); }
  db.sessions = [...m.values()]; db.sessions.forEach(setFocus);
  const mm = new Map(db.moods.map(x => [x.id, x]));
  for (const x of Array.isArray(r.moods) ? r.moods : []) { const l = mm.get(x.id); if (!l || (x.u || 0) > (l.u || 0)) mm.set(x.id, x); }
  db.moods = [...mm.values()].sort((x, y) => x.t - y.t);
  for (const [day, c] of Object.entries(r.checkins || {})) if (!db.checkins[day] || (c.u || 0) > (db.checkins[day].u || 0)) db.checkins[day] = c;
  for (const [id, ts] of Object.entries(r.deleted || {})) db.deleted[id] = Math.max(db.deleted[id] || 0, ts);
  const gone = x => (db.deleted[x.id] || 0) >= (x.u || 1);
  db.sessions = db.sessions.filter(x => !gone(x)); db.moods = db.moods.filter(x => !gone(x));
  for (const coll of ['subjects', 'types', 'tags', 'crews']) db[coll] = db[coll].filter(x => !gone(x));
  for (const s of [...db.sessions, db.active]) if (s) s.tags = s.tags.filter(t => tagById(t.id));
  if ((r.metaU || 0) > (db.metaU || 0)) { // goals and theme travel together, newest wins
    if (r.goals) { db.goals = r.goals; db.goals.subjects ||= {}; }
    if (r.shared) { db.settings.theme = r.shared.theme || db.settings.theme; db.settings.neglectDays = r.shared.neglectDays || db.settings.neglectDays; }
    db.metaU = r.metaU;
  }
  return JSON.stringify(syncDoc()) !== before;
}
async function syncNow(loud) {
  if (!sync) return;
  if (syncing) { syncAgain = true; return; }
  if (navigator.onLine === false) { sync.err = 'Offline. Will sync when you are back online.'; saveSync(); syncPaint(); return; }
  syncing = true; syncPaint();
  try {
    let done = false;
    for (let i = 0; i < 4 && !done; i++) {
      const rem = await pullRemote();
      if (rem.doc && mergeRemote(rem.doc)) {
        saveLocal(); applyTheme();
        const el = document.activeElement, typing = el && /INPUT|TEXTAREA|SELECT/.test(el.tagName);
        if (!ui.modal && !ui.setup && !typing) render(); // don't yank the screen from under someone mid-entry
      }
      const mine = JSON.stringify(syncDoc());
      if (rem.text === mine) { done = true; break; }
      const put = await gh(SYNC_FILE, { method: 'PUT', body: JSON.stringify({ message: 'sync', content: b64e(mine), ...(rem.sha ? { sha: rem.sha } : {}) }) });
      if (put.ok) done = true;
      else if (put.status !== 409 && put.status !== 422) throw new Error(ghErr(put.status)); // 409/422 = the other device wrote first → pull again
    }
    if (!done) throw new Error('Both devices were saving at once. It will retry.');
    sync.last = Date.now(); sync.err = '';
    if (loud) toast('Synced');
  } catch (e) {
    sync.err = e instanceof TypeError ? 'Could not reach GitHub. Will retry.' : e.message;
    if (loud) toast(sync.err);
  }
  syncing = false; saveSync(); syncPaint();
  if (syncAgain) { syncAgain = false; scheduleSync(); }
}
function scheduleSync() { if (!sync) return; clearTimeout(syncT); syncT = setTimeout(syncNow, 2500); }
function syncPaint() { if (ui.tab === 'settings' && (!ui.setPage || ui.setPage === 'sync') && !ui.modal && document.activeElement?.tagName !== 'INPUT') render(); }
addEventListener('online', () => syncNow());

/* ================= ACTIONS ================= */
const A = {
  tab(el) { ui.tab = el.dataset.v; ui.setPage = null; scrollTo(0, 0); render(); animate(); },
  setPage(el) { ui.setPage = el.dataset.v || null; scrollTo(0, 0); render(); animate(el.dataset.v ? 'fwd' : 'back'); },
  // generic setter: data-path on ui, data-v value; without data-keep a second tap clears it
  set(el) {
    const p = el.dataset.path, v = 'n' in el.dataset ? +el.dataset.v : el.dataset.v, cur = getPath(ui, p);
    setPath(ui, p, 'keep' in el.dataset || String(cur) !== String(v) ? v : ('n' in el.dataset ? 0 : ''));
    p.startsWith('modal.') || (ui.modal && ui.modal.kind === 'mood' && p.startsWith('now.')) ? renderModal(true) : render();
    if (p === 'statsTab' || p === 'f.range') animate();
  },
  startTag(el) { const t = ui.start.tags; t[el.dataset.v] ? delete t[el.dataset.v] : t[el.dataset.v] = true; render(); },
  // The check-in is saved the moment you tap it, applies to every session that day, and stays hidden until tomorrow.
  ckSave() { const c = ui.ck, first = !ui.ckEdit; if (saveCheckin(ckDay(), c)) { if (first && logMood(c.energy, c.mood)) save(); ui.ckEdit = false; ui.ck = blankCk(); render(); toast('Check-in saved'); } },
  ckEdit() { ui.ck = ckFormFrom(ckDay()); ui.ckEdit = true; render(); },
  // block editing works the same on the home card and in the sleep-log editor; data-p says which form
  ckAdd(el) { getPath(ui, el.dataset.p).blocks.push({ bed: '', wake: '' }); ckRepaint(el); },
  ckRm(el) { getPath(ui, el.dataset.p).blocks.splice(+el.dataset.v, 1); ckRepaint(el); },
  ckNone(el) { const f = getPath(ui, el.dataset.p); f.none = !f.none; ckRepaint(el); },
  moodOpen() { ui.now = { energy: 0, mood: 0 }; ui.modal = { kind: 'mood', data: {} }; renderModal(); },
  moodSave() { if (!logMood(ui.now.energy, ui.now.mood)) return toast('Tap an energy or mood level first'); ui.now = { energy: 0, mood: 0 }; ui.modal = null; save(); render(); toast('Logged'); },
  moodDel(el) { db.deleted[el.dataset.v] = Date.now(); db.moods = db.moods.filter(x => x.id !== el.dataset.v); save(); renderModal(true); },
  sleepLog() { ui.modal = { kind: 'sleeplog', data: {} }; renderModal(); },
  ckOpen(el) { ui.modal = { kind: 'ck', data: ckFormFrom(el.dataset.v) }; renderModal(); },
  ckModalSave() { if (saveCheckin(ui.modal.data.day, ui.modal.data)) { ui.modal = { kind: 'sleeplog', data: {} }; render(); toast('Sleep saved'); } },
  ckClear() {
    const day = ui.modal.data.day;
    ask('Clear the sleep, energy and mood logged for this day?', () => {
      db.checkins[day] = { blocks: [], sleep: null, energy: null, mood: null, u: Date.now() };
      for (const x of db.sessions) if (ckDayOf(x.start) === day) Object.assign(x, ckFields(null), { u: Date.now() });
      save(); ui.modal = { kind: 'sleeplog', data: {} }; render();
    }, 'Clear');
  },
  nextTip() { ui.tipI++; render(); },
  // one tap: same subject, type and group as your most recent session, no boosters, no planned length
  quickStart() {
    const l = db.sessions.reduce((m, x) => !m || x.start > m.start ? x : m, null); if (!l) return;
    Object.assign(ui.start, { subjectId: subj(l.subjectId).id || ui.start.subjectId, typeId: typ(l.typeId).id, crewId: crew(l.crewId).id, task: l.task || '', tags: {}, planned: '' });
    A.start();
  },
  newSession() { ui.setup = true; scrollTo(0, 0); render(); animate('fwd'); },
  backHome() { ui.setup = false; render(); animate('back'); },
  start() {
    const s = ui.start; if (!s.subjectId) return toast('Pick a subject');
    db.active = { subjectId: s.subjectId, typeId: s.typeId, crewId: s.crewId || '', task: s.task.trim(), start: Date.now(), pausedMs: 0, pauseStart: null, tags: db.tags.filter(t => s.tags[t.id]).map(t => ({ id: t.id, at: 0 })), distractions: 0, planned: +s.planned > 0 ? +s.planned : null, ...ckFields(db.checkins[ckDay()]), ...(m => m && Date.now() - m.t < MOOD_GAP ? { energy: m.energy ?? null, mood: m.mood ?? null } : {})(lastMood()), ending: false };
    db.settings.lastSubject = s.subjectId; db.settings.lastType = s.typeId; db.settings.lastCrew = s.crewId || null; ui.setup = false; ui.end = { focus: 0, output: 0, note: '', energy: 0, mood: 0 };
    save(); render(); animate();
  },
  // pausing stops the clock straight away, then asks why; each break is logged with its reason and length
  pause() {
    const a = db.active, now = Date.now(); a.pauses ||= [];
    if (a.pauseStart) { a.pausedMs += now - a.pauseStart; a.pauseStart = null; const p = a.pauses[a.pauses.length - 1]; if (p && !p.end) p.end = now; if (ui.modal && ui.modal.kind === 'pause') ui.modal = null; }
    else { a.pauseStart = now; a.pauses.push({ start: now, end: null, reason: '' }); ui.modal = { kind: 'pause', data: { other: '' } }; }
    save(); render();
  },
  pauseReason(el) {
    const a = db.active, p = a && a.pauses && a.pauses[a.pauses.length - 1], r = el.dataset.v || ui.modal.data.other.trim() || 'Other';
    if (p && !p.end) { p.reason = r; save(); }
    ui.modal = null; render();
  },
  distract() { db.active.distractions++; save(); const b = $('#tDist'); b.textContent = db.active.distractions; b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); },
  liveTag(el) { const a = db.active, i = a.tags.findIndex(t => t.id === el.dataset.v); i >= 0 ? a.tags.splice(i, 1) : a.tags.push({ id: el.dataset.v, at: Date.now() - a.start, ts: Date.now() }); save(); render(); },
  // finishing freezes the clock by starting a pause; that final pause never counts toward paused time
  end() { const a = db.active; a.endPause = !a.pauseStart; if (!a.pauseStart) a.pauseStart = Date.now(); a.ending = true; save(); scrollTo(0, 0); render(); animate(); },
  // going back un-freezes the clock; the time spent on the finish screen is skipped entirely rather than logged as a break
  backToTimer() { const a = db.active, now = Date.now(); a.ending = false; if (a.endPause) { const gap = now - a.pauseStart; a.start += gap; (a.pauses || []).forEach(p => { p.start += gap; if (p.end) p.end += gap; }); a.pauseStart = null; } save(); render(); animate(); },
  saveActive() {
    const a = db.active, e = ui.end; if (!e.output) return toast('Rate your output first');
    const had = new Set(milestones().filter(m => m.done).map(m => m.name));
    db.sessions.push(setFocus({ id: uid(), u: Date.now(), subjectId: a.subjectId, typeId: a.typeId, crewId: a.crewId || '', task: a.task, start: a.start, end: a.pauseStart, pausedMs: a.pausedMs, tags: a.tags, pauses: (a.pauses || []).filter(p => p.end), distractions: a.distractions, focusSelf: e.focus || null, fa: 0, output: e.output, note: e.note.trim(), sleep: a.sleep, bed: a.bed, wake: a.wake, energy: a.energy, mood: a.mood, planned: a.planned }));
    logMood(e.energy, e.mood, a.pauseStart);
    db.active = null; save(); freshStart(); render(); animate();
    const won = milestones().filter(m => m.done && !had.has(m.name));
    toast(won.length ? 'Milestone earned: ' + won.map(m => m.name).join(', ') : 'Session saved');
  },
  discard() { ask('Discard this session? It will not be saved.', () => { db.active = null; save(); freshStart(); render(); animate(); }, 'Discard'); },
  askNo(el, e) { if (e.target !== el && !('force' in el.dataset)) return; $('#ask').innerHTML = ''; askCb = null; },
  askYes() { const cb = askCb; $('#ask').innerHTML = ''; askCb = null; if (cb) cb(); },

  addSession() { ui.modal = { kind: 'session', data: sessionForm(null) }; renderModal(); },
  editSession(el) { const s = db.sessions.find(x => x.id === el.dataset.v); if (s) { ui.modal = { kind: 'session', data: sessionForm(s) }; renderModal(); } },
  modalTag(el) { const t = ui.modal.data.tags, id = el.dataset.v, v = t[id]; if (v == null) t[id] = 0; else if (v === 0) t[id] = 'mid'; else delete t[id]; renderModal(true); },
  saveSession() {
    const d = ui.modal.data, start = new Date(d.date).getTime(), dur = parseFloat(d.dur);
    if (!d.subjectId || isNaN(start) || !(dur > 0)) return toast('Subject, start time and minutes are required');
    if (!d.output) return toast('Rate your output');
    const paused = Math.max(0, parseFloat(d.paused) || 0) * 60000, old = db.sessions.find(s => s.id === d.id);
    const s = Object.assign(old || { id: uid() }, {
      u: Date.now(), subjectId: d.subjectId, typeId: d.typeId, crewId: d.crewId || '', task: d.task.trim(), start, end: start + dur * 60000 + paused, pausedMs: paused,
      tags: db.tags.filter(t => d.tags[t.id] != null).map(t => ({ id: t.id, at: d.tags[t.id] === 'mid' ? Math.max(MID_MS, Math.round(dur * 30000)) : d.tags[t.id] })),
      distractions: Math.max(0, parseInt(d.distractions) || 0), focusSelf: d.focus || null, fa: 0, output: d.output, note: d.note.trim(), sleep: numOrNull(d.sleep), energy: d.energy || null, mood: d.mood || null
    });
    if (old && Math.abs(paused - sum((s.pauses || []).map(p => p.end - p.start))) > 60000) s.pauses = []; // break total was edited by hand, so the logged breaks no longer add up
    setFocus(s);
    if (!old) { const ck = db.checkins[ckDayOf(start)]; if (ck) for (const [k, v] of Object.entries(ckFields(ck))) if (s[k] == null) s[k] = v; db.sessions.push(s); }
    save(); ui.modal = null; render(); toast('Saved');
  },
  deleteSession() { ask('Delete this session?', () => { db.deleted[ui.modal.data.id] = Date.now(); db.sessions = db.sessions.filter(s => s.id !== ui.modal.data.id); save(); ui.modal = null; render(); }, 'Delete'); },

  editItem(el) {
    const coll = el.dataset.coll, x = db[coll].find(i => i.id === el.dataset.v), g = x && db.goals.subjects[x.id] || {};
    ui.modal = { kind: 'item', coll, data: x ? { id: x.id, name: x.name, color: x.color, daily: g.daily || '', weekly: g.weekly || '' } : { id: null, name: '', color: PALETTE[db[coll].length % PALETTE.length], daily: '', weekly: '' } };
    renderModal();
  },
  saveItem() {
    const { coll, data: d } = ui.modal, name = d.name.trim(); if (!name) return toast('Give it a name');
    let x = db[coll].find(i => i.id === d.id);
    if (x) { x.name = name; x.color = d.color; } else { x = { id: uid(), name, color: d.color }; db[coll].push(x); }
    x.u = Date.now();
    if (coll === 'subjects') { db.goals.subjects[x.id] = { daily: +d.daily || 0, weekly: +d.weekly || 0 }; db.metaU = Date.now(); }
    save(); ui.modal = null; freshStart(); render();
  },
  deleteItem() {
    const { coll, data: d } = ui.modal, n = db.sessions.filter(s => coll === 'subjects' ? s.subjectId === d.id : coll === 'types' ? s.typeId === d.id : coll === 'crews' ? s.crewId === d.id : s.tags.some(t => t.id === d.id)).length;
    ask(`Delete “${d.name}”?` + (n ? ` ${n} session${n === 1 ? '' : 's'} use it — they are kept, just without this label.` : ''), () => {
    db[coll] = db[coll].filter(i => i.id !== d.id); db.deleted[d.id] = Date.now();
    if (coll === 'tags') { db.sessions.forEach(s => { if (s.tags.some(t => t.id === d.id)) { s.tags = s.tags.filter(t => t.id !== d.id); s.u = Date.now(); } }); if (db.active) db.active.tags = db.active.tags.filter(t => t.id !== d.id); }
    if (coll === 'subjects') delete db.goals.subjects[d.id];
    for (const f of [ui.f, ui.hist]) { if (f.subject === d.id) f.subject = ''; if (f.type === d.id) f.type = ''; if (f.tag === d.id) f.tag = ''; }
    save(); ui.modal = null; freshStart(); render();
    }, 'Delete');
  },
  closeModal(el, e) { if (e.target !== el && !('force' in el.dataset)) return; ui.modal = null; renderModal(); },

  setTheme(el) { db.settings.theme = el.dataset.v; db.metaU = Date.now(); save(); applyTheme(); render(); },
  async syncConnect() {
    const f = ui.syncForm, repo = f.repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, ''), token = f.token.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return toast('Repo should look like owner/name');
    if (!token) return toast('Paste your access token');
    sync = { repo, token, last: 0, err: '' };
    try { const r = await gh(''); if (!r.ok) throw new Error(ghErr(r.status)); }
    catch (e) { const msg = e instanceof TypeError ? 'Could not reach GitHub.' : e.message; sync = null; return toast(msg); }
    saveSync(); ui.syncForm = null; render(); syncNow(true);
  },
  syncManual() { syncNow(true); },
  syncOff() { ask('Turn off sync on this device? Your data stays here and in the repo.', () => { sync = null; saveSync(); render(); }, 'Turn off'); },
  setPin() { ui.modal = { kind: 'pin', data: { pin: '' } }; renderModal(); },
  savePin() { const p = ui.modal.data.pin; if (!/^\d{4}$/.test(p)) return toast('PIN must be 4 digits'); db.settings.pin = hashPin(p); save(); ui.modal = null; render(); toast('PIN set'); },
  removePin() { ask('Remove the PIN lock?', () => { db.settings.pin = null; save(); render(); }, 'Remove'); },
  pinKey(el) {
    const k = el.dataset.v; ui.pinBuf = k === '⌫' ? ui.pinBuf.slice(0, -1) : (ui.pinBuf + k).slice(0, 4); renderLock();
    if (ui.pinBuf.length === 4) {
      if (hashPin(ui.pinBuf) === db.settings.pin) { $('#lock').hidden = true; ui.pinBuf = ''; }
      else { $('.dots').classList.add('shake'); setTimeout(() => { ui.pinBuf = ''; renderLock(); }, 350); }
    }
  },

  exportJSON() { download('focus-log-backup-' + dayKey(Date.now()) + '.json', JSON.stringify(db, null, 2), 'application/json'); },
  exportCSV() { download('focus-log-' + dayKey(Date.now()) + '.csv', toCSV(), 'text/csv'); },
  seedDemo,
  clearDemo() { [...db.sessions, ...db.moods].forEach(s => { if (s.demo) db.deleted[s.id] = Date.now(); }); db.sessions = db.sessions.filter(s => !s.demo); db.moods = db.moods.filter(m => !m.demo); save(); render(); toast('Demo data cleared'); },
  reset() { ask('Erase ALL sessions, subjects, boosters and settings on this device?' + (sync ? ' Sync will be switched off here; the copy in your GitHub repo is not touched.' : ''), () => ask('This cannot be undone. Erase everything?', () => { sync = null; saveSync(); db = defaults(); saveLocal(); applyTheme(); freshStart(); render(); toast('All data reset'); }, 'Erase everything'), 'Erase'); }
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-tip]');
  hideTip();
  if (t) { showTip(t.dataset.tip, e.clientX, e.clientY); (t.closest('.col, .hbar') || t).classList.add('sel'); }
  const el = e.target.closest('[data-a]');
  if (el && A[el.dataset.a]) A[el.dataset.a](el, e);
});
document.addEventListener('input', e => {
  const el = e.target; if (!el.dataset || !el.dataset.m) return;
  setPath(ui, el.dataset.m, el.value);
  if (el.dataset.live === 'hist') $('#histList').innerHTML = histList();
  if (el.dataset.live === 'sleep') $('#sleepOut').textContent = fmtSleep(ckTotal(getPath(ui, el.dataset.p)));
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'importFile') return importFile(el);
  if (el.dataset.d) { setPath(db, el.dataset.d, Math.max(0, parseFloat(el.value) || 0)); db.metaU = Date.now(); save(); }
  if (el.dataset.m && 'r' in el.dataset) { setPath(ui, el.dataset.m, el.value); render(); }
});
addEventListener('scroll', hideTip, { passive: true });
if (matchMedia('(hover: hover)').matches) document.addEventListener('mousemove', e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  t ? showTip(t.dataset.tip, e.clientX, e.clientY) : hideTip();
});

/* ================= BOOT ================= */
if (db.settings.pin) { $('#lock').hidden = false; renderLock(); }
setTimeout(maybeAskMood, 900);
freshStart(); // needs the check-in helpers above, so it runs here rather than where it is defined
render(); animate();
syncNow();
// ask the browser not to evict this site's storage when space runs low
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
