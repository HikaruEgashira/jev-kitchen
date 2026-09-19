import {
  RECIPES,
  STAR_SCORES,
  STOCK_PRICE,
  quotaForLevel,
  stationAt,
  actionHint,
  STATIONS,
  activeStationIds,
} from './model.js';
import { STAFF } from './staff.js';
import { TUTORIAL_STEPS } from './game.js';

export const compactControls = (width, height) => width < 600 || height < 500;

export function preparation(g) {
  return {
    page: 0,
    applicantIndex: 0,
    selected: null,
    assigned: g.staffId,
    quantity: Math.max(0, quotaForLevel(g.level + 1) + 2 - (g.stock ?? 0)),
  };
}

export function purchase(g, view) {
  const quantity = Number(view.quantity);
  const valid = /^\d{1,2}$/.test(String(view.quantity)) && Number.isInteger(quantity);
  const hiring = view.selected ? (STAFF[view.selected]?.cost ?? Infinity) : 0;
  const stock = (g.stock ?? 0) + quantity;
  const cash = g.cash - hiring - quantity * STOCK_PRICE;
  const quota = quotaForLevel(g.level + 1);
  const error = !valid
    ? '仕入れは0〜99個で入力'
    : stock < quota
      ? `あと${quota - stock}個の仕入れが必要`
      : cash < 0
        ? `コインが${-cash}不足`
        : '';
  return { quantity, hiring, stock, cash, quota, error };
}

