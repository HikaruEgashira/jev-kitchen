import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_EQUIPMENT,
  EQUIPMENT,
  equipmentBurnMultiplier,
  equipmentCapacity,
  equipmentDurationMultiplier,
  equipmentState,
  quoteEquipment,
  stationKind,
  validateEquipment,
  investmentCost,
} from '../src/equipment.js';
import { STAFF } from '../src/staff.js';
import { RECIPES, STOCK_PRICE, levelConfig } from '../src/model.js';

test('capital prices require saving while preserving affordable opening supplies', () => {
  const surplus =
    levelConfig(2).quota * (RECIPES.dish.points / 4 - STOCK_PRICE) - STAFF.helper.wage;
  assert.equal(investmentCost(1), surplus);
  assert.equal(EQUIPMENT.board.addCost, surplus * 3);
  assert.deepEqual(EQUIPMENT.kitchen.upgradeCosts, [surplus * 8, surplus * 12]);
  assert.ok(
    Math.min(
      ...Object.values(STAFF)
        .filter((s) => s.cost)
        .map((s) => s.cost),
    ) >=
      surplus * 3,
  );
  assert.equal(STAFF.veteran.cost, surplus * 16);
  const openingCash = 120 - STAFF.helper.wage + (levelConfig(1).quota * RECIPES.dish.points) / 4;
  const nextOpening = (levelConfig(2).quota + 2) * STOCK_PRICE + STAFF.helper.wage;
  assert.ok(openingCash >= nextOpening + EQUIPMENT.board.upgradeCosts[0]);
  assert.ok(openingCash < nextOpening + EQUIPMENT.board.addCost);
  assert.ok(openingCash < nextOpening + STAFF.prep.cost);
});

test('the catalog preserves the automatic station unlocks and investment gates', () => {
  assert.deepEqual(DEFAULT_EQUIPMENT, {
    board: { count: 1, level: 1 },
    pot: { count: 1, level: 1 },
    grill: { count: 1, level: 1 },
    warmer: { count: 0, level: 1 },
    kitchen: { count: 1, level: 1 },
  });
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(EQUIPMENT).map(([kind, item]) => [kind, [item.name, item.unlockLevel]]),
    ),
    {
      board: ['まな板', 1],
      pot: ['スープ鍋', 5],
      grill: ['グリル', 10],
      warmer: ['保温台', 20],
      kitchen: ['厨房拡張', 1],
    },
  );
  assert.equal(EQUIPMENT.board.addUnlockLevel, 2);
  assert.equal(EQUIPMENT.pot.addUnlockLevel, 10);
  assert.equal(EQUIPMENT.grill.addUnlockLevel, 15);
  assert.equal(EQUIPMENT.warmer.addUnlockLevel, 20);
  assert.equal(EQUIPMENT.warmer.maxCount, 1);
  assert.equal(EQUIPMENT.kitchen.upgradeUnlockLevel, 2);
  assert.ok(Object.values(EQUIPMENT).every((item) => item.unlockLevel <= 30));
});

test('equipmentState fills and clamps createGame-compatible state without mutating input', () => {
  const source = {
    board: { count: 0, level: 9 },
    pot: { count: '2.8', level: '2.2' },
    unknown: { count: 99, level: 99 },
  };
  const state = equipmentState(source);
  assert.deepEqual(state, {
    board: { count: 1, level: 3 },
    pot: { count: 2, level: 2 },
    grill: { count: 1, level: 1 },
    warmer: { count: 0, level: 1 },
    kitchen: { count: 1, level: 1 },
  });
  assert.deepEqual(source, {
    board: { count: 0, level: 9 },
    pot: { count: '2.8', level: '2.2' },
    unknown: { count: 99, level: 99 },
  });
  assert.deepEqual(equipmentState(), DEFAULT_EQUIPMENT);
  assert.deepEqual(equipmentState(null), DEFAULT_EQUIPMENT);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.board), true);
});

