import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCandidates, createGame } from '../src/model.js';
import { useKitchen } from '../src/game.js';
import { preparation, screen, screenContext } from '../src/ui.js';
import { PREPARATION_ACTIONS, preparationCandidates } from '../src/benchmark.js';

// The human preparation sheet and the bench candidate list are separate
// vocabularies, so they drift silently. These tests fail when `screen()` gains
// an action that PREPARATION_ACTIONS does not classify, or when a declared
// bench candidate family stops being produced.

function fixture() {
  const g = createGame({ level: 8, stock: 10, duty: ['helper'] });
  g.cash = 50000;
  g.hired = ['helper', 'chef'];
  const state = {
    ...useKitchen.getState(),
    ready: true,
    game: g,
    phase: 'finished',
    cleared: true,
    applicants: ['runner', 'sous'],
    menuOpen: false,
    benchmark: false,
  };
  return { g, state };
}

test('every human preparation control is classified for bench', () => {
  const { g, state } = fixture();
  const actions = new Set();
  for (const [width, height] of [
    [1280, 720],
    [480, 800],
  ])
    for (const page of [0, 1, 2, 3])
      for (const equipmentIndex of [0, 1, 2, 3, 4])
        for (const layoutMode of ['equipment', 'layout'])
          for (const layoutSelection of [null, 'board'])
            for (const vitaminItem of [null, 'move']) {
              const view = {
                ...preparation(g),
                page,
                equipmentIndex,
                layoutMode,
                layoutSelection,
                vitaminItem,
              };
              for (const item of screen(state, view, width, height).items) {
                if (item.action && !item.inert) actions.add(item.action);
              }
            }
  for (const action of actions)
    assert.equal(typeof action, 'string', `screen() emitted a non-string action: ${action}`);
  assert.deepEqual([...actions].sort(), Object.keys(PREPARATION_ACTIONS).sort());
});

test('declared bench families are actually offered', () => {
  const { g, state } = fixture();
  const plan = {
    ...preparation(g),
    selected: 'runner',
    vitamins: [{ item: 'move', target: 'human' }],
  };
  const ids = preparationCandidates(state, plan).map((candidate) => candidate.id);
  const covered = (family) =>
    family.endsWith('_*')
      ? ids.some((id) => id.startsWith(family.slice(0, -1)))
      : ids.includes(family);
  for (const [action, coverage] of Object.entries(PREPARATION_ACTIONS)) {
    if (coverage.bench)
      assert.ok(covered(coverage.bench), `${action} -> ${coverage.bench} missing`);
    else assert.equal(typeof coverage.omitted, 'string');
  }
});

test('screenContext keeps a control id only when the actor can choose it', () => {
  const { g, state } = fixture();
  const cases = [
    { state, view: preparation(g), actions: preparationCandidates(state, preparation(g)) },
    {
      state: { ...state, phase: 'playing', cleared: false },
      view: preparation(g),
      actions: buildCandidates(g, 'human'),
    },
  ];
  for (const item of cases) {
    const choices = new Set(item.actions.map((candidate) => candidate.id));
    const controls = new Set(
      screen(item.state, item.view, 1280, 720)
        .items.filter((entry) => entry.action && !entry.inert)
        .map((entry) => entry.id),
    );
    for (const projected of screenContext(item.state, item.view, 1280, 720, choices).items) {
      if (projected.id && controls.has(projected.id))
        assert.ok(choices.has(projected.id), `${projected.id} exposed without a choice`);
    }
  }
});
