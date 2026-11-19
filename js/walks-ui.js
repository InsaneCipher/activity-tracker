// Walk Log extras for the "road book" design: the hero, and long walk names
// that scroll inside their cell. Everything else comes from js/walks.js, which
// this file hooks into by wrapping its render() and renderRows().

(function () {
  const originalRender = render;
  let animated = false;

  render = function (walks, sourceText) {
    originalRender(walks, sourceText);
    drawHero(currentWalks);
  };

  // Long walk names slide inside their cell (js/name-scroll.js).
  const originalRenderRows = renderRows;
  const scrollLongNames = makeNameScroller('#walks', 'table-view', () => { if (currentWalks.length) renderRows(); });
  renderRows = function () {
    originalRenderRows();
    scrollLongNames();
  };

  function drawHero(walks) {
    const km = document.getElementById('hero-km');
    const sub = document.getElementById('hero-sub');
    if (!walks.length) {
      sub.textContent = 'No walks yet. Your first one will start the profile.';
    } else {
      const total = walks.reduce((s, w) => s + (w.distance_km || 0), 0);
      const secs = walks.reduce((s, w) => s + (w.moving_time_sec || 0), 0);
      const steps = walks.reduce((s, w) => s + (w.steps_estimated || 0), 0);
      const hikes = walks.filter(w => w.type === 'Hike').length;
      const longest = walks.reduce((a, b) => ((b.distance_km || 0) > (a.distance_km || 0) ? b : a));
      const first = walks.map(w => w.date).sort()[0];
      const since = new Date(first + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const what = hikes ? `${walks.length - hikes} walks and ${hikes} ${hikes === 1 ? 'hike' : 'hikes'}` : `${walks.length} walks`;
      km.innerHTML = `${Math.round(total).toLocaleString('en-GB')}<span class="unit">km</span>`;
      sub.innerHTML = `${what}, ${formatDuration(secs)} on foot and about ${Math.round(steps / 1000)}k steps since ${since}. ` +
        `Longest so far: <b>${SeasonHero.esc(longest.name || 'a walk')}</b>, ${longest.distance_km} km.`;
    }
    SeasonHero.draw(document.getElementById('hero-profile'),
      [{ cls: 'walk', label: 'Walks', items: walks.map(w => ({ date: w.date, time: w.time, km: w.distance_km, name: w.name })) }],
      { animate: !animated, markLongest: true });
    animated = true;
  }

  // Columns button in the filter bar (js/column-picker.js).
  makeColumnPicker({ table: '#walk-table', mount: '#col-picker', storageKey: 'walkHiddenCols', keep: ['idx', 'date', 'name'] });
})();
