let currentWalks = [];
let sortKey = 'date';
let sortAsc = false;   // newest first, so a row limit shows your latest walks

// How many rows the walk table shows (the "Show" dropdown); remembered per browser.
let rowLimit = 25;
try {
  const saved = localStorage.getItem('walkRowLimit');
  if (saved) rowLimit = saved === 'all' ? Infinity : Number(saved) || 25;
} catch (e) {}
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

/* ---------------- Filters ---------------- */
const FILTER_INPUTS = ['f-search', 'f-type', 'f-km-min', 'f-km-max', 'f-min-min', 'f-min-max', 'f-from', 'f-to'];
const filterValue = id => document.getElementById(id).value.trim();
const filterNumber = id => { const v = filterValue(id); return v === '' ? null : Number(v); };
const escapeHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function filteredWalks() {
  const search = filterValue('f-search').toLowerCase();
  const type = filterValue('f-type');
  const kmMin = filterNumber('f-km-min'), kmMax = filterNumber('f-km-max');
  const minMin = filterNumber('f-min-min'), minMax = filterNumber('f-min-max');
  const from = filterValue('f-from'), to = filterValue('f-to');
  return currentWalks.filter(w => {
    const km = w.distance_km || 0;
    const mins = movingSecs(w) / 60;
    if (search && !(w.name || '').toLowerCase().includes(search)) return false;
    if (type && typeOf(w) !== type) return false;
    if (kmMin !== null && km < kmMin) return false;
    if (kmMax !== null && km > kmMax) return false;
    if (minMin !== null && mins < minMin) return false;
    if (minMax !== null && mins > minMax) return false;
    if (from && w.date < from) return false;
    if (to && w.date > to) return false;
    return true;
  });
}

function buildFilterOptions(walks) {
  const select = document.getElementById('f-type');
  const current = select.value;
  const counts = new Map();
  walks.forEach(w => counts.set(typeOf(w), (counts.get(typeOf(w)) || 0) + 1));
  select.innerHTML = '<option value="">All types</option>' + [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, n]) => `<option value="${escapeHtml(t)}">${escapeHtml(t)} (${n})</option>`).join('');
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function updateFilterCount(shown, listed) {
  const active = FILTER_INPUTS.some(id => filterValue(id) !== '');
  const km = shown.reduce((s, w) => s + (w.distance_km || 0), 0);
  const secs = shown.reduce((s, w) => s + movingSecs(w), 0);
  const limited = listed < shown.length ? ` (first ${listed} listed)` : '';
  document.getElementById('f-count').innerHTML = active
    ? `Showing <b>${shown.length}</b> of ${currentWalks.length} walks · ${km.toFixed(1)} km · ${formatDuration(secs)}${limited}`
    : `${currentWalks.length} walks${limited}`;
  document.getElementById('filter-bar').classList.toggle('filtering', active);
}

FILTER_INPUTS.forEach(id => document.getElementById(id).addEventListener('input', () => renderRows()));
document.getElementById('f-reset').addEventListener('click', () => {
  FILTER_INPUTS.forEach(id => { document.getElementById(id).value = ''; });
  renderRows();
});
const limitSelect = document.getElementById('f-limit');
limitSelect.value = rowLimit === Infinity ? 'all' : String(rowLimit);
if (!limitSelect.value) { limitSelect.value = '25'; rowLimit = 25; }
limitSelect.addEventListener('change', () => {
  rowLimit = limitSelect.value === 'all' ? Infinity : Number(limitSelect.value);
  try { localStorage.setItem('walkRowLimit', limitSelect.value); } catch (e) {}
  renderRows();
});

