import {
  RECIPES,
  STAR_SCORES,
  STOCK_PRICE,
  quotaForLevel,
  stationAt,
  actionHint,
  STATIONS,
  activeStationIds,
  levelConfig,
  layoutSlots,
  resolveLayout,
  stationInfo,
} from './model.js';
import {
  STAFF,
  nextStaffState,
  payroll,
  staffAvailable,
  staffPerformance,
  nextDuty,
} from './staff.js';
import { FEATURE_LEVELS } from './progression.js';
import { TUTORIAL_STEPS } from './game.js';
import { EQUIPMENT, equipmentCapacity, quoteEquipment } from './equipment.js';

export const compactControls = (width, height) => width < 600 || height < 500;

export function preparation(g, reviewing = false) {
  const duty = nextDuty(g);
  return {
    page: reviewing ? (g.level < 3 ? 2 : 1) : 0,
    applicantIndex: 0,
    selected: null,
    duty,
    quantity: Math.max(0, quotaForLevel(g.level + 1) + 2 - (g.stock ?? 0)),
    equipmentPurchases: [],
    equipmentIndex: 0,
    layout: g.layout ? { ...g.layout } : undefined,
    layoutMode: 'equipment',
    layoutSelection: null,
    layoutIndex: 0,
  };
}

function staffStateOf(g, id) {
  return g.staffState?.[id] ?? { worked: 0, rest: 0 };
}

function staffSlots(level) {
  return levelConfig(level).staffSlots;
}

function forecastStaffState(g) {
  return nextStaffState(g);
}

function staffIds(g, view) {
  return [
    ...new Set([
      ...(Array.isArray(g.hired) ? g.hired : []),
      ...(view.selected ? [view.selected] : []),
    ]),
  ].filter((id) => STAFF[id]);
}

function staffShortName(id) {
  return STAFF[id]?.name?.split('の').at(-1) ?? id;
}

export function purchase(g, view) {
  const quantity = Number(view.quantity);
  const valid = /^\d{1,2}$/.test(String(view.quantity)) && Number.isInteger(quantity);
  const hiring = view.selected ? (STAFF[view.selected]?.cost ?? Infinity) : 0;
  const duty = [...new Set(Array.isArray(view.duty) ? view.duty : [])].filter((id) => STAFF[id]);
  const slots = staffSlots(g.level + 1);
  const wages = payroll(duty);
  const staffState = forecastStaffState(g);
  const available = duty.every(
    (id) => (!g.staffState?.[id] && id === view.selected) || staffAvailable(staffState, id),
  );
  const stock = (g.stock ?? 0) + quantity;
  const equipmentPurchases = [
    ...new Set(Array.isArray(view.equipmentPurchases) ? view.equipmentPurchases : []),
  ];
  const equipmentQuote = quoteEquipment(g.equipment ?? null, equipmentPurchases, g.level + 1);
  const equipment = equipmentQuote.equipment;
  const equipmentCost = equipmentQuote.cost;
  const layoutGame = { ...g, level: g.level + 1, equipment };
  const proposedLayout = view.layout ?? g.layout;
  const layout =
    resolveLayout(layoutGame, proposedLayout) ?? normalizedLayout(layoutGame, proposedLayout);
  const cash = g.cash - hiring - quantity * STOCK_PRICE - wages - equipmentCost;
  const quota = quotaForLevel(g.level + 1);
  const error = !valid
    ? '仕入れは0〜99個で入力'
    : stock < quota
      ? `あと${quota - stock}個の仕入れが必要`
      : levelConfig(g.level + 1).partner &&
          (duty.length !== 1 || duty[0] !== levelConfig(g.level + 1).partner)
        ? 'この営業は指定の相棒と出勤しよう'
        : duty.length > slots
          ? `このレベルの勤務上限は${slots}人`
          : !available
            ? '休養中の相棒は配置できません'
            : equipmentQuote.error
              ? equipmentQuote.error
              : !layout
                ? '設備の配置を確認してください'
                : cash < 0
                  ? `コインが${-cash}不足`
                  : '';
  return {
    quantity,
    hiring,
    wages,
    duty,
    slots,
    stock,
    cash,
    quota,
    staffState,
    equipment,
    equipmentCost,
    equipmentPurchases,
    layout,
    error,
  };
}

// Warns only when the pending plan cannot open because the stock is below the
// next quota. A sufficient plan needs no hint; the model already has the numbers
// in `preparation.bill`. Kept in `screen` so the player and the model see the
// same warning through `screenContext`.
export function preparationHint(bill) {
  if (Number.isFinite(bill.stock) && bill.stock < bill.quota)
    return `あと${bill.quota - bill.stock}個の仕入れが必要`;
  return '';
}

function layoutSlotOf(layout, id) {
  return typeof layout?.[id] === 'string' ? layout[id] : null;
}

