// Homepage extras for the "road book" design: the hero, showing rides and
// walks as two lines. The rest of the page comes from js/index.js.

(function () {
  const getJson = url => fetch(url).then(res => {
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  });
  const loadAll = (folder, key) => getJson(`${folder}/index.json`)
    .then(index => Promise.all((index.files || []).map(f => getJson(`${folder}/${f}`))))
    .then(months => months.flatMap(m => (Array.isArray(m[key]) ? m[key] : [])));

  const secsOf = s => String(s || '').split(':').map(Number).reduce((a, p) => a * 60 + p, 0);
  const hours = secs => {
    const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  };

  Promise.allSettled([loadAll('ride_data', 'rides'), loadAll('walk_data', 'walks')]).then(([r, w]) => {
    const rides = r.status === 'fulfilled' ? r.value : [];
    const walks = w.status === 'fulfilled' ? w.value : [];
    if (window.renderHomeGoals) renderHomeGoals(rides, walks);   // js/home-goals.js
    const km = document.getElementById('hero-km');
    const sub = document.getElementById('hero-sub');
    if (!rides.length && !walks.length) {
      sub.textContent = 'No activities loaded yet.';
      return;
    }
    const rideKm = rides.reduce((s, x) => s + (x.distance_km || 0), 0);
    const walkKm = walks.reduce((s, x) => s + (x.distance_km || 0), 0);
    const secs = rides.reduce((s, x) => s + secsOf(x.moving_time), 0) +
                 walks.reduce((s, x) => s + (x.moving_time_sec || secsOf(x.moving_time)), 0);
    km.innerHTML = `${Math.round(rideKm + walkKm).toLocaleString('en-GB')}<span class="unit">km</span>`;
    sub.innerHTML = `<b>${Math.round(rideKm).toLocaleString('en-GB')} km</b> on the bike across ${rides.length} rides, ` +
      `<b>${Math.round(walkKm).toLocaleString('en-GB')} km</b> on foot across ${walks.length} walks, ${hours(secs)} moving in total.`;

    SeasonHero.draw(document.getElementById('hero-profile'), [
      { cls: 'ride', label: 'Rides', items: rides.map(x => ({ date: x.date, time: x.time, km: x.distance_km, name: x.map_name })) },
      { cls: 'walk', label: 'Walks', items: walks.map(x => ({ date: x.date, time: x.time, km: x.distance_km, name: x.name })) },
    ], { animate: true });
  });
})();
