// "Columns" button in the filter bar: a small dropdown with a checkbox per table
// column, to hide the ones you don't need. Used by the Ride Log and Walk Log.
//
//   makeColumnPicker({ table: '#ride-table', mount: '#col-picker',
//                      storageKey: 'rideHiddenCols', keep: ['idx', 'date', 'route'] });
//
// Columns are named by the class on their <col> (col.date, col.km, ...); the
// labels come from the table's header row. `keep` columns are always shown.
// The choice is saved in this browser, so it sticks between visits.

window.makeColumnPicker = function ({ table, mount, storageKey, keep = [] }) {
  const tbl = document.querySelector(table);
  const host = document.querySelector(mount);
  if (!tbl || !host) return;

  const cols = [...tbl.querySelectorAll('colgroup col')];
  const heads = [...tbl.querySelectorAll('thead th')];
  const columns = cols.map((col, i) => ({
    name: col.classList[0],
    label: (heads[i] ? heads[i].textContent : col.classList[0]).trim(),
    n: i + 1,
  }));

  let hidden = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    hidden = new Set(saved.filter(name => columns.some(c => c.name === name) && !keep.includes(name)));
  } catch (e) { /* storage unavailable: start with everything shown */ }

  // Each column's share of the table width with everything shown, so the
  // table's minimum width can shrink as columns are hidden (less sideways
  // scrolling on a phone).
  const baseMin = parseFloat(getComputedStyle(tbl).minWidth) || 0;
  const widths = cols.map(c => c.getBoundingClientRect().width);
  const total = widths.reduce((a, b) => a + b, 0);

  const style = document.createElement('style');
  document.head.appendChild(style);

  // ---- The button and dropdown ----
  host.classList.add('col-picker');
  host.innerHTML = `
    <button type="button" class="col-picker-btn" aria-expanded="false" aria-haspopup="true">
      Columns<span class="col-picker-count"></span>
    </button>
    <div class="col-picker-panel" hidden>
      ${columns.filter(c => !keep.includes(c.name)).map(c => `
        <label class="col-picker-item">
          <input type="checkbox" value="${c.name}"> ${c.label}
        </label>`).join('')}
      <button type="button" class="col-picker-reset">Show all</button>
    </div>`;
  const btn = host.querySelector('.col-picker-btn');
  const panel = host.querySelector('.col-picker-panel');
  const count = host.querySelector('.col-picker-count');

  function apply() {
    const shown = columns.filter(c => !hidden.has(c.name));
    style.textContent = columns.filter(c => hidden.has(c.name)).map(c =>
      `${table} col:nth-child(${c.n}), ${table} tr > :nth-child(${c.n}){display:none;}`).join('\n');
    if (baseMin && total) {
      const share = shown.reduce((s, c) => s + widths[c.n - 1], 0) / total;
      tbl.style.minWidth = `${Math.round(baseMin * share)}px`;
    }
    panel.querySelectorAll('input').forEach(box => { box.checked = !hidden.has(box.value); });
    count.textContent = hidden.size || '';
    btn.classList.toggle('has-hidden', hidden.size > 0);   // swaps the dropdown arrow for the count
    btn.title = hidden.size ? `${hidden.size} column${hidden.size === 1 ? '' : 's'} hidden` : '';
    try { localStorage.setItem(storageKey, JSON.stringify([...hidden])); } catch (e) { /* not saved */ }
    // Cells changed width: let the long-name scroller measure again.
    window.dispatchEvent(new Event('resize'));
  }

  function open(yes) {
    panel.hidden = !yes;
    btn.setAttribute('aria-expanded', String(yes));
  }

  btn.addEventListener('click', () => open(panel.hidden));
  panel.addEventListener('change', e => {
    if (e.target.type !== 'checkbox') return;
    if (e.target.checked) hidden.delete(e.target.value); else hidden.add(e.target.value);
    apply();
  });
  host.querySelector('.col-picker-reset').addEventListener('click', () => { hidden.clear(); apply(); });
  document.addEventListener('click', e => { if (!host.contains(e.target)) open(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { open(false); btn.focus(); } });

  apply();
};