function normalizedLayout(g, proposed) {
  const active = new Set([
    ...activeStationIds(g),
    ...(g.equipment?.warmer?.count ? ['warmer'] : []),
  ]);
  const slots = new Set(Object.keys(layoutSlots(g)));
  const filtered = Object.fromEntries(
    Object.entries(proposed ?? {}).filter(([id, slot]) => active.has(id) && slots.has(slot)),
  );
  return resolveLayout(g, filtered);
}

function layoutWithMove(layout, id, slot) {
  const next = { ...layout };
  const previous = next[id];
  const owner = Object.entries(next).find(([, value]) => value === slot)?.[0];
  next[id] = slot;
  if (owner && owner !== id && previous) next[owner] = previous;
  return next;
}

function stationName(g, id) {
  const info = stationInfo(g, id);
  return (typeof info === 'string' ? info : info?.name) ?? STATIONS[id]?.name ?? id;
}

function equipmentEffect(kind, state) {
  const level = Math.max(1, Math.min(3, Number(state?.level) || 1));
  if (kind === 'warmer')
    return state?.count > 0 ? `焦げ猶予×${[1, 1.5, 1.75, 2][level]}` : '未導入';
  if (kind === 'kitchen') return `床+${(level - 1) * 2}列`;
  return `時間-${(level - 1) * 8}%`;
}

function equipmentOptionStatus(error) {
  if (!error) return null;
  if (/枠が足りません/.test(error)) return '枠不足';
  if (/これ以上/.test(error)) return '上限';
  if (/先に/.test(error)) return '先に導入';
  if (/Lv\d+から/.test(error)) return error.match(/Lv\d+から/)?.[0] ?? '未解禁';
  if (/改良のみ/.test(error)) return '改良のみ';
  return '購入不可';
}

function stationButtonName(id) {
  if (id.startsWith('board')) return `切る${id === 'board' ? '' : '2'}`;
  if (id.startsWith('pot')) return `鍋${id === 'pot' ? '' : '2'}`;
  if (id.startsWith('grill')) return `焼く${id === 'grill' ? '' : '2'}`;
  if (id === 'plates') return '皿';
  if (id === 'serve') return '配膳';
  return STATIONS[id]?.name ?? id;
}

function layoutPositionName(slots, id) {
  const slot = slots[id];
  if (!slot) return '未配置';
  const side = slot.dx > 0 ? '右' : slot.dy > 0 ? '手前' : '奥';
  const orderBy = side === '右' ? 'y' : 'x';
  const peers = Object.entries(slots)
    .filter(([, candidate]) => {
      const candidateSide = candidate.dx > 0 ? '右' : candidate.dy > 0 ? '手前' : '奥';
      return candidateSide === side;
    })
    .sort(([, a], [, b]) => a[orderBy] - b[orderBy] || a.y - b.y);
  const index =
    Math.max(
      0,
      peers.findIndex(([slotId]) => slotId === id),
    ) + 1;
  return `${side}${index}`;
}

