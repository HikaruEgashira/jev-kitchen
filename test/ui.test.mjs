import assert from 'node:assert/strict';
import test from 'node:test';
import { activeStationIds, createGame, layoutSlots, STATIONS } from '../src/model.js';
import { useKitchen, TUTORIAL_STEPS } from '../src/game.js';
import { compactControls, preparation, purchase, screen, screenContext } from '../src/ui.js';
import { STAFF } from '../src/staff.js';

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
  assert.match(playing.items.find((i) => i.id === 'roster').text, /ハル/);
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
          for (const page of [0, 1, 2, 3]) {
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
  const g = createGame({ level: 1, cash: 205 });
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

test('operation settings expose the background mode toggle and reflect its state', () => {
  for (const backgroundMode of [false, true]) {
    const s = {
      ...useKitchen.getState(),
      menuOpen: true,
      menuPage: 'controls',
      phase: 'paused',
      backgroundMode,
    };
    const ui = screen(s, preparation(s.game), 320, 568);
    const toggle = ui.items.find((item) => item.action === 'background');
    assert.ok(toggle);
    assert.equal(toggle.pressed, backgroundMode);
    assert.match(toggle.text, backgroundMode ? /オン/ : /オフ/);
    assert.ok([...toggle.text].length * toggle.size <= toggle.w - 8);
  }
  const settings = screen(
    { ...useKitchen.getState(), menuOpen: true, menuPage: 'settings', phase: 'paused' },
    preparation(useKitchen.getState().game),
    320,
    568,
  );
  assert.ok(!settings.items.some((item) => item.action === 'background'));
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

test('equipment page keeps pending investments, effects and controls within the sheet', () => {
  const game = createGame({ level: 14, cash: 1200, stock: 20 });
  const state = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: true,
    ready: true,
    applicants: ['veteran'],
  };
  const view = { ...preparation(game), page: 3, equipmentPurchases: ['add_board'] };
  const bill = purchase(game, view);
  assert.equal(bill.equipmentPurchases[0], 'add_board');
  assert.equal(bill.equipment.board.count, 2);
  assert.ok(bill.equipmentCost > 0);
  assert.equal(bill.cash, game.cash - bill.quantity * 8 - bill.wages - bill.equipmentCost);
  const recovered = purchase(game, {
    ...view,
    equipmentPurchases: [],
    layout: bill.layout,
  });
  assert.equal(recovered.error, '');
  assert.equal(recovered.layout.board2, undefined);
  for (const [width, height] of [
    [320, 568],
    [568, 320],
    [390, 844],
  ]) {
    const ui = screen(state, view, width, height);
    assert.ok(ui.items.find((item) => item.id === 'equipment-summary'));
    assert.ok(ui.items.find((item) => item.id === 'equipment-add-board')?.pressed);
    assert.ok(ui.items.find((item) => item.id === 'equipment-next'));
    const controls = ui.items.filter((item) => item.action && !item.inert);
    for (const control of controls) {
      assert.ok(control.w >= 44 && control.h >= 44, `${control.id} touch target`);
      assert.ok(
        control.x >= 0 &&
          control.y >= 0 &&
          control.x + control.w <= width &&
          control.y + control.h <= height,
        `${control.id} outside ${width}x${height}`,
      );
    }
  }
});

test('equipment placement uses named slots, swaps occupied stations, and stays tappable', () => {
  const game = createGame({ level: 20, cash: 2000, stock: 30 });
  const state = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: true,
    ready: true,
    applicants: [],
  };
  const baseView = { ...preparation(game), page: 3, layoutMode: 'layout' };
  const slots = layoutSlots(game);
  const targetSlot = Object.keys(slots).find((slot) => slot !== game.layout.board);
  for (const [width, height] of [
    [320, 568],
    [568, 320],
  ]) {
    const list = screen(state, baseView, width, height);
    assert.equal(list.items.find((item) => item.id === 'layout-mode').text, '設備');
    assert.ok(list.items.find((item) => item.id === 'layout-select-board'));
    const selected = screen(state, { ...baseView, layoutSelection: 'board' }, width, height);
    const destination = selected.items.find((item) => item.id === `layout-slot-${targetSlot}`);
    assert.ok(destination);
    assert.equal(destination.disabled, false);
    assert.ok(!destination.text.includes(targetSlot));
    const controls = selected.items.filter((item) => item.action && !item.inert);
    for (const control of controls) {
      assert.ok(control.w >= 44 && control.h >= 44, `${control.id} touch target`);
      assert.ok(
        control.x >= 0 &&
          control.y >= 0 &&
          control.x + control.w <= width &&
          control.y + control.h <= height,
        `${control.id} outside ${width}x${height}`,
      );
      for (const other of controls) {
        if (other === control) continue;
        assert.ok(
          control.x + control.w <= other.x ||
            other.x + other.w <= control.x ||
            control.y + control.h <= other.y ||
            other.y + other.h <= control.y,
          `${control.id} overlaps ${other.id}`,
        );
      }
    }
  }
  const warmer = screen(state, { ...preparation(game), page: 3, equipmentIndex: 1 }, 320, 568);
  assert.match(warmer.items.find((item) => item.id === 'equipment-summary').text, /設備枠/);
  const kitchen = screen(state, { ...preparation(game), page: 3, equipmentIndex: 2 }, 320, 568);
  assert.equal(
    kitchen.items.find((item) => item.id === 'equipment-add-kitchen'),
    undefined,
  );
  assert.ok(kitchen.items.find((item) => item.id === 'equipment-upgrade-kitchen'));
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
  assert.equal(ui.items.find((item) => item.id === 'review').text, '開店準備から見直す');
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
        for (const other of stations.slice(0, index))
          assert.ok(
            item.x + item.w <= other.x ||
              other.x + other.w <= item.x ||
              item.y + item.h <= other.y ||
              other.y + other.h <= item.y,
            `${item.id} overlaps ${other.id}`,
          );
      }
    }
    const maxEquipmentGame = createGame({
      level: 100,
      equipment: {
        board: { count: 2, level: 3 },
        pot: { count: 2, level: 3 },
        grill: { count: 2, level: 3 },
        warmer: { count: 1, level: 3 },
        kitchen: { count: 1, level: 3 },
      },
    });
    const maxStations = screen(
      {
        ...useKitchen.getState(),
        game: maxEquipmentGame,
        tutorial: null,
        phase: 'playing',
        ready: true,
      },
      preparation(maxEquipmentGame),
      width,
      height,
    ).items.filter((item) => item.action === 'station');
    assert.equal(
      maxStations.length,
      compactControls(width, height) ? activeStationIds(maxEquipmentGame).length : 0,
    );
    if (maxStations.length) {
      assert.ok(maxStations.every((item) => item.w >= 44 && item.h >= 44));
      for (const item of maxStations)
        assert.ok(item.x >= 0 && item.x + item.w <= width && item.y + item.h <= height);
    }
  }
});

