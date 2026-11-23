// "Filters" button in the filter bar: shows or hides the filter fields, which
// start hidden. The row with the count, Show and Columns stays visible. When
// any filter is set, the button shows how many, so a hidden filter is never a
// surprise. Used by the Ride Log and Walk Log.

(function () {
  const bar = document.getElementById('filter-bar');
  const footer = bar && bar.querySelector('.f-footer');
  if (!footer) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'f-toggle';
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = 'Filters<span class="f-toggle-count"></span>';
  footer.insertBefore(btn, footer.firstChild);
  const count = btn.querySelector('.f-toggle-count');

  function setOpen(open) {
    bar.classList.toggle('collapsed', !open);
    btn.setAttribute('aria-expanded', String(open));
  }

  // How many filters are set: any field in the filter groups with a value.
  function updateCount() {
    const set = [...bar.querySelectorAll('.f-group input, .f-group select')].filter(el => el.value !== '');
    // A range (min/max, from/to) counts once.
    const groups = new Set(set.map(el => el.closest('.f-group')));
    count.textContent = groups.size || '';
  }

  btn.addEventListener('click', () => setOpen(bar.classList.contains('collapsed')));
  bar.addEventListener('input', updateCount);
  bar.addEventListener('change', updateCount);
  // The page's own Reset button clears the fields without firing input events.
  document.getElementById('f-reset')?.addEventListener('click', () => setTimeout(updateCount));

  setOpen(false);
  updateCount();
})();