// One layout describes both Three meshes and their keyboard/screen-reader controls.
export function screen(s, view, width, height) {
  const g = s.game;
  const items = [];
  const narrow = compactControls(width, height);
  const compactHud = width < 1060;
  const playing = s.phase === 'playing';
  const practice = g.practice;
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
    ? '時間無制限'
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
  const rosterIds = staffIds(g, { selected: null });
  const rosterW = narrow ? Math.min(124, width - 132) : 230;
  const scoreW = narrow ? Math.max(140, width - rosterW - 28) : 288;
  panel('score-board', 12, 74, scoreW, 34);
  label(
    'score',
    narrow
      ? `${g.score}点  🪙${g.cash}${g.burned ? `  焦${g.burned}` : ''}`
      : `${g.score}点   ${g.cash} コイン${g.burned ? `   焦げ ${g.burned}` : ''}`,
    16,
    77,
    scoreW - 8,
    28,
    { size: narrow ? 12 : 14 },
  );
  const duty = new Set(Array.isArray(g.duty) ? g.duty : []);
  const rosterLines = rosterIds.reduce((lines, id) => {
    const staff = STAFF[id];
    const state = staffStateOf(g, id);
    const status = state.rest > 0 ? `休${state.rest}` : duty.has(id) ? '出' : '待';
    if (narrow) {
      lines.push(`${staff.icon ?? '👤'}${status}`);
    } else {
      lines.push(`${staff.icon ?? '👤'} ${staffShortName(id)}  ${status}`);
    }
    return lines;
  }, []);
  const onDutyNames = rosterIds
    .filter((id) => duty.has(id))
    .slice(0, 4)
    .map(staffShortName);
  const narrowRoster = onDutyNames.length
    ? onDutyNames.reduce((lines, name, index) => {
        const row = Math.floor(index / 2);
        lines[row] = `${lines[row] ? `${lines[row]}  ` : ''}${name}`;
        return lines;
      }, [])
    : ['ひとりで営業'];
  const rosterH = narrow ? 42 : Math.max(42, Math.min(112, rosterLines.length * 23 + 12));
  panel('roster-board', width - rosterW - 12, 74, rosterW, rosterH, {
    color: narrow ? '#397864' : undefined,
  });
  label(
    'roster',
    narrow ? narrowRoster.join('\n') : rosterLines.join('\n') || '勤務なし',
    width - rosterW - 8,
    78,
    rosterW - 8,
    rosterH - 8,
    {
      size: narrow ? 12 : 13,
      color: narrow ? '#fff9e8' : undefined,
      label: `勤務一覧：${rosterLines.join('、') || 'ひとりで営業'}`,
    },
  );
  const orderTop = compactHud ? 74 + rosterH + 8 : 16;
  const orderCount = Math.min(3, g.orders.length);
  const orderGap = narrow ? 4 : 10;
  const orderWidth = narrow
    ? (width - 24 - orderGap * Math.max(0, orderCount - 1)) / Math.max(1, orderCount)
    : compactHud
      ? 160
      : 180;
  const orderTotal = orderCount * orderWidth + Math.max(0, orderCount - 1) * orderGap;
  g.orders.slice(0, 3).forEach((o, i) => {
    const left = practice ? null : Math.max(0, Math.ceil((o.deadline - g.time) / 1000));
    const x = width / 2 - orderTotal / 2 + i * (orderWidth + orderGap);
    const y = orderTop;
    const orderHeight = narrow ? 64 : 76;
    const shortRecipe = { dish: 'サラダ', soup: 'スープ', roast: '焼き' }[o.recipe] ?? '料理';
    panel(`ticket-${o.id}`, x, y, orderWidth, orderHeight);
    add('food', `food-${o.id}`, '', x + 2, y + 4, narrow ? 40 : 50, narrow ? 52 : 60, {
      recipe: o.recipe,
    });
    label(
      `order-${o.id}`,
      `${narrow ? shortRecipe : RECIPES[o.recipe].name}\n${left === null ? 'おためし' : `あと ${left} 秒`}`,
      x + (narrow ? 40 : 48),
      y + 8,
      orderWidth - (narrow ? 44 : 52),
      orderHeight - 12,
      { size: narrow ? 10 : 12, color: left !== null && left <= 10 ? '#a1372f' : '#245e50' },
    );
  });
  const near = stationAt(g, 'human');
  const step = TUTORIAL_STEPS[s.tutorial];
  const reached = near.inReach && (s.tutorial === null || near.id === step?.station);
  const stations = narrow ? activeStationIds(g) : [];
  const stationGap = 4;
  const stationColumns = narrow
    ? Math.max(1, Math.floor((width - 24 + stationGap) / (44 + stationGap)))
    : 1;
  const stationRows = narrow ? Math.ceil(stations.length / stationColumns) : 0;
  const stationTop = narrow ? height - 112 - (stationRows - 1) * 48 : height - 112;
  if (playing) {
    if (practice && step) {
      const lessonHeight = narrow ? 36 : 68;
      panel(
        'lesson',
        width / 2 - Math.min(width - 24, 380) / 2,
        narrow ? stationTop - lessonHeight - 12 : height - 140,
        Math.min(width - 24, 380),
        lessonHeight,
        { color: '#f4cd75' },
      );
      label(
        'lesson-copy',
        narrow ? `${STATIONS[step.station].name}をタップ` : `WASDで移動・Eで作業\n${step.label}`,
        width / 2 - Math.min(width - 32, 372) / 2,
        narrow ? stationTop - lessonHeight - 10 : height - 135,
        Math.min(width - 32, 372),
        narrow ? 32 : 56,
        { size: 15 },
      );
    } else if (s.toast && g.time < s.toastUntil) {
      const tw = Math.min(width - 24, 520);
      const toastY = narrow ? stationTop - 50 : height - 112;
      panel('toast-board', (width - tw) / 2, toastY, tw, 38);
      label(
        'toast',
        s.toast.replace(/\p{Extended_Pictographic}|\uFE0F/gu, ''),
        (width - tw) / 2 + 4,
        toastY + 2,
        tw - 8,
        32,
        { size: 14, live: true },
      );
    }
    if (narrow) {
      const w = (width - 24 - stationGap * (stationColumns - 1)) / stationColumns;
      stations.forEach((id, index) => {
        const row = Math.floor(index / stationColumns);
        const col = index % stationColumns;
        button(
          `station-${id}`,
          stationButtonName(id),
          12 + col * (w + stationGap),
          stationTop + row * 48,
          w,
          'station',
          {
            value: id,
            label: `${STATIONS[id].name}へ移動して作業`,
            disabled: s.tutorial !== null && step?.station !== id,
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
  const placementSheet =
    s.phase === 'finished' && s.cleared && view.page === 3 && view.layoutMode === 'layout';
  let prepStatus = view.error || '';
  const pw = Math.min(width - 24, welcome ? 700 : 580);
  const ph = Math.min(
    height - 24,
    s.menuOpen
      ? 400
      : placementSheet
        ? 296
        : s.phase === 'finished' && s.cleared && !s.campaignComplete
          ? 384
          : s.phase === 'finished' && !s.cleared && !s.campaignComplete
            ? 296
            : welcome
              ? narrow
                ? 136
                : 178
              : 256,
  );
  const x = (width - pw) / 2,
    y = welcome ? 20 : placementSheet ? height - ph - 12 : (height - ph) / 2;
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
      s.menuPage === 'help'
        ? 'キッチンの手引き'
        : s.menuPage === 'controls'
          ? '操作設定'
          : s.menuPage === 'diagnostics'
            ? '診断情報'
            : 'ひと休み',
    );
    const page = s.menuPage ?? 'settings';
    if (page === 'controls') {
      const bw = (inside - 16) / 3;
      label('camera-heading', 'カメラ', x + 16, y + 54, inside, 20, {
        size: narrow ? 12 : 14,
        color: '#245e50',
      });
      [
        ['auto', '自動'],
        ['follow', '追従'],
        ['overview', '全体'],
      ].forEach(([mode, text], index) =>
        button(`camera-${mode}`, text, x + 16 + index * (bw + 8), y + 74, bw, 'camera', {
          value: mode,
          pressed: s.cameraMode === mode,
          size: 13,
          label: mode === 'auto' ? 'カメラ：自動（縦は追従、横は全体）' : `カメラ：${text}`,
        }),
      );
      const mw = (inside - 8) / 2;
      label('movement-heading', '移動基準', x + 16, y + 118, inside, 20, {
        size: narrow ? 12 : 14,
        color: '#245e50',
      });
      [
        ['screen', '画面基準'],
        ['grid', 'マス目基準'],
      ].forEach(([mode, text], index) =>
        button(`movement-${mode}`, text, x + 16 + index * (mw + 8), y + 138, mw, 'movement', {
          value: mode,
          pressed: (s.movementMode ?? 'grid') === mode,
          size: 13,
          label: `移動：${text}`,
        }),
      );
      const backW = narrow ? 76 : 120;
      const bgW = inside - backW - 8;
      button('back', '設定に戻る', x + 16, footerY - 54, backW, 'menu-page', {
        value: 'settings',
        size: 13,
      });
      button(
        'background',
        s.backgroundMode ? 'バックグラウンドモード：オン' : 'バックグラウンドモード：オフ',
        x + 24 + backW,
        footerY - 54,
        bgW,
        'background',
        {
          pressed: s.backgroundMode,
          size: 13,
          label: '裏画面でも動き続ける',
        },
      );
    } else if (page === 'help') {
      copy(
        'help',
        `作業台をタップ、または WASD で移動\nE で作業・Shift でダッシュ・Q で片づけ\n切る → お皿をとる → 盛る → 配膳\nLv.${FEATURE_LEVELS.pot} でスープ、Lv.${FEATURE_LEVELS.grill} でグリルが登場`,
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
        ph < 340 ? 68 : 106,
        { size: narrow ? 12 : 15 },
      );
      copy(
        'privacy',
        '相棒の判断にゲーム状態を\nTypeSafe または Cloudflare へ送信します。',
        ph < 340 ? 136 : 180,
        ph < 340 ? 42 : 54,
        { size: 12 },
      );
      const bw = (inside - 8) / 2;
      button('back', '設定に戻る', x + 16, footerY - 54, bw, 'menu-page', {
        value: 'settings',
      });
      button('benchmark', 'jev-bench', x + 24 + bw, footerY - 54, bw, 'link', { href: '/bench' });
    } else {
      button('sound', s.sound ? '音オン' : '音オフ', x + 16, y + 64, inside, 'sound', {
        pressed: s.sound,
        size: 13,
      });
      const nav = (inside - 16) / 3;
      button('controls', '操作設定', x + 16, y + 116, nav, 'menu-page', {
        value: 'controls',
        size: 13,
      });
      button('help', '遊び方', x + 24 + nav, y + 116, nav, 'menu-page', {
        value: 'help',
        size: 13,
      });
      button('diagnostics', '診断', x + 32 + nav * 2, y + 116, nav, 'menu-page', {
        value: 'diagnostics',
        size: 13,
      });
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
    if (s.campaignComplete) {
      title('全100レベル、完走！');
      copy(
        'result',
        `${g.served} / ${g.quota}皿   ・   ${g.score}点\n見事なチームワークでした。`,
        70,
        70,
        {
          size: 17,
        },
      );
      primary('最初から再挑戦', 'start');
    } else {
      title('営業失敗');
      copy(
        'result',
        `${g.served} / ${g.quota}皿   ・   ${g.score}点\n資金・在庫・疲労・設備配置を営業前へ戻せます。`,
        62,
        54,
        { size: narrow ? 13 : 16 },
      );
      button('retry', '同じ条件で再挑戦', x + 16, y + 126, inside, 'retry', { size: 14 });
      button('review', '開店準備から見直す', x + 16, y + 174, inside, 'review', {
        size: 14,
        disabled: !s.rollback?.preparation,
      });
      button('previous', '前のステージへ戻る', x + 16, y + 222, inside, 'previous', {
        size: 14,
        disabled: g.level <= 1 || !s.rollback?.previous,
      });
    }
  } else {
    const bill = purchase(g, view);
    const hint = preparationHint(bill);
    prepStatus = view.error || hint || (view.page >= 2 ? bill.error : '');
    const stars = STAR_SCORES.map((n) => (g.score >= n ? '★' : '☆')).join(' ');
    const bodyTop = y + 68;
    const short = ph < 340;
    if (view.page === 0) {
      title(`Lv.${g.level} 営業クリア`);
      copy('stars', stars, 62, 44, { size: 30, color: '#987018' });
      copy(
        'result',
        `${g.served} / ${g.quota}皿  ・  ${g.score}点\nお財布 ${g.cash}コイン\n次は Lv.${g.level + 1}、${bill.quota}皿を届けよう\n${levelConfig(g.level + 1).unlockLabel}`,
        short ? 102 : 126,
        short ? 90 : 116,
        { size: 17 },
      );
      if (!short && (view.error || hint))
        label('hint', view.error || hint, x + 16, footerY - 72, inside, 30, {
          color: '#a1372f',
          size: 12,
        });
      primary('次のステージ', 'page', { value: g.level < 3 ? 2 : 1 });
    } else if (view.page === 1) {
      title('候補者の採用');
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
        const top = y + (short ? 112 : 116);
        const avatarW = short ? 52 : narrow ? 60 : 76;
        const infoX = x + 24 + avatarW;
        const infoW = x + 16 + inside - infoX;
        const bars = staffPerformance(id);
        const detailsH = short ? 14 : narrow ? 32 : 42;
        const rowH = short ? 14 : narrow ? 19 : 24;
        const barH = short ? 8 : narrow ? 12 : 14;
        const dash = staff.canDash ? '  ・  ダッシュ' : '';
        const cost = `採用 ${staff.cost}  ・  給与 ${staff.wage ?? 0}/営業  ・  お財布 ${g.cash}${dash}`;
        add('avatar', 'applicant-avatar', '', x + 16, top, avatarW, avatarW, {
          color: staff.color,
          label: `${staff.name}の立ち姿`,
        });
        label(
          'applicant-details',
          short ? cost : `${staff.description}\n${cost}`,
          infoX,
          top,
          infoW,
          detailsH,
          {
            size: short ? 11 : narrow ? 12 : 14,
          },
        );
        bars.forEach((bar, index) => {
          const rowY = top + detailsH + index * rowH;
          label(`applicant-bar-${bar.key}-label`, bar.label, infoX, rowY, 46, rowH, {
            size: short ? 10 : narrow ? 11 : 13,
          });
          add(
            'bar',
            `applicant-bar-${bar.key}`,
            '',
            infoX + 48,
            rowY + (rowH - barH) / 2,
            infoW - 48,
            barH,
            {
              ratio: bar.ratio,
              color: staff.color,
              label: `${bar.label}の性能`,
            },
          );
        });
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
    } else if (view.page === 2) {
      title(`Lv.${g.level + 1} 仕入れ・勤務表`);
      const roster = [
        ...new Set([...Object.keys(bill.staffState), ...(view.selected ? [view.selected] : [])]),
      ];
      const duty = [...new Set(Array.isArray(view.duty) ? view.duty : [])].filter((id) =>
        roster.includes(id),
      );
      const columns = 4;
      const gap = 4;
      const cellW = (inside - gap * (columns - 1)) / columns;
      const dutyY = short ? y + 56 : y + 72;
      const nextState = bill.staffState;
      const fatigueVisible = levelConfig(g.level + 1).fatigueEnabled;
      roster.forEach((id, index) => {
        const staff = STAFF[id];
        const projected = nextState[id] ?? { worked: 0, rest: 0 };
        const available =
          (!g.staffState?.[id] && id === view.selected) || staffAvailable(nextState, id);
        const onDuty = duty.includes(id);
        const availability =
          fatigueVisible || id === 'veteran'
            ? projected.rest > 0
              ? `休${projected.rest}`
              : `あと${staff.maxConsecutive - projected.worked}勤`
            : onDuty
              ? '出勤'
              : '待機';
        const employment = staff.employment ?? '雇用';
        const wage = staff.wage ?? 0;
        const row = Math.floor(index / columns);
        const col = index % columns;
        button(
          `duty-${id}`,
          `${staffShortName(id)}\n${availability}`,
          x + 16 + col * (cellW + gap),
          dutyY + row * 48,
          cellW,
          'duty',
          {
            value: id,
            pressed: onDuty,
            disabled:
              Boolean(levelConfig(g.level + 1).partner) ||
              (!available && !onDuty) ||
              (!onDuty && duty.length >= bill.slots),
            avatar: cellW >= 88 ? staff.color : undefined,
            label: `${staff.name}（${employment}、給与${wage}/営業、連勤上限${staff.maxConsecutive}回、休養${staff.restShifts}営業）。現在${onDuty ? '出勤中' : '待機中'}。${
              available ? (onDuty ? '勤務から外す' : '勤務に入れる') : '休養中で配置不可'
            }`,
            size: narrow ? 13 : 11,
          },
        );
      });
      const dutyRows = Math.max(1, Math.ceil(roster.length / columns));
      const sy = short ? y + 56 + dutyRows * 48 + 4 : y + 86 + dutyRows * 48;
      label(
        'duty-summary',
        bill.error && short
          ? bill.error
          : duty.length === 0
            ? `ひとりで営業  ・  給与 🪙0${short ? `  残り🪙${bill.cash}` : ''}`
            : `出勤 ${duty.length}/${bill.slots}人  ・  勤務給与 🪙${bill.wages}${short ? `  残り🪙${bill.cash}` : ''}`,
        x + 16,
        sy - 4,
        inside,
        28,
        { size: 11, color: bill.error && short ? '#a1372f' : undefined },
      );
      const stockY = sy + 22;
      label('stock-label', `${STOCK_PRICE} / 個`, x + 16, stockY, inside - 168, 44, { size: 13 });
      button('less', '−', x + pw - 180, stockY, 44, 'quantity', {
        value: -1,
        label: '仕入れを1個減らす',
        disabled: bill.quantity <= 0,
      });
      add('number', 'quantity', String(view.quantity), x + pw - 132, stockY, 64, 44, {
        label: '仕入れ個数',
        action: 'quantity-input',
      });
      button('more', '＋', x + pw - 64, stockY, 44, 'quantity', {
        value: 1,
        label: '仕入れを1個増やす',
        disabled: bill.quantity >= 99,
      });
      if (!short)
        copy(
          'bill',
          `在庫 ${g.stock ?? 0} → ${Number.isFinite(bill.stock) ? bill.stock : '—'}個 / ノルマ ${bill.quota}皿\n採用 ${bill.hiring} ＋ 仕入れ ${Number.isFinite(bill.quantity) ? bill.quantity * STOCK_PRICE : '—'} ＋ 給与 ${bill.wages} / 残り ${Number.isFinite(bill.cash) ? bill.cash : '—'}コイン`,
          stockY + 48 - y,
          42,
          { size: 12 },
        );
      const warning = view.error || hint || bill.error;
      if (!short && warning && stockY + 128 <= footerY)
        label('hint', warning, x + 16, stockY + 102 - y, inside, 26, {
          color: '#a1372f',
          size: 12,
          live: true,
        });
      const backW = narrow ? 72 : 120;
      const equipmentW = narrow ? 68 : 100;
      button('back', g.level < 3 ? '戻る' : '採用', x + 16, footerY, backW, 'page', {
        value: g.level < 3 ? 0 : 1,
        size: 13,
      });
      button('equipment', '設備', x + 24 + backW, footerY, equipmentW, 'page', {
        value: 3,
        size: 13,
        label: '設備投資を見る',
      });
      button(
        'primary',
        'この準備で開店',
        x + 32 + backW + equipmentW,
        footerY,
        inside - backW - equipmentW - 16,
        'next',
        {
          disabled: Boolean(bill.error),
          color: '#245e50',
          ink: '#fff9e8',
          size: 14,
        },
      );
    } else {
      title(`Lv.${g.level + 1} 設備投資`);
      const baseEquipment = g.equipment ?? null;
      const pending = new Set(bill.equipmentPurchases);
      const nextLevel = g.level + 1;
      const layoutMode = view.layoutMode === 'layout' ? 'layout' : 'equipment';
      const layoutGame = { ...g, level: nextLevel, equipment: bill.equipment };
      const currentLayout = bill.layout ?? view.layout ?? g.layout ?? {};
      const capacity = equipmentCapacity(bill.equipment);

      const backW = narrow ? 76 : 120;
      const modeW = narrow ? 64 : 88;
      button('back', '仕入れへ', x + 16, footerY, backW, 'page', { value: 2, size: 13 });
      button(
        'layout-mode',
        layoutMode === 'layout' ? '設備' : '配置',
        x + 24 + backW,
        footerY,
        modeW,
        'layout-mode',
        {
          label: layoutMode === 'layout' ? '設備一覧へ戻る' : '設備の配置を変更',
          size: 13,
        },
      );
      button(
        'primary',
        'この準備で開店',
        x + 32 + backW + modeW,
        footerY,
        inside - backW - modeW - 16,
        'next',
        {
          disabled: Boolean(bill.error),
          color: '#245e50',
          ink: '#fff9e8',
          size: 14,
        },
      );

      if (layoutMode === 'layout') {
        const slotMap = layoutSlots(layoutGame) ?? {};
        const slots = Object.entries(slotMap);
        const stationIds = [
          ...new Set([
            ...activeStationIds(layoutGame),
            ...(bill.equipment?.warmer?.count ? ['warmer'] : []),
            ...Object.keys(currentLayout),
          ]),
        ];
        const movable = stationIds.filter((id) => {
          try {
            return Boolean(stationInfo(layoutGame, id) ?? STATIONS[id]);
          } catch {
            return Boolean(STATIONS[id]);
          }
        });
        const selected = movable.includes(view.layoutSelection) ? view.layoutSelection : null;
        const entries = selected
          ? slots.map(([id, meta]) => ({ id, meta }))
          : movable.map((id) => ({ id, meta: stationInfo(layoutGame, id) }));
        const pageCount = Math.max(1, Math.ceil(entries.length / 2));
        const layoutIndex = Math.min(
          pageCount - 1,
          Math.max(0, Math.floor(Number(view.layoutIndex) || 0)),
        );
        const visible = entries.slice(layoutIndex * 2, layoutIndex * 2 + 2);
        if (pageCount > 1) {
          button('layout-prev', '‹', x + 16, bodyTop, 44, 'layout-index', {
            value: -1,
            disabled: layoutIndex === 0,
            label: '前の配置ページ',
          });
          if (selected)
            button('layout-back', '設備を選ぶ', x + 66, bodyTop, inside - 116, 'layout-select', {
              value: null,
              size: 12,
            });
          else
            label(
              'layout-page',
              `設備  ${layoutIndex + 1}/${pageCount}`,
              x + 66,
              bodyTop,
              inside - 116,
              44,
              {
                size: narrow ? 11 : 13,
              },
            );
          button('layout-next', '›', x + pw - 60, bodyTop, 44, 'layout-index', {
            value: 1,
            disabled: layoutIndex >= pageCount - 1,
            label: '次の配置ページ',
          });
        } else if (selected) {
          button('layout-back', '設備を選ぶ', x + 16, bodyTop, inside, 'layout-select', {
            value: null,
            size: 12,
          });
        } else {
          label(
            'layout-heading',
            selected ? `${stationName(layoutGame, selected)}の移動先` : '移動する設備を選ぶ',
            x + 16,
            bodyTop,
            inside,
            44,
            { size: narrow ? 12 : 14 },
          );
        }
        const rowTop = bodyTop + 44;
        visible.forEach(({ id }, index) => {
          const row = rowTop + index * 44;
          if (!selected) {
            const slot = layoutSlotOf(currentLayout, id);
            button(
              `layout-select-${id}`,
              `${stationName(layoutGame, id)}\n${layoutPositionName(slotMap, slot)}`,
              x + 16,
              row,
              inside,
              'layout-select',
              {
                value: id,
                pressed: false,
                label: `${stationName(layoutGame, id)}を移動。現在${layoutPositionName(slotMap, slot)}`,
                size: narrow ? 11 : 13,
              },
            );
            return;
          }
          const slotId = id;
          const owner = Object.entries(currentLayout).find(([, value]) => value === slotId)?.[0];
          const occupied = owner && owner !== selected;
          const proposed = layoutWithMove(currentLayout, selected, slotId);
          let valid = false;
          try {
            valid = Boolean(resolveLayout(layoutGame, proposed));
          } catch {
            valid = false;
          }
          const name = layoutPositionName(slotMap, slotId);
          button(
            `layout-slot-${slotId}`,
            `${name}${layoutSlotOf(currentLayout, selected) === slotId ? '\n現在地' : ''}`,
            x + 16,
            row,
            inside,
            'layout-slot',
            {
              value: slotId,
              layout: proposed,
              pressed: layoutSlotOf(currentLayout, selected) === slotId,
              disabled: !valid,
              label: `${name}${occupied ? '（入れ替え）' : 'へ移動'}`,
              size: narrow ? 11 : 13,
            },
          );
        });
        if (!visible.length)
          label('layout-empty', '移動できる区画がありません', x + 16, rowTop, inside, 44, {
            size: 12,
            color: '#a1372f',
          });
        const layoutSummary = selected
          ? `${stationName(layoutGame, selected)}を選択中`
          : `設備枠 ${capacity.used}/${capacity.limit}`;
        label('layout-summary', layoutSummary, x + 16, rowTop + 88 + 4, inside, 28, {
          size: narrow ? 11 : 13,
        });
      } else {
        const kinds = Object.keys(EQUIPMENT);
        const pageCount = Math.max(1, Math.ceil(kinds.length / 2));
        const equipmentIndex = Math.min(
          pageCount - 1,
          Math.max(0, Math.floor(Number(view.equipmentIndex) || 0)),
        );
        const visibleKinds = kinds.slice(equipmentIndex * 2, equipmentIndex * 2 + 2);
        const equipmentBudget = g.cash - bill.hiring - bill.quantity * STOCK_PRICE - bill.wages;
        const optionQuote = (id) => {
          const purchases = pending.has(id)
            ? bill.equipmentPurchases.filter((purchaseId) => purchaseId !== id)
            : [...bill.equipmentPurchases, id];
          return quoteEquipment(baseEquipment, purchases, nextLevel);
        };
        const optionText = (id, action) => {
          const quote = optionQuote(id);
          if (pending.has(id)) return '取消';
          const status = equipmentOptionStatus(quote.error);
          if (status) return status;
          if (quote.cost > equipmentBudget) return '資金不足';
          const incremental = Math.max(0, quote.cost - bill.equipmentCost);
          return `${action} 🪙${incremental}`;
        };
        const optionLabel = (kind, id, action) => {
          const equipmentMeta = EQUIPMENT[kind];
          const quote = optionQuote(id);
          const incremental = Math.max(0, quote.cost - bill.equipmentCost);
          return `${equipmentMeta.name ?? kind}の${action}（${quote.error || `費用${incremental}コイン`}）`;
        };
        const buttonW = narrow ? 86 : 112;
        const labelW = inside - buttonW * 2 - 8;
        if (pageCount > 1) {
          button('equipment-prev', '‹', x + 16, bodyTop, 44, 'equipment-index', {
            value: -1,
            disabled: equipmentIndex === 0,
            label: '前の設備ページ',
          });
          label(
            'equipment-page',
            `${equipmentIndex + 1} / ${pageCount}`,
            x + 66,
            bodyTop,
            inside - 116,
            44,
            { size: 13 },
          );
          button('equipment-next', '›', x + pw - 60, bodyTop, 44, 'equipment-index', {
            value: 1,
            disabled: equipmentIndex >= pageCount - 1,
            label: '次の設備ページ',
          });
        }
        const rowTop = bodyTop + (pageCount > 1 ? 44 : 0);
        visibleKinds.forEach((kind, index) => {
          const meta = EQUIPMENT[kind];
          const current = bill.equipment?.[kind] ?? { count: meta.initialCount ?? 0, level: 1 };
          const row = rowTop + index * 44;
          const addId = `add_${kind}`;
          const upgradeId = `upgrade_${kind}`;
          const addQuote = optionQuote(addId);
          const upgradeQuote = optionQuote(upgradeId);
          const maxCount = meta.maxCount ?? (kind === 'warmer' ? 1 : 2);
          const addDisabled =
            !pending.has(addId) &&
            (current.count >= maxCount ||
              nextLevel < meta.addUnlockLevel ||
              Boolean(addQuote.error) ||
              addQuote.cost > equipmentBudget);
          const upgradeDisabled =
            !pending.has(upgradeId) &&
            (current.level >= 3 ||
              current.count < 1 ||
              nextLevel < (meta.upgradeUnlockLevel ?? meta.unlockLevel) ||
              Boolean(upgradeQuote.error) ||
              upgradeQuote.cost > equipmentBudget);
          const effect = equipmentEffect(kind, current);
          label(
            `equipment-label-${kind}`,
            narrow
              ? `${meta.name ?? kind}\n${current.count}台 Lv${current.level}\n${effect}`
              : `${meta.name ?? kind}\n${current.count}台 Lv${current.level}・${effect}`,
            x + 16,
            row,
            labelW,
            44,
            { size: narrow ? 11 : 13 },
          );
          if (kind !== 'kitchen')
            button(
              `equipment-add-${kind}`,
              optionText(addId, '増設'),
              x + 16 + labelW + 4,
              row,
              buttonW,
              'equipment',
              {
                value: addId,
                disabled: addDisabled,
                pressed: pending.has(addId),
                label: optionLabel(kind, addId, '増設'),
                size: narrow ? 10 : 12,
              },
            );
          button(
            `equipment-upgrade-${kind}`,
            optionText(upgradeId, '改良'),
            x + 16 + labelW + (kind === 'kitchen' ? 4 : buttonW + 8),
            row,
            buttonW,
            'equipment',
            {
              value: upgradeId,
              disabled: upgradeDisabled,
              pressed: pending.has(upgradeId),
              label: optionLabel(kind, upgradeId, '改良'),
              size: narrow ? 10 : 12,
            },
          );
        });
        const summaryY = rowTop + visibleKinds.length * 44 + 4;
        label(
          'equipment-summary',
          bill.error && short
            ? bill.error
            : `設備枠 ${capacity.used}/${capacity.limit}  投資 🪙${bill.equipmentCost} / 残り 🪙${bill.cash}`,
          x + 16,
          summaryY,
          inside,
          28,
          { size: narrow ? 11 : 13, color: bill.error && short ? '#a1372f' : undefined },
        );
        const warning = view.error || hint || bill.error;
        if (!short && warning && summaryY + 52 <= footerY)
          label('hint', warning, x + 16, summaryY + 26 - y, inside, 26, {
            color: '#a1372f',
            size: 12,
            live: true,
          });
      }
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
    status: prepStatus,
  };
}

// The model must see what the player sees. This projects the rendered screen
// into model context, so any text added to `screen` reaches the model and the
// two representations cannot drift apart.
export function screenContext(s, view, width, height) {
  const { items, modal, title, status } = screen(s, view, width, height);
  return {
    modal,
    title: title ?? null,
    status: status || null,
    items: items
      .filter((item) => item.text || item.label || item.recipe)
      .map((item) => ({
        id: item.id,
        text: item.text || null,
        ...(item.label && item.label !== item.text ? { label: item.label } : {}),
        ...(item.recipe ? { recipe: item.recipe } : {}),
        ...(item.disabled ? { disabled: true } : {}),
        ...(item.pressed ? { pressed: true } : {}),
      })),
  };
}
