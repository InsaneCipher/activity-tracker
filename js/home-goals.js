// Homepage: how many weekly and yearly goals are done, under each log's card in
// "Pick a log". The goals come from js/goals-rides.js and js/goals-walks.js and
// are counted by js/goals.js, so they always match each log's Goals tab.
// js/home-ui.js calls renderHomeGoals once the rides and walks have loaded.

window.renderHomeGoals = function (rides, walks) {
  const configs = window.GOAL_CONFIGS || {};
  [['ride', rides, configs.rides], ['walk', walks, configs.walks]].forEach(([kind, items, c]) => {
    const box = document.getElementById(`${kind}-goals`);
    if (!box || !c || !window.goalSummary) return;
    const s = goalSummary(items, c);
    const chip = (hit, total, label, cls) => `
      <span class="cg-item ${cls}${hit === total ? ' all' : ''}">
        <span class="cg-ring">${ringSegments(hit, total)}</span>
        <span class="cg-text"><b>${hit}/${total}</b> ${label}</span>
      </span>`;
    box.innerHTML =
      chip(s.weekHit, s.weekTotal, 'weekly goals', 'week') +
      chip(s.yearHit, s.yearTotal, `${s.year} goals`, 'year');
    box.hidden = false;
  });
};
