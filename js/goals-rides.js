// Ride Log goals. Shown on the Goals tab and in the hero badges; the drawing
// is done by js/goals.js.

// ---- Weekly goals ----
// The targets, then what each goal measures.
const GOALS = { rides: 3, km: 50, hours: 2.5, elev: 200, kcal: 1000 };

const GOAL_METRICS = [
  { key: 'rides', label: 'Rides',     unit: v => (v === 1 ? 'ride' : 'rides'), color: 'var(--power)', get: () => 1, fmt: v => String(Math.round(v)) },
  { key: 'km',    label: 'Distance',  unit: 'km',   color: 'var(--jersey)', get: r => r.distance_km || 0,              fmt: v => String(+v.toFixed(v >= 100 ? 0 : 1)) },
  { key: 'hours', label: 'Time',      unit: 'h',    color: 'var(--speed)',  get: r => parseDuration(r.moving_time) / 3600, fmt: v => hoursText(v), noUnit: true },
  { key: 'elev',  label: 'Climbing',  unit: 'm',    color: 'var(--kom)',    get: r => r.elevation_m || 0,              fmt: v => Math.round(v).toLocaleString('en-GB') },
  { key: 'kcal',  label: 'Calories',  unit: 'kcal', color: 'var(--burn)',   get: r => r.calories || 0,                 fmt: v => Math.round(v).toLocaleString('en-GB') },
];

// ---- Year goals ----
// One list per year. `start` is when the goals begin: a date, or 'first ride'
// for the day of your first ride that year.

const GOALS_2026 = [
  { key: 'km',      label: 'Distance',       target: 1000, unit: 'km', color: 'var(--jersey)', get: r => r.distance_km || 0 },
  { key: 'hours',   label: 'Time',           target: 50,   unit: 'h',  color: 'var(--speed)',  get: r => parseDuration(r.moving_time) / 3600 },
  { key: 'elev',    label: 'Climbing',       target: 4000, unit: 'm',  color: 'var(--kom)',    get: r => r.elevation_m || 0 },
  { key: 'rides',   label: 'Rides',          target: 60,   unit: 'rides', color: 'var(--ink)', count: () => true },
  { key: 'longest', label: 'Longest ride',   target: 100,  unit: 'km', color: 'var(--jersey)',  get: r => r.distance_km || 0, single: true },
  { key: 'long50',  label: '50 km+ rides',   target: 5,    unit: 'rides', color: 'var(--jersey)', count: r => (r.distance_km || 0) >= 50, noPace: true },
  { key: 'w150',    label: '150 W+ avg rides', target: 5,  unit: 'rides', color: 'var(--power)',
    count: r => (r.power_avg_w || 0) >= 150 && (r.distance_km || 0) > 10, note: 'Rides over 10 km', noPace: true },
  { key: 'w180',    label: 'Best avg power', target: 180,  unit: 'W',  color: 'var(--power)',  get: r => r.power_avg_w || 0, single: true, note: 'On any ride' },
];

// 2027 goals.
const GOALS_2027 = [
  { key: 'km',      label: 'Distance',       target: 3000, unit: 'km', color: 'var(--jersey)', get: r => r.distance_km || 0 },
  { key: 'hours',   label: 'Time',           target: 120,   unit: 'h',  color: 'var(--speed)',  get: r => parseDuration(r.moving_time) / 3600 },
  { key: 'elev',    label: 'Climbing',       target: 10000, unit: 'm',  color: 'var(--kom)',    get: r => r.elevation_m || 0 },
  { key: 'rides',   label: 'Rides',          target: 60,   unit: 'rides', color: 'var(--ink)', count: () => true },
  { key: 'longest', label: 'Longest ride',   target: 150,  unit: 'km', color: 'var(--jersey)',  get: r => r.distance_km || 0, single: true },
  { key: 'long50',  label: '50 km+ rides',   target: 15,    unit: 'rides', color: 'var(--jersey)', count: r => (r.distance_km || 0) >= 50, noPace: true },
  { key: 'w150',    label: '150 W+ avg rides', target: 20,  unit: 'rides', color: 'var(--power)',
    count: r => (r.power_avg_w || 0) >= 150 && (r.distance_km || 0) > 10, note: 'Rides over 10 km', noPace: true },
  { key: 'w180',    label: 'Best avg power', target: 200,  unit: 'W',  color: 'var(--power)',  get: r => r.power_avg_w || 0, single: true, note: 'On any ride' },
];

const RIDE_YEAR_GOALS = {
  2026: { start: 'first ride', goals: GOALS_2026 },
  2027: { start: '2027-01-01', goals: GOALS_2027 },
};

window.GOAL_CONFIG = {
  items: () => currentRides,
  noun: { one: 'ride', many: 'rides' },
  nameOf: r => routeOf(r),
  yearKey: 'rideGoalYear',
  weeklyTargets: GOALS,
  weeklyMetrics: GOAL_METRICS,
  years: RIDE_YEAR_GOALS,
};

// Also listed by name, so the homepage can show both logs' goals.
(window.GOAL_CONFIGS ||= {}).rides = window.GOAL_CONFIG;
