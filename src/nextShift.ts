/**
 * Pure shift-transition math, extracted from `game.js` `nextShift`.
 *
 * `nextShift` keeps the store, rollback history and UI side effects; both it and
 * the replay verifier share this function, so the ranked run and live play agree
 * on hiring, stock, duty and investment.
 */
import { STOCK_PRICE, resolveLayout, recommendedStock } from './model.ts';
import { levelConfig, quotaForLevel, MAX_LEVEL } from './progression.ts';
import { STAFF, nextStaffState, nextDuty, payroll, staffAvailable } from './staff.ts';
import { quoteEquipment } from './equipment.ts';
import { quoteVitamins } from './training.ts';
import type { EquipmentState, GameState, Layout, StaffState, TrainingState } from './types.ts';

export interface NextShiftOptions {
  applicants?: string[];
  applicantId?: string | null;
  buyStock?: number;
  assignedDuty?: string[];
  equipmentPurchases?: string[];
  layout?: unknown;
  vitamins?: unknown[];
}

export interface NextShiftParams {
  level: number;
  cash: number;
  stock: number;
  duty: string[];
  staffState: Record<string, StaffState>;
  hired: string[];
  equipment: EquipmentState;
  training: TrainingState;
  layout: Layout;
}

export function nextShiftParams(
  g: GameState,
  {
    applicants = [],
    applicantId = null,
    buyStock,
    assignedDuty,
    equipmentPurchases = [],
    layout,
    vitamins = [],
  }: NextShiftOptions = {},
): NextShiftParams | null {
  const currentLevel = Math.floor(Number(g.level) || 1);
  if (currentLevel >= MAX_LEVEL) return null;
  const nextLevel = currentLevel + 1;
  const selected =
    applicantId === null
      ? null
      : typeof applicantId === 'string' &&
          Object.hasOwn(STAFF, applicantId) &&
          applicants.includes(applicantId)
        ? STAFF[applicantId]
        : null;
  if (applicantId !== null && !selected) return null;
  const stock = Number.isFinite(g.stock) ? Math.max(0, Math.floor(g.stock as number)) : 0;
  const requiredStock = quotaForLevel(nextLevel);
  const purchased = buyStock === undefined ? recommendedStock(g) : buyStock;
  if (!Number.isInteger(purchased) || purchased < 0 || purchased > 99) return null;
  if (stock + purchased < requiredStock) return null;
  const hiringCost = selected ? Math.max(0, Number(selected.cost) || 0) : 0;
  const cash = Number.isFinite(g.cash) ? g.cash : 0;
  const staffState = nextStaffState(g);
  const hired = Object.keys(staffState);
  if (selected && applicantId && hired.includes(applicantId)) return null;
  if (selected && applicantId) {
    hired.push(applicantId);
    staffState[applicantId] = { worked: 0, rest: 0 };
  }
  const staffSlots = levelConfig(nextLevel).staffSlots;
  const availableDuty = nextDuty(g);
  const duty =
    assignedDuty ??
    (selected &&
    applicantId &&
    (!Number.isSafeInteger(staffSlots) || availableDuty.length < staffSlots)
      ? [...availableDuty, applicantId]
      : availableDuty);
  if (
    !Array.isArray(duty) ||
    (levelConfig(nextLevel).partner &&
      (duty.length !== 1 || duty[0] !== levelConfig(nextLevel).partner)) ||
    new Set(duty).size !== duty.length ||
    (Number.isSafeInteger(staffSlots) && duty.length > staffSlots) ||
    !duty.every(
      (id) => typeof id === 'string' && hired.includes(id) && staffAvailable(staffState, id),
    )
  )
    return null;
  const investment = quoteEquipment(g.equipment, equipmentPurchases, nextLevel);
  if (investment.error) return null;
  const nextLayout = resolveLayout(
    { level: nextLevel, equipment: investment.equipment },
    layout === undefined ? g.layout : layout,
  );
  if (!nextLayout) return null;
  const retainedTraining = Object.fromEntries(
    Object.entries(g.training).filter(([id]) => id === 'human' || hired.includes(id)),
  );
  const vitaminQuote = quoteVitamins(retainedTraining, vitamins, ['human', ...hired]);
  if (vitaminQuote.error) return null;
  const total =
    hiringCost + purchased * STOCK_PRICE + payroll(duty) + investment.cost + vitaminQuote.cost;
  if (total > cash) return null;
  return {
    level: nextLevel,
    cash: cash - total,
    stock: stock + purchased,
    duty,
    staffState,
    hired,
    equipment: investment.equipment,
    training: vitaminQuote.training,
    layout: nextLayout,
  };
}
