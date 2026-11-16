let currentWalks = [];
let sortKey = 'date';
let sortAsc = true;
let activeMetric = 'pace';

const fmt = (v, unit = '') => (v === null || v === undefined) ? '—' : `${v}${unit}`;
const has = v => v !== null && v !== undefined && !isNaN(v);

function parseDuration(str) {
  if (!str) return 0;
  const parts = String(str).split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// Seconds per km -> "11:16"
function formatPace(secs) {
  if (!has(secs) || secs <= 0) return '—';
  const s = Math.round(secs);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const movingSecs = w => w.moving_time_sec ?? parseDuration(w.moving_time);
const paceSecs = w => w.pace_min_per_km ? parseDuration(w.pace_min_per_km) : null;
const typeOf = w => w.type || 'Walk';

// Add derived fields used for sorting.
function prepare(walk) {
  return { ...walk, moving_time_sec: movingSecs(walk), pace_sec: paceSecs(walk) };
}

function renderTotals(walks) {
  const sum = f => walks.reduce((s, w) => s + (has(w[f]) ? w[f] : 0), 0);
  const totalTime = walks.reduce((s, w) => s + movingSecs(w), 0);
  const totalDist = sum('distance_km');
  const avgPace = totalDist ? totalTime / totalDist : null;

  document.getElementById('totals').innerHTML = `
    <div class="total-cell"><div class="num">${walks.length}</div><div class="label">Walks logged</div></div>
    <div class="total-cell"><div class="num">${totalDist.toFixed(1)}</div><div class="label">Total distance (km)</div></div>
    <div class="total-cell"><div class="num">${formatDuration(totalTime)}</div><div class="label">Time on foot</div></div>
    <div class="total-cell"><div class="num">${formatPace(avgPace)}</div><div class="label">Average pace (/km)</div></div>
    <div class="total-cell"><div class="num">${Math.round(sum('elevation_gain_m'))}</div><div class="label">Total elevation (m)</div></div>
    <div class="total-cell"><div class="num">${Math.round(sum('steps_estimated')).toLocaleString('en-GB')}</div><div class="label">Steps (estimated)</div></div>
    <div class="total-cell"><div class="num">${Math.round(sum('calories')).toLocaleString('en-GB')}</div><div class="label">Calories burned</div></div>
  `;
}

// Highest value is best for most fields; for pace the lowest is best.
function computeBestValues(walks) {
  const maxFields = ['distance_km', 'moving_time_sec', 'elevation_gain_m', 'speed_avg_kmh', 'speed_max_kmh',
                     'cadence_avg_spm', 'steps_estimated', 'calories', 'relative_effort'];
  const best = {};
  maxFields.forEach(f => {
    const vals = walks.map(w => w[f]).filter(has);
    best[f] = vals.length ? Math.max(...vals) : null;
  });
  const paces = walks.filter(w => (w.distance_km || 0) >= 1).map(w => w.pace_sec).filter(v => has(v) && v > 0);
  best.pace_sec = paces.length ? Math.min(...paces) : null;
  return best;
}

const isBest = (best, field, value) => has(value) && best[field] !== null && value === best[field];

function miniSplits(splits) {
  const full = (splits || []).filter(s => s.distance_m > 0 && s.pace_min_per_km);
  if (!full.length) return '<span class="muted">—</span>';
  const speeds = full.map(s => 3600 / parseDuration(s.pace_min_per_km)); // km/h
  const max = Math.max(...speeds), min = Math.min(...speeds);
  const bars = full.map((s, i) => {
    const h = max === min ? 70 : 25 + ((speeds[i] - min) / (max - min)) * 75;
    const partial = s.distance_m < 900 ? ' partial' : '';
    return `<div class="mini-split${partial}" style="height:${h}%" title="Km ${s.km}: ${s.pace_min_per_km} /km${s.heart_rate_avg_bpm ? ' · ' + s.heart_rate_avg_bpm + ' bpm' : ''}"></div>`;
  }).join('');
  return `<div class="mini-splits">${bars}</div>`;
}

function renderRows() {
  const best = computeBestValues(currentWalks);

  const sorted = currentWalks.slice().sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (sortKey === 'date') { av = `${a.date} ${a.time || ''}`; bv = `${b.date} ${b.time || ''}`; }
    if (av === null || av === undefined) av = sortAsc ? Infinity : -Infinity;
    if (bv === null || bv === undefined) bv = sortAsc ? Infinity : -Infinity;
    if (typeof av === 'string' && typeof bv === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortAsc ? av - bv : bv - av;
  });

  const val = (value, unit, highlight) => {
    const text = fmt(value, unit);
    return highlight ? `<span class="best-val">${text}</span>` : text;
  };
  const pair = (a, b, highlightA, highlightB) => `${val(a, '', highlightA)}<span class="pair-max${highlightB ? ' best-val' : ''}">/${fmt(b)}</span>`;

  document.getElementById('walks').innerHTML = sorted.map((w, i) => `
    <tr>
      <td class="idx">${i + 1}</td>
      <td class="muted date-cell">${fmt(w.date)}${w.time ? `<span class="walk-time">${w.time}</span>` : ''}</td>
      <td class="name" title="${w.name || ''}">${w.url ? `<a href="${w.url}" target="_blank" rel="noopener">${w.name || '—'}</a>` : (w.name || '—')}</td>
      <td><span class="type-tag ${typeOf(w).toLowerCase()}">${typeOf(w)}</span></td>
      <td class="num">${val(w.distance_km, '', isBest(best, 'distance_km', w.distance_km))}</td>
      <td class="num muted">${val(w.moving_time, '', isBest(best, 'moving_time_sec', w.moving_time_sec))}</td>
      <td class="num muted">${val(w.elevation_gain_m, '', isBest(best, 'elevation_gain_m', w.elevation_gain_m))}</td>
      <td class="num pace">${val(w.pace_min_per_km, '', isBest(best, 'pace_sec', w.pace_sec) && (w.distance_km || 0) >= 1)}</td>
      <td class="num speed">${pair(w.speed_avg_kmh, w.speed_max_kmh, isBest(best, 'speed_avg_kmh', w.speed_avg_kmh), isBest(best, 'speed_max_kmh', w.speed_max_kmh))}</td>
      <td class="num hr">${pair(w.heart_rate_avg_bpm, w.heart_rate_max_bpm)}</td>
      <td class="num steps">${val(w.cadence_avg_spm, '', isBest(best, 'cadence_avg_spm', w.cadence_avg_spm))}</td>
      <td class="num steps">${has(w.steps_estimated) ? val(w.steps_estimated.toLocaleString('en-GB'), '', isBest(best, 'steps_estimated', w.steps_estimated)) : '—'}</td>
      <td class="num muted">${val(w.calories, '', isBest(best, 'calories', w.calories))}</td>
      <td class="num muted">${val(w.relative_effort, '', isBest(best, 'relative_effort', w.relative_effort))}</td>
      <td>${miniSplits(w.splits)}</td>
    </tr>
  `).join('');

  document.querySelectorAll('#walk-table thead th[data-key]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.key === sortKey);
  });
}

