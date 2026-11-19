let currentRides = [];
let sortKey = 'date';
let sortAsc = false;   // newest first, so a row limit shows your latest rides

// How many rows the ride table shows (the "Show" dropdown); remembered per browser.
let rowLimit = 25;
try {
  const saved = localStorage.getItem('rideRowLimit');
  if (saved) rowLimit = saved === 'all' ? Infinity : Number(saved) || 25;
} catch (e) {}
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
  const countries = new Set(rides.map(countryOf).filter(Boolean)).size;
  const totalTime = rides.reduce((s, r) => s + parseDuration(r.moving_time), 0);
  const totalElevation = rides.reduce((s, r) => s + (r.elevation_m || 0), 0);

  document.getElementById('totals').innerHTML = `
    <div class="total-cell"><div class="num">${rides.length}</div><div class="label">Rides logged</div></div>
    <div class="total-cell"><div class="num">${totalDist.toFixed(1)}</div><div class="label">Total distance (km)</div></div>
    <div class="total-cell"><div class="num">${formatDuration(totalTime)}</div><div class="label">Time in the saddle</div></div>
    <div class="total-cell"><div class="num">${totalElevation}</div><div class="label">Total elevation (m)</div></div>
    <div class="total-cell"><div class="num">${totalCals}</div><div class="label">Calories burned</div></div>
    <div class="total-cell"><div class="num">${countries}</div><div class="label">Countries ridden in</div></div>
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

/* ---------------- Bikes and apps ---------------- */
// Each ride gets a small icon from images/bike-icons/: the centre colour is the
// bike and the ring is the app the ride came from.
const ICON_DIR = 'images/bike-icons/';
const BIKE_SLOT_COUNT = 3;   // bike1, bike2, bike3 icon colours

// Pin a bike to a colour by its Strava gear id (1 = blue, 2 = pink, 3 = lavender).
// Bikes not listed here take the next free colour, in the order first ridden.
const BIKE_SLOTS = {
  'b18660663': 1,   // Renpho Smart S
};

const APP_ICONS = { 'MyWhoosh': 'mywhoosh', 'Rouvy': 'rouvy', 'Outdoor': 'outdoor' };
const APP_ORDER = ['MyWhoosh', 'Rouvy', 'Zwift', 'Outdoor', 'Indoor', 'Other app'];
const appIcon = app => app ? (APP_ICONS[app] || 'other') : 'none';

let bikeSlots = new Map();   // gear id -> 1..3

function assignBikeSlots(rides) {
  bikeSlots = new Map(Object.entries(BIKE_SLOTS));
  const used = new Set(bikeSlots.values());
  rides.slice()
    .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`))
    .forEach(r => {
      if (!r.bike_id || bikeSlots.has(r.bike_id)) return;
      let slot = 1;
      while (used.has(slot) && slot <= BIKE_SLOT_COUNT) slot++;
      if (slot > BIKE_SLOT_COUNT) slot = (bikeSlots.size % BIKE_SLOT_COUNT) + 1;  // more bikes than colours
      bikeSlots.set(r.bike_id, slot);
      used.add(slot);
    });
}

const escapeHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const bikeLabel = r => r.bike || (r.bike_id ? 'Unnamed bike' : 'No bike set');
const bikeFile = id => bikeSlots.has(id) ? `bike${bikeSlots.get(id)}` : 'nobike';

function bikeIcon(r) {
  const title = `Bike: ${bikeLabel(r)}${r.app ? ` · App: ${r.app}` : ''}${r.device ? ` (${r.device})` : ''}`;
  return `<img class="bike-icon" src="${ICON_DIR}${bikeFile(r.bike_id)}-${appIcon(r.app)}.svg" alt="" title="${escapeHtml(title)}">`;
}

