// "By app / By bike" chart at the bottom of the Ride Log's Trends tab: one bar
// per app (or bike) for the chosen stat, with every stat for that app or bike
// on hover. Uses helpers from js/rides.js (bikeLabel, bikeSlots, bikeFile,
// appIcon, parseDuration, formatDuration, APP_ORDER).

(function () {
  // Bar colours by app, in the same families as the app rings on the bike
  // icons, darkened so they pass the colour checks on a white card.
  const APP_COLOURS = { MyWhoosh: '#C49300', Rouvy: '#0F9D6E', Outdoor: '#E2661A' };
  const OTHER_APP = '#6F6FC8';
  const BIKE_COLOURS = { 1: '#5B9BF0', 2: '#F0739A', 3: '#A483F0' };
  const NO_BIKE = '#8C93A3';

  const METRICS = [
    { key: 'km',     label: 'Distance',  fmt: v => `${v.toFixed(1)} km` },
    { key: 'rides',  label: 'Rides',     fmt: v => `${v} ride${v === 1 ? '' : 's'}` },
    { key: 'secs',   label: 'Time',      fmt: v => formatDuration(v) },
    { key: 'avgW',   label: 'Avg power', fmt: v => `${Math.round(v)} W` },
    { key: 'maxW',   label: 'Max power', fmt: v => `${Math.round(v)} W` },
    { key: 'speed',  label: 'Avg speed', fmt: v => `${v.toFixed(1)} km/h` },
  ];
  const GROUPS = {
    app:  { title: 'By app',  key: r => r.app || 'Unknown app' },
    bike: { title: 'By bike', key: r => bikeLabel(r) },
  };

  const load = (k, ok, fallback) => { try { const v = localStorage.getItem(k); return ok(v) ? v : fallback; } catch (e) { return fallback; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* not saved */ } };
  let group = load('rideKitGroup', v => GROUPS[v], 'app');
  let metric = load('rideKitMetric', v => METRICS.some(m => m.key === v), 'km');

  function stats(rides) {
    const map = new Map();
    rides.forEach(r => {
      const name = GROUPS[group].key(r);
      if (!map.has(name)) map.set(name, { name, sample: r, rides: 0, km: 0, secs: 0, wSecs: 0, wSum: 0, maxW: null });
      const e = map.get(name);
      const secs = parseDuration(r.moving_time);
      e.rides++;
      e.km += r.distance_km || 0;
      e.secs += secs;
      if (r.power_avg_w) { e.wSum += r.power_avg_w * secs; e.wSecs += secs; }
      if (r.power_max_w && (e.maxW === null || r.power_max_w > e.maxW)) e.maxW = r.power_max_w;
    });
    return [...map.values()].map(e => ({
      ...e,
      avgW: e.wSecs ? e.wSum / e.wSecs : null,            // weighted by ride time
      speed: e.secs ? e.km / (e.secs / 3600) : null,
    }));
  }

  function look(e) {
    if (group === 'app') {
      return { colour: APP_COLOURS[e.name] || OTHER_APP, icon: `${ICON_DIR}ring-${appIcon(e.sample.app)}.svg` };
    }
    const id = e.sample.bike_id;
    const slot = id && bikeSlots.get(id);
    return { colour: slot ? BIKE_COLOURS[slot] : NO_BIKE, icon: `${ICON_DIR}${bikeFile(id)}-none.svg` };
  }

  window.renderKitStats = function (rides) {
    const box = document.getElementById('kit-bars');
    if (!box) return;
    document.getElementById('kit-title').textContent = GROUPS[group].title;
    document.querySelectorAll('#kit-group .group-btn').forEach(b => b.classList.toggle('active', b.dataset.group === group));
    document.querySelectorAll('#kit-metric .group-btn').forEach(b => b.classList.toggle('active', b.dataset.metric === metric));

    const m = METRICS.find(x => x.key === metric);
    const rows = stats(rides);
    if (!rows.length) { box.innerHTML = '<div class="chart-empty">No rides yet.</div>'; return; }
    rows.sort((a, b) => (b[metric] ?? -1) - (a[metric] ?? -1) ||
      (group === 'app' ? APP_ORDER.indexOf(a.name) - APP_ORDER.indexOf(b.name) : a.name.localeCompare(b.name)));
    const max = Math.max(...rows.map(r => r[metric] || 0)) || 1;

    box.innerHTML = rows.map((e, i) => {
      const v = e[metric];
      const { colour, icon } = look(e);
      return `
        <div class="kit-row" data-i="${i}">
          <span class="kit-name"><img src="${icon}" alt="">${escapeHtml(e.name)}</span>
          <span class="kit-track">${v != null ? `<i style="width:${Math.max((v / max) * 100, 1.5)}%;background:${colour}"></i>` : ''}</span>
          <span class="kit-val">${v != null ? m.fmt(v) : '—'}</span>
        </div>`;
    }).join('');
    box._rows = rows;
  };

  // ---- Controls ----
  const redraw = () => window.renderKitStats(currentRides);
  document.getElementById('kit-group')?.addEventListener('click', e => {
    const b = e.target.closest('[data-group]'); if (!b) return;
    group = b.dataset.group; save('rideKitGroup', group); redraw();
  });
  document.getElementById('kit-metric')?.addEventListener('click', e => {
    const b = e.target.closest('[data-metric]'); if (!b) return;
    metric = b.dataset.metric; save('rideKitMetric', metric); redraw();
  });
  document.querySelector('.tab-btn[data-view="trends-view"]')?.addEventListener('click', redraw);

  // ---- Hover: every stat for that app or bike ----
  const box = document.getElementById('kit-bars');
  if (!box) return;
  const tip = document.createElement('div');
  tip.className = 'hover-tip kit-tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  box.addEventListener('pointermove', e => {
    const row = e.target.closest('.kit-row');
    const r = row && box._rows && box._rows[row.dataset.i];
    if (!r) { tip.hidden = true; return; }
    tip.innerHTML = `<b>${escapeHtml(r.name)}</b>` + METRICS.map(m =>
      `<span><em>${m.label}</em>${r[m.key] != null ? m.fmt(r[m.key]) : '—'}</span>`).join('');
    tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY + 16}px`;
  });
  box.addEventListener('pointerleave', () => { tip.hidden = true; });
})();