/* ---------------- Tabs ---------------- */
function renderActiveView() {
  const active = document.querySelector('.view.active').id;
  if (active === 'graph-view') drawChart();
  if (active === 'records-view') { renderRecords(currentWalks); renderBreakdowns(currentWalks); }
  if (active === 'trends-view') { renderWeekly(currentWalks); renderMonthly(currentWalks); }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.view).classList.add('active');
    renderActiveView();
  });
});

/* ---------------- Graphs ---------------- */
function timeToMinutes(t) {
  if (!t) return null;
  const parts = t.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  const [h, m] = parts;
  return h * 60 + m;
}
function minutesToTime(mins) {
  mins = Math.round(mins);
  const h = Math.floor(mins / 60) % 24;
  const m = ((mins % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const METRICS = [
  { id: 'pace',       label: 'Pace',        unit: '/km',  color: '--pace',  get: w => (w.distance_km || 0) >= 1 ? w.pace_sec : null, format: formatPace,
    note: 'Lower is faster. Walks under 1 km are left out.' },
  { id: 'speed',      label: 'Speed',       unit: 'km/h', color: '--speed', get: w => w.speed_avg_kmh },
  { id: 'hr',         label: 'Heart rate',  unit: 'bpm',  color: '--hr',    get: w => w.heart_rate_avg_bpm },
  { id: 'distance',   label: 'Distance',    unit: 'km',   color: '--text',  get: w => w.distance_km },
  { id: 'time',       label: 'Time',        unit: 'min',  color: '--text',  get: w => Math.round(movingSecs(w) / 60) },
  { id: 'elevation',  label: 'Elevation',   unit: 'm',    color: '--text',  get: w => w.elevation_gain_m },
  { id: 'cadence',    label: 'Cadence',     unit: 'spm',  color: '--steps', get: w => w.cadence_avg_spm },
  { id: 'steps',      label: 'Steps',       unit: '',     color: '--steps', get: w => w.steps_estimated, format: v => Math.round(v).toLocaleString('en-GB'),
    note: 'Estimated from cadence × moving time.' },
  { id: 'calories',   label: 'Calories',    unit: 'kcal', color: '--text',  get: w => w.calories },
  { id: 'effort',     label: 'Effort',      unit: '',     color: '--text',  get: w => w.relative_effort },
  { id: 'start_time', label: 'Start time',  unit: '',     color: '--text',  get: w => timeToMinutes(w.time), format: v => minutesToTime(v) },
  { id: 'cum_distance', label: 'Total distance', unit: 'km', color: '--pace', get: w => w.distance_km, cumulative: true },
  { id: 'cum_steps',  label: 'Total steps', unit: '',     color: '--steps', get: w => w.steps_estimated, cumulative: true, format: v => Math.round(v).toLocaleString('en-GB') },
];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function buildMetricPicker() {
  const wrap = document.getElementById('metric-picker');
  wrap.innerHTML = METRICS.map(m => `<button class="metric-btn" data-metric="${m.id}">${m.label}</button>`).join('');
  wrap.querySelectorAll('.metric-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeMetric = btn.dataset.metric;
      drawChart();
    });
  });
}

