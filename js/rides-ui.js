// Ride Log extras for the "road book" design: the hero, and long route names
// that scroll inside their cell (via js/name-scroll.js). Everything else comes from js/rides.js, which
// this file hooks into by wrapping its render() and renderRows().

(function () {
  const originalRender = render;
  const originalRenderRows = renderRows;
  let animated = false;

  render = function (data, sourceText) {
    originalRender(data, sourceText);
    drawHero(currentRides);
    if (window.renderGoalBadge) renderGoalBadge(currentRides);   // js/goals.js
  };

  renderRows = function () {
    originalRenderRows();
    scrollLongNames();
  };

  function drawHero(rides) {
    const km = document.getElementById('hero-km');
    const sub = document.getElementById('hero-sub');
    if (!rides.length) {
      sub.textContent = 'No rides yet. Your first one will start the profile.';
    } else {
      const total = rides.reduce((s, r) => s + (r.distance_km || 0), 0);
      const secs = rides.reduce((s, r) => s + parseDuration(r.moving_time), 0);
      const longest = rides.reduce((a, b) => ((b.distance_km || 0) > (a.distance_km || 0) ? b : a));
      const first = rides.map(r => r.date).sort()[0];
      const since = new Date(first + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      km.innerHTML = `${Math.round(total).toLocaleString('en-GB')}<span class="unit">km</span>`;
      sub.innerHTML = `${rides.length} rides and ${formatDuration(secs)} in the saddle since ${since}. ` +
        `Biggest day so far: <b>${SeasonHero.esc(longest.map_name || 'a ride')}</b>, ${longest.distance_km} km.`;
    }
    SeasonHero.draw(document.getElementById('hero-profile'),
      [{ cls: 'ride', label: 'Rides', items: rides.map(r => ({ date: r.date, time: r.time, km: r.distance_km, name: r.map_name })) }],
      { animate: !animated, markLongest: true });
    animated = true;
  }

  // Long route names slide inside their cell (js/name-scroll.js).
  const scrollLongNames = makeNameScroller('#rides', 'table-view', () => { if (currentRides.length) renderRows(); });

  // Columns button in the filter bar (js/column-picker.js).
  makeColumnPicker({ table: '#ride-table', mount: '#col-picker', storageKey: 'rideHiddenCols', keep: ['idx', 'date', 'route'] });
})();
