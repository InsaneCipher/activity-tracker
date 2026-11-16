const RECENT_COUNT = 10;
const CAL_MAX_WEEKS = 52;   // the calendar shows as many weeks as fit, up to a year
let allActivities = [];

const has = v => v !== null && v !== undefined && !isNaN(v);
const fmt = (v, unit = '') => has(v) ? `${v}${unit}` : '—';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function parseDuration(str) {
  if (!str) return 0;
  const parts = String(str).split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}
function clock(secs) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.round(secs % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const prettyDate = (iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(iso + 'T00:00').toLocaleDateString('en-GB', opts);

function timeAgo(iso, time) {
  const then = new Date(`${iso}T${time || '12:00'}`);
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  return prettyDate(iso);
}

/* ---------- Normalise rides and walks into one shape ---------- */
function fromRide(r) {
  return {
    kind: 'ride', type: 'Ride', date: r.date, time: r.time || '',
    name: r.map_name || 'Ride', url: r.url,
    km: r.distance_km, secs: parseDuration(r.moving_time), elev: r.elevation_m,
    hr: r.heart_rate_avg_bpm, cal: r.calories,
    key: has(r.power_avg_w) ? `<b>${r.power_avg_w} W</b> · ${fmt(r.speed_avg_kmh)} km/h` : `<b>${fmt(r.speed_avg_kmh)}</b> km/h`,
  };
}
function fromWalk(w) {
  const type = w.type === 'Hike' ? 'Hike' : 'Walk';
  return {
    kind: 'walk', type, date: w.date, time: w.time || '',
    name: w.name || type, url: w.url,
    km: w.distance_km, secs: w.moving_time_sec ?? parseDuration(w.moving_time), elev: w.elevation_gain_m,
    hr: w.heart_rate_avg_bpm, cal: w.calories, steps: w.steps_estimated,
    key: w.pace_min_per_km ? `<b>${w.pace_min_per_km}</b> /km` : '—',
  };
}
const byNewest = (a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`);

/* ---------- Totals ---------- */
function renderTotals(all) {
  const sum = f => all.reduce((s, a) => s + (has(a[f]) ? a[f] : 0), 0);
  const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const thisWeek = all.filter(a => new Date(a.date + 'T00:00') >= weekStart);
  const weekKm = thisWeek.reduce((s, a) => s + (a.km || 0), 0);

  document.getElementById('totals').innerHTML = `
    <div class="total-cell"><div class="num">${all.length}</div><div class="label">Activities</div></div>
    <div class="total-cell"><div class="num">${sum('km').toFixed(1)}</div><div class="label">Total distance (km)</div></div>
    <div class="total-cell"><div class="num">${formatDuration(sum('secs'))}</div><div class="label">Total time</div></div>
    <div class="total-cell"><div class="num">${Math.round(sum('elev')).toLocaleString('en-GB')}</div><div class="label">Total elevation (m)</div></div>
    <div class="total-cell"><div class="num">${Math.round(sum('cal')).toLocaleString('en-GB')}</div><div class="label">Calories burned</div></div>
    <div class="total-cell"><div class="num">${weekKm.toFixed(1)}</div><div class="label">This week (km, ${thisWeek.length} ${thisWeek.length === 1 ? 'activity' : 'activities'})</div></div>
  `;
}

/* ---------- Type cards ---------- */
function sparkline(items, color) {
  const pts = items.slice().sort((a, b) => -byNewest(a, b)).slice(-20).map(a => a.km || 0);
  if (pts.length < 2) return '';
  const W = 300, H = 48, max = Math.max(...pts) || 1;
  const bw = W / pts.length;
  const bars = pts.map((v, i) => {
    const h = Math.max(2, (v / max) * (H - 4));
    return `<rect x="${i * bw + 1}" y="${H - h}" width="${Math.max(1, bw - 2)}" height="${h}" fill="${color}" opacity="${0.35 + 0.65 * (i / (pts.length - 1))}"><title>${v} km</title></rect>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>`;
}

function renderCard(prefix, items, labels, color) {
  const sorted = items.slice().sort(byNewest);
  const km = items.reduce((s, a) => s + (a.km || 0), 0);
  const secs = items.reduce((s, a) => s + a.secs, 0);
  const stats = [
    [items.length, labels.count],
    [km.toFixed(1), 'Km'],
    [formatDuration(secs), 'Time'],
    [labels.fourth(items), labels.fourthLabel],
  ];
  document.getElementById(`${prefix}-stats`).innerHTML = stats
    .map(([n, l]) => `<div class="card-stat"><div class="num">${n}</div><div class="label">${l}</div></div>`).join('');
  document.getElementById(`${prefix}-spark`).innerHTML = sparkline(items, color);
  const last = sorted[0];
  document.getElementById(`${prefix}-last`).innerHTML = last
    ? `Last: <b>${esc(last.name)}</b> · ${fmt(last.km, ' km')} · ${timeAgo(last.date, last.time)}`
    : 'No activities yet';
}

/* ---------- Calendar ---------- */
function renderCalendar(all) {
  const byDay = new Map();
  all.forEach(a => {
    if (!byDay.has(a.date)) byDay.set(a.date, { ride: 0, walk: 0, items: [] });
    const d = byDay.get(a.date);
    d[a.kind] += a.secs;
    d.items.push(a);
  });
  const maxSecs = Math.max(1, ...[...byDay.values()].map(d => d.ride + d.walk));

  const wrap = document.getElementById('calendar-wrap');
  const usable = wrap.clientWidth - 44 - 34;            // padding and day labels
  const CAL_WEEKS = Math.max(8, Math.min(CAL_MAX_WEEKS, Math.floor((usable + 4) / 20)));
  document.getElementById('cal-title').textContent =
    CAL_WEEKS >= 52 ? 'Last 12 months' : `Last ${CAL_WEEKS} weeks`;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (CAL_WEEKS - 1) * 7); // a Monday

  const ride = getComputedStyle(document.documentElement).getPropertyValue('--ride').trim();
  const walk = getComputedStyle(document.documentElement).getPropertyValue('--walk').trim();
  const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

  let weeks = '', lastMonth = -1;
  for (let w = 0; w < CAL_WEEKS; w++) {
    let days = '';
    const weekStart = new Date(start); weekStart.setDate(start.getDate() + w * 7);
    const m = weekStart.getMonth();
    days += `<div class="cal-month">${m !== lastMonth && w < CAL_WEEKS - 1 ? weekStart.toLocaleDateString('en-GB', { month: 'short' }) : ''}</div>`;
    lastMonth = m;
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart); day.setDate(weekStart.getDate() + d);
      const key = localDate(day);
      if (day > today) { days += `<div class="cal-day future"></div>`; continue; }
      const info = byDay.get(key);
      let style = '', title = prettyDate(key, { weekday: 'short', day: 'numeric', month: 'short' });
      if (info) {
        const a = 0.35 + 0.65 * Math.min(1, (info.ride + info.walk) / maxSecs);
        const fill = info.ride && info.walk
          ? `linear-gradient(135deg, ${alpha(ride, a)} 50%, ${alpha(walk, a)} 50%)`
          : alpha(info.ride ? ride : walk, a);
        style = `background:${fill};border-color:transparent;`;
        title += ' — ' + info.items.map(i => `${i.type}: ${i.name} (${fmt(i.km, ' km')})`).join(', ');
      }
      days += `<div class="cal-day${key === localDate(today) ? ' today' : ''}" style="${style}" title="${esc(title)}"></div>`;
    }
    weeks += `<div class="cal-week">${days}</div>`;
  }
  const labels = ['', 'Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map(l => `<span>${l}</span>`).join('');
  document.getElementById('calendar').innerHTML = `<div class="cal-labels">${labels}</div>${weeks}`;
}

/* ---------- Recent activities ---------- */
function renderRecent(all) {
  const recent = all.slice().sort(byNewest).slice(0, RECENT_COUNT);
  const body = document.getElementById('recent');
  if (!recent.length) {
    body.innerHTML = `<tr><td colspan="9" class="muted" style="text-align:center;padding:30px">No activities yet.</td></tr>`;
    return;
  }
  body.innerHTML = recent.map(a => `
    <tr>
      <td><span class="badge ${a.type.toLowerCase()}">${a.type}</span></td>
      <td class="muted">${prettyDate(a.date)}<span class="time-sub">${a.time}</span></td>
      <td class="name" title="${esc(a.name)}">${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>` : esc(a.name)}</td>
      <td class="num">${fmt(a.km)}</td>
      <td class="num muted">${a.secs ? clock(a.secs) : '—'}</td>
      <td class="num muted">${fmt(a.elev, ' m')}</td>
      <td class="key-stat ${a.type.toLowerCase()}">${a.key}</td>
      <td class="num hr">${fmt(a.hr)}</td>
      <td class="num muted">${fmt(a.cal)}</td>
    </tr>
  `).join('');
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => allActivities.length && renderCalendar(allActivities), 150);
});