function formatAxisDate(d, showYear) {
  const opts = showYear ? { day: 'numeric', month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
  return d.toLocaleDateString('en-GB', opts);
}

function drawChart() {
  const wrap = document.getElementById('metric-picker');
  wrap.querySelectorAll('.metric-btn').forEach(btn => {
    const m = METRICS.find(mm => mm.id === btn.dataset.metric);
    const active = btn.dataset.metric === activeMetric;
    btn.classList.toggle('active', active);
    btn.style.borderColor = active ? cssVar(m.color) : '';
    btn.style.color = active ? cssVar(m.color) : '';
    btn.style.background = active ? cssVar('--panel-hover') : '';
  });

  const metric = METRICS.find(m => m.id === activeMetric);
  const container = document.getElementById('chart-container');
  document.getElementById('chart-note').textContent = metric.note || '';

  const points = currentWalks
    .map(w => ({ date: new Date(`${w.date}T${w.time || '00:00'}`), value: metric.get(w), walk: w }))
    .filter(p => has(p.value) && !isNaN(p.date.getTime()))
    .sort((a, b) => a.date - b.date);

  if (metric.cumulative) {
    let running = 0;
    points.forEach(p => { running = Math.round((running + p.value) * 100) / 100; p.value = running; });
  }

  if (points.length === 0) {
    container.innerHTML = `<div class="chart-empty">No data for ${metric.label} yet.</div>`;
    return;
  }

  const W = 900, H = 340;
  const padL = 52, padR = 20, padT = 20, padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let xMin = points[0].date.getTime();
  let xMax = points[points.length - 1].date.getTime();
  if (xMin === xMax) { xMin -= 86400000; xMax += 86400000; }

  const values = points.map(p => p.value);
  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const yPad = (yMax - yMin) * 0.15;
  yMin -= yPad; yMax += yPad;
  if (!['elevation', 'start_time', 'pace'].includes(metric.id) && yMin > 0 && (yMin / (yMax - yMin)) < 0.3) yMin = 0;
  if (metric.cumulative || yMin < 0) yMin = Math.max(0, yMin);
  if (metric.cumulative) yMin = 0;

  const xScale = t => padL + ((t - xMin) / (xMax - xMin)) * plotW;
  const yScale = v => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const color = cssVar(metric.color) || cssVar('--text');
  const lineColor = metric.color === '--text' ? cssVar('--muted') : color;
  const label = v => metric.format ? metric.format(v) : Math.round(v);

  const linePoints = points.map(p => `${xScale(p.date.getTime())},${yScale(p.value)}`).join(' ');
  const areaPoints = `${xScale(points[0].date.getTime())},${padT + plotH} ` + linePoints +
    ` ${xScale(points[points.length - 1].date.getTime())},${padT + plotH}`;

  const tickCount = 4;
  const yTicks = [];
  for (let i = 0; i <= tickCount; i++) yTicks.push(yMin + (i * (yMax - yMin) / tickCount));

  const maxXTicks = 7;
  const step = Math.max(1, Math.ceil(points.length / maxXTicks));
  const spansMultipleYears = points[0].date.getFullYear() !== points[points.length - 1].date.getFullYear();
  const xTicks = [];
  for (let i = 0; i < points.length; i += step) xTicks.push(points[i]);
  if (xTicks[xTicks.length - 1] !== points[points.length - 1]) xTicks.push(points[points.length - 1]);

  const gridLines = yTicks.map(v => `
    <line x1="${padL}" y1="${yScale(v)}" x2="${W - padR}" y2="${yScale(v)}" stroke="${cssVar('--line')}" stroke-width="1" />
    <text x="${padL - 8}" y="${yScale(v) + 3}" text-anchor="end" font-size="10" fill="${cssVar('--muted')}" font-family="IBM Plex Mono, monospace">${label(v)}</text>
  `).join('');

  const xLabels = xTicks.map(p => `
    <text x="${xScale(p.date.getTime())}" y="${H - 12}" text-anchor="middle" font-size="10" fill="${cssVar('--muted')}" font-family="IBM Plex Mono, monospace">${formatAxisDate(p.date, spansMultipleYears)}</text>
  `).join('');

  const dots = points.map((p, i) => `
    <circle class="pt" data-i="${i}" cx="${xScale(p.date.getTime())}" cy="${yScale(p.value)}" r="3.5" fill="${lineColor}" stroke="${cssVar('--panel')}" stroke-width="1.5" />
  `).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      ${gridLines}
      <polygon points="${areaPoints}" fill="${lineColor}" opacity="0.08" />
      <polyline points="${linePoints}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      ${dots}
      ${xLabels}
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${cssVar('--line')}" stroke-width="1" />
    </svg>
  `;

  const tooltip = document.getElementById('tooltip');
  container.querySelectorAll('.pt').forEach(circle => {
    circle.addEventListener('mouseenter', () => {
      const p = points[+circle.dataset.i];
      tooltip.innerHTML = `<span class="t-date">${p.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${p.walk.name || ''}</span><br><span class="t-val">${label(p.value)}${metric.unit ? ' ' + metric.unit : ''}</span>`;
      tooltip.style.display = 'block';
    });
    circle.addEventListener('mousemove', (e) => {
      const rect = container.getBoundingClientRect();
      tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
      tooltip.style.top = (e.clientY - rect.top - 30) + 'px';
    });
    circle.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
  });
}

/* ---------------- Records view ---------------- */
function computeRecords(walks) {
  const pick = (items, getValue, lowest = false) => {
    const vals = items.map(w => ({ w, v: getValue(w) })).filter(x => has(x.v) && x.v > 0);
    if (!vals.length) return null;
    return vals.reduce((a, b) => (lowest ? b.v < a.v : b.v > a.v) ? b : a);
  };
  const rec = (label, top, show) => top && { label, value: show(top.v), name: top.w.name, date: top.w.date };

  // Fastest single km across all walks' splits.
  const splits = walks.flatMap(w => (w.splits || [])
    .filter(s => s.distance_m >= 950 && s.pace_min_per_km)
    .map(s => ({ w, v: parseDuration(s.pace_min_per_km) })));
  const fastestKm = splits.length ? splits.reduce((a, b) => b.v < a.v ? b : a) : null;

  const num = unit => v => `${v}${unit}`;
  return [
    rec('Longest walk',          pick(walks, w => w.distance_km), num(' km')),
    rec('Longest time on foot',  pick(walks, movingSecs), formatDuration),
    rec('Most elevation',        pick(walks, w => w.elevation_gain_m), num(' m')),
    rec('Fastest pace (1 km+)',  pick(walks.filter(w => (w.distance_km || 0) >= 1), w => w.pace_sec, true), v => formatPace(v) + ' /km'),
    rec('Fastest single km',     fastestKm, v => formatPace(v) + ' /km'),
    rec('Highest max speed',     pick(walks, w => w.speed_max_kmh), num(' km/h')),
    rec('Most steps',            pick(walks, w => w.steps_estimated), v => v.toLocaleString('en-GB')),
    rec('Highest cadence',       pick(walks, w => w.cadence_avg_spm), num(' spm')),
    rec('Most calories burned',  pick(walks, w => w.calories), num(' kcal')),
    rec('Toughest effort',       pick(walks, w => w.relative_effort), num('')),
  ].filter(Boolean);
}

function applyMarquee(selector) {
  document.querySelectorAll(selector).forEach(el => {
    const text = el.textContent;
    if (el.scrollWidth > el.clientWidth + 2) {
      const duration = Math.max(6, text.length * 0.18).toFixed(1);
      el.innerHTML = `<span class="record-meta-track" style="animation-duration:${duration}s">${text}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${text}</span>`;
      el.classList.add('scrolling');
    }
  });
}

function renderRecords(walks) {
  const records = computeRecords(walks);
  const grid = document.getElementById('records-grid');
  if (!records.length) {
    grid.innerHTML = `<div class="chart-empty">No data yet.</div>`;
    return;
  }
  grid.innerHTML = records.map(r => `
    <div class="record-card">
      <div class="record-value">${r.value}</div>
      <div class="record-label">${r.label}</div>
      <div class="record-meta">${r.name || ''}${r.date ? ' · ' + r.date : ''}</div>
    </div>
  `).join('');
  applyMarquee('#records-grid .record-meta');
}

// A stacked bar of time spent per group, with a legend.
function breakdownBar(containerId, groups) {
  const container = document.getElementById(containerId);
  const total = groups.reduce((s, g) => s + g.seconds, 0);
  if (!total) {
    container.innerHTML = `<div class="chart-empty">No data yet.</div>`;
    return;
  }
  const bar = groups
    .filter(g => g.seconds > 0)
    .map(g => `<div class="zone-seg" style="width:${(g.seconds / total) * 100}%;background:${g.color}" title="${g.name}: ${formatDuration(g.seconds)}"></div>`)
    .join('');
  const legend = groups
    .map(g => `<div class="zone-legend-item"><span class="zone-dot" style="background:${g.color}"></span>${g.name} — ${g.count} · ${g.km.toFixed(1)} km · ${formatDuration(g.seconds)}</div>`)
    .join('');
  container.innerHTML = `<div class="zone-bar">${bar}</div><div class="zone-legend">${legend}</div>`;
}

function groupWalks(walks, defs, keyOf) {
  return defs.map(d => {
    const items = walks.filter(w => keyOf(w) === d.key);
    return {
      ...d,
      count: items.length,
      km: items.reduce((s, w) => s + (w.distance_km || 0), 0),
      seconds: items.reduce((s, w) => s + movingSecs(w), 0),
    };
  });
}

function renderBreakdowns(walks) {
  breakdownBar('type-chart', groupWalks(walks, [
    { key: 'Walk', name: 'Walks', color: cssVar('--pace') },
    { key: 'Hike', name: 'Hikes', color: cssVar('--steps') },
  ], typeOf));

  const partOfDay = w => {
    const m = timeToMinutes(w.time);
    if (m === null) return null;
    if (m >= 5 * 60 && m < 12 * 60) return 'morning';
    if (m < 17 * 60 && m >= 12 * 60) return 'afternoon';
    if (m < 21 * 60 && m >= 17 * 60) return 'evening';
    return 'night';
  };
  breakdownBar('timeofday-chart', groupWalks(walks, [
    { key: 'morning',   name: 'Morning (5–12)',   color: '#ffff66' },
    { key: 'afternoon', name: 'Afternoon (12–17)', color: '#ffaa80' },
    { key: 'evening',   name: 'Evening (17–21)',  color: '#C1523B' },
    { key: 'night',     name: 'Night (21–5)',     color: '#5a5f8a' },
  ], partOfDay));
}

/* ---------------- Trends view ---------------- */
function getWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function totalsBy(walks, keyOf) {
  const map = new Map();
  walks.forEach(w => {
    if (!w.date) return;
    const key = keyOf(w);
    if (!map.has(key)) map.set(key, { key, walks: 0, km: 0, secs: 0, elev: 0, steps: 0 });
    const e = map.get(key);
    e.walks++;
    e.km += w.distance_km || 0;
    e.secs += movingSecs(w);
    e.elev += w.elevation_gain_m || 0;
    e.steps += w.steps_estimated || 0;
  });
  return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
}

function renderWeekly(walks) {
  const weeks = totalsBy(walks, w => {
    const s = getWeekStart(w.date);
    return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
  });
  const body = document.getElementById('weekly-body');
  if (!weeks.length) {
    body.innerHTML = `<tr><td colspan="5" class="chart-empty">No data yet.</td></tr>`;
    return;
  }
  body.innerHTML = weeks.map(w => `
    <tr>
      <td>${new Date(w.key).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
      <td class="num">${w.walks}</td>
      <td class="num">${w.km.toFixed(1)}</td>
      <td class="num">${formatDuration(w.secs)}</td>
      <td class="num">${Math.round(w.steps).toLocaleString('en-GB')}</td>
    </tr>
  `).join('');
}

function renderMonthly(walks) {
  const months = totalsBy(walks, w => w.date.slice(0, 7));
  const body = document.getElementById('monthly-body');
  if (!months.length) {
    body.innerHTML = `<tr><td colspan="7" class="chart-empty">No data yet.</td></tr>`;
    return;
  }
  body.innerHTML = months.map(m => `
    <tr>
      <td>${new Date(m.key + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</td>
      <td class="num">${m.walks}</td>
      <td class="num">${m.km.toFixed(1)}</td>
      <td class="num">${formatDuration(m.secs)}</td>
      <td class="num">${Math.round(m.elev)} m</td>
      <td class="num">${Math.round(m.steps).toLocaleString('en-GB')}</td>
      <td class="num">${m.km ? formatPace(m.secs / m.km) + ' /km' : '—'}</td>
    </tr>
  `).join('');
}

/* ---------------- Boot ---------------- */
// Walks from all monthly files, oldest first.
function combineWalks(files) {
  return files
    .flatMap(d => (d && Array.isArray(d.walks)) ? d.walks : [])
    .map(prepare)
    .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`));
}

function render(walks, sourceText) {
  currentWalks = walks;
  renderTotals(currentWalks);
  renderRows();
  renderActiveView();
  document.getElementById('status').textContent = `Loaded ${currentWalks.length} walk(s) from ${sourceText}`;
}

document.querySelectorAll('#walk-table thead th[data-key]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = key === 'date' || key === 'pace_sec' || key === 'name' || key === 'type';
    }
    renderRows();
  });
});

function showPicker() {
  document.getElementById('picker-wrap').classList.add('show');
  document.getElementById('status').textContent = '';
  document.getElementById('file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).filter(f => f.name !== 'index.json');
    if (!files.length) return;
    try {
      const parsed = await Promise.all(files.map(f => f.text().then(JSON.parse)));
      render(combineWalks(parsed), `${files.length} file(s)`);
      document.getElementById('picker-wrap').classList.remove('show');
    } catch (err) {
      document.getElementById('status').textContent = 'Could not read one of those files as JSON.';
    }
  });
}

buildMetricPicker();

// walk_data/index.json lists the monthly files written by extract_walks.py.
function getJson(url) {
  return fetch(url).then(res => {
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  });
}

getJson('walk_data/index.json')
  .then(index => Promise.all((index.files || []).map(f => getJson(`walk_data/${f}`)))
    .then(months => render(combineWalks(months), `${months.length} monthly file(s)`)))
  .catch(() => showPicker());
