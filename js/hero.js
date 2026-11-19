// The hero at the top of every page: your season drawn as a stage profile.
// Each activity type is a line of cumulative km over time. Used by
// rides-ui.js, walks-ui.js and home-ui.js.

window.SeasonHero = (function () {
  const WINDOW_DAYS = 365;   // the profile shows the last 12 months
  let last = null;           // last draw, repeated on resize

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const when = it => new Date(`${it.date}T${it.time || '12:00'}`).getTime();

  // series: [{ cls: 'ride' | 'walk', label: 'Rides', items: [{ date, time, km, name }] }]
  // options: { animate, markLongest }
  function draw(box, series, options = {}) {
    last = { box, series, options: { ...options, animate: false } };
    const W = box.clientWidth, H = box.clientHeight;
    const end = Date.now();
    const windowStart = end - WINDOW_DAYS * 86400000;
    const lines = series.map(s => ({
      ...s,
      items: s.items.filter(it => it.date && when(it) >= windowStart).sort((a, b) => when(a) - when(b)),
    })).filter(s => s.items.length);
    if (!lines.length || !W || !H) { box.innerHTML = ''; return; }

    const first = Math.min(...lines.map(s => when(s.items[0])));
    const start = first - 3 * 86400000;
    const maxKm = Math.max(...lines.map(s => s.items.reduce((t, it) => t + (it.km || 0), 0))) || 1;
    const top = 40, padR = 70;
    // The stats strip overlaps the bottom of the hero, so the baseline sits just above it.
    const totals = document.getElementById('totals');
    const overlap = totals ? Math.max(0, -parseFloat(getComputedStyle(totals).marginTop) || 0) : 0;
    const base = H - overlap - 10;
    const x = t => ((t - start) / (end - start)) * (W - padR);
    const y = km => base - (km / maxKm) * (base - top);

    let longest = null;
    const drawn = lines.map(s => {
      let cum = 0;
      const pts = [];
      s.items.forEach(it => {
        const px = x(when(it));
        pts.push([px, y(cum)]);
        cum += it.km || 0;
        pts.push([px + 2, y(cum)]);
        if (options.markLongest && (!longest || (it.km || 0) > (longest.it.km || 0))) longest = { it, px: px + 2, py: y(cum) };
      });
      pts.push([x(end), y(cum)]);
      const ridge = `M0,${base.toFixed(1)} ` + pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      return { ...s, cum, ridge, endY: y(cum) };
    }).sort((a, b) => b.cum - a.cum);   // biggest first, so its area sits behind

    // Filled band under the biggest line, running on to the right edge and down behind the stats strip.
    const lead = drawn[0];
    const area = `${lead.ridge} L${W},${lead.endY.toFixed(1)} L${W},${H} L0,${H} Z`;

    // Month boundaries, like kilometre markers on a road-book profile.
    const clashes = tx => longest && longest.py < top + 30 && tx > longest.px - 90 && tx < longest.px + 10;
    let ticks = '';
    const m = new Date(start); m.setDate(1); m.setMonth(m.getMonth() + 1); m.setHours(0, 0, 0, 0);
    for (; m.getTime() < end; m.setMonth(m.getMonth() + 1)) {
      const tx = x(m.getTime());
      const label = m.getMonth() === 0 ? m.getFullYear() : m.toLocaleDateString('en-GB', { month: 'short' });
      ticks += `<line class="tick" x1="${tx.toFixed(1)}" y1="${top - 10}" x2="${tx.toFixed(1)}" y2="${H}"/>` +
               (clashes(tx) ? '' : `<text class="tick-label" x="${(tx + 6).toFixed(1)}" y="${top - 2}">${label}</text>`);
    }

    const ex = x(end);
    const flag = `<line class="flag" x1="${ex}" y1="${lead.endY}" x2="${ex}" y2="${lead.endY - 30}"/>` +
                 `<path class="flag-cloth" d="M${ex},${lead.endY - 30} l18,5 l-18,5 z"/>`;
    const mark = longest
      ? `<circle class="marker" cx="${longest.px.toFixed(1)}" cy="${longest.py.toFixed(1)}" r="5"/>` +
        `<text class="marker-label" x="${(longest.px - 8).toFixed(1)}" y="${(longest.py - 12).toFixed(1)}" text-anchor="end">${longest.it.km} km</text>`
      : '';
    // With more than one line, name each one at its end.
    const labels = drawn.length > 1
      ? drawn.map(s => `<text class="series-label ${s.cls}" x="${(ex + 8).toFixed(1)}" y="${(s.endY + 4).toFixed(1)}">${esc(s.label)}</text>`).join('')
      : '';

    box.classList.remove('animate');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      ${ticks}
      <path class="area" d="${area}"/>
      ${drawn.map(s => `<path class="ridge ${s.cls || ''}" d="${s.ridge}"/>`).join('')}
      ${mark}${drawn.length > 1 ? labels : flag}
    </svg>`;

    if (options.animate) {
      box.querySelectorAll('.ridge').forEach(path => {
        const len = Math.ceil(path.getTotalLength());
        path.style.setProperty('--len', len);
        path.style.strokeDasharray = len;
        path.style.strokeDashoffset = len;
        path.addEventListener('animationend', () => { path.style.strokeDasharray = ''; path.style.strokeDashoffset = ''; }, { once: true });
      });
      requestAnimationFrame(() => box.classList.add('animate'));
    }
  }

  let timer;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (last) draw(last.box, last.series, last.options); }, 150);
  });

  return { draw, esc };
})();