// One layout describes both Three meshes and their keyboard/screen-reader controls.
export function screen(s, view, width, height) {
  const g = s.game;
  const items = [];
  const narrow = compactControls(width, height);
  const compactHud = width < 1060;
  const playing = s.phase === 'playing';
  const practice = s.tutorial !== null;
  let order = 2000;
  const add = (kind, id, text, x, y, w, h, extra = {}) =>
    items.push({
      kind,
      id,
      text,
      x,
      y,
      w,
      h,
      order: (order += 3),
      ...extra,
      size: narrow ? Math.max(11, Math.round((extra.size ?? 16) * 0.8)) : extra.size,
    });
  const label = (id, text, x, y, w, h = 30, extra) => add('text', id, text, x, y, w, h, extra);
  const panel = (id, x, y, w, h, extra) => add('panel', id, '', x, y, w, h, extra);
  const button = (id, text, x, y, w, action, extra) =>
    add('button', id, text, x, y, w, 44, { action, ...extra });
  const seconds = Math.max(0, Math.ceil((g.duration - g.time) / 1000));
  const time = practice
    ? '最初の一皿'
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  panel('shift-board', 12, 12, narrow ? width - 132 : 366, 54, { color: '#245e50' });
  label(
    'shift',
    narrow
      ? `Lv.${g.level}  ${g.served}/${g.quota}皿  ${time}`
      : `SIDEKICK   Lv.${g.level}    ${g.served} / ${g.quota}皿    ${time}`,
    18,
    14,
    narrow ? width - 144 : 354,
    44,
    { color: '#fff9e8', size: narrow ? 13 : 17 },
  );
  button('pause', s.phase === 'paused' ? '再開' : 'Ⅱ', width - 112, 16, 44, 'pause', {
    label: s.phase === 'paused' ? 'ゲームを再開' : 'ゲームを一時停止',
    disabled: !s.ready || !['playing', 'paused'].includes(s.phase),
  });
  button('menu', '≡', width - 60, 16, 48, 'menu', { label: 'メニューを開く' });
  panel('score-board', 12, 74, narrow ? width - 24 : 288, 34);
  label(
    'score',
    `${g.score}点   ${g.cash} コイン${g.burned ? `   焦げ ${g.burned}` : ''}`,
    16,
    77,
    narrow ? width - 32 : 280,
    28,
    { size: 14 },
  );
  const ow = narrow ? 132 : 180;
  g.orders.slice(0, 2).forEach((o, i) => {
    const left = practice ? null : Math.max(0, Math.ceil((o.deadline - g.time) / 1000));
    const x = width / 2 - ow - 5 + i * (ow + 10);
    const y = compactHud ? 120 : 16;
    panel(`ticket-${o.id}`, x, y, ow, 76);
    add('food', `food-${o.id}`, '', x + 2, y + 6, 50, 60, { recipe: o.recipe });
    label(
      `order-${o.id}`,
      `${RECIPES[o.recipe].name}\n${left === null ? 'おためし' : `あと ${left} 秒`}`,
      x + 48,
      y + 8,
      ow - 52,
      58,
      { size: 12, color: left !== null && left <= 10 ? '#a1372f' : '#245e50' },
    );
  });
  if (!compactHud) {
    panel('roster-board', width - 242, 82, 230, g.hired.length * 26 + 16);
    label(
      'roster',
      g.hired.map((id) => `${STAFF[id].name}${id === g.staffId ? '  出勤中' : ''}`).join('\n'),
      width - 238,
      90,
      224,
      g.hired.length * 26,
      { size: 13 },
    );
  }
  const near = stationAt(g, 'human');
  const step = TUTORIAL_STEPS[s.tutorial];
  const reached = near.inReach && (!practice || near.id === step?.station);
  if (playing) {
    if (practice && step) {
      panel(
        'lesson',
        width / 2 - Math.min(width - 24, 380) / 2,
        height - (narrow ? 160 : 140),
        Math.min(width - 24, 380),
        narrow ? 36 : 68,
        { color: '#f4cd75' },
      );
      label(
        'lesson-copy',
        narrow ? `${STATIONS[step.station].name}をタップ` : `WASDで移動・Eで作業\n${step.label}`,
        width / 2 - Math.min(width - 32, 372) / 2,
        height - (narrow ? 158 : 135),
        Math.min(width - 32, 372),
        narrow ? 32 : 56,
        { size: 15 },
      );
    } else if (s.toast && g.time < s.toastUntil) {
      const tw = Math.min(width - 24, 520);
      panel('toast-board', (width - tw) / 2, height - (narrow ? 160 : 112), tw, 38);
      label(
        'toast',
        s.toast.replace(/\p{Extended_Pictographic}|\uFE0F/gu, ''),
        (width - tw) / 2 + 4,
        height - (narrow ? 158 : 110),
        tw - 8,
        32,
        { size: 14, live: true },
      );
    }
    if (narrow) {
      const stations = activeStationIds(g);
      const gap = 4;
      const w = (width - 24 - gap * (stations.length - 1)) / stations.length;
      stations.forEach((id, index) => {
        button(
          `station-${id}`,
          id === 'pot' ? 'スープ' : STATIONS[id].name,
          12 + index * (w + gap),
          height - 112,
          w,
          'station',
          {
            value: id,
            label: `${STATIONS[id].name}へ移動して作業`,
            disabled: practice && step?.station !== id,
            pressed: practice ? step?.station === id : reached && near.id === id,
            size: 13,
          },
        );
      });
    }
    const aw = Math.min(width - 24, 520);
    const ax = (width - aw) / 2;
    const side = narrow ? 62 : 106;
    button(
      'interact',
      reached
        ? `${narrow ? '' : 'E  '}${practice ? '作業する' : actionHint(g, near.id)}`
        : '作業台へ移動',
      ax,
      height - 60,
      aw - side * 2 - 16,
      'interact',
      { disabled: !reached, color: '#245e50', ink: '#fff9e8', size: narrow ? 12 : 15 },
    );
    button(
      'dash',
      narrow ? '急ぐ' : 'Shift 急ぐ',
      ax + aw - side * 2 - 8,
      height - 60,
      side,
      'dash',
      { label: 'ダッシュ', disabled: g.time < g.human.dashReadyAt, size: 13 },
    );
    button('clear', narrow ? '片づけ' : 'Q 片づけ', ax + aw - side, height - 60, side, 'clear', {
      disabled: practice || !g.human.carrying,
      size: 13,
    });
  }
  const modal = s.menuOpen
    ? 'menu'
    : s.phase === 'finished'
      ? `result-${view.page}`
      : s.phase === 'paused'
        ? 'paused'
        : s.phase === 'ready'
          ? 'welcome'
          : null;
  if (!modal)
    return {
      items,
      modal: null,
      title: 'キッチン',
      status: practice && step ? step.label : s.toast || '',
    };
  if (s.phase === 'ready') items.length = 0;
  // Background HUD stays legible, but never accepts input behind a sheet.
  items.forEach((item) => {
    item.inert = true;
  });
  const welcome = modal === 'welcome';
  const pw = Math.min(width - 24, welcome ? 700 : 580);
  const ph = Math.min(
    height - 24,
    s.menuOpen
      ? 400
      : s.phase === 'finished' && s.cleared && !s.campaignComplete
        ? 384
        : welcome
          ? narrow
            ? 136
            : 178
          : 256,
  );
  const x = (width - pw) / 2,
    y = welcome ? 20 : (height - ph) / 2;
  order = 4000;
  if (!welcome) add('veil', 'veil', '', 0, 0, width, height);
  panel('sheet', x, y, pw, ph);
  panel('clip', width / 2 - 36, y - 5, 72, 16, { color: '#76b59b', edge: '#245e50' });
  const inside = pw - 32;
  const title = (text) =>
    label('title', text, x + 16, y + 18, inside, 34, { size: narrow ? 21 : 26 });
  const copy = (id, text, top, h = 30, extra = {}) =>
    label(id, text, x + 16, y + top, inside, h, { size: 14, ...extra });
  const footerY = welcome ? height - 68 : y + ph - 60;
  const primary = (text, action, extra = {}) =>
    button('primary', text, x + 16, footerY, inside, action, {
      color: '#245e50',
      ink: '#fff9e8',
      ...extra,
    });
  if (s.menuOpen) {
    title(
      view.menuPage === 'help'
        ? 'キッチンの手引き'
        : view.menuPage === 'diagnostics'
          ? '診断情報'
          : 'ひと休み',
    );
    const page = view.menuPage ?? 'settings';
    if (page === 'help') {
      copy(
        'help',
        '作業台をタップ、または WASD で移動\nE で作業・Shift でダッシュ・Q で片づけ\n切る → お皿をとる → 盛る → 配膳\nLv.2 でスープ、Lv.3 でグリルが登場',
        62,
        110,
        { size: narrow ? 12 : 16 },
      );
      button('back', '設定に戻る', x + 16, footerY - 54, inside, 'menu-page', {
        value: 'settings',
      });
    } else if (page === 'diagnostics') {
      copy(
        'diagnostics',
        `${s.backend} / ${s.hud.via}\n応答 ${s.hud.latency ?? '—'} ms  ・  判断 ${s.hud.decisions}回\n古い回答の破棄 ${s.hud.dropped}回${s.fallback ? '\n接続待ち：固定ルールで営業を続けます' : ''}`,
        60,
        106,
        { size: narrow ? 12 : 15 },
      );
      button('back', '設定に戻る', x + 16, footerY - 54, inside, 'menu-page', {
        value: 'settings',
      });
    } else {
      const bw = (inside - 16) / 3;
      button('sound', s.sound ? '音オン' : '音オフ', x + 16, y + 64, bw, 'sound', {
        pressed: s.sound,
        size: 13,
      });
      button('help', '遊び方', x + 24 + bw, y + 64, bw, 'menu-page', { value: 'help', size: 13 });
      button('diagnostics', '診断', x + 32 + bw * 2, y + 64, bw, 'menu-page', {
        value: 'diagnostics',
        size: 13,
      });
      copy(
        'privacy',
        '相棒の判断にゲーム状態を\nTypeSafe または Cloudflare へ送信します。',
        120,
        54,
        { size: 12 },
      );
      const lw = (inside - 8) / 2;
      button('license', 'ライセンス', x + 16, footerY - 54, lw, 'link', {
        href: '/licenses.md',
        size: 13,
      });
      button('notices', '追加通知', x + 24 + lw, footerY - 54, lw, 'link', {
        href: '/third-party-notices.md',
        size: 13,
      });
    }
    primary('閉じる', 'close-menu');
  } else if (s.phase === 'ready') {
    add('title3d', 'title', 'SIDEKICK', x + 16, y + 12, inside, narrow ? 72 : 100, {
      size: narrow ? 46 : 82,
    });
    copy('welcome', 'kitchen   /   ふたりで、ひと皿。', narrow ? 84 : 116, 36, {
      size: narrow ? 15 : 22,
    });
    primary(s.ready ? '開店' : 'キッチンを準備中…', 'start', { disabled: !s.ready });
  } else if (s.phase === 'paused') {
    title('ただいま、ひと休み');
    copy('paused', '営業の時計は止まっています。', 66, 70, { size: 18 });
    primary('再開する', 'pause');
  } else if (!s.cleared || s.campaignComplete) {
    title(s.campaignComplete ? '全100レベル、完走！' : 'もう一度、同じ厨房で');
    copy(
      'result',
      `${g.served} / ${g.quota}皿   ・   ${g.score}点\n${s.campaignComplete ? '見事なチームワークでした。' : '開店時の資金と在庫に戻して再挑戦。'}`,
      70,
      70,
      { size: 17 },
    );
    primary(
      s.campaignComplete ? '最初から再挑戦' : '同じ営業をやり直す',
      s.campaignComplete ? 'start' : 'retry',
    );
  } else {
    const bill = purchase(g, view);
    const stars = STAR_SCORES.map((n) => (g.score >= n ? '★' : '☆')).join(' ');
    const bodyTop = y + 68;
    const short = ph < 340;
    if (view.page === 0) {
      title(`Lv.${g.level} 営業クリア`);
      copy('stars', stars, 62, 44, { size: 30, color: '#987018' });
      copy(
        'result',
        `${g.served} / ${g.quota}皿  ・  ${g.score}点\nお財布 ${g.cash}コイン\n次は Lv.${g.level + 1}、${bill.quota}皿を届けよう`,
        short ? 102 : 126,
        short ? 90 : 116,
        { size: 17 },
      );
      primary('相棒を選ぶ', 'page', { value: 1 });
    } else if (view.page === 1) {
      title('次の相棒を選ぼう');
      const id = s.applicants[view.applicantIndex % Math.max(1, s.applicants.length)];
      const staff = STAFF[id];
      if (staff) {
        button('previous-applicant', '‹', x + 16, bodyTop, 44, 'applicant-index', {
          value: -1,
          label: '前の応募者',
        });
        label(
          'applicant-name',
          `${staff.name}  ${view.applicantIndex + 1}/${s.applicants.length}`,
          x + 66,
          bodyTop,
          pw - 132,
          44,
          { size: 15 },
        );
        button('next-applicant', '›', x + pw - 60, bodyTop, 44, 'applicant-index', {
          value: 1,
          label: '次の応募者',
        });
        copy(
          'applicant-description',
          `${staff.description}\n速さ ×${staff.speed}  ・  判断 ${(staff.decisionMs / 1000).toFixed(1)}秒ごと${staff.canDash ? ' ・ ダッシュ' : ''}\n採用 ${staff.cost}コイン / お財布 ${g.cash}`,
          short ? 112 : 126,
          62,
          { size: narrow ? 12 : 14 },
        );
        const bw = (inside - 8) / 2;
        button(
          'hire',
          view.selected === id ? '採用予定' : 'この相棒を採用',
          x + 16,
          footerY - 54,
          bw,
          'hire',
          { value: id, pressed: view.selected === id, size: 13 },
        );
        button('skip', '今回は見送る', x + 24 + bw, footerY - 54, bw, 'skip', {
          pressed: view.selected === null,
          size: 13,
        });
      } else
        copy(
          'all-hired',
          '応募者は全員採用済みです。\n次のページで出勤する相棒を選べます。',
          90,
          90,
        );
      primary('仕入れと配置へ', 'page', { value: 2 });
    } else {
      title(`Lv.${g.level + 1} 仕入れ帳`);
      const roster = [
        ...g.hired,
        ...(view.selected && !g.hired.includes(view.selected) ? [view.selected] : []),
      ];
      const rowY = bodyTop;
      button('previous-staff', '‹', x + 16, rowY, 44, 'staff', {
        value: -1,
        label: '前の相棒を配置',
        disabled: roster.length < 2,
      });
      label('assigned', `出勤：${STAFF[view.assigned].name}`, x + 66, rowY, pw - 132, 44, {
        size: 14,
      });
      button('next-staff', '›', x + pw - 60, rowY, 44, 'staff', {
        value: 1,
        label: '次の相棒を配置',
        disabled: roster.length < 2,
      });
      const sy = short ? y + 118 : y + 138;
      label('stock-label', `${STOCK_PRICE} / 個`, x + 16, sy, inside - 168, 44, { size: 13 });
      button('less', '−', x + pw - 180, sy, 44, 'quantity', {
        value: -1,
        label: '仕入れを1個減らす',
        disabled: bill.quantity <= 0,
      });
      add('number', 'quantity', String(view.quantity), x + pw - 132, sy, 64, 44, {
        label: '仕入れ個数',
        action: 'quantity-input',
      });
      button('more', '＋', x + pw - 64, sy, 44, 'quantity', {
        value: 1,
        label: '仕入れを1個増やす',
        disabled: bill.quantity >= 99,
      });
      copy(
        'bill',
        `在庫 ${g.stock ?? 0} → ${Number.isFinite(bill.stock) ? bill.stock : '—'}個 / ノルマ ${bill.quota}皿\n採用 ${bill.hiring} ＋ 仕入れ ${Number.isFinite(bill.quantity) ? bill.quantity * STOCK_PRICE : '—'} / 残り ${Number.isFinite(bill.cash) ? bill.cash : '—'}コイン`,
        short ? 168 : 204,
        short ? 36 : 48,
        { size: 12 },
      );
      if (bill.error || view.error)
        copy('error', view.error || bill.error, short ? 205 : 260, 26, {
          color: '#a1372f',
          size: 12,
          live: true,
        });
      const backW = narrow ? 76 : 120;
      button('back', '相棒選び', x + 16, footerY, backW, 'page', { value: 1, size: 13 });
      button('primary', 'この準備で開店', x + 24 + backW, footerY, inside - backW - 8, 'next', {
        disabled: Boolean(bill.error),
        color: '#245e50',
        ink: '#fff9e8',
        size: 14,
      });
    }
  }
  if (!s.menuOpen && ['ready', 'paused'].includes(s.phase)) {
    const main = items.find((item) => item.id === 'primary');
    main.w = Math.min(welcome ? 300 : Infinity, main.w - 60);
    if (welcome) main.x = (width - main.w - 56) / 2;
    button('sheet-menu', '≡', main.x + main.w + 16, footerY, 44, 'menu', {
      label: 'メニューを開く',
    });
  }
  return {
    items,
    modal,
    title: items.find((i) => i.id === 'title').text,
    status: view.error || (view.page === 2 && s.cleared ? purchase(g, view).error : ''),
  };
}