test('candidate adoption uses a themed avatar and performance bars instead of raw stats', () => {
  const game = createGame({ level: 2, cash: 500, stock: 4, hired: ['helper', 'runner'] });
  const state = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: true,
    ready: true,
    applicants: ['chef'],
  };
  const ui = screen(state, { ...preparation(game), page: 1 }, 1440, 900);
  const avatar = ui.items.find((item) => item.id === 'applicant-avatar');
  assert.equal(avatar.kind, 'avatar');
  assert.equal(avatar.color, STAFF.chef.color);
  const bars = ui.items.filter(
    (item) => item.id.startsWith('applicant-bar-') && !item.id.endsWith('-label'),
  );
  assert.deepEqual(
    bars.map((bar) => bar.kind),
    ['bar', 'bar', 'bar', 'bar'],
  );
  assert.ok(bars.every((bar) => bar.ratio > 0 && bar.ratio <= 1));
  assert.ok(bars.every((bar) => bar.x >= 0 && bar.x + bar.w <= 1440));
  assert.ok(!ui.items.some((item) => (item.text ?? '').includes('速さ ×')));
  const roster = screen(state, { ...preparation(game), page: 2, selected: 'chef' }, 1440, 900);
  assert.equal(roster.items.find((item) => item.id === 'duty-chef').avatar, STAFF.chef.color);
});

test('preparation hint warns only when the stock is below the next quota', () => {
  const game = createGame({ level: 1, cash: 500 });
  const state = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: true,
    ready: true,
    applicants: ['chef'],
  };
  const view = preparation(game);
  const ui = screen(state, view, 1440, 900);
  assert.equal(ui.status, '');
  assert.equal(
    ui.items.find((item) => item.id === 'hint'),
    undefined,
  );
  const short = { ...view, page: 2, quantity: 0 };
  const shortUi = screen(state, short, 1440, 900);
  assert.equal(shortUi.status, 'あと9個の仕入れが必要');
  assert.equal(shortUi.items.find((item) => item.id === 'hint').text, shortUi.status);
  assert.equal(screenContext(state, short, 1440, 900).status, shortUi.status);
  assert.equal(screenContext(state, view, 1440, 900).status, null);
});

test('Lv3 hands the roster to Haru and a rare manager applicant can be rehired', () => {
  const g = createGame({ level: 3, stock: 11, cash: 2000 });
  const view = preparation(g);
  assert.deepEqual(view.duty, ['helper']);
  const bill = purchase(g, view);
  assert.ok(!Object.hasOwn(bill.staffState, 'veteran'));
  const base = {
    ...useKitchen.getState(),
    game: g,
    phase: 'finished',
    cleared: true,
    applicants: ['veteran'],
  };
  const ordinary = screen(base, { ...view, page: 2 }, 390, 844);
  assert.ok(!ordinary.items.some((i) => i.id === 'duty-veteran'));
  const rehiring = { ...view, page: 2, selected: 'veteran', duty: ['veteran'] };
  const rehireBill = purchase(g, rehiring);
  assert.equal(rehireBill.error, '');
  assert.equal(rehireBill.hiring, STAFF.veteran.cost);
  assert.equal(rehireBill.wages, STAFF.veteran.wage);
  const rehire = screen(base, rehiring, 390, 844);
  assert.equal(rehire.items.find((i) => i.id === 'duty-veteran').disabled, false);
});
