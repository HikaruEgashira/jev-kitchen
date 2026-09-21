import assert from 'node:assert/strict';
import test from 'node:test';

test('stage picker pages all saved stages and mobile buttons have matching 3D icons', () => {
  const base = useKitchen.getState();
  const stages: Record<string, Checkpoint> = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [i + 1, {} as Checkpoint]),
  );
  for (const [width, height] of [
    [320, 568],
    [568, 320],
    [390, 844],
  ]) {
    const seen = [];
    for (let stagePage = 0; stagePage < 17; stagePage++) {
      const ui = screen(
        { ...base, ready: true, stages, menuOpen: true, menuPage: 'stages' },
        { ...preparation(base.game), stagePage },
        width,
        height,
      );
      const buttons = ui.items.filter((i) => i.action && !i.inert);
      seen.push(...buttons.filter((i) => i.action === 'restore-stage').map((i) => i.value));
      for (const b of buttons) {
        assert.ok(b.w >= 44 && b.h >= 44);
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= width && b.y + b.h <= height);
        for (const other of buttons.filter((i) => i !== b))
          assert.ok(
            b.x + b.w <= other.x ||
              other.x + other.w <= b.x ||
              b.y + b.h <= other.y ||
              other.y + other.h <= b.y,
          );
      }
    }
    assert.deepEqual(
      seen,
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
  }
  const ui = screen(
    { ...base, ready: true, phase: 'playing', tutorial: null },
    preparation(base.game),
    390,
    844,
  );
  for (const b of ui.items.filter((i) => i.action === 'station')) {
    assert.equal(b.icon, b.value);
    assert.equal(b.h, 64);
  }
});
import { activeStationIds, createGame, layoutSlots, STATIONS } from '../src/model.ts';
import { useKitchen, TUTORIAL_STEPS } from '../src/game.ts';
import { benchRequest, preparationCandidates } from '../src/benchmark.ts';
import {
  compactControls,
  preparation,
  purchase,
  screen as screenBase,
  screenContext,
  preparationAdvice,
  staffingOutlook,
  editPreparation,
} from '../src/ui.ts';
import type { Checkpoint, RecipeId, ScreenItem, StoreState, ViewState } from '../src/types.ts';

type ScreenItems = Omit<ScreenItem[], 'find'> & {
  find(predicate: (value: ScreenItem, index: number, obj: ScreenItem[]) => boolean): ScreenItem;
};

// Tests assume the referenced ids exist, so keep that guarantee in the type.
const screen = (...args: Parameters<typeof screenBase>) =>
  screenBase(...args) as {
    items: ScreenItems;
    modal: string | null;
    title: string;
    status: string;
  };

test('hiring previews share the remaining stock and payroll budget with Jev', () => {
  const game = createGame({
    level: 4,
    cash: 200,
    stock: 5,
    hired: ['helper', 'chef'],
    duty: ['chef'],
  });
  const state: StoreState = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: true,
    applicants: ['runner'],
    menuOpen: false,
  };
  const view: ViewState = { ...preparation(game), page: 1, stage: 'hiring' };
  const balance = purchase(game, { ...view, selected: 'runner' }).cash;
  assert.ok(balance < 0, 'legal hiring can require changes to stock or duty');
  const preview = screen(state, view, 390, 844).items.find(
    (i) => i.id === 'applicant-details',
  ).text!;
  const candidate = preparationCandidates(state, view).find((c) => c.id === 'hire_runner')!;
  assert.ok(preview.includes(`予定残金 ${balance}`));
  assert.ok(candidate.label.includes(`予定残金${balance}コイン`));
  assert.ok(preparationCandidates(state, view).some((c) => c.id === 'skip_hiring'));
});

