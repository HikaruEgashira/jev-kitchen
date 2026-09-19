import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, STATIONS, activeStationIds } from '../src/model.js';
import { useKitchen, TUTORIAL_STEPS } from '../src/game.js';
import { preparation, purchase, screen } from '../src/ui.js';

test('title screen contains no playing HUD, orders, stock or staff', () => {
  const base = { ...useKitchen.getState(), phase: 'ready', ready: true };
  const ui = screen(base, preparation(base.game), 1440, 900);
  assert.equal(ui.items.find((i) => i.id === 'title').text, 'SIDEKICK');
  assert.ok(ui.items.find((i) => i.id === 'title').size >= 80);
  assert.equal(ui.items.find((i) => i.id === 'title').kind, 'title3d');
  assert.ok(!ui.items.some((i) => i.kind === 'veil'));
  assert.ok(ui.items.find((i) => i.id === 'sheet').y < 40);
  assert.ok(ui.items.find((i) => i.id === 'primary').y > 800);
  const mobile = screen(base, preparation(base.game), 320, 568);
  assert.ok(mobile.items.find((i) => i.id === 'title').size <= 38);
  assert.ok(
    !ui.items.some((i) => i.kind === 'food' || /shift|score|order|roster|stock/.test(i.id)),
  );
  const playing = screen({ ...base, phase: 'playing' }, preparation(base.game), 1440, 900);
  assert.ok(playing.items.some((i) => i.id === 'shift'));
  assert.ok(playing.items.some((i) => i.kind === 'food'));
  for (const id of ['score', 'roster']) {
    const text = playing.items.find((i) => i.id === id);
    const board = playing.items.find((i) => i.id === `${id}-board`);
    assert.ok(
      text.x >= board.x &&
        text.y >= board.y &&
        text.x + text.w <= board.x + board.w &&
        text.y + text.h <= board.y + board.h,
    );
  }
});

test('every sheet keeps distinct, reachable 44px controls in portrait and landscape', () => {
  const game = createGame({ level: 2, cash: 500, stock: 4, hired: ['helper', 'runner'] });
  const base = {
    ...useKitchen.getState(),
    game,
    ready: true,
    applicants: ['chef', 'sous', 'veteran'],
  };
  for (const [width, height] of [
    [320, 568],
    [568, 320],
    [844, 390],
    [390, 844],
    [768, 1024],
    [1440, 900],
  ]) {
    for (const phase of ['ready', 'playing', 'paused', 'finished']) {
      for (const cleared of [false, true]) {
        for (const menuPage of [null, 'settings', 'controls', 'help', 'diagnostics']) {
          for (const page of [0, 1, 2]) {
            const ui = screen(
              { ...base, phase, cleared, menuOpen: menuPage !== null, menuPage },
              { ...preparation(game), page },
              width,
              height,
            );
            assert.equal(new Set(ui.items.map((i) => i.id)).size, ui.items.length);
            const controls = ui.items.filter((i) => i.action && !i.inert);
            for (const c of controls) {
              assert.ok(c.w >= 44 && c.h >= 44, `${c.id} touch target`);
              assert.ok(
                c.x >= 0 && c.y >= 0 && c.x + c.w <= width && c.y + c.h <= height,
                `${c.id} outside ${width}x${height}`,
              );
            }
            for (let a = 0; a < controls.length; a++)
              for (let b = a + 1; b < controls.length; b++) {
                const l = controls[a],
                  r = controls[b];
                assert.ok(
                  l.x + l.w <= r.x || r.x + r.w <= l.x || l.y + l.h <= r.y || r.y + r.h <= l.y,
                  `${l.id} overlaps ${r.id} at ${width}x${height}`,
                );
              }
            if (ui.modal)
              assert.ok(ui.items.filter((i) => i.action && i.order < 4000).every((i) => i.inert));
          }
        }
      }
    }
  }
});