// Small key above the table: an icon, name and ride count per bike and per app.
function renderBikeKey(rides) {
  const key = document.getElementById('bike-key');
  const counts = new Map();
  rides.forEach(r => { if (r.bike_id) counts.set(r.bike_id, (counts.get(r.bike_id) || 0) + 1); });
  const apps = new Map();
  rides.forEach(r => { if (r.app) apps.set(r.app, (apps.get(r.app) || 0) + 1); });
  if (!counts.size && !apps.size) { key.innerHTML = ''; return; }
  const names = new Map(rides.filter(r => r.bike_id).map(r => [r.bike_id, bikeLabel(r)]));
  const bikeItems = [...counts.keys()].sort((a, b) => bikeSlots.get(a) - bikeSlots.get(b)).map(id => `
    <span class="bike-key-item"><img class="bike-icon" src="${ICON_DIR}${bikeFile(id)}-none.svg" alt="">${escapeHtml(names.get(id))} <span class="bike-key-count">${counts.get(id)}</span></span>
  `);
  const appItems = [...apps.keys()].sort((a, b) => APP_ORDER.indexOf(a) - APP_ORDER.indexOf(b)).map(app => `
    <span class="bike-key-item"><img class="bike-icon" src="${ICON_DIR}ring-${appIcon(app)}.svg" alt="">${escapeHtml(app)} <span class="bike-key-count">${apps.get(app)}</span></span>
  `);
  key.innerHTML = bikeItems.join('') + (bikeItems.length && appItems.length ? '<span class="bike-key-sep"></span>' : '') + appItems.join('');
}

/* ---------------- Filters ---------------- */
// Route names look like "Al Wathba-L (Arabia)": the route is the part before
// the brackets and the country is the part inside them.
// MyWhoosh names some worlds after a place or region rather than a country;
// those are shown under the real country. Add more here if a new one turns up.
const COUNTRY_RENAMES = {
  Hudayriyat: 'United Arab Emirates',   // an island in Abu Dhabi
  Arabia: 'United Arab Emirates',       // MyWhoosh's Arabia world: the UAE's seven emirates (plus one Bahrain route)
};
// Routes whose real country differs from their world's - checked first.
const ROUTE_COUNTRIES = {
  'Tour Of Hegra': 'Saudi Arabia',      // from the AlUla world, but labelled "(Arabia)"
  'Bahrain': 'Bahrain',
};
const bracketOf = r => ((r.map_name || '').match(/\(([^()]+)\)\s*$/) || [])[1] || '';
const routeNameOf = r => (r.map_name || '').replace(/\s*\([^()]*\)\s*$/, '').trim();
const countryOf = r => ROUTE_COUNTRIES[routeNameOf(r)] || COUNTRY_RENAMES[bracketOf(r)] || bracketOf(r);