test('staffing forecasts show the following shift without choosing the roster', () => {
  const game = createGame({
    level: 20,
    cash: 2000,
    stock: 30,
    hired: ['helper', 'chef', 'runner', 'prep', 'sprinter', 'sous'],
    duty: ['chef', 'runner', 'sprinter', 'sous'],
    staffState: { chef: { worked: 1, rest: 0 }, sous: { worked: 1, rest: 0 } },
  });
  const state: StoreState = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: true,
    applicants: [],
  };
  const plan: ViewState = { ...preparation(game), stage: 'staffing' };
  const candidates = preparationCandidates(state, plan);
  for (const [id, expected] of [
    ['crew_chef_runner_prep_sprinter', '翌営業に出勤できる相棒2人・加熱担当0人'],
    ['crew_helper_runner_prep_sprinter', '翌営業に出勤できる相棒3人・加熱担当1人'],
  ]) {
    const candidate = candidates.find((c) => c.id === id)!;
    const selected = { ...plan, duty: candidate.duty };
    assert.equal(staffingOutlook(game, selected), expected);
    assert.ok(candidate.label.includes(expected));
    assert.ok(preparationAdvice(game, selected).hint.includes(expected));
  }
  assert.equal(staffingOutlook({ ...game, level: 3 }, plan), '');
  assert.equal(staffingOutlook({ ...game, level: 99 }, plan), '');
});

test('current order recipes are readable in the human hints and the bench context', () => {
  const game = createGame({ level: 7, stock: 12 });
  game.orders = (['soup', 'roast', 'soup'] as RecipeId[]).map((recipe, id) => ({
    recipe,
    id,
    deadline: 40000,
    duration: 40000,
  }));
  const state: StoreState = {
    ...useKitchen.getState(),
    game,
    phase: 'paused',
    menuOpen: true,
    menuPage: 'hints',
    benchmark: false,
  };
  const recipes = benchRequest(state, {
    preparing: false,
    plan: preparation(game),
    candidates: [],
  }).state.recipes!;
  assert.deepEqual(Object.keys(recipes), ['soup', 'roast']);
  let text = '';
  for (let advicePage = 0; advicePage < 12; advicePage++) {
    const ui = screen(state, { ...preparation(game), advicePage }, 320, 568);
    text += ui.items.find((i) => i.id === 'advice-copy').text!.replaceAll('\n', '');
    if (ui.items.find((i) => i.id === 'advice-next').disabled) break;
  }
  for (const steps of Object.values(recipes)) assert.ok(text.includes(steps));
});
import { STAFF } from '../src/staff.ts';
import { VITAMINS } from '../src/training.ts';

