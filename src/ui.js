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
} from './model.js';
import { STAFF, nextStaffState, payroll, staffAvailable } from './staff.js';
import { TUTORIAL_STEPS } from './game.js';

export const compactControls = (width, height) => width < 600 || height < 500;

export function preparation(g, reviewing = false) {
  const duty = [...new Set(Array.isArray(g.duty) ? g.duty : [])];
  return {
    page: reviewing ? 1 : 0,
    applicantIndex: 0,
    selected: null,
    duty,
    quantity: Math.max(0, quotaForLevel(g.level + 1) + 2 - (g.stock ?? 0)),
  };
}

function staffStateOf(g, id) {
  return g.staffState?.[id] ?? { worked: 0, rest: 0 };
}

function staffSlots(level) {
  return levelConfig(level).staffSlots;
}

function forecastStaffState(g) {
  return levelConfig(g.level + 1).fatigueEnabled ? nextStaffState(g) : g.staffState;
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
  const cash = g.cash - hiring - quantity * STOCK_PRICE - wages;
  const quota = quotaForLevel(g.level + 1);
  const error = !valid
    ? '仕入れは0〜99個で入力'
    : stock < quota
      ? `あと${quota - stock}個の仕入れが必要`
      : duty.length > slots
        ? `このレベルの勤務上限は${slots}人`
        : !available
          ? '休養中の相棒は配置できません'
          : cash < 0
            ? `コインが${-cash}不足`
            : '';
  return { quantity, hiring, wages, duty, slots, stock, cash, quota, staffState, error };
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
        : s.phase === 'finished' && !s.cleared && !s.campaignComplete
          ? 296
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
        : view.menuPage === 'controls'
          ? '操作設定'
          : view.menuPage === 'diagnostics'
            ? '診断情報'
            : 'ひと休み',
    );
    const page = view.menuPage ?? 'settings';
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
      button('back', '設定に戻る', x + 16, footerY - 54, inside, 'menu-page', {
        value: 'settings',
      });
    } else if (page === 'help') {
      copy(
        'help',
        '作業台をタップ、または WASD で移動\nE で作業・Shift でダッシュ・Q で片づけ\n切る → お皿をとる → 盛る → 配膳\nLv.5 でスープ、Lv.10 でグリルが登場',
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
      const bw = (inside - 8) / 2;
      button('sound', s.sound ? '音オン' : '音オフ', x + 16, y + 64, bw, 'sound', {
        pressed: s.sound,
        size: 13,
      });
      button('controls', '操作設定', x + 24 + bw, y + 64, bw, 'menu-page', {
        value: 'controls',
        size: 13,
      });
      button('help', '遊び方', x + 16, y + 116, bw, 'menu-page', { value: 'help', size: 13 });
      button('diagnostics', '診断', x + 24 + bw, y + 116, bw, 'menu-page', {
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
        `${g.served} / ${g.quota}皿   ・   ${g.score}点\n資金・在庫・疲労は営業前の状態に戻せます。`,
        62,
        54,
        { size: narrow ? 13 : 16 },
      );
      button('retry', '同じ条件で再挑戦', x + 16, y + 126, inside, 'retry', { size: 14 });
      button('review', '仕入れ・採用から見直す', x + 16, y + 174, inside, 'review', {
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
          `${staff.description}\n速さ ×${staff.speed}  ・  判断 ${(staff.decisionMs / 1000).toFixed(1)}秒ごと${staff.canDash ? ' ・ ダッシュ' : ''}\n採用 ${staff.cost}  ・ 給与 ${staff.wage ?? 0}/営業 / お財布 ${g.cash}`,
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
      title(`Lv.${g.level + 1} 仕入れ・勤務表`);
      const roster = staffIds(g, view);
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
        const availability = fatigueVisible
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
          narrow
            ? `${staffShortName(id)}\n${availability}`
            : `${staff.icon ?? '👤'} ${staffShortName(id)}\n${availability}`,
          x + 16 + col * (cellW + gap),
          dutyY + row * 48,
          cellW,
          'duty',
          {
            value: id,
            pressed: onDuty,
            disabled: (!available && !onDuty) || (!onDuty && duty.length >= bill.slots),
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
      if ((bill.error || view.error) && !short)
        copy('error', view.error || bill.error, short ? stockY + 82 - y : stockY + 102 - y, 26, {
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
