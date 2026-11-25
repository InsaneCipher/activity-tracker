// Changelog page: draws changelog.json, newest first.

(function () {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtDate = d => new Date(d + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const TYPES = { new: 'New', improved: 'Improved', fixed: 'Fixed' };

  fetch('changelog.json?v=' + Date.now().toString().slice(0, -5))
    .then(res => (res.ok ? res.json() : Promise.reject(res.status)))
    .then(log => {
      const entries = log.entries || [];
      const latest = entries[0];
      if (latest) {
        document.getElementById('cl-current').innerHTML =
          `Version <b>${esc(latest.version)}</b>, updated ${fmtDate(latest.date)}. ${entries.length} updates since ${fmtDate(entries[entries.length - 1].date)}.`;
      }
      document.getElementById('cl-list').innerHTML = entries.map(e => {
        const [major, minor, patch] = e.version.split('.').map(Number);
        const kind = minor === 0 && patch === 0 ? 'major' : patch === 0 ? 'minor' : 'patch';
        return `
          <article class="cl-entry ${kind}" id="v${esc(e.version)}">
            <div class="cl-side">
              <span class="cl-version">v${esc(e.version)}</span>
              <time datetime="${esc(e.date)}">${fmtDate(e.date)}</time>
            </div>
            <div class="cl-body">
              <h2>${esc(e.title)}</h2>
              <ul>${e.changes.map(c => `
                <li><span class="cl-tag ${esc(c.type)}">${TYPES[c.type] || esc(c.type)}</span><span>${esc(c.text)}</span></li>`).join('')}
              </ul>
            </div>
          </article>`;
      }).join('');
    })
    .catch(() => {
      document.getElementById('cl-list').innerHTML = '<div class="chart-empty">The changelog couldn\'t be loaded.</div>';
    });
})();