function renderRows() {
  // Best values stay based on all walks, so a highlight always means an all-time best.
  const best = computeBestValues(currentWalks);
  const shown = filteredWalks();

  const sorted = shown.slice().sort((a, b) => {
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

  const listed = sorted.slice(0, rowLimit);
  updateFilterCount(shown, listed.length);

  document.getElementById('walks').innerHTML = listed.map((w, i) => `
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
  if (!listed.length) {
    document.getElementById('walks').innerHTML =
      `<tr><td colspan="15" class="no-match">No walks match these filters.</td></tr>`;
  }

  document.querySelectorAll('#walk-table thead th[data-key]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.key === sortKey);
  });
}

/* ---------------- Tabs ---------------- */
function renderActiveView() {
  const active = document.querySelector('.view.active').id;
  if (active === 'graph-view') drawChart();
  if (active === 'records-view') { renderRecords(currentWalks); renderBreakdowns(currentWalks); }
  if (active === 'trends-view') renderWeekly(currentWalks);
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
/* ---------- Totals by period (week / month / 3 months / 6 months / year) ---------- */
const GROUPS = {
  week:    { title: 'Weekly totals',     head: 'Week of', months: 0 },
  month:   { title: 'Monthly totals',    head: 'Month',   months: 1 },
  quarter: { title: '3-monthly totals',  head: 'Period',  months: 3 },
  half:    { title: '6-monthly totals',  head: 'Period',  months: 6 },
  year:    { title: 'Yearly totals',     head: 'Year',    months: 12 },
};
let trendGroup = 'week';
let showChanges = true;
let trendLimit = 12;     // how many periods the totals table lists (latest first)
try {
  trendGroup = GROUPS[localStorage.getItem('walkTrendGroup')] ? localStorage.getItem('walkTrendGroup') : 'week';
  showChanges = localStorage.getItem('walkTrendChanges') !== 'off';
  const savedLimit = localStorage.getItem('walkTrendLimit');
  if (savedLimit) trendLimit = savedLimit === 'all' ? Infinity : Number(savedLimit) || 12;
} catch (e) {}

function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  return d;
}

// First day of the calendar period containing the date.
function periodStart(dateStr, group) {
  if (group === 'week') return getWeekStart(dateStr);
  const d = new Date(dateStr + 'T00:00');
  const months = GROUPS[group].months;
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / months) * months, 1);
}

function previousPeriodStart(start, group) {
  const d = new Date(start);
  if (group === 'week') d.setDate(d.getDate() - 7);
  else d.setMonth(d.getMonth() - GROUPS[group].months);
  return d;
}

const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function periodLabel(start, group) {
  const short = d => d.toLocaleDateString('en-GB', { month: 'short' });
  const y = start.getFullYear();
  if (group === 'week') return start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (group === 'month') return start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  if (group === 'year') return String(y);
  const end = new Date(start); end.setMonth(end.getMonth() + GROUPS[group].months - 1);
  return `${short(start)}–${short(end)} ${y}`;
}

function computePeriodTotals(walks, group) {
  const map = new Map();
  walks.forEach(w => {
    if (!w.date) return;
    const start = periodStart(w.date, group);
    const key = dayKey(start);
    if (!map.has(key)) map.set(key, { key, start, walks: 0, km: 0, secs: 0, elev: 0, steps: 0 });
    const e = map.get(key);
    e.walks++;
    e.km += w.distance_km || 0;
    e.secs += movingSecs(w);
    e.elev += w.elevation_gain_m || 0;
    e.steps += w.steps_estimated || 0;
  });
  map.forEach(e => { e.pace = e.km ? e.secs / e.km : null; });   // seconds per km
  return map;
}

// "▲ 12%" / "▼ 8%" against the previous period; blank when there's nothing to compare with.
// lowerIsBetter flips the colours (a faster pace is a lower number). A fall in a
// running total during the current period is grey: the period isn't over yet.
function changeBadge(cur, prev, { inProgress = false, lowerIsBetter = false } = {}) {
  if (cur === null || cur === undefined || !prev) return '<span class="delta none"></span>';
  const pct = (cur - prev) / prev * 100;
  if (Math.abs(pct) < 0.5) return '<span class="delta flat">0%</span>';
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  const cls = good ? 'up' : (inProgress && !lowerIsBetter ? 'pending' : 'down');
  const title = cls === 'pending' ? ' title="This period is still in progress"' : '';
  return `<span class="delta ${cls}"${title}>${pct > 0 ? '▲' : '▼'} ${Math.abs(Math.round(pct))}%</span>`;
}

function renderWeekly(walks) {
  const group = trendGroup;
  document.getElementById('trend-title').textContent = GROUPS[group].title;
  document.getElementById('trend-period-head').textContent = GROUPS[group].head;
  document.querySelectorAll('#group-picker .group-btn[data-group]').forEach(b => b.classList.toggle('active', b.dataset.group === group));

  const totals = computePeriodTotals(walks, group);
  const periods = [...totals.values()].sort((a, b) => b.start - a.start);
  const body = document.getElementById('weekly-body');
  if (!periods.length) {
    body.innerHTML = `<tr><td colspan="7" class="chart-empty">No data yet.</td></tr>`;
    return;
  }
  const current = dayKey(periodStart(dayKey(new Date()), group));
  // Only the latest periods are listed, but changes still compare with the
  // previous period from the full totals.
  body.innerHTML = periods.slice(0, trendLimit).map(p => {
    const prev = totals.get(dayKey(previousPeriodStart(p.start, group)));
    const inProgress = p.key === current;
    const cell = (text, cur, prevVal, opts = {}) =>
      `<td class="num ${opts.cls || ''}"><span class="trend-val">${text}</span>${changeBadge(cur, prevVal, { inProgress, ...opts })}</td>`;
    return `
      <tr>
        <td>${periodLabel(p.start, group)}${inProgress ? ' <span class="so-far">so far</span>' : ''}</td>
        ${cell(p.walks, p.walks, prev && prev.walks)}
        ${cell(p.km.toFixed(1), p.km, prev && prev.km)}
        ${cell(formatDuration(p.secs), p.secs, prev && prev.secs)}
        ${cell(Math.round(p.elev) + ' m', p.elev, prev && prev.elev)}
        ${cell(Math.round(p.steps).toLocaleString('en-GB'), p.steps || null, prev && prev.steps)}
        ${cell(p.pace ? formatPace(p.pace) + ' /km' : '—', p.pace, prev && prev.pace, { cls: 'pace', lowerIsBetter: true })}
      </tr>`;
  }).join('');
  alignTrendValues();
}

// Give every value in a column the width of the column's widest value, so the
// ▲▼ percentages line up in a straight column.
function alignTrendValues() {
  const rows = [...document.querySelectorAll('#weekly-body tr')];
  if (!rows.length || !rows[0].offsetParent) return;
  const cols = rows[0].children.length;
  for (let c = 1; c < cols; c++) {
    const vals = rows.map(r => r.children[c] && r.children[c].querySelector('.trend-val')).filter(Boolean);
    vals.forEach(v => { v.style.width = ''; });
    const widest = Math.ceil(Math.max(...vals.map(v => v.getBoundingClientRect().width)));
    vals.forEach(v => { v.style.width = widest + 'px'; });
  }
}

function applyChangeToggle() {
  const btn = document.getElementById('delta-toggle');
  btn.classList.toggle('active', showChanges);
  btn.setAttribute('aria-pressed', String(showChanges));
  document.getElementById('trends-view').classList.toggle('hide-changes', !showChanges);
}

if (document.fonts) document.fonts.ready.then(() => alignTrendValues());

document.getElementById('delta-toggle').addEventListener('click', () => {
  showChanges = !showChanges;
  try { localStorage.setItem('walkTrendChanges', showChanges ? 'on' : 'off'); } catch (e) {}
  applyChangeToggle();
});
applyChangeToggle();

const trendLimitSelect = document.getElementById('trend-limit');
trendLimitSelect.value = trendLimit === Infinity ? 'all' : String(trendLimit);
if (!trendLimitSelect.value) { trendLimitSelect.value = '12'; trendLimit = 12; }
trendLimitSelect.addEventListener('change', () => {
  trendLimit = trendLimitSelect.value === 'all' ? Infinity : Number(trendLimitSelect.value);
  try { localStorage.setItem('walkTrendLimit', trendLimitSelect.value); } catch (e) {}
  renderWeekly(currentWalks);
});

document.querySelectorAll('#group-picker .group-btn[data-group]').forEach(btn => {
  btn.addEventListener('click', () => {
    trendGroup = btn.dataset.group;
    try { localStorage.setItem('walkTrendGroup', trendGroup); } catch (e) {}
    renderWeekly(currentWalks);
  });
});

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
  buildFilterOptions(currentWalks);
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
