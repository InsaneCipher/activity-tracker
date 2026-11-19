// Goals tab on the Ride Log: weekly targets for rides, distance, time, climbing
// and calories, each shown as a ring for the current week (Monday to Sunday) with
// the last 8 weeks underneath.
//
// To change a goal, edit GOALS below.

const GOALS = { rides: 3, km: 50, hours: 2.5, elev: 200, kcal: 1000 };

const GOAL_METRICS = [
  { key: 'rides', label: 'Rides',     unit: v => (v === 1 ? 'ride' : 'rides'), color: 'var(--power)', get: () => 1, fmt: v => String(Math.round(v)) },
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

function mondayOf(d) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function weekTotals(rides) {
  // Totals for every week from your first ride (or GOAL_WEEKS ago, whichever is
  // earlier) up to this week, keyed by the Monday's date.
  const thisMonday = mondayOf(new Date());
  let first = new Date(thisMonday); first.setDate(first.getDate() - 7 * (GOAL_WEEKS - 1));
  rides.forEach(r => {
    if (!r.date) return;
    const m = mondayOf(new Date(r.date + 'T00:00'));
    if (m < first) first = m;
  });
  const weeks = [];
  for (const d = new Date(first); d <= thisMonday; d.setDate(d.getDate() + 7)) {
    weeks.push({ start: new Date(d), key: isoDay(d), totals: { rides: 0, km: 0, hours: 0, elev: 0, kcal: 0 } });
  }
  const byKey = new Map(weeks.map(w => [w.key, w]));
  rides.forEach(r => {
    if (!r.date) return;
    const w = byKey.get(isoDay(mondayOf(new Date(r.date + 'T00:00'))));
    if (w) GOAL_METRICS.forEach(m => { w.totals[m.key] += m.get(r); });
  });
  return weeks;
}

function streaks(weeks, key, target) {
  // Longest run of weeks with the goal hit, and the current run (counting back
  // from last week; this week joins in once it's hit).
  let longest = 0, run = 0;
  weeks.forEach(w => { run = w.totals[key] >= target ? run + 1 : 0; longest = Math.max(longest, run); });
  let current = 0;
  const last = weeks.length - 1;
  if (weeks[last].totals[key] >= target) current = 1;
  for (let i = last - 1; i >= 0 && weeks[i].totals[key] >= target; i--) current++;
  return { longest, current };
}

const unitOf = (m, v) => (typeof m.unit === 'function' ? m.unit(v) : m.unit);
const withUnit = (m, v) => m.fmt(v) + (m.noUnit ? '' : ' ' + unitOf(m, v));

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
  const goals = GOALS;
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
    const { longest, current: streak } = streaks(weeks, m.key, target);
    const recent = weeks.slice(-GOAL_WEEKS);
    const bars = recent.map((w, i) => {
      const p = target ? Math.min(w.totals[m.key] / target, 1) : 0;
      const hit = target && w.totals[m.key] >= target;
      const label = `Week of ${fmtDay(w.start)}: ${withUnit(m, w.totals[m.key])}`;
      return `<span class="goal-bar${hit ? ' hit' : ''}${i === recent.length - 1 ? ' now' : ''}" title="${label}">
        <i style="height:${Math.max(p * 100, 4)}%;background:${m.color}"></i></span>`;
    }).join('');
    return `
      <div class="goal-card${done ? ' done' : ''}">
        <div class="goal-head"><span class="goal-label">${m.label}</span>
          ${streak > 1 ? `<span class="goal-streak" title="Goal hit ${streak} weeks in a row">${streak} wk streak</span>` : ''}</div>
        <div class="goal-dial">
          ${ringSvg(pct, m.color)}
          <div class="goal-centre">
            <div class="goal-value">${m.fmt(value)}${m.noUnit ? '' : `<span>${unitOf(m, value)}</span>`}</div>
            <div class="goal-of">of ${withUnit(m, target)}</div>
          </div>
          <div class="goal-pct">${Math.round(pct * 100)}%</div>
        </div>
        <div class="goal-status">${done ? 'Goal hit this week' : `${withUnit(m, left)} to go`}</div>
        <div class="goal-history" aria-label="Last ${GOAL_WEEKS} weeks">${bars}</div>
        <div class="goal-best">Longest streak <b>${longest ? `${longest} week${longest === 1 ? '' : 's'}` : '—'}</b></div>
      </div>`;
  }).join('');

  renderYearGoals(rides);

  if (!goalsAnimated) {
    box.classList.add('animate');
    goalsAnimated = true;
  } else {
    box.classList.remove('animate');
  }
}

// ---- Year goals ----
// Totals for the year, plus one "longest single ride" goal. Each shows the date
// it was reached, or what's needed per week for the rest of the year. Pace is
// measured from your first ride of the year: the marker on each bar is where
// you'd be today riding at an even pace from that day to 31 December.