// Flags: images/flags/<code>.png, named by two-letter country code (ch.png).
// The browser knows every country's English name, so any country - including
// ones you haven't ridden yet - finds its flag without a list to keep up.
// Short or unofficial names the browser wouldn't recognise go in FLAG_ALIASES.
const FLAG_ALIASES = {
  uae: 'ae', usa: 'us', us: 'us', uk: 'gb', 'great britain': 'gb', britain: 'gb',
  england: 'gb-eng', scotland: 'gb-sct', wales: 'gb-wls', 'northern ireland': 'gb-nir',
  'south korea': 'kr', korea: 'kr', russia: 'ru', 'czech republic': 'cz', holland: 'nl',
  turkey: 'tr', 'ivory coast': 'ci',
};
const FLAG_CODES = (() => {
  const codes = { ...FLAG_ALIASES };
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    const A = 65;
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(A + i, A + j);
        let name;
        try { name = names.of(code); } catch (e) { continue; }
        if (name && name !== code && !codes[name.toLowerCase()]) codes[name.toLowerCase()] = code.toLowerCase();
      }
    }
  } catch (e) { /* very old browser: aliases only */ }
  return codes;
})();
function flagImg(country) {
  const code = country && FLAG_CODES[country.toLowerCase()];
  if (!code) return '';
  // A missing image just disappears rather than showing a broken icon.
  return `<img class="flag" src="images/flags/${code}.png" alt="" title="${country}" onerror="this.remove()">`;
}
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
  const bikes = [...bikeSlots.keys()].filter(id => rides.some(r => r.bike_id === id)).map(id => {
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

function updateFilterCount(shown, listed) {
  const active = FILTER_INPUTS.some(id => filterValue(id) !== '');
  const km = shown.reduce((s, r) => s + (r.distance_km || 0), 0);
  const secs = shown.reduce((s, r) => s + parseDuration(r.moving_time), 0);
  const limited = listed < shown.length ? ` (first ${listed} listed)` : '';
  document.getElementById('f-count').innerHTML = active
    ? `Showing <b>${shown.length}</b> of ${currentRides.length} rides · ${km.toFixed(1)} km · ${formatDuration(secs)}${limited}`
    : `${currentRides.length} rides${limited}`;
  document.getElementById('filter-bar').classList.toggle('filtering', active);
}

FILTER_INPUTS.forEach(id => document.getElementById(id).addEventListener('input', () => renderRows()));

const limitSelect = document.getElementById('f-limit');
limitSelect.value = rowLimit === Infinity ? 'all' : String(rowLimit);
if (!limitSelect.value) { limitSelect.value = '25'; rowLimit = 25; }
limitSelect.addEventListener('change', () => {
  rowLimit = limitSelect.value === 'all' ? Infinity : Number(limitSelect.value);
  try { localStorage.setItem('rideRowLimit', limitSelect.value); } catch (e) {}
  renderRows();
});
document.getElementById('f-reset').addEventListener('click', () => {
  FILTER_INPUTS.forEach(id => { document.getElementById(id).value = ''; });
  renderRows();
});

function renderRows() {
  // Best values stay based on all rides, so a highlight always means an all-time best.
  const best = computeBestValues(currentRides);
  const shown = filteredRides();

  const sorted = shown.slice().sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (sortKey === 'date') { av = `${a.date} ${a.time || ''}`; bv = `${b.date} ${b.time || ''}`; }
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

  const listed = sorted.slice(0, rowLimit);
  updateFilterCount(shown, listed.length);

  document.getElementById('rides').innerHTML = listed.map((r, i) => `
    <tr>
      <td class="idx">${i + 1}</td>
      <td class="muted date-cell">${fmt(r.date)}${r.time ? `<span class="ride-time">${r.time}</span>` : ''}</td>
      <td class="name" title="${escapeHtml(r.map_name)}${r.bike_id ? ' · ' + escapeHtml(bikeLabel(r)) : ''}">${bikeIcon(r)}${r.url ? `<a href="${r.url}" target="_blank" rel="noopener">${r.map_name || '—'}</a>` : (r.map_name || '—')}</td>
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
  const savedLimit = localStorage.getItem('rideTrendLimit');
  if (savedLimit) trendLimit = savedLimit === 'all' ? Infinity : Number(savedLimit) || 12;
} catch (e) {}
try {
  trendGroup = GROUPS[localStorage.getItem('rideTrendGroup')] ? localStorage.getItem('rideTrendGroup') : 'week';
  showChanges = localStorage.getItem('rideTrendChanges') !== 'off';
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

function computePeriodTotals(rides, group) {
  const map = new Map();
  rides.forEach(r => {
    if (!r.date) return;
    const start = periodStart(r.date, group);
    const key = dayKey(start);
    if (!map.has(key)) map.set(key, { key, start, rides: 0, km: 0, secs: 0, wattSecs: 0, powerSecs: 0, maxW: null });
    const e = map.get(key);
    const secs = parseDuration(r.moving_time);
    e.rides++;
    e.km += r.distance_km || 0;
    e.secs += secs;
    if (r.power_avg_w) { e.wattSecs += r.power_avg_w * secs; e.powerSecs += secs; }
    if (r.power_max_w) e.maxW = Math.max(e.maxW || 0, r.power_max_w);
  });
  map.forEach(e => { e.avgW = e.powerSecs ? e.wattSecs / e.powerSecs : null; });
  return map;
}

// "▲ 12%" / "▼ 8%" against the previous period; blank when there's nothing to compare with.
// A fall in the current period is grey: the period isn't over yet.
function changeBadge(cur, prev, inProgress) {
  if (cur === null || cur === undefined || !prev) return '<span class="delta none"></span>';
  const pct = (cur - prev) / prev * 100;
  if (Math.abs(pct) < 0.5) return '<span class="delta flat">0%</span>';
  const cls = pct > 0 ? 'up' : (inProgress ? 'pending' : 'down');
  const title = pct < 0 && inProgress ? ' title="This period is still in progress"' : '';
  return `<span class="delta ${cls}"${title}>${pct > 0 ? '▲' : '▼'} ${Math.abs(Math.round(pct))}%</span>`;
}

function applyChangeToggle() {
  const btn = document.getElementById('delta-toggle');
  btn.classList.toggle('active', showChanges);
  btn.setAttribute('aria-pressed', String(showChanges));
  document.getElementById('trends-view').classList.toggle('hide-changes', !showChanges);
}

function renderWeekly(rides) {
  const group = trendGroup;
  document.getElementById('trend-title').textContent = GROUPS[group].title;
  document.getElementById('trend-period-head').textContent = GROUPS[group].head;
  document.querySelectorAll('#group-picker .group-btn[data-group]').forEach(b => b.classList.toggle('active', b.dataset.group === group));

  const totals = computePeriodTotals(rides, group);
  const periods = [...totals.values()].sort((a, b) => b.start - a.start);
  const body = document.getElementById('weekly-body');
  if (!periods.length) {
    body.innerHTML = `<tr><td colspan="6" class="chart-empty">No data yet.</td></tr>`;
    return;
  }
  const current = dayKey(periodStart(dayKey(new Date()), group));
  // Only the latest periods are listed, but changes still compare with the
  // previous period from the full totals.
  body.innerHTML = periods.slice(0, trendLimit).map(p => {
    const prev = totals.get(dayKey(previousPeriodStart(p.start, group)));
    const inProgress = p.key === current;
    const cell = (text, cur, prevVal, cls = '') =>
      `<td class="num ${cls}"><span class="trend-val">${text}</span>${changeBadge(cur, prevVal, inProgress)}</td>`;
    return `
      <tr>
        <td>${periodLabel(p.start, group)}${p.key === current ? ' <span class="so-far">so far</span>' : ''}</td>
        ${cell(p.rides, p.rides, prev && prev.rides)}
        ${cell(p.km.toFixed(1), p.km, prev && prev.km)}
        ${cell(formatDuration(p.secs), p.secs, prev && prev.secs)}
        ${cell(p.avgW !== null ? Math.round(p.avgW) + ' W' : '—', p.avgW, prev && prev.avgW, 'power')}
        ${cell(p.maxW !== null ? p.maxW + ' W' : '—', p.maxW, prev && prev.maxW, 'power')}
      </tr>`;
  }).join('');
  alignTrendValues();
}

// Give every value in a column the width of the column's widest value, so the
// ▲▼ percentages line up in a straight column.
function alignTrendValues() {
  const rows = [...document.querySelectorAll('#weekly-body tr')];
  if (!rows.length || !rows[0].offsetParent) return;   // table hidden: nothing to measure
  const cols = rows[0].children.length;
  for (let c = 1; c < cols; c++) {
    const vals = rows.map(r => r.children[c] && r.children[c].querySelector('.trend-val')).filter(Boolean);
    vals.forEach(v => { v.style.width = ''; });
    const widest = Math.ceil(Math.max(...vals.map(v => v.getBoundingClientRect().width)));
    vals.forEach(v => { v.style.width = widest + 'px'; });
  }
}

if (document.fonts) document.fonts.ready.then(() => alignTrendValues());   // web font changes widths

const trendLimitSelect = document.getElementById('trend-limit');
trendLimitSelect.value = trendLimit === Infinity ? 'all' : String(trendLimit);
if (!trendLimitSelect.value) { trendLimitSelect.value = '12'; trendLimit = 12; }
trendLimitSelect.addEventListener('change', () => {
  trendLimit = trendLimitSelect.value === 'all' ? Infinity : Number(trendLimitSelect.value);
  try { localStorage.setItem('rideTrendLimit', trendLimitSelect.value); } catch (e) {}
  renderWeekly(currentRides);
});

document.getElementById('delta-toggle').addEventListener('click', () => {
  showChanges = !showChanges;
  try { localStorage.setItem('rideTrendChanges', showChanges ? 'on' : 'off'); } catch (e) {}
  applyChangeToggle();
});
applyChangeToggle();

document.querySelectorAll('#group-picker .group-btn[data-group]').forEach(btn => {
  btn.addEventListener('click', () => {
    trendGroup = btn.dataset.group;
    try { localStorage.setItem('rideTrendGroup', trendGroup); } catch (e) {}
    renderWeekly(currentRides);
  });
});

// Which continent each country (the part in brackets) is in. MyWhoosh names
// some worlds after a region ("Arabia") or an island ("Hudayriyat"), so those
// are listed too. Add new countries here as you ride them.
const CONTINENTS = {
  Europe: ['Switzerland', 'France', 'Belgium', 'Hungary', 'Ireland', 'Italy', 'Spain', 'Netherlands',
           'Germany', 'Austria', 'United Kingdom', 'UK', 'England', 'Scotland', 'Wales', 'Norway',
           'Portugal', 'Denmark', 'Sweden', 'Czechia', 'Poland', 'Croatia', 'Slovenia', 'Monaco', 'Andorra'],
  Asia: ['Arabia', 'Hudayriyat', 'United Arab Emirates', 'Bahrain', 'Bhutan', 'Japan', 'China', 'India', 'Nepal', 'UAE', 'Oman',
         'Qatar', 'Saudi Arabia', 'Jordan', 'Thailand', 'Vietnam', 'South Korea', 'Korea', 'Indonesia'],
  'North America': ['USA', 'United States', 'Canada', 'Mexico'],
  'South America': ['Brazil', 'Colombia', 'Argentina', 'Chile', 'Peru'],
  Africa: ['Morocco', 'South Africa', 'Kenya', 'Egypt', 'Rwanda'],
  Oceania: ['Australia', 'New Zealand'],
};
const CONTINENT_OF = Object.fromEntries(
  Object.entries(CONTINENTS).flatMap(([cont, list]) => list.map(c => [c.toLowerCase(), cont])));
const continentOf = r => CONTINENT_OF[countryOf(r).toLowerCase()] || (countryOf(r) ? 'Other' : 'Unknown');

const ROUTE_GROUPS = {
  route:     { title: 'By route',     head: 'Route',     key: r => r.map_name || 'Unknown', flag: r => countryOf(r) },
  country:   { title: 'By country',   head: 'Country',   key: r => countryOf(r) || 'Unknown', flag: r => countryOf(r) },
  continent: { title: 'By continent', head: 'Continent', key: continentOf },
};
let routeGroup = 'route';
try { if (ROUTE_GROUPS[localStorage.getItem('rideRouteGroup')]) routeGroup = localStorage.getItem('rideRouteGroup'); } catch (e) {}

function computeRouteHistory(rides, group = routeGroup) {
  const g = ROUTE_GROUPS[group];
  const keyOf = g.key;
  const map = new Map();
  rides.forEach(r => {
    const key = keyOf(r);
    if (!map.has(key)) map.set(key, { name: key, flag: g.flag ? g.flag(r) : '', count: 0, km: 0, routes: new Set(), bestSpeed: null, lastDate: null });
    const entry = map.get(key);
    entry.count++;
    entry.km += r.distance_km || 0;
    entry.routes.add(r.map_name || 'Unknown');
    if (r.speed_avg_kmh != null && (entry.bestSpeed === null || r.speed_avg_kmh > entry.bestSpeed)) {
      entry.bestSpeed = r.speed_avg_kmh;
    }
    if (r.date && (!entry.lastDate || r.date > entry.lastDate)) entry.lastDate = r.date;
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count || b.km - a.km);
}

function renderRouteHistory(rides) {
  const g = ROUTE_GROUPS[routeGroup];
  const grouped = routeGroup !== 'route';
  document.getElementById('route-title').textContent = g.title;
  document.getElementById('route-head-name').textContent = g.head;
  document.getElementById('route-head-routes').hidden = !grouped;
  document.querySelectorAll('#route-picker .group-btn').forEach(b => b.classList.toggle('active', b.dataset.group === routeGroup));

  const routes = computeRouteHistory(rides);
  const body = document.getElementById('route-body');
  if (!routes.length) {
    body.innerHTML = `<tr><td colspan="6" class="chart-empty">No data yet.</td></tr>`;
    return;
  }
  body.innerHTML = routes.map(rt => `
    <tr>
      <td class="name">${flagImg(rt.flag)}${window.SeasonHero ? SeasonHero.esc(rt.name) : rt.name}</td>
      ${grouped ? `<td class="num">${rt.routes.size}</td>` : ''}
      <td class="num">${rt.count}</td>
      <td class="num">${rt.km.toFixed(1)}</td>
      <td class="num">${rt.bestSpeed != null ? rt.bestSpeed.toFixed(1) + ' km/h' : '—'}</td>
      <td class="muted">${rt.lastDate || '—'}</td>
    </tr>
  `).join('');
}

document.querySelectorAll('#route-picker .group-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    routeGroup = btn.dataset.group;
    try { localStorage.setItem('rideRouteGroup', routeGroup); } catch (e) {}
    renderRouteHistory(currentRides);
  });
});

/* ---------------- Boot ---------------- */
// Rides from all monthly files, oldest first.
function combineRides(files) {
  return files
    .flatMap(d => (d && Array.isArray(d.rides)) ? d.rides : [])
    .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`));
}

function render(data, sourceText) {
  currentRides = data.rides || [];
  assignBikeSlots(currentRides);
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
