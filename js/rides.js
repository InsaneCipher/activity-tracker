let currentRides = [];
let sortKey = 'date';
let sortAsc = true;
let activeMetric = 'power';

const fmt = (v, unit = '') => (v === null || v === undefined) ? '—' : `${v}${unit}`;

function parseDuration(str) {
  if (!str) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function renderTotals(rides) {
  const totalDist = rides.reduce((s, r) => s + (r.distance_km || 0), 0);
  const totalCals = rides.reduce((s, r) => s + (r.calories || 0), 0);
  const totalKj = rides.reduce((s, r) => s + (r.total_work_kj || 0), 0);
  const totalTime = rides.reduce((s, r) => s + parseDuration(r.moving_time), 0);
  const totalElevation = rides.reduce((s, r) => s + (r.elevation_m || 0), 0);

  document.getElementById('totals').innerHTML = `
    <div class="total-cell"><div class="num">${rides.length}</div><div class="label">Rides logged</div></div>
    <div class="total-cell"><div class="num">${totalDist.toFixed(1)}</div><div class="label">Total distance (km)</div></div>
    <div class="total-cell"><div class="num">${formatDuration(totalTime)}</div><div class="label">Time in the saddle</div></div>
    <div class="total-cell"><div class="num">${totalElevation}</div><div class="label">Total elevation (m)</div></div>
    <div class="total-cell"><div class="num">${totalCals}</div><div class="label">Calories burned</div></div>
    <div class="total-cell"><div class="num">${totalKj}</div><div class="label">Total work (kJ)</div></div>
  `;
}

function computeBestValues(rides) {
  const maxFields = ['distance_km', 'elevation_m', 'power_avg_w', 'power_max_w', 'ftp', 'speed_avg_kmh', 'speed_max_kmh', 'cadence_avg', 'calories', 'relative_effort'];
  const best = {};
  maxFields.forEach(f => {
    const vals = rides.map(r => r[f]).filter(v => v !== null && v !== undefined && !isNaN(v));
    best[f] = vals.length ? Math.max(...vals) : null;
  });
  const times = rides.map(r => parseDuration(r.moving_time)).filter(v => v > 0);
  best.moving_time_seconds = times.length ? Math.max(...times) : null;
  return best;
}

function isBest(best, field, value) {
  if (value === null || value === undefined) return false;
  const b = best[field];
  if (b === null || b === undefined) return false;
  return value === b;
}

// Hand-picked colors rather than a computed gradient — each zone is a genuinely different
// hue so adjacent zones stay visually distinct even at small sizes, instead of blurring
// together the way a smooth interpolation tends to. The top zone matches --hr exactly.
const ZONE_DEFS = [
  { key: 'recovery_sec',      name: 'Recovery',      color: '#99ff66' }, // muted grey (--muted)
  { key: 'endurance_sec',     name: 'Endurance',     color: '#ffff66' }, // teal (--speed)
  { key: 'tempo_sec',         name: 'Tempo',         color: '#ffaa80' }, // yellow (--power)
  { key: 'threshold_sec',     name: 'Threshold',     color: '#ff884d' }, // orange
  { key: 'vo2max_sec',        name: 'VO2 max',       color: '#C1523B' }, // deep orange-red
  { key: 'anaerobic_sec',     name: 'Anaerobic',     color: '#e60000' }, // purple
  { key: 'neuromuscular_sec', name: 'Neuromuscular', color: '#800000' }, // matches --hr (avg heart rate)
];

function zoneColor(c) {
  return c;
}

function miniZoneBar(zones) {
  if (!zones) return '<span class="muted">—</span>';
  const total = ZONE_DEFS.reduce((s, z) => s + (zones[z.key] || 0), 0);
  if (!total) return '<span class="muted">—</span>';
  const segs = ZONE_DEFS
    .filter(z => zones[z.key] > 0)
    .map(z => `<div class="mini-zone-seg" style="width:${(zones[z.key] / total) * 100}%;background:${zoneColor(z.color)}" title="${z.name}: ${formatDuration(zones[z.key])}"></div>`)
    .join('');
  return `<div class="mini-zone-bar">${segs}</div>`;
}

/* ---------------- Bikes ---------------- */
// One colour per bike, given in the order the bikes were first ridden, so a
// bike keeps its colour as new rides are added.
const BIKE_COLORS = ['#7FB3FF', '#FF8FB1', '#B8E986', '#FFB86B', '#C3A6FF', '#5CE1E6', '#F7E36D', '#FF7A6B'];
let bikeColors = new Map();

function assignBikeColors(rides) {
  bikeColors = new Map();
  rides.slice()
    .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`))
    .forEach(r => {
      if (r.bike_id && !bikeColors.has(r.bike_id)) {
        bikeColors.set(r.bike_id, BIKE_COLORS[bikeColors.size % BIKE_COLORS.length]);
      }
    });
}

// Ring colour around the bike dot = the app the ride came from.
const APP_COLORS = { 'MyWhoosh': '#FFD60A', 'Rouvy': '#FF6A3D', 'Zwift': '#FF4FD8', 'Outdoor': '#FFFFFF' };
const APP_ORDER = ['MyWhoosh', 'Rouvy', 'Zwift', 'Outdoor', 'Indoor', 'Other app'];
const appColor = app => APP_COLORS[app] || '#7D7D8C';
const appRing = app => app ? `box-shadow:0 0 0 1.5px var(--panel),0 0 0 3px ${appColor(app)};` : '';

const escapeHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const bikeLabel = r => r.bike || (r.bike_id ? 'Unnamed bike' : 'No bike set');

function bikeDot(r) {
  const color = bikeColors.get(r.bike_id);
  const title = `Bike: ${bikeLabel(r)}${r.app ? ` · App: ${r.app}` : ''}${r.device ? ` (${r.device})` : ''}`;
  return color
    ? `<span class="bike-dot" style="background:${color};${appRing(r.app)}" title="${escapeHtml(title)}"></span>`
    : `<span class="bike-dot none" style="${appRing(r.app)}" title="${escapeHtml(title)}"></span>`;
}

// Small key above the table: a dot, name and ride count per bike.
function renderBikeKey(rides) {
  const key = document.getElementById('bike-key');
  const counts = new Map();
  rides.forEach(r => { if (r.bike_id) counts.set(r.bike_id, (counts.get(r.bike_id) || 0) + 1); });
  const apps = new Map();
  rides.forEach(r => { if (r.app) apps.set(r.app, (apps.get(r.app) || 0) + 1); });
  if (!counts.size && !apps.size) { key.innerHTML = ''; return; }
  const names = new Map(rides.filter(r => r.bike_id).map(r => [r.bike_id, bikeLabel(r)]));
  const bikeItems = [...bikeColors.keys()].filter(id => counts.has(id)).map(id => `
    <span class="bike-key-item"><span class="bike-dot" style="background:${bikeColors.get(id)}"></span>${escapeHtml(names.get(id))} <span class="bike-key-count">${counts.get(id)}</span></span>
  `);
  const appItems = [...apps.keys()].sort((a, b) => APP_ORDER.indexOf(a) - APP_ORDER.indexOf(b)).map(app => `
    <span class="bike-key-item"><span class="bike-dot ring-only" style="${appRing(app)}"></span>${escapeHtml(app)} <span class="bike-key-count">${apps.get(app)}</span></span>
  `);
  key.innerHTML = bikeItems.join('') + (bikeItems.length && appItems.length ? '<span class="bike-key-sep"></span>' : '') + appItems.join('');
}

/* ---------------- Filters ---------------- */
// Route names look like "Al Wathba-L (Arabia)": the route is the part before
// the brackets and the country is the part inside them.
const countryOf = r => ((r.map_name || '').match(/\(([^()]+)\)\s*$/) || [])[1] || '';
const routeOf = r => (r.map_name || '').replace(/\s*\([^()]*\)\s*$/, '').trim() || '—';

const FILTER_INPUTS = ['f-search', 'f-route', 'f-country', 'f-bike', 'f-app', 'f-km-min', 'f-km-max',
                       'f-min-min', 'f-min-max', 'f-from', 'f-to'];
const filterValue = id => document.getElementById(id).value.trim();
const filterNumber = id => { const v = filterValue(id); return v === '' ? null : Number(v); };

function filteredRides() {
  const search = filterValue('f-search').toLowerCase();
  const route = filterValue('f-route');
  const country = filterValue('f-country');
  const bike = filterValue('f-bike');
  const app = filterValue('f-app');
  const kmMin = filterNumber('f-km-min'), kmMax = filterNumber('f-km-max');
  const minMin = filterNumber('f-min-min'), minMax = filterNumber('f-min-max');
  const from = filterValue('f-from'), to = filterValue('f-to');

  return currentRides.filter(r => {
    const km = r.distance_km || 0;
    const mins = parseDuration(r.moving_time) / 60;
    if (search && !(r.map_name || '').toLowerCase().includes(search)) return false;
    if (route && routeOf(r) !== route) return false;
    if (country && countryOf(r) !== country) return false;
    if (bike === '__none' ? r.bike_id : (bike && r.bike_id !== bike)) return false;
    if (app && r.app !== app) return false;
    if (kmMin !== null && km < kmMin) return false;
    if (kmMax !== null && km > kmMax) return false;
    if (minMin !== null && mins < minMin) return false;
    if (minMax !== null && mins > minMax) return false;
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    return true;
  });
}

// Fill a dropdown with "Name (count)" options, keeping the current choice if it still exists.
function fillSelect(id, allLabel, entries) {
  const select = document.getElementById(id);
  const current = select.value;
  select.innerHTML = `<option value="">${allLabel}</option>` + entries
    .map(([value, label, count]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)} (${count})</option>`)
    .join('');
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function countBy(rides, keyOf) {
  const counts = new Map();
  rides.forEach(r => { const k = keyOf(r); if (k) counts.set(k, (counts.get(k) || 0) + 1); });
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function buildFilterOptions(rides) {
  fillSelect('f-route', 'All routes', countBy(rides, routeOf).map(([k, n]) => [k, k, n]));
  fillSelect('f-country', 'All countries', countBy(rides, countryOf).map(([k, n]) => [k, k, n]));
  const bikes = [...bikeColors.keys()].map(id => {
    const ride = rides.find(r => r.bike_id === id);
    return [id, bikeLabel(ride), rides.filter(r => r.bike_id === id).length];
  });
  const noBike = rides.filter(r => !r.bike_id).length;
  if (noBike) bikes.push(['__none', 'No bike set', noBike]);
  fillSelect('f-bike', 'All bikes', bikes);
  fillSelect('f-app', 'All apps', countBy(rides, r => r.app)
    .sort((a, b) => APP_ORDER.indexOf(a[0]) - APP_ORDER.indexOf(b[0]))
    .map(([k, n]) => [k, k, n]));
}

function updateFilterCount(shown) {
  const active = FILTER_INPUTS.some(id => filterValue(id) !== '');
  const km = shown.reduce((s, r) => s + (r.distance_km || 0), 0);
  const secs = shown.reduce((s, r) => s + parseDuration(r.moving_time), 0);
  document.getElementById('f-count').innerHTML = active
    ? `Showing <b>${shown.length}</b> of ${currentRides.length} rides · ${km.toFixed(1)} km · ${formatDuration(secs)}`
    : `${currentRides.length} rides`;
  document.getElementById('filter-bar').classList.toggle('filtering', active);
}

FILTER_INPUTS.forEach(id => document.getElementById(id).addEventListener('input', () => renderRows()));
document.getElementById('f-reset').addEventListener('click', () => {
  FILTER_INPUTS.forEach(id => { document.getElementById(id).value = ''; });
  renderRows();
});

function renderRows() {
  // Best values stay based on all rides, so a highlight always means an all-time best.
  const best = computeBestValues(currentRides);
  const shown = filteredRides();
  updateFilterCount(shown);

  const sorted = shown.slice().sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (av === null || av === undefined) av = sortAsc ? Infinity : -Infinity;
    if (bv === null || bv === undefined) bv = sortAsc ? Infinity : -Infinity;
    if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortAsc ? av - bv : bv - av;
  });

  const val = (value, unit, highlight) => {
    const text = fmt(value, unit);
    return highlight ? `<span class="best-val">${text}</span>` : text;
  };

  const pair = (a, b, highlightA, highlightB) => `${val(a, '', highlightA)}<span class="pair-max${highlightB ? ' best-val' : ''}">/${fmt(b)}</span>`;

  document.getElementById('rides').innerHTML = sorted.map((r, i) => `
    <tr>
      <td class="idx">${i + 1}</td>
      <td class="muted date-cell">${fmt(r.date)}${r.time ? `<span class="ride-time">${r.time}</span>` : ''}</td>
      <td class="name" title="${escapeHtml(r.map_name)}${r.bike_id ? ' · ' + escapeHtml(bikeLabel(r)) : ''}">${bikeDot(r)}${r.url ? `<a href="${r.url}" target="_blank" rel="noopener">${r.map_name || '—'}</a>` : (r.map_name || '—')}</td>
      <td class="num">${val(r.distance_km, '', isBest(best, 'distance_km', r.distance_km))}</td>
      <td class="num muted">${val(r.moving_time, '', isBest(best, 'moving_time_seconds', parseDuration(r.moving_time)))}</td>
      <td class="num muted">${val(r.elevation_m, '', isBest(best, 'elevation_m', r.elevation_m))}</td>
      <td class="num power">${pair(r.power_avg_w, r.power_max_w, isBest(best, 'power_avg_w', r.power_avg_w), isBest(best, 'power_max_w', r.power_max_w))}</td>
      <td class="num power">${val(r.ftp, ' W', isBest(best, 'ftp', r.ftp))}</td>
      <td class="num speed">${pair(r.speed_avg_kmh, r.speed_max_kmh, isBest(best, 'speed_avg_kmh', r.speed_avg_kmh), isBest(best, 'speed_max_kmh', r.speed_max_kmh))}</td>
      <td class="num hr">${pair(r.heart_rate_avg_bpm, r.heart_rate_max_bpm, isBest(best, 'heart_rate_avg_bpm', r.heart_rate_avg_bpm))}</td>
      <td class="num muted">${val(r.cadence_avg, '', isBest(best, 'cadence_avg', r.cadence_avg))}</td>
      <td class="num muted">${val(r.calories, '', isBest(best, 'calories', r.calories))}</td>
      <td class="num muted">${val(r.relative_effort, '', isBest(best, 'relative_effort', r.relative_effort))}</td>
      <td class="zones-cell">${miniZoneBar(r.zones)}</td>
    </tr>
  `).join('');
  if (!sorted.length) {
    document.getElementById('rides').innerHTML =
      `<tr><td colspan="14" class="no-match">No rides match these filters.</td></tr>`;
  }

  document.querySelectorAll('thead th[data-key]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.key === sortKey);
  });
}