test('validateEquipment is strict and optionally enforces level unlocks', () => {
  assert.equal(validateEquipment(DEFAULT_EQUIPMENT), true);
  assert.equal(validateEquipment(DEFAULT_EQUIPMENT, 1), true);
  assert.equal(validateEquipment(DEFAULT_EQUIPMENT, 100), true);
  assert.equal(validateEquipment(null), false);
  assert.equal(validateEquipment(undefined), false);
  assert.equal(validateEquipment([]), false);
  assert.equal(validateEquipment({ ...DEFAULT_EQUIPMENT, extra: true }), false);
  assert.equal(
    validateEquipment({ ...DEFAULT_EQUIPMENT, board: { count: 1, level: 1, extra: 0 } }),
    false,
  );
  assert.equal(
    validateEquipment({ ...DEFAULT_EQUIPMENT, board: { count: 2, level: 1 } }, 1),
    false,
  );
  assert.equal(validateEquipment({ ...DEFAULT_EQUIPMENT, board: { count: 2, level: 1 } }, 2), true);
  assert.equal(validateEquipment({ ...DEFAULT_EQUIPMENT, pot: { count: 1, level: 2 } }, 4), false);
  assert.equal(validateEquipment({ ...DEFAULT_EQUIPMENT, pot: { count: 1, level: 2 } }, 5), true);
  assert.equal(
    validateEquipment({ ...DEFAULT_EQUIPMENT, grill: { count: 2, level: 1 } }, 10),
    false,
  );
  assert.equal(
    validateEquipment({ ...DEFAULT_EQUIPMENT, grill: { count: 2, level: 1 } }, 15),
    true,
  );
  assert.equal(
    validateEquipment({ ...DEFAULT_EQUIPMENT, warmer: { count: 1, level: 1 } }, 19),
    false,
  );
  assert.equal(
    validateEquipment({ ...DEFAULT_EQUIPMENT, warmer: { count: 1, level: 1 } }, 20),
    true,
  );
  assert.equal(
    validateEquipment({ ...DEFAULT_EQUIPMENT, warmer: { count: 0, level: 2 } }, 20),
    false,
  );
  assert.equal(
    validateEquipment({ ...DEFAULT_EQUIPMENT, kitchen: { count: 1, level: 2 } }, 1),
    false,
  );
  assert.equal(
    validateEquipment({ ...DEFAULT_EQUIPMENT, kitchen: { count: 1, level: 2 } }, 2),
    true,
  );
  assert.equal(
    validateEquipment(
      {
        ...DEFAULT_EQUIPMENT,
        board: { count: 2, level: 1 },
        pot: { count: 2, level: 1 },
      },
      10,
    ),
    false,
  );
  assert.equal(
    validateEquipment(
      {
        ...DEFAULT_EQUIPMENT,
        board: { count: 2, level: 1 },
        pot: { count: 2, level: 1 },
        kitchen: { count: 1, level: 2 },
      },
      10,
    ),
    true,
  );
});

test('one shared equipment level shortens only that station by 8% per upgrade', () => {
  assert.equal(equipmentDurationMultiplier(DEFAULT_EQUIPMENT, 'board'), 1);
  assert.equal(
    equipmentDurationMultiplier({ ...DEFAULT_EQUIPMENT, board: { count: 2, level: 2 } }, 'board'),
    0.92,
  );
  assert.equal(
    equipmentDurationMultiplier({ ...DEFAULT_EQUIPMENT, pot: { count: 2, level: 3 } }, 'pot'),
    0.84,
  );
  assert.equal(equipmentDurationMultiplier(DEFAULT_EQUIPMENT, 'unknown'), 1);
  assert.equal(
    equipmentDurationMultiplier({ ...DEFAULT_EQUIPMENT, warmer: { count: 1, level: 3 } }, 'warmer'),
    1,
  );
});