test('the stock field rejects incomplete, non-integer and unaffordable purchases', () => {
  const g = createGame({ level: 1, cash: 120 });
  const view = preparation(g);
  assert.equal(purchase(g, view).error, '');
  for (const quantity of ['', '-1', '1.5', '1e1', 'Infinity', 'NaN', '100', '99', 0]) {
    const invalid = { ...view, page: 2, quantity };
    assert.notEqual(purchase(g, invalid).error, '', String(quantity));
    const ui = screen(
      { ...useKitchen.getState(), game: g, phase: 'finished', cleared: true },
      invalid,
      320,
      568,
    );
    assert.equal(ui.items.find((i) => i.id === 'primary').disabled, true);
  }
  assert.match(purchase(g, { ...view, selected: 'veteran' }).error, /コイン/);
  assert.equal(purchase({ ...g, stock: 20 }, { ...view, quantity: 0 }).error, '');
});

test('camera settings expose the three modes as Three UI controls with matching semantics', () => {
  for (const mode of ['auto', 'follow', 'overview']) {
    const s = {
      ...useKitchen.getState(),
      menuOpen: true,
      menuPage: 'controls',
      phase: 'paused',
      cameraMode: mode,
      movementMode: 'grid',
    };
    const ui = screen(s, preparation(s.game), 320, 568);
    const controls = ui.items.filter((item) => item.action === 'camera');
    assert.deepEqual(
      controls.map((item) => item.value),
      ['auto', 'follow', 'overview'],
    );
    assert.deepEqual(
      controls.filter((item) => item.pressed).map((item) => item.value),
      [mode],
    );
    assert.ok(controls.every((item) => item.kind === 'button' && item.label.includes('カメラ')));
    assert.ok(controls.every((item) => [...item.text].length * item.size <= item.w - 8));
    const movement = ui.items.filter((item) => item.action === 'movement');
    assert.deepEqual(
      movement.map((item) => item.value),
      ['screen', 'grid'],
    );
    assert.deepEqual(
      movement.filter((item) => item.pressed).map((item) => item.value),
      ['grid'],
    );
  }
});

test('operation settings expose the away-pause toggle and reflect its state', () => {
  for (const pauseWhenAway of [false, true]) {
    const s = {
      ...useKitchen.getState(),
      menuOpen: true,
      menuPage: 'controls',
      phase: 'paused',
      pauseWhenAway,
    };
    const ui = screen(s, preparation(s.game), 320, 568);
    const toggle = ui.items.find((item) => item.action === 'away-pause');
    assert.ok(toggle);
    assert.equal(toggle.pressed, pauseWhenAway);
    assert.match(toggle.text, pauseWhenAway ? /オン/ : /オフ/);
    assert.ok([...toggle.text].length * toggle.size <= toggle.w - 8);
  }
  const settings = screen(
    { ...useKitchen.getState(), menuOpen: true, menuPage: 'settings', phase: 'paused' },
    preparation(useKitchen.getState().game),
    320,
    568,
  );
  assert.ok(!settings.items.some((item) => item.action === 'away-pause'));
});

test('preparation screen exposes multi-person duty selection and fatigue status', () => {
  const game = createGame({ level: 24, cash: 900, stock: 12, hired: ['helper', 'runner', 'chef'] });
  Object.assign(game, {
    duty: ['helper', 'runner'],
    staffState: {
      helper: { worked: 1, rest: 0 },
      runner: { worked: 0, rest: 1 },
      chef: { worked: 0, rest: 0 },
    },
  });
  const state = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: true,
    ready: true,
    applicants: ['veteran'],
  };
  const view = { ...preparation(game), page: 2, selected: 'veteran', duty: ['helper', 'runner'] };
  const ui = screen(state, view, 320, 568);
  assert.ok(ui.items.find((item) => item.id === 'duty-helper')?.pressed);
  assert.ok(ui.items.find((item) => item.id === 'duty-runner')?.pressed);
  assert.match(ui.items.find((item) => item.id === 'duty-runner').text, /あと2勤/);
  assert.ok(ui.items.find((item) => item.id === 'duty-chef'));
  assert.ok(ui.items.find((item) => item.id === 'duty-summary').text.includes('出勤'));
  assert.ok(ui.items.find((item) => item.id === 'quantity'));
  assert.equal(preparation(game, true).page, 1);
});

