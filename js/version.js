// Version number under every page's footer, linking to the changelog. The
// version is the newest entry in changelog.json, so the two always agree.

(function () {
  const foot = document.querySelector('footer.page-foot');
  if (!foot) return;
  fetch('changelog.json?v=' + Date.now().toString().slice(0, -5))   // re-checked every ~2 minutes
    .then(res => (res.ok ? res.json() : Promise.reject(res.status)))
    .then(log => {
      const latest = log.entries && log.entries[0];
      if (!latest) return;
      const link = document.createElement('a');
      link.className = 'version-link';
      link.href = 'changelog.html';
      link.textContent = `v${latest.version}`;
      link.title = 'See what changed in each version';
      // Its own line under the footer, so a page that rewrites the footer's
      // text (the homepage does) can't remove it.
      foot.insertAdjacentElement('afterend', link);
    })
    .catch(() => { /* no changelog: no version shown */ });
})();
