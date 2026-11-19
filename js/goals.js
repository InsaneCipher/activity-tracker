// Goals tab and hero badges, shared by the Ride Log and the Walk Log.
//
// The goals themselves live in each page's own file, loaded just before this
// one: js/goals-rides.js and js/goals-walks.js. That file sets GOAL_CONFIG:
//   items         function returning the page's activities (rides or walks)
//   noun          { one: 'ride', many: 'rides' }
//   nameOf        function giving an activity's name, for "Best so far on ..."
//   yearKey       where the chosen year is remembered in the browser
//   weeklyTargets { key: target } for the weekly goals
//   weeklyMetrics the weekly goals: key, label, unit, color, get, fmt
//   years         the year goals, one entry per year
//   hookTabs      true if this file should redraw when the Goals tab opens

const cfg = window.GOAL_CONFIG;
// Count units, for "3 rides", "1 walk", "1 ride every 3 weeks".
const COUNT_WORDS = { rides: ['ride', 'rides'], walks: ['walk', 'walks'], hikes: ['hike', 'hikes'] };

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
  // Totals for every week from your first activity (or GOAL_WEEKS ago,
  // whichever is earlier) up to this week, keyed by the Monday's date.
  const thisMonday = mondayOf(new Date());
  let first = new Date(thisMonday); first.setDate(first.getDate() - 7 * (GOAL_WEEKS - 1));
  rides.forEach(r => {
    if (!r.date) return;
    const m = mondayOf(new Date(r.date + 'T00:00'));
    if (m < first) first = m;
  });
  const weeks = [];
  for (const d = new Date(first); d <= thisMonday; d.setDate(d.getDate() + 7)) {
    const totals = {};
    cfg.weeklyMetrics.forEach(m => { totals[m.key] = 0; });
    weeks.push({ start: new Date(d), key: isoDay(d), totals });
  }
  const byKey = new Map(weeks.map(w => [w.key, w]));
  rides.forEach(r => {
    if (!r.date) return;
    const w = byKey.get(isoDay(mondayOf(new Date(r.date + 'T00:00'))));
    if (w) cfg.weeklyMetrics.forEach(m => { w.totals[m.key] += m.get(r); });
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
  const goals = cfg.weeklyTargets;
  const weeks = weekTotals(rides);
  const now = weeks[weeks.length - 1];

  // Header: the week's dates and how many days are left in it.
  const end = new Date(now.start); end.setDate(end.getDate() + 6);
  const fmtDay = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((end - today) / 86400000);
  document.getElementById('goals-week').textContent =
    `${fmtDay(now.start)} – ${fmtDay(end)} · ${daysLeft === 0 ? 'last day' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}`;

  box.dataset.count = cfg.weeklyMetrics.length;
  box.style.setProperty('--n', cfg.weeklyMetrics.length);
  box.innerHTML = cfg.weeklyMetrics.map(m => {
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
// Each year's goals (from GOAL_CONFIG.years) show the date they were reached,
// or what's needed per week for the rest of the year. The marker on each bar
// is where you'd be today at an even pace from the goals' start to 31 December.
// Goal types: totals add up each activity's value (get); `single` goals look
// for one activity reaching the target; `count` goals count the activities that
// pass a test. `note` shows next to the cursor when you hover the card;
// `noPace` goals don't show the pace marker or a weekly amount needed.

const YEAR_GOALS = cfg.years;
const goalYears = Object.keys(YEAR_GOALS).map(Number).sort();
let goalYear = (() => {
  try { const saved = Number(localStorage.getItem(cfg.yearKey)); if (YEAR_GOALS[saved]) return saved; } catch (e) {}
  const now = new Date().getFullYear();
  return YEAR_GOALS[now] ? now : goalYears.filter(y => y <= now).pop() || goalYears[0];
})();
function yearGoalValue(g, v) {
  if (g.key === 'hours') return hoursText(v);
  if (g.unit === 'steps' && v >= 10000) {   // 422,985 -> "423k", 1,000,000 -> "1M"
    return `${new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: v >= 1e6 ? 1 : 0 }).format(v).replace('K', 'k').replace(/m$/, 'M')} steps`;
  }
  if (COUNT_WORDS[g.unit]) {
    const n = Number.isInteger(v) ? v : +v.toFixed(1);
    return `${n.toLocaleString('en-GB')} ${COUNT_WORDS[g.unit][n === 1 ? 0 : 1]}`;
  }
  const rounded = g.unit === 'km' ? +v.toFixed(v >= 100 ? 0 : 1) : Math.round(v);
  return `${rounded.toLocaleString('en-GB')} ${g.unit}`;
}

// Activities in a year, oldest first.
function yearRides(rides, year) {
  return rides
    .filter(r => r.date && r.date.startsWith(String(year)))
    .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`));
}

// How far a year goal has got: its value, the date it was reached (if it has
// been) and, for single-activity goals, the best one.
function yearGoalProgress(g, inYear) {
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
  return { value, reached, best };
}

function renderYearGoals(rides) {
  const box = document.getElementById('year-goals');
  if (!box) return;
  const year = goalYear;
  const plan = YEAR_GOALS[year];
  document.getElementById('year-goals-title').textContent = `${year} goals`;
  const picker = document.getElementById('year-picker');
  picker.innerHTML = goalYears.map(y =>
    `<button type="button" class="group-btn${y === year ? ' active' : ''}" data-year="${y}">${y}</button>`).join('');

  const inYear = yearRides(rides, year);

  // The goals run from their start date to 31 December.
  const fromFirst = plan.start === 'first' || plan.start === 'first ride';
  const start = fromFirst
    ? (inYear.length ? new Date(inYear[0].date + 'T00:00') : new Date(year, 0, 1))
    : new Date(plan.start + 'T00:00');
  const end = new Date(year + 1, 0, 1);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const spanDays = (end - start) / 86400000;
  const daysGone = Math.min(Math.max((today - start) / 86400000 + 1, 0), spanDays);   // today included
  const daysLeft = spanDays - daysGone;
  const weeksLeft = daysLeft / 7;
  const pace = daysGone / spanDays;   // share of the goal period that's gone
  const fmtDate = d => new Date(d + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  // Under the title: the dates the goals run, e.g. "29 August – 31 December".
  const longDay = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  document.getElementById('year-goals-range').textContent = `${longDay(start)} – 31 December`;

  document.getElementById('year-goals-left').textContent =
    today >= end ? 'Year finished'
    : today < start ? `Starts ${fmtDate(fromFirst ? `${year}-01-01` : plan.start)}`
    : `${Math.round(daysLeft)} day${Math.round(daysLeft) === 1 ? '' : 's'} left`;

  // How far through the goal period we are, from its start to 31 December.
  const passed = Math.round(pace * 100);
  document.getElementById('year-progress').innerHTML = `
    <div class="yp-labels"><span>${longDay(start)}</span><b>${passed}% of the way through</b><span>31 December</span></div>
    <div class="yp-bar"><i style="width:${pace * 100}%"></i></div>`;

  box.innerHTML = plan.goals.map(g => {
    const { value, reached, best } = yearGoalProgress(g, inYear);
    const pct = Math.min(value / g.target, 1);
    const left = Math.max(g.target - value, 0);

    let status;
    if (reached) {
      status = `<span class="yg-done">Achieved ${fmtDate(reached)}</span>`;
    } else if (g.single) {
      status = best ? `Best so far on ${SeasonHero.esc(cfg.nameOf(best))}, ${fmtDate(best.date)}` : `No ${cfg.noun.many} yet this year`;
    } else if (g.noPace) {
      status = `${yearGoalValue(g, left)} to go`;
    } else if (weeksLeft > 0) {
      const perWeek = left / Math.max(weeksLeft, 1 / 7);
      const needed = COUNT_WORDS[g.unit] && perWeek < 1
        ? `1 ${COUNT_WORDS[g.unit][0]} every ${Math.round(1 / perWeek)} weeks`
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

        <div class="yg-value">${yearGoalValue(g, value)}<span> of ${yearGoalValue(g, g.target)}${g.single && g.unit === 'km' ? ` in one ${cfg.noun.one}` : ''}</span></div>
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

// Year buttons above the year goals.
document.getElementById('year-picker')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-year]');
  if (!btn) return;
  goalYear = Number(btn.dataset.year);
  try { localStorage.setItem(cfg.yearKey, String(goalYear)); } catch (err) { /* not saved */ }
  renderYearGoals(cfg.items());
});

// ---- Goals badge in the hero ----
// Two rings at the top of the page: this week's goals (yellow) and this year's
// (green), with one segment per goal that lights up once it's hit. Clicking
// either opens the Goals tab.

function ringSegments(hit, total) {
  const r = 30, gap = total > 1 ? 18 : 0;          // degrees between segments (the round caps fill some of it)
  const each = 360 / total;
  const arc = (a0, a1) => {
    const p = a => [36 + r * Math.sin(a * Math.PI / 180), 36 - r * Math.cos(a * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  let out = '';
  for (let i = 0; i < total; i++) {
    const a0 = i * each + gap / 2, a1 = (i + 1) * each - gap / 2;
    out += `<path class="${i < hit ? 'on' : ''}" style="--i:${i}" d="${arc(a0, a1)}"/>`;
  }
  return `<svg viewBox="0 0 72 72" aria-hidden="true">${out}</svg>`;
}

function renderGoalBadge(rides) {
  const box = document.getElementById('hero-goals');
  if (!box) return;

  // This week
  const weeks = weekTotals(rides);
  const now = weeks[weeks.length - 1];
  const weekHit = cfg.weeklyMetrics.filter(m => now.totals[m.key] >= cfg.weeklyTargets[m.key]).length;
  const weekTotal = cfg.weeklyMetrics.length;

  // This year (the current calendar year's goals, or the latest year before it)
  const thisYear = new Date().getFullYear();
  const year = YEAR_GOALS[thisYear] ? thisYear : (goalYears.filter(y => y <= thisYear).pop() || goalYears[0]);
  const inYear = yearRides(rides, year);
  const yearGoals = YEAR_GOALS[year].goals;
  const yearHit = yearGoals.filter(g => yearGoalProgress(g, inYear).reached).length;

  const item = (hit, total, label, sub, kind) => `
    <button type="button" class="hg-item ${kind}${hit === total ? ' all' : ''}" data-open-goals>
      <span class="hg-ring">${ringSegments(hit, total)}<span class="hg-count"><b>${hit}</b>/${total}</span></span>
      <span class="hg-text"><span class="hg-label">${label}</span><span class="hg-sub">${sub}</span></span>
    </button>`;
  box.innerHTML =
    item(weekHit, weekTotal, 'Weekly goals', weekHit === weekTotal ? 'All hit this week' : 'hit this week', 'week') +
    item(yearHit, yearGoals.length, `${year} goals`, yearHit === yearGoals.length ? 'All done' : 'achieved', 'year');
  box.hidden = false;
}

document.getElementById('hero-goals')?.addEventListener('click', e => {
  if (!e.target.closest('[data-open-goals]')) return;
  const tab = document.querySelector('.tab-btn[data-view="goals-view"]');
  if (!tab) return;
  tab.click();
  document.querySelector('.tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Pages whose own script doesn't redraw the Goals tab (the Walk Log) let this
// file do it when the tab opens.
if (cfg.hookTabs) {
  document.querySelector('.tab-btn[data-view="goals-view"]')
    ?.addEventListener('click', () => renderGoals(cfg.items()));
}