test('three order previews stay below the compact staff roster', () => {
  const game = createGame({
    level: 30,
    hired: ['helper', 'runner', 'chef'],
    duty: ['helper', 'runner', 'chef'],
  });
  game.orders.push({ id: 99, recipe: 'roast', deadline: 20_000, duration: 20_000 });
  const ui = screen(
    { ...useKitchen.getState(), game, phase: 'playing', ready: true, tutorial: null },
    preparation(game),
    768,
    390,
  );
  const roster = ui.items.find((item) => item.id === 'roster-board');
  const tickets = ui.items.filter((item) => item.id.startsWith('ticket-'));
  assert.equal(tickets.length, 3);
  assert.ok(tickets.every((item) => item.y >= roster.y + roster.h));
  assert.equal(roster.h, 42);
  assert.equal(ui.items.find((item) => item.id === 'roster').color, '#fff9e8');
  assert.equal(ui.items.find((item) => item.id === 'roster').text, 'ハル  ソラ\nナギ');
});

test('failed shift gives explicit recovery choices and gates previous level', () => {
  const game = createGame({ level: 2 });
  const state = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: false,
    ready: true,
    rollback: { preparation: {}, previous: { snapshot: { level: 1 } } },
  };
  const ui = screen(state, preparation(game), 320, 568);
  assert.equal(ui.items.find((item) => item.id === 'retry').text, '同じ条件で再挑戦');
  assert.equal(ui.items.find((item) => item.id === 'review').text, '仕入れ・採用から見直す');
  assert.equal(ui.items.find((item) => item.id === 'previous').disabled, false);
  assert.match(ui.items.find((item) => item.id === 'result').text, /資金・在庫・疲労/);
});

test('phone station buttons stay below the kitchen and respect onboarding restrictions', () => {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [568, 320],
    [844, 390],
  ]) {
    TUTORIAL_STEPS.forEach((step, tutorial) => {
      const game = createGame({ practice: true });
      Object.assign(game.human, {
        x: STATIONS[step.station].x,
        y: STATIONS[step.station].y,
        carrying: 'tomato',
      });
      const state = { ...useKitchen.getState(), game, tutorial, phase: 'playing', ready: true };
      const ui = screen(state, preparation(game), width, height);
      assert.equal(
        ui.items.find((i) => i.id === 'lesson-copy').text,
        `${STATIONS[step.station].name}をタップ`,
      );
      const action = ui.items.find((i) => i.id === 'interact');
      assert.equal(action.text, '作業する');
      assert.equal(action.disabled, false);
      assert.equal(ui.items.find((i) => i.id === 'clear').disabled, true);
      assert.ok(action.w >= 44 && action.h >= 44);
      const stations = ui.items.filter((i) => i.action === 'station');
      assert.deepEqual(
        stations.map((i) => i.value),
        activeStationIds(game),
      );
      assert.deepEqual(
        stations.filter((i) => !i.disabled).map((i) => i.value),
        [step.station],
      );
      assert.ok(stations.every((i) => i.y + i.h < action.y));
      const lesson = ui.items.find((i) => i.id === 'lesson');
      assert.ok(lesson.y + lesson.h < stations[0].y);
    });
    for (const level of [1, 2, 3, 100]) {
      const game = createGame({ level });
      const ui = screen(
        { ...useKitchen.getState(), game, tutorial: null, phase: 'playing', ready: true },
        preparation(game),
        width,
        height,
      );
      const stations = ui.items.filter((i) => i.action === 'station');
      assert.deepEqual(
        stations.map((i) => i.value),
        activeStationIds(game),
      );
      for (const [index, item] of stations.entries()) {
        assert.equal(item.disabled, false);
        assert.ok(item.w >= 44 && item.h >= 44);
        assert.ok(item.x >= 0 && item.x + item.w <= width);
        assert.ok([...item.text].length * item.size <= item.w - 8, `${item.id} label fits`);
        if (index) assert.ok(stations[index - 1].x + stations[index - 1].w <= item.x);
      }
    }
  }
});
