import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_TRAINING,
  TRAINING_STEP,
  VITAMINS,
  quoteVitamins,
  trainingLevel,
  trainingMultiplier,
  trainingState,
  validateTraining,
} from '../src/training.js';
import { CHOP_MS, createGame, interact } from '../src/model.js';

test('vitamin quotes raise one base ability per actor and price every purchase', () => {
  const targets = ['human', 'helper'];
  const quote = quoteVitamins(
    {},
    [
      { item: 'move', target: 'human' },
      { item: 'cook', target: 'helper' },
    ],
    targets,
  );
  assert.equal(quote.error, null);
  assert.equal(quote.cost, VITAMINS.move.cost + VITAMINS.cook.cost);
  assert.deepEqual(quote.training, {
    human: { move: 1, cook: 0 },
    helper: { move: 0, cook: 1 },
  });
});

test('vitamin quotes reject unknown items, unknown actors, and levels over the cap', () => {
  const targets = ['human', 'helper'];
  assert.match(quoteVitamins({}, [{ item: 'speed', target: 'human' }], targets).error, /不明/);
  assert.match(quoteVitamins({}, [{ item: 'move', target: 'runner' }], targets).error, /対象者/);
  assert.match(quoteVitamins({}, 'move', targets).error, /購入リスト/);
  const capped = { human: { move: MAX_TRAINING, cook: 0 } };
  assert.match(
    quoteVitamins(capped, [{ item: 'move', target: 'human' }], targets).error,
    /これ以上/,
  );
  const overflow = [
    { item: 'move', target: 'human' },
    { item: 'move', target: 'human' },
  ];
  const quote = quoteVitamins({ human: { move: MAX_TRAINING - 1, cook: 0 } }, overflow, targets);
  assert.match(quote.error, /これ以上/);
  assert.deepEqual(quote.training, { human: { move: MAX_TRAINING - 1, cook: 0 } });
});

test('training multipliers scale movement up and cooking down, clamping bad data', () => {
  assert.equal(trainingMultiplier(undefined, 'human', 'move'), 1);
  assert.equal(trainingMultiplier(undefined, 'human', 'cook'), 1);
  const training = { human: { move: 2, cook: 5 } };
  assert.equal(trainingMultiplier(training, 'human', 'move'), 1 + TRAINING_STEP * 2);
  assert.equal(trainingMultiplier(training, 'human', 'cook'), 1 - TRAINING_STEP * 5);
  assert.equal(
    trainingMultiplier({ human: { move: 99 } }, 'human', 'move'),
    1 + TRAINING_STEP * MAX_TRAINING,
  );
  assert.equal(trainingLevel({ human: { cook: -3 } }, 'human', 'cook'), 0);
  assert.deepEqual(trainingState(null), {});
  assert.deepEqual(trainingState({ human: { move: '2.9', cook: 9 } }), {
    human: { move: 2, cook: MAX_TRAINING },
  });
});

test('checkpoint training accepts only known actors and known abilities', () => {
  assert.deepEqual(validateTraining(undefined, ['helper']), {});
  assert.deepEqual(validateTraining({ human: { move: 1, cook: 2 } }, ['helper']), {
    human: { move: 1, cook: 2 },
  });
  assert.equal(validateTraining({ runner: { move: 1, cook: 0 } }, ['helper']), null);
  assert.equal(validateTraining({ human: { move: 1 } }, ['helper']), null);
  assert.equal(validateTraining({ human: { move: -1, cook: 0 } }, ['helper']), null);
  assert.equal(validateTraining({ human: { move: 0, cook: MAX_TRAINING + 1 } }, ['helper']), null);
  assert.equal(validateTraining({ human: { move: 1, cook: 0, extra: 1 } }, ['helper']), null);
});

test('a trained player chops faster while an untrained player keeps the base time', () => {
  const base = createGame({ level: 3, stock: 99 });
  base.human.carrying = 'tomato';
  interact(base, 'human', 'board');
  assert.equal(base.stations.board.duration, CHOP_MS);

  const trained = createGame({ level: 3, stock: 99, training: { human: { cook: 5 } } });
  trained.human.carrying = 'tomato';
  interact(trained, 'human', 'board');
  assert.equal(trained.stations.board.duration, Math.round(CHOP_MS * (1 - TRAINING_STEP * 5)));
});