const YEAR_GOALS = {
  year: 2026,
  goals: [
    { key: 'km',      label: 'Distance',       target: 1000, unit: 'km', color: 'var(--jersey)', get: r => r.distance_km || 0 },
    { key: 'hours',   label: 'Time',           target: 50,   unit: 'h',  color: 'var(--speed)',  get: r => parseDuration(r.moving_time) / 3600 },
    { key: 'elev',    label: 'Climbing',       target: 4000, unit: 'm',  color: 'var(--kom)',    get: r => r.elevation_m || 0 },
    { key: 'longest', label: 'Longest ride',   target: 100,  unit: 'km', color: 'var(--power)',  get: r => r.distance_km || 0, single: true },
    { key: 'rides',   label: 'Rides',          target: 60,   unit: 'rides', color: 'var(--ink)', count: () => true },
    { key: 'long50',  label: '50 km+ rides',   target: 5,    unit: 'rides', color: 'var(--jersey)', count: r => (r.distance_km || 0) >= 50, noPace: true },
    { key: 'w150',    label: '150 W+ avg rides', target: 5,  unit: 'rides', color: 'var(--power)',
      count: r => (r.power_avg_w || 0) >= 150 && (r.distance_km || 0) > 10, note: 'Rides over 10 km', noPace: true },
    { key: 'w180',    label: 'Best avg power', target: 180,  unit: 'W',  color: 'var(--power)',  get: r => r.power_avg_w || 0, single: true, note: 'On any ride' },
  ],
};
// Goal types: totals add up each ride's value (get); `single` goals look for
// one ride reaching the target; `count` goals count the rides that pass a test.
// `note` explains the goal; it shows next to the cursor when you hover the card. `noPace` goals don't
// show the pace marker or a weekly amount needed.

function yearGoalValue(g, v) {
  if (g.key === 'hours') return hoursText(v);
  if (g.unit === 'rides') {
    const n = Number.isInteger(v) ? v : +v.toFixed(1);
    return `${n.toLocaleString('en-GB')} ${n === 1 ? 'ride' : 'rides'}`;
  }
  const rounded = g.unit === 'km' ? +v.toFixed(v >= 100 ? 0 : 1) : Math.round(v);
  return `${rounded.toLocaleString('en-GB')} ${g.unit}`;
}

function renderYearGoals(rides) {
  const box = document.getElementById('year-goals');
  if (!box) return;
  const year = YEAR_GOALS.year;
  document.getElementById('year-goals-title').textContent = `${year} goals`;

  const inYear = rides
    .filter(r => r.date && r.date.startsWith(String(year)))
    .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`));

  // The goals run from your first ride of the year to 31 December.
  const start = inYear.length ? new Date(inYear[0].date + 'T00:00') : new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const spanDays = (end - start) / 86400000;
  const daysGone = Math.min(Math.max((today - start) / 86400000 + 1, 0), spanDays);   // today included
  const daysLeft = spanDays - daysGone;
  const weeksLeft = daysLeft / 7;
  const pace = daysGone / spanDays;   // share of the goal period that's gone
  document.getElementById('year-goals-left').textContent =
    today >= end ? 'Year finished'
    : `${Math.round(daysLeft)} day${Math.round(daysLeft) === 1 ? '' : 's'} left`;
  const fmtDate = d => new Date(d + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  box.innerHTML = YEAR_GOALS.goals.map(g => {
    let value = 0, reached = null, best = null;
    inYear.forEach(r => {
      if (g.count) {
        if (g.count(r)) { value++; if (!reached && value >= g.target) reached = r.date; }
        return;
      }
      const v = g.get(r);
      if (g.single) {
        if (v > value) { value = v; best = r; }
        if (!reached && v >= g.target) reached = r.date;
      } else {
        value += v;
        if (!reached && value >= g.target) reached = r.date;
      }
    });
    const pct = Math.min(value / g.target, 1);
    const left = Math.max(g.target - value, 0);

    let status;
    if (reached) {
      status = `<span class="yg-done">Achieved ${fmtDate(reached)}</span>`;
    } else if (g.single) {
      status = best ? `Best so far on ${SeasonHero.esc(routeOf(best))}, ${fmtDate(best.date)}` : 'No rides yet this year';
    } else if (g.noPace) {
      status = `${yearGoalValue(g, left)} to go`;
    } else if (weeksLeft > 0) {
      const perWeek = left / Math.max(weeksLeft, 1 / 7);
      const needed = g.unit === 'rides' && perWeek < 1
        ? `1 ride every ${Math.round(1 / perWeek)} weeks`
        : `${yearGoalValue(g, perWeek)} a week`;
      status = `${yearGoalValue(g, left)} to go · <b>${needed}</b> needed`;
    } else {
      status = `Missed by ${yearGoalValue(g, left)}`;
    }

    const showPace = !g.single && !g.noPace && !reached && daysLeft > 0 && daysGone > 0;
    return `
      <div class="yg-card${reached ? ' done' : ''}${g.note ? ' has-note' : ''}"${g.note ? ` data-note="${g.note}"` : ''}>
        <div class="yg-head">
          <span class="goal-label">${g.label}</span>
          <span class="yg-pct">${Math.round((value / g.target) * 100)}%</span>
        </div>

        <div class="yg-value">${yearGoalValue(g, value)}<span> of ${yearGoalValue(g, g.target)}${g.single && g.unit === 'km' ? ' in one ride' : ''}</span></div>
        <div class="yg-bar">
          <i style="width:${pct * 100}%;background:${g.color}"></i>
          ${showPace ? `<b class="yg-marker" style="left:${pace * 100}%" title="Where you'd be today on an even pace: ${yearGoalValue(g, g.target * pace)}"></b>` : ''}
        </div>
        <div class="yg-status">${status}</div>
      </div>`;
  }).join('');
}

// Hovering a goal card that has a note shows the note next to the cursor.
(function () {
  const box = document.getElementById('year-goals');
  if (!box) return;
  const tip = document.createElement('div');
  tip.className = 'hover-tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  box.addEventListener('pointermove', e => {
    const card = e.target.closest('[data-note]');
    if (!card) { tip.hidden = true; return; }
    tip.textContent = card.dataset.note;
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY + 16}px`;
  });
  box.addEventListener('pointerleave', () => { tip.hidden = true; });
})();