test('title screen contains no playing HUD, orders, stock or staff', () => {
  const base: StoreState = { ...useKitchen.getState(), phase: 'ready', ready: true };
  const ui = screen(base, preparation(base.game), 1440, 900);
  assert.equal(ui.items.find((i) => i.id === 'title').text, 'SIDEKICK');
  assert.ok(ui.items.find((i) => i.id === 'title').size! >= 80);
  assert.equal(ui.items.find((i) => i.id === 'title').kind, 'title3d');
  assert.ok(!ui.items.some((i) => i.kind === 'veil'));
  assert.ok(ui.items.find((i) => i.id === 'sheet').y < 40);
  assert.ok(ui.items.find((i) => i.id === 'primary').y > 800);
  const mobile = screen(base, preparation(base.game), 320, 568);
  assert.ok(mobile.items.find((i) => i.id === 'title').size! <= 38);
  assert.ok(
    !ui.items.some((i) => i.kind === 'food' || /shift|score|order|roster|stock/.test(i.id)),
  );
  const playing = screen({ ...base, phase: 'playing' }, preparation(base.game), 1440, 900);
  assert.ok(playing.items.some((i) => i.id === 'shift'));
  assert.ok(playing.items.some((i) => i.kind === 'food'));
  assert.match(playing.items.find((i) => i.id === 'roster').text!, /ハル/);
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
  const base: StoreState = {
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
    for (const phase of ['ready', 'playing', 'paused', 'finished'] as const) {
      for (const cleared of [false, true]) {
        for (const menuPage of [
          null,
          'settings',
          'controls',
          'help',
          'diagnostics',
          'hints',
          'stages',
          'ranking',
        ]) {
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
              assert.ok(ui.items.filter((i) => i.action && i.order! < 4000).every((i) => i.inert));
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
  for (const mode of ['auto', 'follow', 'overview'] as const) {
    const s: StoreState = {
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
    assert.ok(controls.every((item) => item.kind === 'button' && item.label!.includes('カメラ')));
    assert.ok(controls.every((item) => [...item.text!].length * item.size! <= item.w - 8));
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
    const s: StoreState = {
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
    assert.match(toggle.text!, backgroundMode ? /オン/ : /オフ/);
    assert.ok([...toggle.text!].length * toggle.size! <= toggle.w - 8);
  }
  const settings = screen(
    { ...useKitchen.getState(), menuOpen: true, menuPage: 'settings', phase: 'paused' },
    preparation(useKitchen.getState().game),
    320,
    568,
  );
  assert.ok(!settings.items.some((item) => item.action === 'background'));
});

test('diagnostics contains auto mode and confirms reset; settings contains neither', () => {
  const base: StoreState = {
    ...useKitchen.getState(),
    menuOpen: true,
    menuPage: 'diagnostics',
    phase: 'paused',
  };
  for (const [width, height] of [
    [320, 568],
    [568, 320],
    [390, 844],
    [1440, 900],
  ]) {
    const view = preparation(base.game);
    const ui = screen(base, view, width, height);
    const auto = ui.items.find((item) => item.action === 'auto-mode');
    assert.equal(auto.text, 'オート：オフ');
    assert.equal(auto.label, 'オートモード：オフ');
    const enabled = screen({ ...base, autoMode: true }, view, width, height);
    assert.equal(enabled.items.find((item) => item.action === 'auto-mode').pressed, true);
    const settings = screen({ ...base, menuPage: 'settings' }, view, width, height);
    assert.ok(!settings.items.some((item) => ['auto-mode', 'reset'].includes(item.action ?? '')));
    const reset = ui.items.find((item) => item.action === 'reset');
    assert.ok(reset, `${width}x${height}`);
    assert.equal(reset.text, 'リセット');
    assert.equal(reset.color, undefined);
    assert.ok([...reset.text!].length * reset.size! <= reset.w - 8);
    const armed = screen(base, { ...view, resetArmed: true }, width, height);
    const confirm = armed.items.find((item) => item.action === 'reset');
    assert.equal(confirm.text, 'リセット確定');
    assert.equal(confirm.color, '#a1372f');
    assert.ok([...confirm.text!].length * confirm.size! <= confirm.w - 8);
  }
  const bench = screen({ ...base, benchmark: true }, preparation(base.game), 390, 844);
  assert.ok(!bench.items.some((item) => ['reset', 'auto-mode'].includes(item.action ?? '')));
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
  const state: StoreState = {
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
  assert.match(ui.items.find((item) => item.id === 'duty-runner').text!, /あと2勤/);
  assert.ok(ui.items.find((item) => item.id === 'duty-chef'));
  assert.ok(ui.items.find((item) => item.id === 'duty-summary').text!.includes('出勤'));
  assert.ok(ui.items.find((item) => item.id === 'quantity'));
  assert.equal(preparation(game, true).page, 1);
});

test('stock and attendance use stacked portrait and side-by-side landscape layouts for a full roster', () => {
  const game = createGame({ level: 24, cash: 9000, stock: 20, hired: Object.keys(STAFF) });
  const state: StoreState = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: true,
    ready: true,
  };
  const view = { ...preparation(game), page: 2 };
  for (const [width, height] of [
    [320, 480],
    [320, 568],
    [390, 844],
    [568, 320],
    [844, 390],
    [1440, 900],
  ]) {
    const ui = screen(state, view, width, height);
    const find = (id: string) => ui.items.find((i) => i.id === id);
    const duty = ui.items.filter((i) => i.action === 'duty');
    assert.equal(duty.length, 7);
    if (width < height)
      assert.ok(find('stock-label').y >= find('duty-summary').y + find('duty-summary').h);
    else assert.ok(duty.every((i) => i.x + i.w < find('quantity').x));
    const lastStockLine = find('bill') ?? find('stock-summary');
    assert.ok(lastStockLine.y + lastStockLine.h <= find('balance-board').y);
    assert.ok(find('balance-board').y + find('balance-board').h <= find('primary').y);
    const content = ui.items.filter(
      (i) => !i.inert && ['button', 'number', 'text'].includes(i.kind!),
    );
    for (const item of content) {
      assert.ok(
        item.x >= 0 && item.y >= 0 && item.x + item.w <= width && item.y + item.h <= height,
        item.id,
      );
      for (const other of content.filter((i) => i !== item))
        assert.ok(
          item.x + item.w <= other.x ||
            other.x + other.w <= item.x ||
            item.y + item.h <= other.y ||
            other.y + other.h <= item.y,
          `${item.id} overlaps ${other.id} at ${width}x${height}`,
        );
    }
  }
});

test('landscape dialogs keep the action group in a bottom bar while portrait stacks it below', () => {
  const game = createGame({ level: 9, cash: 3000, stock: 20 });
  const actionIds = ['primary', 'back', 'hire', 'skip', 'retry', 'review', 'previous'];
  for (const phase of ['paused', 'finished'] as const) {
    for (const cleared of [false, true]) {
      for (const menuPage of [null, 'settings', 'controls', 'help', 'diagnostics', 'stages']) {
        for (const page of [0, 1, 3]) {
          const state: StoreState = {
            ...useKitchen.getState(),
            game,
            phase,
            cleared,
            menuOpen: menuPage !== null,
            menuPage,
            applicants: ['chef'],
          };
          const view = { ...preparation(game), page };
          const landscape = screen(state, view, 844, 390);
          assert.ok(!landscape.items.some((i) => i.id === 'actions-board'));
          const sheet = landscape.items.find((i) => i.id === 'sheet');
          const actions = landscape.items.filter(
            (i) => !i.inert && i.kind === 'button' && actionIds.includes(i.id),
          );
          assert.ok(actions.length, `${phase}/${cleared}/${menuPage}/${page}`);
          const rowY = actions[0].y;
          for (const item of actions) {
            assert.equal(item.y, rowY, `${item.id} shares the bottom row`);
            assert.ok(item.y + item.h > sheet.y + sheet.h - 24, `${item.id} hugs the sheet bottom`);
            assert.ok(item.y + item.h <= sheet.y + sheet.h, `${item.id} stays inside the sheet`);
          }
          const portrait = screen(state, view, 390, 844);
          assert.ok(!portrait.items.some((i) => i.id === 'actions-board'));
        }
      }
    }
  }
});

test('menu and result content stays readable and clear of controls on small screens', () => {
  const game = createGame({ level: 6, cash: 840, stock: 20 });
  const base = { ...useKitchen.getState(), game, ready: true };
  const states: StoreState[] = [
    { ...base, phase: 'paused' },
    { ...base, phase: 'finished', cleared: false },
    { ...base, phase: 'finished', cleared: true },
    { ...base, phase: 'finished', cleared: true, campaignComplete: true },
    ...['settings', 'controls', 'help', 'hints', 'diagnostics', 'stages', 'ranking'].map(
      (menuPage) => ({
        ...base,
        phase: 'paused' as const,
        menuOpen: true,
        menuPage,
        stages: Object.fromEntries(
          Array.from({ length: 100 }, (_, i) => [i + 1, {} as Checkpoint]),
        ),
      }),
    ),
  ];
  for (const [width, height] of [
    [320, 480],
    [320, 568],
    [390, 844],
    [568, 320],
    [844, 390],
    [1440, 900],
  ])
    for (const state of states) {
      const ui = screen(state, { ...preparation(game), page: 0 }, width, height);
      const content = ui.items.filter(
        (item) => !item.inert && ['text', 'button'].includes(item.kind),
      );
      for (const [index, item] of content.entries()) {
        assert.ok((item.size ?? 16) >= 13, `${item.id} readable at ${width}x${height}`);
        assert.ok(
          item.x >= 0 && item.y >= 0 && item.x + item.w <= width && item.y + item.h <= height,
          item.id,
        );
        for (const other of content.slice(index + 1))
          assert.ok(
            item.x + item.w <= other.x ||
              other.x + other.w <= item.x ||
              item.y + item.h <= other.y ||
              other.y + other.h <= item.y,
            `${state.menuPage ?? state.phase}: ${item.id} overlaps ${other.id} at ${width}x${height}`,
          );
      }
      if (state.menuOpen && state.menuPage !== 'settings') {
        const back = ui.items.find((item) => item.id === 'menu-back');
        assert.equal(back.action, 'menu-page');
        assert.equal(back.value, 'settings');
        assert.ok(back.y < ui.items.find((item) => item.id === 'primary').y);
      }
    }
});

test('preparation navigation and receipts never cover content or purchase controls', () => {
  const game = createGame({ level: 20, cash: 10000, stock: 40, hired: Object.keys(STAFF) });
  const state: StoreState = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: true,
    ready: true,
    menuOpen: false,
    applicants: Object.keys(STAFF),
  };
  const variants: ViewState[] = [
    ...Object.keys(STAFF).map((_, applicantIndex) => ({ page: 1, applicantIndex })),
    { page: 1, applicantIndex: 99 },
    { page: 2 },
    ...[0, 1, 2, 3].map((equipmentIndex) => ({ page: 3, equipmentIndex })),
    { page: 3, vitaminItem: 'move', vitamins: [{ item: 'move', target: 'human' }] },
    { page: 3, layoutMode: 'layout' },
    { page: 3, layoutMode: 'layout', layoutSelection: 'board' },
  ];
  for (const [width, height] of [
    [320, 480],
    [320, 568],
    [390, 844],
    [568, 320],
    [844, 390],
    [1440, 900],
  ])
    for (const variant of variants) {
      const view = { ...preparation(game), ...variant };
      const ui = screen(
        variant.applicantIndex === 99 ? { ...state, applicants: [] } : state,
        view,
        width,
        height,
      );
      const content = ui.items.filter(
        (item) => !item.inert && ['text', 'button', 'number'].includes(item.kind),
      );
      for (const [index, item] of content.entries()) {
        assert.ok(
          item.x >= 0 && item.y >= 0 && item.x + item.w <= width && item.y + item.h <= height,
          `${item.id} outside ${width}x${height}`,
        );
        if (item.action) assert.ok(item.w >= 44 && item.h >= 44, item.id);
        for (const other of content.slice(index + 1))
          assert.ok(
            item.x + item.w <= other.x ||
              other.x + other.w <= item.x ||
              item.y + item.h <= other.y ||
              other.y + other.h <= item.y,
            `${item.id} overlaps ${other.id} at ${width}x${height}`,
          );
      }
      for (const page of [1, 2, 3])
        assert.equal(
          ui.items.find((item) => item.id === `prep-tab-${page}`).pressed,
          view.page === page,
        );
    }
});

test('equipment page keeps pending investments, effects and controls within the sheet', () => {
  const game = createGame({ level: 14, cash: 1200, stock: 20 });
  const state: StoreState = {
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
    layout: bill.layout ?? undefined,
  });
  assert.equal(recovered.error, '');
  assert.equal(recovered.layout!.board2, undefined);
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

test('training rows buy a vitamin then pick exactly one actor inside the sheet', () => {
  const game = createGame({ level: 14, cash: 1200, stock: 20, hired: ['helper', 'runner'] });
  const state: StoreState = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: true,
    ready: true,
    applicants: [],
  };
  const view = { ...preparation(game), page: 3, equipmentIndex: 2 };
  const list = screen(state, view, 390, 844);
  assert.ok(list.items.find((item) => item.id === 'equipment-buy-move'));

  const bill = purchase(game, { ...view, vitamins: [{ item: 'move', target: 'human' }] });
  assert.equal(bill.vitaminCost, VITAMINS.move.cost);
  assert.ok(bill.cash < game.cash);
  assert.equal(bill.error, '');

  for (const [width, height] of [
    [320, 568],
    [568, 320],
    [390, 844],
  ]) {
    const picker = screen(state, { ...view, vitaminItem: 'move' }, width, height);
    assert.ok(picker.items.find((item) => item.id === 'vitamin-target-human'));
    assert.ok(picker.items.find((item) => item.id === 'vitamin-target-helper'));
    assert.ok(picker.items.find((item) => item.id === 'layout-mode').text === 'やめる');
    for (const control of picker.items.filter((item) => item.action && !item.inert)) {
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
  const state: StoreState = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: true,
    ready: true,
    applicants: [],
  };
  const baseView: ViewState = { ...preparation(game), page: 3, layoutMode: 'layout' };
  const slots = layoutSlots(game);
  const targetSlot = Object.keys(slots).find((slot) => slot !== game.layout.board)!;
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
    assert.ok(!destination.text!.includes(targetSlot));
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
  assert.match(warmer.items.find((item) => item.id === 'equipment-summary').text!, /設備枠/);
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

test('order tickets fill their background with the elapsed share of the deadline', () => {
  const game = createGame({ level: 30 });
  const ticket = (
    time: number,
    { practice = false, deadline = 20_000, duration = 20_000 } = {},
  ) => {
    game.time = time;
    game.practice = practice;
    game.orders = [{ id: 7, recipe: 'dish', deadline, duration }];
    return screen(
      { ...useKitchen.getState(), game, phase: 'playing', ready: true, tutorial: null },
      preparation(game),
      768,
      390,
    ).items.find((item) => item.id === 'ticket-7');
  };
  assert.equal(ticket(0).progress, 0);
  assert.equal(ticket(5_000).progress, 0.25);
  assert.equal(ticket(5_000).progressColor, '#76b59b');
  assert.equal(ticket(10_000).progress, 0.5);
  assert.equal(ticket(10_000).progressColor, '#c7594b');
  assert.equal(ticket(5_000, { practice: true }).progress, null);
  assert.equal(ticket(5_000, { duration: 0 }).progress, null);
});

test('failed shift gives explicit recovery choices and gates previous level', () => {
  const game = createGame({ level: 2 });
  const state: StoreState = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: false,
    ready: true,
    rollback: {
      preparation: { snapshot: { level: 1 } as Checkpoint, applicants: [] },
      previous: { snapshot: { level: 1 } as Checkpoint, applicants: [] },
    },
  };
  const ui = screen(state, preparation(game), 320, 568);
  assert.equal(ui.items.find((item) => item.id === 'retry').text, '同じ条件で再挑戦');
  assert.equal(ui.items.find((item) => item.id === 'review').text, '開店準備から見直す');
  assert.equal(ui.items.find((item) => item.id === 'previous').disabled, false);
  assert.match(ui.items.find((item) => item.id === 'result').text!, /開店前から/);
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
      const state: StoreState = {
        ...useKitchen.getState(),
        game,
        tutorial,
        phase: 'playing',
        ready: true,
      };
      const ui = screen(state, preparation(game), width, height);
      assert.equal(
        ui.items.find((i) => i.id === 'lesson-copy').text,
        `${tutorial + 1}/5  ${STATIONS[step.station].name}をタップ`,
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
        assert.ok([...item.text!].length * item.size! <= item.w - 8, `${item.id} label fits`);
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
  const state: StoreState = {
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
  assert.ok(bars.every((bar) => bar.ratio! > 0 && bar.ratio! <= 1));
  assert.ok(bars.every((bar) => bar.x >= 0 && bar.x + bar.w <= 1440));
  assert.ok(!ui.items.some((item) => (item.text ?? '').includes('速さ ×')));
  const roster = screen(state, { ...preparation(game), page: 2, selected: 'chef' }, 1440, 900);
  assert.equal(roster.items.find((item) => item.id === 'duty-chef').avatar, STAFF.chef.color);
});

test('preparation hint warns only when the stock is below the next quota', () => {
  const game = createGame({ level: 1, cash: 500 });
  const state: StoreState = {
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
  assert.equal(shortUi.status, 'あと7個の仕入れが必要');
  assert.equal(shortUi.items.find((item) => item.id === 'prep-status').text, shortUi.status);
  assert.equal(screenContext(state, short, 1440, 900).status, shortUi.status);
  assert.equal(screenContext(state, view, 1440, 900).status, null);
});

test('Lv3 hands the roster to Haru and a rare manager applicant can be rehired', () => {
  const g = createGame({ level: 3, stock: 11, cash: 2000 });
  const view = preparation(g);
  assert.deepEqual(view.duty, ['helper']);
  const bill = purchase(g, view);
  assert.ok(!Object.hasOwn(bill.staffState, 'veteran'));
  const base: StoreState = {
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

test('human hints share stock facts, cooking advice and bounded preparation history', () => {
  const game = createGame({ level: 12, cash: 2000, stock: 3, hired: ['helper', 'chef', 'sous'] });
  game.served = 11;
  const base: StoreState = {
    ...useKitchen.getState(),
    game,
    phase: 'finished',
    cleared: true,
    menuOpen: true,
    menuPage: 'hints',
    benchmark: false,
  };
  let view: ViewState = { ...preparation(game), page: 2 };
  let text = '';
  for (let advicePage = 0; advicePage < 12; advicePage++) {
    const ui = screen(base, { ...view, advicePage }, 320, 568);
    text += ui.items.find((i) => i.id === 'advice-copy').text!.replaceAll('\n', '');
    if (ui.items.find((i) => i.id === 'advice-next').disabled) break;
  }
  assert.ok(
    text.includes(preparationAdvice(game, { ...view, stage: 'stock' }).hint.replaceAll('\n', '')),
  );
  assert.match(text, /トマトサラダ 25コイン/);
  assert.match(text, /トマトスープ 35コイン/);
  assert.match(text, /前回11皿/);
  assert.match(text, /次の注文/);
  assert.doesNotMatch(text, /ノルマ後も売|しよう|優先|選ぼう/);
  for (const stage of ['hiring', 'staffing', 'stock', 'investment'] as const) {
    const advice = preparationAdvice(game, { ...view, stage });
    assert.doesNotMatch(advice.hint, /しよう|優先|選ぼう/);
    assert.doesNotMatch(
      advice.instructions,
      /Prioritize|Prefer|First train|Assign .*ONLY|Invest remaining/,
    );
  }
  view = editPreparation(view, { equipmentPurchases: ['upgrade_board'] }, 'まな板を強化');
  view = editPreparation(view, { equipmentPurchases: [] }, 'まな板の強化を取消');
  assert.equal(view.looping, true);
  for (let quantity = 20; quantity < 30; quantity++)
    view = editPreparation(view, { quantity }, `仕入れ${quantity}個`);
  assert.equal(view.history!.length, 6);
  assert.equal(view.looping, false);
  game.human.carrying = 'roast';
  game.orders = [{ recipe: 'soup', id: 0, deadline: 40000, duration: 40000 }];
  const playing = screen(
    { ...base, phase: 'playing', menuOpen: false, tutorial: null },
    view,
    1280,
    720,
  );
  assert.match(playing.items.find((i) => i.id === 'advice').text!, /注文のない料理/);
});