/* ---------- Load ---------- */
function getJson(url) {
  return fetch(url).then(res => {
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  });
}
// Every monthly file listed in <folder>/index.json, combined.
function loadFolder(folder, key) {
  return getJson(`${folder}/index.json`)
    .then(index => Promise.all((index.files || []).map(f => getJson(`${folder}/${f}`))))
    .then(months => months.flatMap(m => Array.isArray(m[key]) ? m[key] : []));
}

Promise.allSettled([loadFolder('ride_data', 'rides'), loadFolder('walk_data', 'walks')])
  .then(([rideRes, walkRes]) => {
    if (rideRes.status === 'rejected' && walkRes.status === 'rejected') {
      document.getElementById('notice').classList.add('show');
      return;
    }
    const rides = (rideRes.value || []).map(fromRide);
    const walks = (walkRes.value || []).map(fromWalk);
    const all = rides.concat(walks);

    renderTotals(all);
    renderCard('ride', rides, {
      count: 'Rides', fourthLabel: 'Avg power',
      fourth: items => {
        const p = items.map(r => r.key.match(/(\d+) W/)).filter(Boolean).map(m => +m[1]);
        return p.length ? Math.round(p.reduce((a, b) => a + b, 0) / p.length) + ' W' : '—';
      },
    }, getComputedStyle(document.documentElement).getPropertyValue('--ride').trim());
    renderCard('walk', walks, {
      count: 'Walks', fourthLabel: 'Steps',
      fourth: items => {
        const s = items.reduce((t, w) => t + (w.steps || 0), 0);
        return s >= 10000 ? Math.round(s / 1000) + 'k' : s.toLocaleString('en-GB');
      },
    }, getComputedStyle(document.documentElement).getPropertyValue('--walk').trim());
    allActivities = all;
    renderCalendar(all);
    renderRecent(all);

    const newest = all.slice().sort(byNewest)[0];
    document.getElementById('status').textContent =
      `${rides.length} rides and ${walks.length} walks` + (newest ? ` · last activity ${timeAgo(newest.date, newest.time)}` : '');
    document.getElementById('footer').textContent = 'Data synced from Strava every 15 minutes';
  });
