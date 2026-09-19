import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame } from '../src/model.js';
import { useKitchen } from '../src/game.js';
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
    [390, 844],
    [768, 1024],
    [1440, 900],
  ]) {
    for (const phase of ['ready', 'playing', 'paused', 'finished']) {
      for (const cleared of [false, true]) {
        for (const menuPage of [null, 'settings', 'help', 'diagnostics']) {
          for (const page of [0, 1, 2]) {
            const ui = screen(
              { ...base, phase, cleared, menuOpen: menuPage !== null },
              { ...preparation(game), page, menuPage },
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
