// Long names in a table slide to their end and back inside their cell, so they
// can be read without widening the column. Used by the Ride Log and Walk Log.
//
//   const scrollNames = makeNameScroller('#rides', 'table-view', rerender);
//   ...then call scrollNames() after the table rows are drawn.
//
// rerender() redraws the rows; it's called when the names need measuring
// again: once the web font has loaded (it's wider than the stand-in font),
// when the table's tab is opened (a hidden table can't be measured), and after
// the window is resized.

window.makeNameScroller = function (tbodySelector, viewId, rerender) {
  if (document.fonts) {
    document.fonts.ready.then(rerender);
    // fonts.ready can resolve before the font has even started loading, so also
    // re-measure whenever a font actually finishes loading.
    document.fonts.addEventListener('loadingdone', rerender);
    document.fonts.load('600 14px Archivo').then(rerender).catch(() => {});
  }
  const tab = document.querySelector(`.tab-btn[data-view="${viewId}"]`);
  if (tab) tab.addEventListener('click', () => requestAnimationFrame(rerender));
  let timer;
  window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(rerender, 200); });

  return function scrollLongNames() {
    const view = document.getElementById(viewId);
    if (view && !view.classList.contains('active')) return;
    document.querySelectorAll(`${tbodySelector} td.name`).forEach(td => {
      const label = td.querySelector('a') || td.lastChild;
      if (!label) return;
      // Room for the name: from where the name starts (after any bike icon or
      // flag in front of it) to the cell's right padding.
      const range = document.createRange();
      range.selectNodeContents(label);
      const textBox = range.getBoundingClientRect();
      const tdBox = td.getBoundingClientRect();
      const room = tdBox.right - parseFloat(getComputedStyle(td).paddingRight) - textBox.left;
      const textWidth = textBox.width;
      if (textWidth <= room + 0.5) return;   // fits: leave it alone

      const clip = document.createElement('span');
      const track = document.createElement('span');
      clip.className = 'name-clip';
      track.className = 'name-track';
      clip.style.width = `${Math.floor(room)}px`;
      td.insertBefore(clip, label);
      track.appendChild(label);
      clip.appendChild(track);
      const shift = Math.ceil(textWidth - room) + 4;
      track.style.setProperty('--shift', `-${shift}px`);
      track.style.setProperty('--dur', `${Math.max(6, shift / 12).toFixed(1)}s`);   // slow and steady
      td.classList.add('scrolling');
    });
  };
};