/* ---------------- Tabs ---------------- */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.view).classList.add('active');
    if (btn.dataset.view === 'graph-view') drawChart();
    if (btn.dataset.view === 'records-view') { renderRecords(currentRides); renderZones(currentRides); }
    if (btn.dataset.view === 'trends-view') { renderWeekly(currentRides); renderRouteHistory(currentRides); }
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
  { id: 'power',      label: 'Power',      unit: 'W',     color: '--power', get: r => r.power_avg_w },
  { id: 'ftp',        label: 'FTP',        unit: 'W',     color: '--power', get: r => r.ftp },
  { id: 'speed',      label: 'Speed',      unit: 'km/h',  color: '--speed', get: r => r.speed_avg_kmh },
  { id: 'hr',         label: 'Heart rate', unit: 'bpm',   color: '--hr',    get: r => r.heart_rate_avg_bpm },
  { id: 'distance',   label: 'Distance',   unit: 'km',    color: '--text',  get: r => r.distance_km },
  { id: 'time',       label: 'Time',       unit: 'min',   color: '--text',  get: r => Math.round(parseDuration(r.moving_time) / 60) },
  { id: 'elevation',  label: 'Elevation',  unit: 'm',     color: '--text',  get: r => r.elevation_m },
  { id: 'cadence',    label: 'Cadence',    unit: 'rpm',   color: '--text',  get: r => r.cadence_avg },
  { id: 'calories',   label: 'Calories',   unit: 'kcal',  color: '--text',  get: r => r.calories },
  { id: 'effort',     label: 'Effort',     unit: '',      color: '--text',  get: r => r.relative_effort },
  { id: 'start_time', label: 'Start time', unit: '',      color: '--text',  get: r => timeToMinutes(r.time), format: v => minutesToTime(v) },
  { id: 'cum_distance', label: 'Total distance', unit: 'km', color: '--speed', get: r => r.distance_km, cumulative: true },
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

  const points = currentRides
    .map(r => ({ date: new Date(r.date), value: metric.get(r), ride: r }))
    .filter(p => p.value !== null && p.value !== undefined && !isNaN(p.date.getTime()))
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
  const padL = 46, padR = 20, padT = 20, padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let xMin = points[0].date.getTime();
  let xMax = points[points.length - 1].date.getTime();
  if (xMin === xMax) { xMin -= 86400000; xMax += 86400000; }

  let values = points.map(p => p.value);
  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const yPad = (yMax - yMin) * 0.15;
  yMin -= yPad; yMax += yPad;
  if (metric.id !== 'elevation' && metric.id !== 'start_time' && yMin > 0 && (yMin / (yMax - yMin)) < 0.3) yMin = 0;
  if (metric.cumulative) yMin = 0;

  const xScale = t => padL + ((t - xMin) / (xMax - xMin)) * plotW;
  const yScale = v => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const color = cssVar(metric.color) || cssVar('--text');
  const lineColor = metric.color === '--text' ? cssVar('--muted') : color;

  const linePoints = points.map(p => `${xScale(p.date.getTime())},${yScale(p.value)}`).join(' ');
  const areaPoints = `${xScale(points[0].date.getTime())},${padT + plotH} ` + linePoints +
    ` ${xScale(points[points.length - 1].date.getTime())},${padT + plotH}`;

  const tickCount = 4;
  let yTicks = [];
  for (let i = 0; i <= tickCount; i++) yTicks.push(yMin + (i * (yMax - yMin) / tickCount));

  const maxXTicks = 7;
  const step = Math.max(1, Math.ceil(points.length / maxXTicks));
  const spansMultipleYears = points[0].date.getFullYear() !== points[points.length - 1].date.getFullYear();
  let xTicks = [];
  for (let i = 0; i < points.length; i += step) xTicks.push(points[i]);
  if (xTicks[xTicks.length - 1] !== points[points.length - 1]) xTicks.push(points[points.length - 1]);

  const gridLines = yTicks.map(v => `
    <line x1="${padL}" y1="${yScale(v)}" x2="${W - padR}" y2="${yScale(v)}" stroke="${cssVar('--line')}" stroke-width="1" />
    <text x="${padL - 8}" y="${yScale(v) + 3}" text-anchor="end" font-size="10" fill="${cssVar('--muted')}" font-family="IBM Plex Mono, monospace">${metric.format ? metric.format(v) : Math.round(v)}</text>
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
      tooltip.innerHTML = `<span class="t-date">${p.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span><br><span class="t-val">${metric.format ? metric.format(p.value) : p.value}${metric.unit ? ' ' + metric.unit : ''}</span>`;
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

/* ---------------- New: Records view ---------------- */
function computeRecords(rides) {
  const specs = [
    { field: 'distance_km',     label: 'Longest ride',        unit: ' km' },
    { field: 'elevation_m',     label: 'Most elevation',      unit: ' m' },
    { field: 'power_avg_w',     label: 'Highest avg power',   unit: ' W' },
    { field: 'power_max_w',     label: 'Highest max power',   unit: ' W' },
    { field: 'ftp',             label: 'Highest FTP',         unit: ' W' },
    { field: 'speed_avg_kmh',   label: 'Highest avg speed',   unit: ' km/h' },
    { field: 'speed_max_kmh',   label: 'Highest max speed',   unit: ' km/h' },
    { field: 'calories',        label: 'Most calories burned',unit: ' kcal' },
    { field: 'relative_effort', label: 'Toughest effort',     unit: '' },
  ];

  const results = specs.map(spec => {
    const vals = rides
      .map(r => ({ r, v: r[spec.field] }))
      .filter(x => x.v !== null && x.v !== undefined && !isNaN(x.v));
    if (!vals.length) return null;
    const top = vals.reduce((a, b) => (b.v > a.v ? b : a));
    return { label: spec.label, value: top.v, unit: spec.unit, rideName: top.r.map_name, rideDate: top.r.date };
  }).filter(Boolean);

  const moving = rides
    .map(r => ({ r, secs: parseDuration(r.moving_time) }))
    .filter(x => x.secs > 0);
  if (moving.length) {
    const top = moving.reduce((a, b) => (b.secs > a.secs ? b : a));
    results.splice(1, 0, {
      label: 'Longest time in the saddle',
      value: formatDuration(top.secs),
      unit: '',
      rideName: top.r.map_name,
      rideDate: top.r.date,
    });
  }

  return results;
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

function renderRecords(rides) {
  const records = computeRecords(rides);
  const grid = document.getElementById('records-grid');
  if (!records.length) {
    grid.innerHTML = `<div class="chart-empty">No data yet.</div>`;
    return;
  }
  grid.innerHTML = records.map(rec => `
    <div class="record-card">
      <div class="record-value">${rec.value}${rec.unit}</div>
      <div class="record-label">${rec.label}</div>
      <div class="record-meta">${rec.rideName || ''}${rec.rideDate ? ' · ' + rec.rideDate : ''}</div>
    </div>
  `).join('');
  applyMarquee('#records-grid .record-meta');
}

function renderZones(rides) {
  // Uses real per-ride time-in-zone data (seconds) recorded in each ride's "zones" object,
  // summed across all rides — not an estimate from average power.
  const withZones = rides.filter(r => r.zones);

  const container = document.getElementById('zones-chart');
  if (!withZones.length) {
    container.innerHTML = `<div class="chart-empty">No zone data yet.</div>`;
    return;
  }

  const totals = ZONE_DEFS.map(z => ({
    ...z,
    color: zoneColor(z.color),
    seconds: withZones.reduce((s, r) => s + (r.zones[z.key] || 0), 0),
  }));
  const totalSeconds = totals.reduce((s, z) => s + z.seconds, 0);

  const bar = totals
    .filter(z => z.seconds > 0)
    .map(z => `<div class="zone-seg" style="width:${(z.seconds / totalSeconds) * 100}%;background:${z.color}" title="${z.name}: ${formatDuration(z.seconds)}"></div>`)
    .join('');
  const legend = totals
    .map(z => `<div class="zone-legend-item"><span class="zone-dot" style="background:${z.color}"></span>${z.name} (${formatDuration(z.seconds)})</div>`)
    .join('');

  container.innerHTML = `<div class="zone-bar">${bar}</div><div class="zone-legend">${legend}</div>`;
}

/* ---------------- New: Trends view ---------------- */
function getWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function computeWeeklyTotals(rides) {
  const map = new Map();
  rides.forEach(r => {
    if (!r.date) return;
    const start = getWeekStart(r.date);
    const key = start.toISOString().slice(0, 10);
    if (!map.has(key)) map.set(key, { start, rides: 0, km: 0, secs: 0 });
    const entry = map.get(key);
    entry.rides++;
    entry.km += r.distance_km || 0;
    entry.secs += parseDuration(r.moving_time);
  });
  return Array.from(map.values()).sort((a, b) => b.start - a.start);
}

function renderWeekly(rides) {
  const weeks = computeWeeklyTotals(rides);
  const body = document.getElementById('weekly-body');
  if (!weeks.length) {
    body.innerHTML = `<tr><td colspan="4" class="chart-empty">No data yet.</td></tr>`;
    return;
  }
  body.innerHTML = weeks.map(w => `
    <tr>
      <td>${w.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
      <td class="num">${w.rides}</td>
      <td class="num">${w.km.toFixed(1)}</td>
      <td class="num">${formatDuration(w.secs)}</td>
    </tr>
  `).join('');
}

function computeRouteHistory(rides) {
  const map = new Map();
  rides.forEach(r => {
    const key = r.map_name || 'Unknown';
    if (!map.has(key)) map.set(key, { name: key, count: 0, bestSpeed: null, lastDate: null });
    const entry = map.get(key);
    entry.count++;
    if (r.speed_avg_kmh != null && (entry.bestSpeed === null || r.speed_avg_kmh > entry.bestSpeed)) {
      entry.bestSpeed = r.speed_avg_kmh;
    }
    if (r.date && (!entry.lastDate || r.date > entry.lastDate)) entry.lastDate = r.date;
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function renderRouteHistory(rides) {
  const routes = computeRouteHistory(rides);
  const body = document.getElementById('route-body');
  if (!routes.length) {
    body.innerHTML = `<tr><td colspan="4" class="chart-empty">No data yet.</td></tr>`;
    return;
  }
  body.innerHTML = routes.map(rt => `
    <tr>
      <td class="name">${rt.name}</td>
      <td class="num">${rt.count}</td>
      <td class="num">${rt.bestSpeed != null ? rt.bestSpeed.toFixed(1) + ' km/h' : '—'}</td>
      <td class="muted">${rt.lastDate || '—'}</td>
    </tr>
  `).join('');
}

/* ---------------- Boot ---------------- */
// Rides from all monthly files, oldest first.
function combineRides(files) {
  return files
    .flatMap(d => (d && Array.isArray(d.rides)) ? d.rides : [])
    .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`));
}

