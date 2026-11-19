// Goals tab on the Ride Log: weekly targets for distance, time, climbing and
// calories, each shown as a ring for the current week (Monday to Sunday) with
// the last 8 weeks underneath.
//
// DEFAULT_GOALS are used until you change them with "Edit goals" on the page;
// your own goals are saved in that browser.

const DEFAULT_GOALS = { km: 75, hours: 3, elev: 250, kcal: 1500 };

const GOAL_METRICS = [
  { key: 'km',    label: 'Distance',  unit: 'km',   color: 'var(--jersey)', get: r => r.distance_km || 0,              fmt: v => String(+v.toFixed(v >= 100 ? 0 : 1)) },
  { key: 'hours', label: 'Time',      unit: 'h',    color: 'var(--speed)',  get: r => parseDuration(r.moving_time) / 3600, fmt: v => hoursText(v), noUnit: true },
  { key: 'elev',  label: 'Climbing',  unit: 'm',    color: 'var(--kom)',    get: r => r.elevation_m || 0,              fmt: v => Math.round(v).toLocaleString('en-GB') },
  { key: 'kcal',  label: 'Calories',  unit: 'kcal', color: 'var(--burn)',   get: r => r.calories || 0,                 fmt: v => Math.round(v).toLocaleString('en-GB') },
];
// 2.5 -> "2h 30m", 3 -> "3h"
function hoursText(v) {
  const mins = Math.round(v * 60), h = Math.floor(mins / 60), m = mins % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

const GOAL_WEEKS = 8;            // weeks in the history strip, this one included
let goalsAnimated = false;       // the rings fill up once, the first time the tab opens

function loadGoals() {
  try {
    const saved = JSON.parse(localStorage.getItem('rideGoals') || 'null');
    if (saved) return { ...DEFAULT_GOALS, ...saved };
  } catch (e) { /* storage unavailable */ }
  return { ...DEFAULT_GOALS };
}

function mondayOf(d) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function weekTotals(rides) {
  // Totals per week (keyed by the Monday's date) for the last GOAL_WEEKS weeks.
  const thisMonday = mondayOf(new Date());
  const weeks = [];
  for (let i = GOAL_WEEKS - 1; i >= 0; i--) {
    const start = new Date(thisMonday); start.setDate(start.getDate() - 7 * i);
    weeks.push({ start, key: isoDay(start), totals: { km: 0, hours: 0, elev: 0, kcal: 0 } });
  }
  const byKey = new Map(weeks.map(w => [w.key, w]));
  rides.forEach(r => {
    if (!r.date) return;
    const w = byKey.get(isoDay(mondayOf(new Date(r.date + 'T00:00'))));
    if (w) GOAL_METRICS.forEach(m => { w.totals[m.key] += m.get(r); });
  });
  return weeks;
}

function ringSvg(pct, color) {
  // A 270° gauge, open at the bottom; fills clockwise.
  const r = 52, c = 2 * Math.PI * r, arc = c * 0.75;
  const fill = Math.min(pct, 1) * arc;
  return `<svg class="goal-ring" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="${r}" class="goal-track" stroke-dasharray="${arc} ${c}" transform="rotate(135 60 60)"/>
    <circle cx="60" cy="60" r="${r}" class="goal-fill" style="stroke:${color};--arc:${arc};--fill:${fill}"
      stroke-dasharray="${fill} ${c}" transform="rotate(135 60 60)"/>
  </svg>`;
}

function renderGoals(rides) {
  const box = document.getElementById('goals-grid');
  if (!box) return;
  const goals = loadGoals();
  const weeks = weekTotals(rides);
  const now = weeks[weeks.length - 1];

  // Header: the week's dates and how many days are left in it.
  const end = new Date(now.start); end.setDate(end.getDate() + 6);
  const fmtDay = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((end - today) / 86400000);
  document.getElementById('goals-week').textContent =
    `${fmtDay(now.start)} – ${fmtDay(end)} · ${daysLeft === 0 ? 'last day' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}`;

  box.innerHTML = GOAL_METRICS.map(m => {
    const target = goals[m.key];
    const value = now.totals[m.key];
    const pct = target ? value / target : 0;
    const done = pct >= 1;
    const left = Math.max(target - value, 0);
    // Weeks in a row the goal was hit, counting back from last week (this week
    // only counts once it's hit).
    let streak = done ? 1 : 0;
    for (let i = weeks.length - 2; i >= 0 && target && weeks[i].totals[m.key] >= target; i--) streak++;
    const bars = weeks.map((w, i) => {
      const p = target ? Math.min(w.totals[m.key] / target, 1) : 0;
      const hit = target && w.totals[m.key] >= target;
      const label = `Week of ${fmtDay(w.start)}: ${m.fmt(w.totals[m.key])}${m.noUnit ? '' : ' ' + m.unit}`;
      return `<span class="goal-bar${hit ? ' hit' : ''}${i === weeks.length - 1 ? ' now' : ''}" title="${label}">
        <i style="height:${Math.max(p * 100, 4)}%;background:${m.color}"></i></span>`;
    }).join('');
    return `
      <div class="goal-card${done ? ' done' : ''}">
        <div class="goal-head"><span class="goal-label">${m.label}</span>
          ${streak > 1 ? `<span class="goal-streak" title="Goal hit ${streak} weeks in a row">${streak} wk streak</span>` : ''}</div>
        <div class="goal-dial">
          ${ringSvg(pct, m.color)}
          <div class="goal-centre">
            <div class="goal-value">${m.fmt(value)}${m.noUnit ? '' : `<span>${m.unit}</span>`}</div>
            <div class="goal-of">of ${m.fmt(target)}${m.noUnit ? '' : ' ' + m.unit}</div>
          </div>
          <div class="goal-pct">${Math.round(pct * 100)}%</div>
        </div>
        <div class="goal-status">${done ? 'Goal hit this week' : `${m.fmt(left)}${m.noUnit ? '' : ' ' + m.unit} to go`}</div>
        <div class="goal-history" aria-label="Last ${GOAL_WEEKS} weeks">${bars}</div>
      </div>`;
  }).join('');

  if (!goalsAnimated) {
    box.classList.add('animate');
    goalsAnimated = true;
  } else {
    box.classList.remove('animate');
  }
}

// ---- Edit goals ----
(function () {
  const btn = document.getElementById('goals-edit');
  const form = document.getElementById('goals-form');
  if (!btn || !form) return;

  function fill() {
    const g = loadGoals();
    form.querySelectorAll('input[name]').forEach(i => { i.value = g[i.name]; });
  }
  btn.addEventListener('click', () => {
    const open = form.hidden;
    form.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) { fill(); form.querySelector('input').focus(); }
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const g = {};
    form.querySelectorAll('input[name]').forEach(i => {
      const v = parseFloat(i.value);
      g[i.name] = v > 0 ? v : DEFAULT_GOALS[i.name];
    });
    try { localStorage.setItem('rideGoals', JSON.stringify(g)); } catch (err) { /* not saved */ }
    form.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    renderGoals(currentRides);
  });
  form.querySelector('.goals-cancel').addEventListener('click', () => {
    form.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  });
  form.querySelector('.goals-reset').addEventListener('click', () => {
    try { localStorage.removeItem('rideGoals'); } catch (err) { /* nothing saved */ }
    fill();
    renderGoals(currentRides);
  });
})();