test('warmer changes only the post-cook burn grace window', () => {
  assert.equal(equipmentBurnMultiplier(DEFAULT_EQUIPMENT), 1);
  assert.equal(
    equipmentBurnMultiplier({ ...DEFAULT_EQUIPMENT, warmer: { count: 1, level: 1 } }),
    1.5,
  );
  assert.equal(
    equipmentBurnMultiplier({ ...DEFAULT_EQUIPMENT, warmer: { count: 1, level: 2 } }),
    1.75,
  );
  assert.equal(
    equipmentBurnMultiplier({ ...DEFAULT_EQUIPMENT, warmer: { count: 1, level: 3 } }),
    2,
  );
  assert.deepEqual(equipmentCapacity(DEFAULT_EQUIPMENT), { used: 0, limit: 1 });
  assert.deepEqual(
    equipmentCapacity({
      ...DEFAULT_EQUIPMENT,
      board: { count: 2, level: 1 },
      warmer: { count: 1, level: 1 },
      kitchen: { count: 1, level: 2 },
    }),
    { used: 2, limit: 2 },
  );
  assert.equal(stationKind('board2'), 'board');
  assert.equal(stationKind('pot'), 'pot');
  assert.equal(stationKind('plates'), 'plates');
});

test('quoteEquipment applies valid repeated purchases atomically and non-destructively', () => {
  const current = equipmentState();
  const board = quoteEquipment(current, ['add_board', 'upgrade_board', 'upgrade_board'], 2);
  assert.equal(board.error, null);
  assert.equal(
    board.cost,
    EQUIPMENT.board.addCost + EQUIPMENT.board.upgradeCosts.reduce((a, b) => a + b),
  );
  assert.deepEqual(board.equipment.board, { count: 2, level: 3 });
  assert.deepEqual(current, DEFAULT_EQUIPMENT);

  const pot = quoteEquipment(current, ['upgrade_pot'], 5);
  assert.equal(pot.error, null);
  assert.equal(pot.cost, EQUIPMENT.pot.upgradeCosts[0]);
  assert.deepEqual(pot.equipment.pot, { count: 1, level: 2 });

  const grill = quoteEquipment(current, ['add_grill'], 15);
  assert.equal(grill.error, null);
  assert.equal(grill.cost, EQUIPMENT.grill.addCost);
  assert.deepEqual(grill.equipment.grill, { count: 2, level: 1 });

  const warmer = quoteEquipment(current, ['add_warmer', 'upgrade_warmer'], 20);
  assert.equal(warmer.error, null);
  assert.equal(warmer.cost, EQUIPMENT.warmer.addCost + EQUIPMENT.warmer.upgradeCosts[0]);
  assert.deepEqual(warmer.equipment.warmer, { count: 1, level: 2 });

  const kitchen = quoteEquipment(current, ['upgrade_kitchen', 'add_board', 'add_pot'], 10);
  assert.equal(kitchen.error, null);
  assert.equal(
    kitchen.cost,
    EQUIPMENT.kitchen.upgradeCosts[0] + EQUIPMENT.board.addCost + EQUIPMENT.pot.addCost,
  );
  assert.deepEqual(
    quoteEquipment(current, ['add_board', 'add_pot', 'upgrade_kitchen'], 10),
    kitchen,
  );
  assert.deepEqual(kitchen.equipment.kitchen, { count: 1, level: 2 });
  assert.deepEqual(kitchen.equipment.board, { count: 2, level: 1 });
  assert.deepEqual(kitchen.equipment.pot, { count: 2, level: 1 });
});

test('quoteEquipment rejects locked, capped, malformed, and partially valid purchases atomically', () => {
  const current = equipmentState();
  for (const [purchases, level] of [
    [['upgrade_board'], 1],
    [['add_pot'], 5],
    [['add_grill'], 10],
    [['add_warmer'], 19],
    [['upgrade_warmer'], 20],
    [['upgrade_kitchen'], 1],
    [['add_board', 'add_board'], 2],
    [['upgrade_board', 'upgrade_board', 'upgrade_board'], 2],
    [['discard_money'], 2],
  ]) {
    const quote = quoteEquipment(current, purchases, level);
    assert.equal(quote.cost, 0);
    assert.equal(typeof quote.error, 'string');
    assert.deepEqual(quote.equipment, current);
  }
  assert.equal(quoteEquipment(current, 'add_board', 2).error, '設備購入リストが不正です');
  assert.equal(quoteEquipment(current, [], 1.5).error, '次のレベルが不正です');
  assert.equal(quoteEquipment(current, [], 31).error, null);
});