function render(data, sourceText) {
  currentRides = data.rides || [];
  assignBikeColors(currentRides);
  renderBikeKey(currentRides);
  buildFilterOptions(currentRides);
  renderTotals(currentRides);
  renderRows();
  if (document.getElementById('graph-view').classList.contains('active')) drawChart();
  if (document.getElementById('records-view').classList.contains('active')) { renderRecords(currentRides); renderZones(currentRides); }
  if (document.getElementById('trends-view').classList.contains('active')) { renderWeekly(currentRides); renderRouteHistory(currentRides); }
  document.getElementById('status').textContent = `Loaded ${currentRides.length} ride(s) from ${sourceText}`;
}

document.querySelectorAll('thead th[data-key]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = true;
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
      render({ rides: combineRides(parsed) }, `${files.length} file(s)`);
      document.getElementById('picker-wrap').classList.remove('show');
    } catch (err) {
      document.getElementById('status').textContent = 'Could not read one of those files as JSON.';
    }
  });
}

buildMetricPicker();

// ride_data/index.json lists the monthly files written by extract_rides.py.
function getJson(url) {
  return fetch(url).then(res => {
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  });
}

getJson('ride_data/index.json')
  .then(index => Promise.all((index.files || []).map(f => getJson(`ride_data/${f}`)))
    .then(months => render({ rides: combineRides(months) }, `${months.length} monthly file(s)`)))
  .catch(() => showPicker());
