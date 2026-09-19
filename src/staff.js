import { levelConfig } from './progression.js';
import { investmentCost } from './equipment.js';

// Staff profiles keep movement, capabilities, payroll, and fatigue in one table.
export const STAFF = Object.freeze({
  helper: {
    name: '見習いのハル',
    icon: '🐣',
    color: '#f0b03b',
    role: 'allrounder',
    description: '切る・盛る担当。煮る・焼くはあなた。',
    capabilities: ['prep', 'serve'],
    canDash: false,
    employment: 'アルバイト',
    wage: 12,
    maxConsecutive: 4,
    restShifts: 1,
    cost: 0,
    decisionMs: 1800,
    speed: 1,
    chop: 1,
    cook: 1,
  },
  runner: {
    name: '配膳係のソラ',
    icon: '⚡',
    color: '#4f9fd8',
    role: 'runner',
    description: '運搬と盛り付け専門。足が速い。',
    capabilities: ['serve'],
    canDash: false,
    employment: 'アルバイト',
    wage: 20,
    maxConsecutive: 2,
    restShifts: 1,
    cost: investmentCost(4),
    decisionMs: 1400,
    speed: 1.18,
    chop: 1.15,
    cook: 1,
  },
  chef: {
    name: '料理人のナギ',
    icon: '🔪',
    color: '#d1583c',
    role: 'chef',
    description: '仕込みと加熱専門。配膳はしない。',
    capabilities: ['prep', 'cook'],
    canDash: false,
    employment: '正社員',
    wage: 45,
    maxConsecutive: 3,
    restShifts: 2,
    cost: investmentCost(7),
    decisionMs: 900,
    speed: 0.9,
    chop: 0.55,
    cook: 0.75,
  },
  sous: {
    name: '副料理長のリン',
    icon: '⏱️',
    color: '#3f9e7d',
    role: 'expediter',
    description: '全工程に対応。締切を優先。',
    capabilities: ['prep', 'cook', 'serve'],
    canDash: false,
    employment: '正社員',
    wage: 60,
    maxConsecutive: 2,
    restShifts: 2,
    cost: investmentCost(10),
    decisionMs: 500,
    speed: 1.05,
    chop: 0.8,
    cook: 0.9,
  },
  prep: {
    name: '仕込み係のミオ',
    icon: '🥬',
    color: '#8cbf4d',
    role: 'chef',
    description: '切る専門。手際がいい。',
    capabilities: ['prep'],
    canDash: false,
    employment: 'アルバイト',
    wage: 16,
    maxConsecutive: 3,
    restShifts: 1,
    cost: investmentCost(3),
    decisionMs: 2000,
    speed: 1,
    chop: 0.55,
    cook: 1,
  },
  sprinter: {
    name: '特急配膳のレオ',
    icon: '💨',
    color: '#e08a3c',
    role: 'runner',
    description: '配膳専門。ダッシュで届ける。',
    capabilities: ['serve'],
    canDash: true,
    employment: 'アルバイト',
    wage: 32,
    maxConsecutive: 2,
    restShifts: 1,
    cost: investmentCost(8),
    decisionMs: 1200,
    speed: 1.2,
    chop: 1,
    cook: 1,
  },
  veteran: {
    name: '店長のアオ',
    icon: '🌟',
    color: '#8b6bd6',
    role: 'expediter',
    description: '全工程とダッシュ。Lv3で退職。その後の応募率は1%。',
    capabilities: ['prep', 'cook', 'serve'],
    canDash: true,
    employment: '正社員',
    wage: 85,
    maxConsecutive: 2,
    restShifts: 2,
    cost: investmentCost(16),
    decisionMs: 300,
    speed: 1.15,
    chop: 0.75,
    cook: 0.8,
  },
});

function staffStateOf(g, id) {
  const state = g.staffState?.[id];
  return {
    worked: Number.isSafeInteger(state?.worked) && state.worked >= 0 ? state.worked : 0,
    rest: Number.isSafeInteger(state?.rest) && state.rest >= 0 ? state.rest : 0,
  };
}
export function staffAvailable(state, id) {
  return Object.hasOwn(STAFF, id) && state?.[id]?.rest === 0;
}

export function payroll(duty) {
  return [...new Set(Array.isArray(duty) ? duty : [])].reduce(
    (total, id) => total + (STAFF[id]?.wage ?? 0),
    0,
  );
}

export function nextStaffState(g) {
  const duty = new Set(Array.isArray(g.duty) ? g.duty : []);
  return Object.fromEntries(
    [...new Set([...(g.hired ?? []), levelConfig(g.level + 1).partner].filter(Boolean))]
      .filter((id) => Object.hasOwn(STAFF, id) && !(g.level === 3 && id === 'veteran'))
      .map((id) => {
        if (!levelConfig(g.level).fatigueEnabled) return [id, { worked: 0, rest: 0 }];
        const profile = STAFF[id];
        const current = staffStateOf(g, id);
        if (current.rest > 0) return [id, { worked: 0, rest: Math.max(0, current.rest - 1) }];
        if (!duty.has(id)) return [id, { worked: 0, rest: Math.max(0, current.rest - 1) }];
        const worked = current.worked + 1;
        return worked >= profile.maxConsecutive
          ? [id, { worked: 0, rest: profile.restShifts }]
          : [id, { worked, rest: 0 }];
      }),
  );
}

export function nextDuty(g) {
  const config = levelConfig(g.level + 1);
  if (config.partner) return [config.partner];
  const state = nextStaffState(g);
  const duty = g.duty.filter((id) => staffAvailable(state, id));
  return g.level === 3 && !duty.length ? ['helper'] : duty;
}

// Relative strengths for the hiring screen. Higher ratio is always better, so
// slower decisions and chop/cook time multipliers invert before normalizing.
const PERFORMANCE = Object.freeze([
  { key: 'speed', label: '速さ', read: (p) => p.speed, higher: true },
  { key: 'decision', label: '判断', read: (p) => p.decisionMs, higher: false },
  { key: 'chop', label: '仕込み', read: (p) => p.chop, higher: false },
  { key: 'cook', label: '加熱', read: (p) => p.cook, higher: false },
]);
const PERFORMANCE_RANGE = Object.freeze(
  Object.fromEntries(
    PERFORMANCE.map(({ key, read }) => {
      const values = Object.values(STAFF).map(read);
      return [key, { min: Math.min(...values), max: Math.max(...values) }];
    }),
  ),
);

export function staffPerformance(id) {
  const profile = STAFF[id];
  if (!profile) return [];
  return PERFORMANCE.map(({ key, label, read, higher }) => {
    const { min, max } = PERFORMANCE_RANGE[key];
    const value = read(profile);
    const relative =
      max === min ? 1 : higher ? (value - min) / (max - min) : (max - value) / (max - min);
    return { key, label, ratio: 0.15 + 0.85 * relative };
  });
}
