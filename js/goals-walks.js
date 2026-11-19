// Walk Log goals. Shown on the Goals tab and in the hero badges; the drawing
// is done by js/goals.js. These are placeholders: change the targets to suit.

// ---- Weekly goals ----
// The targets, then what each goal measures.
const WALK_GOALS = { walks: 3, km: 25, hours: 5, steps: 40000 };

const WALK_GOAL_METRICS = [
  { key: 'walks', label: 'Walks',    unit: v => (v === 1 ? 'walk' : 'walks'), color: 'var(--ink)', get: () => 1, fmt: v => String(Math.round(v)) },
  { key: 'km',    label: 'Distance', unit: 'km',    color: 'var(--jersey)',  get: w => w.distance_km || 0,          fmt: v => String(+v.toFixed(v >= 100 ? 0 : 1)) },
  { key: 'hours', label: 'Time',     unit: 'h',     color: 'var(--speed)', get: w => (w.moving_time_sec || 0) / 3600, fmt: v => hoursText(v), noUnit: true },
  { key: 'steps', label: 'Steps',    unit: 'steps', color: 'var(--steps)', get: w => w.steps_estimated || 0,      fmt: v => Math.round(v).toLocaleString('en-GB') },
];

// ---- Year goals ----
// One list per year. `start` is when the goals begin: a date, or 'first' for
// the day of your first walk that year.

const WALK_GOALS_2026 = [
  { key: 'km',      label: 'Distance',      target: 500,     unit: 'km',    color: 'var(--jersey)',  get: w => w.distance_km || 0 },
  { key: 'hours',   label: 'Time',          target: 100,     unit: 'h',     color: 'var(--speed)', get: w => (w.moving_time_sec || 0) / 3600 },
  { key: 'elev',    label: 'Climbing',      target: 3000,    unit: 'm',     color: 'var(--kom)',   get: w => w.elevation_gain_m || 0 },
  { key: 'walks',   label: 'Walks',         target: 80,     unit: 'walks', color: 'var(--ink)',   count: () => true },
  { key: 'steps',   label: 'Steps',         target: 600000, unit: 'steps', color: 'var(--steps)', get: w => w.steps_estimated || 0 },
  { key: 'longest', label: 'Longest walk',  target: 20,      unit: 'km',    color: 'var(--pace)',  get: w => w.distance_km || 0, single: true },
  { key: 'long10',  label: '10 km+ walks',  target: 10,      unit: 'walks', color: 'var(--pace)',  count: w => (w.distance_km || 0) >= 10, noPace: true },
  { key: 'fast',    label: 'Sub-10:00 walks', target: 5,     unit: 'walks', color: 'var(--speed)',
    count: w => (w.distance_km || 0) >= 1 && (w.moving_time_sec || 0) / w.distance_km <= 600,
    noPace: true, note: 'Average pace of 10:00 /km or faster, on walks of 1 km or more' },
];

// 2027 goals: the same as 2026 for now.
const WALK_GOALS_2027 = [
  { key: 'km',      label: 'Distance',      target: 1500,     unit: 'km',    color: 'var(--jersey)',  get: w => w.distance_km || 0 },
  { key: 'hours',   label: 'Time',          target: 200,     unit: 'h',     color: 'var(--speed)', get: w => (w.moving_time_sec || 0) / 3600 },
  { key: 'elev',    label: 'Climbing',      target: 10000,    unit: 'm',     color: 'var(--kom)',   get: w => w.elevation_gain_m || 0 },
  { key: 'walks',   label: 'Walks',         target: 150,     unit: 'walks', color: 'var(--ink)',   count: () => true },
  { key: 'steps',   label: 'Steps',         target: 1500000, unit: 'steps', color: 'var(--steps)', get: w => w.steps_estimated || 0 },
  { key: 'longest', label: 'Longest walk',  target: 25,      unit: 'km',    color: 'var(--pace)',  get: w => w.distance_km || 0, single: true },
  { key: 'long10',  label: '10 km+ walks',  target: 30,      unit: 'walks', color: 'var(--pace)',  count: w => (w.distance_km || 0) >= 10, noPace: true },
  { key: 'fast',    label: 'Sub-10:00 walks', target: 20,     unit: 'walks', color: 'var(--speed)',
    count: w => (w.distance_km || 0) >= 1 && (w.moving_time_sec || 0) / w.distance_km <= 600,
    noPace: true, note: 'Average pace of 10:00 /km or faster, on walks of 1 km or more' },
];


const WALK_YEAR_GOALS = {
  2026: { start: 'first', goals: WALK_GOALS_2026 },
  2027: { start: '2027-01-01', goals: WALK_GOALS_2027 },
};

window.GOAL_CONFIG = {
  items: () => currentWalks,
  noun: { one: 'walk', many: 'walks' },
  nameOf: w => w.name || 'a walk',
  yearKey: 'walkGoalYear',
  weeklyTargets: WALK_GOALS,
  weeklyMetrics: WALK_GOAL_METRICS,
  years: WALK_YEAR_GOALS,
  hookTabs: true,
};

// Also listed by name, so the homepage can show both logs' goals.
(window.GOAL_CONFIGS ||= {}).walks = window.GOAL_CONFIG;
