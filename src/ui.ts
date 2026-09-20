import {
  RECIPES,
  ITEM_NAMES,
  STAR_SCORES,
  STOCK_PRICE,
  quotaForLevel,
  stationAt,
  actionHint,
  handoffOption,
  STATIONS,
  activeStationIds,
  levelConfig,
  MAX_LEVEL,
  layoutSlots,
  resolveLayout,
  stationInfo,
  recommendedStock,
  cookingAdvice,
  repeatsActions,
} from './model.ts';
import {
  STAFF,
  nextStaffState,
  payroll,
  staffAvailable,
  staffPerformance,
  nextDuty,
} from './staff.ts';
import { TUTORIAL_STEPS } from './game.ts';
import { EQUIPMENT, equipmentCapacity, quoteEquipment } from './equipment.ts';
import { MAX_TRAINING, VITAMINS, quoteVitamins, trainingLevel } from './training.ts';
import type { VitaminId } from './training.ts';
import type {
  EquipmentCount,
  EquipmentKind,
  GameState,
  Layout,
  PrepareStage,
  ScreenExtra,
  ScreenItem,
  ScreenKind,
  StationSlot,
  StoreState,
  ViewState,
} from './types.ts';

export const compactControls = (width: number, height: number): boolean =>
  width < 600 || height < 500;

// Main call-to-action height, so 開店-type buttons stay comfortably tappable.
const ACTION_HEIGHT = 68;

export function preparation(g: GameState, reviewing = false): ViewState {
  const duty = nextDuty(g);
  return {
    page: reviewing ? (g.level < 3 ? 2 : 1) : 0,
    applicantIndex: 0,
    selected: null,
    duty,
    quantity: recommendedStock(g),
    equipmentPurchases: [],
    equipmentIndex: 0,
    vitamins: [],
    vitaminItem: null,
    layout: g.layout ? { ...g.layout } : undefined,
    layoutMode: 'equipment',
    layoutSelection: null,
    layoutIndex: 0,
    stagePage: 0,
  };
}

function staffStateOf(g: GameState, id: string) {
  return g.staffState?.[id] ?? { worked: 0, rest: 0 };
}

function staffSlots(level: number): number {
  return levelConfig(level).staffSlots;
}

function forecastStaffState(g: GameState) {
  return nextStaffState(g);
}

function staffIds(g: GameState, view: ViewState): string[] {
  return [
    ...new Set([
      ...(Array.isArray(g.hired) ? g.hired : []),
      ...(view.selected ? [view.selected] : []),
    ]),
  ].filter((id) => STAFF[id]);
}

function staffShortName(id: string): string {
  return STAFF[id]?.name?.split('の').at(-1) ?? id;
}

export function purchase(g: GameState, view: ViewState) {
  const quantity = Number(view.quantity);
  const valid = /^\d{1,2}$/.test(String(view.quantity)) && Number.isInteger(quantity);
  const hiring = view.selected ? (STAFF[view.selected]?.cost ?? Infinity) : 0;
  const duty = [...new Set(Array.isArray(view.duty) ? view.duty : [])].filter((id) => STAFF[id]);
  const slots = staffSlots(g.level + 1);
  const wages = payroll(duty);
  const staffState = forecastStaffState(g);
  const available = duty.every(
    (id) => (!staffState[id] && id === view.selected) || staffAvailable(staffState, id),
  );
  const stock = (g.stock ?? 0) + quantity;
  const equipmentPurchases = [
    ...new Set(Array.isArray(view.equipmentPurchases) ? view.equipmentPurchases : []),
  ];
  const equipmentQuote = quoteEquipment(g.equipment ?? null, equipmentPurchases, g.level + 1);
  const equipment = equipmentQuote.equipment;
  const equipmentCost = equipmentQuote.cost;
  const vitamins = Array.isArray(view.vitamins) ? view.vitamins : [];
  const vitaminTargets = [
    'human',
    ...new Set([...Object.keys(staffState), ...(view.selected ? [view.selected] : [])]),
  ];
  const vitaminQuote = quoteVitamins(g.training, vitamins, vitaminTargets);
  const vitaminCost = vitaminQuote.cost;
  const layoutGame = { ...g, level: g.level + 1, equipment };
  const proposedLayout = view.layout ?? g.layout;
  const layout =
    resolveLayout(layoutGame, proposedLayout) ?? normalizedLayout(layoutGame, proposedLayout);
  const cash = g.cash - hiring - quantity * STOCK_PRICE - wages - equipmentCost - vitaminCost;
  const quota = quotaForLevel(g.level + 1);
  const error = !valid
    ? '仕入れは0〜99個で入力'
    : stock < quota
      ? `あと${quota - stock}個の仕入れが必要`
      : levelConfig(g.level + 1).partner &&
          (duty.length !== 1 || duty[0] !== levelConfig(g.level + 1).partner)
        ? 'この営業の相棒は店長です'
        : duty.length > slots
          ? `このレベルの勤務上限は${slots}人`
          : !available
            ? '休養中の相棒は配置できません'
            : equipmentQuote.error
              ? equipmentQuote.error
              : vitaminQuote.error
                ? vitaminQuote.error
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
    vitamins,
    training: vitaminQuote.training,
    vitaminCost,
    layout,
    error,
  };
}

// Stock errors use the same bill as the human purchase and benchmark.
export function preparationHint(bill: ReturnType<typeof purchase>): string {
  if (Number.isFinite(bill.stock) && bill.stock < bill.quota)
    return `あと${bill.quota - bill.stock}個の仕入れが必要`;
  return '';
}

export function preparationKey(plan: ViewState): string {
  const { selected: hire, duty, quantity, equipmentPurchases, vitamins } = plan;
  return JSON.stringify({ stage: plan.stage, hire, duty, quantity, equipmentPurchases, vitamins });
}

export function editPreparation(
  view: ViewState,
  values: Partial<ViewState>,
  label: string,
): ViewState {
  const next: ViewState = { ...view, error: '', ...values };
  if (!['selected', 'duty', 'quantity', 'equipmentPurchases', 'vitamins'].some((k) => k in values))
    return next;
  const key = preparationKey(next);
  if (key === preparationKey(view)) return next;
  const history = view.history ?? [{ key: preparationKey(view), label: '' }];
  return {
    ...next,
    looping: history.some((h) => h.key === key),
    history: [
      ...history.slice(-5),
      { key, label: 'quantity' in values ? `${label}：${next.quantity}個` : label },
    ],
  };
}

export function loopHint(preparing: boolean): string {
  return preparing
    ? '同じ購入予定に戻っています。購入と取消が繰り返されています。'
    : '同じ操作が続き、仕入れ消費・配膳が進んでいません。';
}

export function staffingOutlook(g: GameState, plan: ViewState): string {
  if (!levelConfig(g.level + 1).fatigueEnabled || g.level + 1 >= MAX_LEVEL) return '';
  const forecast = nextStaffState({
    level: g.level + 1,
    hired: staffIds(g, plan),
    duty: plan.duty ?? [],
    staffState: nextStaffState(g),
  });
  const available = Object.keys(forecast).filter((id) => staffAvailable(forecast, id));
  const cooks = available.filter((id) => STAFF[id].capabilities.includes('cook'));
  return `翌営業に出勤できる相棒${available.length}人・加熱担当${cooks.length}人`;
}

export function preparationAdvice(
  g: GameState,
  plan: ViewState,
): { instructions: string; hint: string } {
  const bill = purchase(g, plan);
  const available = Object.entries(bill.staffState)
    .filter(([, schedule]) => schedule.rest === 0)
    .map(([id]) => id);
  if (plan.selected && !available.includes(plan.selected)) available.push(plan.selected);
  const cooks = available.filter((id) => STAFF[id].capabilities.includes('cook'));
  const training = bill.training.human ?? { move: 0, cook: 0 };
  const outlook = staffingOutlook(g, plan);
  const advice: Record<string, { instructions: string; hint: string }> = {
    hiring: {
      instructions: `${available.length} hired staff are available next shift; ${cooks.length} can heat food. Hiring has a one-time cost; assigned staff also receive wages each shift. Hiring and duty assignment are separate. Unspent coins carry over.`,
      hint: `次に出勤できる在籍者は${available.length}人、うち加熱担当は${cooks.length}人です。採用費は初回、給与は出勤ごとにかかります。採用と勤務への配置は別です。残金は持ち越せます。`,
    },
    staffing: {
      instructions: `The next shift has ${bill.slots} staff slots. Available heat cooks: ${cooks.join(', ') || 'none'}. Each option is a complete roster. ${levelConfig(g.level + 1).fatigueEnabled ? 'Consecutive work leads to mandatory rest; a shift off resets the consecutive count.' : ''} Staff capabilities determine which tasks they can perform.`,
      hint: `次の勤務枠は${bill.slots}人。出勤できる加熱担当：${cooks.map((id) => STAFF[id].name).join('・') || 'なし'}。${levelConfig(g.level + 1).fatigueEnabled ? '続けて働くと休養が必要です。休むと連勤数が戻ります。' : ''}担当できる作業は役割ごとに異なります。${outlook ? `この勤務のあと：${outlook}。` : ''}`,
    },
    stock: {
      instructions:
        'recommended_purchase is an estimate, not a requirement. One tomato makes one dish, unsold stock carries over, and purchases share the same cash balance with wages and upgrades. The purchase quantity is editable.',
      hint: `推奨仕入れは${recommendedStock(g)}個（前回${g.served}皿販売・残在庫${g.stock ?? 0}個）。トマト1個で1皿、仕入れは1個${STOCK_PRICE}コイン。残りは次へ持ち越せます。仕入れ量は変更できます。\nおしながき：${Object.values(
        RECIPES,
      )
        .map((r) => `${r.name} ${r.price}コイン`)
        .join('・')}`,
    },
    investment: {
      instructions:
        'A station serves one actor at a time. Equipment additions allow parallel work. Purchases become final at open_shift; cash_remaining already deducts pending purchases, stock and wages.',
      hint: `購入予定後は出勤${bill.duty.length}人・まな板${bill.equipment.board.count}台。同じ作業台を同時に使えるのは1人です。自分の育成：移動${training.move}/${MAX_TRAINING}・調理${training.cook}/${MAX_TRAINING}。育成は1個${VITAMINS.move.cost}コインで1人の移動＋4%／調理時間−4%、効果は持続します。設備を増やすと並行作業ができます。まな板・鍋・グリルの強化で調理が速くなります。残金は購入予定・仕入れ・給与を差し引いた額で、持ち越せます。購入は開店時に確定します。`,
    },
  };
  return (
    advice[plan.stage ?? ''] ?? {
      instructions:
        'Hiring, staffing, stock and upgrades share the available cash. Each choice edits a pending plan; open_shift commits it.',
      hint: '採用・勤務・仕入れ・投資は同じ所持金から支払われ、開店時にまとめて確定します。',
    }
  );
}

function layoutSlotOf(layout: Layout | null | undefined, id: string): string | null {
  return typeof layout?.[id] === 'string' ? layout[id] : null;
}

function normalizedLayout(g: GameState, proposed: Layout | null | undefined): Layout | null {
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

function layoutWithMove(layout: Layout, id: string, slot: string): Layout {
  const next = { ...layout };
  const previous = next[id];
  const owner = Object.entries(next).find(([, value]) => value === slot)?.[0];
  next[id] = slot;
  if (owner && owner !== id && previous) next[owner] = previous;
  return next;
}

function stationName(g: GameState, id: string): string {
  const info = stationInfo(g, id);
  return info?.name ?? STATIONS[id]?.name ?? id;
}

export function equipmentEffect(kind: string, state: EquipmentCount | undefined): string {
  const level = Math.max(1, Math.min(3, Number(state?.level) || 1));
  if (kind === 'warmer')
    return (state?.count ?? 0) > 0 ? `焦げ猶予×${[1, 1.5, 1.75, 2][level]}` : '未導入';
  if (kind === 'kitchen') return `床+${(level - 1) * 2}列`;
  return `時間-${(level - 1) * 8}%`;
}

function equipmentOptionStatus(error: string | null | undefined): string | null {
  if (!error) return null;
  if (/枠が足りません/.test(error)) return '枠不足';
  if (/これ以上/.test(error)) return '上限';
  if (/先に/.test(error)) return '先に導入';
  if (/Lv\d+から/.test(error)) return error.match(/Lv\d+から/)?.[0] ?? '未解禁';
  if (/改良のみ/.test(error)) return '改良のみ';
  return '購入不可';
}

function stationButtonName(id: string): string {
  if (id.startsWith('board')) return `切る${id === 'board' ? '' : '2'}`;
  if (id.startsWith('pot')) return `煮る${id === 'pot' ? '' : '2'}`;
  if (id.startsWith('grill')) return `焼く${id === 'grill' ? '' : '2'}`;
  if (id === 'plates') return '皿';
  if (id === 'serve') return '配膳';
  return STATIONS[id]?.name ?? id;
}

function layoutPositionName(slots: Record<string, StationSlot>, id: string): string {
  const slot = slots[id];
  if (!slot) return '未配置';
  const side = slot.dx > 0 ? '右' : slot.dy > 0 ? '手前' : '奥';
  const orderBy: 'x' | 'y' = side === '右' ? 'y' : 'x';
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
export function screen(
  s: StoreState,
  view: ViewState,
  width: number,
  height: number,
): { items: ScreenItem[]; modal: string | null; title: string; status: string } {
  const g = s.game;
  const items: ScreenItem[] = [];
  const narrow = compactControls(width, height);
  const compactHud = width < 1060;
  const playing = s.phase === 'playing';
  const practice = g.practice;
  let order = 2000;
  const add = (
    kind: ScreenKind,
    id: string,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    extra: ScreenExtra = {},
  ): void => {
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
  };
  const label = (
    id: string,
    text: string,
    x: number,
    y: number,
    w: number,
    h = 30,
    extra?: ScreenExtra,
  ) => add('text', id, text, x, y, w, h, extra);
  const panel = (id: string, x: number, y: number, w: number, h: number, extra?: ScreenExtra) =>
    add('panel', id, '', x, y, w, h, extra);
  const button = (
    id: string,
    text: string,
    x: number,
    y: number,
    w: number,
    action: string,
    extra?: ScreenExtra,
  ) =>
    add('button', id, text, x, y, w, 44, {
      action,
      ...extra,
      ...(s.autoMode && ['station', 'interact', 'dash', 'clear'].includes(action)
        ? { disabled: true }
        : {}),
    });
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
  const rosterLines = rosterIds.reduce<string[]>((lines, id) => {
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
    ? onDutyNames.reduce<string[]>((lines, name, index) => {
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
    const urgency =
      left === null || !(o.duration > 0)
        ? null
        : Math.min(1, Math.max(0, 1 - (o.deadline - g.time) / o.duration));
    panel(`ticket-${o.id}`, x, y, orderWidth, orderHeight, {
      progress: urgency,
      progressColor: left !== null && left <= 10 ? '#c7594b' : '#76b59b',
    });
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
  const step = s.tutorial === null ? undefined : TUTORIAL_STEPS[s.tutorial];
  const reached = near.inReach && (s.tutorial === null || near.id === step?.station);
  const stations = narrow ? activeStationIds(g) : [];
  const portrait = width < height;
  const stationGap = 4;
  const stationColumns = narrow
    ? Math.min(
        stations.length,
        Math.max(Math.ceil(stations.length / 2), Math.floor((width - 20) / (portrait ? 68 : 48))),
      )
    : 1;
  const stationRows = narrow ? Math.ceil(stations.length / stationColumns) : 0;
  const stationHeight = portrait ? 64 : 44;
  const stationTop = narrow
    ? height - 68 - stationRows * (stationHeight + stationGap)
    : height - 112;
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
        narrow
          ? `${(s.tutorial ?? 0) + 1}/5  ${STATIONS[step.station].name}をタップ`
          : `WASDで移動・Eで作業\n${step.label}`,
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
    } else if (!practice && (!narrow || !portrait)) {
      const advice =
        s.benchFeedback?.loop || repeatsActions(g.human.lastActions ?? [], g)
          ? '同じ操作が続いています。ヒントに履歴があります。'
          : `${cookingAdvice(g).hint.split('。')[0]}。`;
      const w = Math.min(width - 24, 520);
      button(
        'advice',
        advice,
        (width - w) / 2,
        narrow ? stationTop - 50 : height - 112,
        w,
        'advice',
        { size: narrow ? 11 : 14, label: `ヒント：${advice}` },
      );
    }
    if (narrow) {
      if (portrait && !step && !(s.toast && g.time < s.toastUntil)) {
        const held = g.human.carrying;
        panel('hands-board', 12, stationTop - 50, width - 96, 44);
        if (!practice)
          button('advice', 'ヒント', width - 80, stationTop - 50, 64, 'advice', { size: 13 });
        if (held) add('food', 'hands-food', '', 18, stationTop - 44, 34, 34, { recipe: held });
        label(
          'hands',
          s.movingTo
            ? `${STATIONS[s.movingTo].name}へ移動中`
            : held
              ? `手持ち：${ITEM_NAMES[held]}`
              : '作業台をタップで移動・作業',
          held ? 56 : 16,
          stationTop - 44,
          width - (held ? 144 : 104),
          34,
          { size: 13 },
        );
      }
      const w = (width - 24 - stationGap * (stationColumns - 1)) / stationColumns;
      stations.forEach((id, index) => {
        const row = Math.floor(index / stationColumns);
        const col = index % stationColumns;
        button(
          `station-${id}`,
          stationButtonName(id),
          12 + col * (w + stationGap),
          stationTop + row * (stationHeight + stationGap),
          w,
          'station',
          {
            value: id,
            h: stationHeight,
            icon: portrait ? id : null,
            label: `${STATIONS[id].name}へ移動して作業`,
            disabled: s.tutorial !== null && step?.station !== id,
            pressed: practice
              ? step?.station === id
              : s.movingTo === id || (reached && near.id === id),
            size: 13,
          },
        );
      });
    }
    const aw = Math.min(width - 24, 520);
    const ax = (width - aw) / 2;
    const side = narrow ? 62 : 106;
    const transfer = handoffOption(g);
    button(
      'interact',
      transfer
        ? `${narrow ? '' : 'E  '}${transfer.label}`
        : reached
          ? `${narrow ? '' : 'E  '}${practice ? '作業する' : actionHint(g, near.id ?? '')}`
          : '作業台へ移動',
      ax,
      height - 60,
      aw - side * 2 - 16,
      'interact',
      { disabled: !reached && !transfer, color: '#245e50', ink: '#fff9e8', size: narrow ? 12 : 15 },
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
      status:
        practice && step
          ? narrow
            ? `${STATIONS[step.station].name}をタップ`
            : step.label
          : s.toast || '',
    };
  if (s.phase === 'ready') items.length = 0;
  // Background HUD stays legible, but never accepts input behind a sheet.
  items.forEach((item) => {
    item.inert = true;
  });
  const welcome = modal === 'welcome';
  const placementSheet =
    s.phase === 'finished' && s.cleared && view.page === 3 && view.layoutMode === 'layout';
  const stockSheet = !s.menuOpen && s.phase === 'finished' && s.cleared && view.page === 2;
  let prepStatus = view.error || '';
  const sheetWidth = Math.min(
    width - 24,
    welcome
      ? portrait
        ? 700
        : width * 0.5
      : stockSheet
        ? portrait
          ? 480
          : 900
        : portrait
          ? 580
          : 900,
  );
  const pw = sheetWidth;
  const ph = Math.min(
    height - 24,
    s.menuOpen
      ? 448
      : stockSheet && portrait
        ? 620
        : placementSheet
          ? 344
          : s.phase === 'finished' && s.cleared && !s.campaignComplete
            ? 440
            : s.phase === 'finished' && !s.cleared && !s.campaignComplete
              ? 400
              : welcome
                ? narrow
                  ? 136
                  : 178
                : 304,
  );
  // The action row is a full-width bar at the bottom of the sheet. Portrait keeps
  // the biggest height; the stock sheet and very short landscape screens have the
  // least room, so they trade height for keeping the roster and bill visible.
  const stockPortrait = stockSheet && portrait;
  const actionH =
    welcome || (portrait && !stockPortrait)
      ? ACTION_HEIGHT
      : stockPortrait
        ? Math.min(ACTION_HEIGHT, 56)
        : Math.max(48, Math.min(ACTION_HEIGHT, ph - 248));
  const x = welcome && !portrait ? 16 : (width - sheetWidth) / 2,
    y = welcome ? 20 : placementSheet ? height - ph - 12 : (height - ph) / 2;
  order = 4000;
  if (!welcome) add('veil', 'veil', '', 0, 0, width, height);
  panel('sheet', x, y, sheetWidth, ph);
  panel('clip', x + pw / 2 - 36, y - 5, 72, 16, { color: '#76b59b', edge: '#245e50' });
  const inside = pw - 32;
  const title = (text: string) =>
    label('title', text, x + 16, y + 18, inside, 34, { size: narrow ? 21 : 26 });
  const copy = (id: string, text: string, top: number, h = 30, extra: ScreenExtra = {}) =>
    label(id, text, x + 16, y + top, inside, h, { size: 14, ...extra });
  const footerY = welcome
    ? height - actionH - 16
    : stockPortrait
      ? y + ph - 60
      : y + ph - actionH - 12;
  const primary = (text: string, action: string, extra: ScreenExtra = {}) =>
    button('primary', text, x + 16, footerY, inside, action, {
      color: '#245e50',
      ink: '#fff9e8',
      h: actionH,
      size: 18,
      ...extra,
    });
  if (s.menuOpen) {
    title(
      s.menuPage === 'hints'
        ? 'いまのヒント'
        : s.menuPage === 'help'
          ? 'キッチンの手引き'
          : s.menuPage === 'stages'
            ? 'ステージを選ぶ'
            : s.menuPage === 'controls'
              ? '操作設定'
              : s.menuPage === 'diagnostics'
                ? '診断情報'
                : 'ひと休み',
    );
    const page = s.menuPage ?? 'settings';
    if (page === 'stages') {
      const levels = Object.keys(s.stages ?? {})
        .map(Number)
        .sort((a, b) => a - b);
      const pageCount = Math.max(1, Math.ceil(levels.length / 6));
      const stagePage = Math.min(pageCount - 1, Math.max(0, view.stagePage ?? 0));
      const bw = (inside - 16) / 3;
      copy('stage-help', 'どの厨房に戻る？', 54, 28, { size: 12 });
      levels.slice(stagePage * 6, stagePage * 6 + 6).forEach((level, index) => {
        button(
          `stage-${level}`,
          `Lv.${level}`,
          x + 16 + (index % 3) * (bw + 8),
          y + 86 + Math.floor(index / 3) * 48,
          bw,
          'restore-stage',
          {
            value: level,
            disabled: !s.ready || s.benchmark,
            pressed: level === s.checkpoint?.level,
            label: `Lv.${level}を開店時の状態で復元`,
          },
        );
      });
      if (!levels.length) copy('stage-empty', '開店するとステージが保存されます。', 98, 48);
      button('stages-prev', '‹', x + 16, footerY - 52, 44, 'stage-page', {
        value: stagePage - 1,
        disabled: stagePage === 0,
        label: '前のステージ一覧',
      });
      label(
        'stages-page',
        `${stagePage + 1} / ${pageCount}`,
        x + 68,
        footerY - 52,
        inside - 104,
        44,
      );
      button('stages-next', '›', x + pw - 60, footerY - 52, 44, 'stage-page', {
        value: stagePage + 1,
        disabled: stagePage + 1 >= pageCount,
        label: '次のステージ一覧',
      });
    } else if (page === 'controls') {
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
    } else if (page === 'hints') {
      const preparing = s.phase === 'finished' && s.cleared;
      const stages: PrepareStage[] =
        view.page === 2
          ? ['staffing', 'stock']
          : [view.page === 3 ? 'investment' : g.level < 3 ? 'stock' : 'hiring'];
      const warning =
        s.benchmark || s.autoMode
          ? s.benchFeedback?.loop
          : preparing
            ? view.looping
            : repeatsActions(g.human.lastActions ?? [], g);
      const history =
        s.benchmark || s.autoMode
          ? (s.benchFeedback?.recent ?? [])
          : preparing
            ? (view.history ?? []).map((h) => h.label).filter(Boolean)
            : (g.human.lastActions ?? []).map((h) => h.label);
      let text = warning ? `${loopHint(preparing)}\n` : '';
      if (preparing) {
        const bill = purchase(g, view);
        const config = levelConfig(g.level + 1);
        const capacity = equipmentCapacity(bill.equipment);
        text += stages.map((stage) => preparationAdvice(g, { ...view, stage }).hint).join('\n');
        text += `\n次の注文：${Object.entries(config.recipeMix)
          .filter(([, v]) => v)
          .map(([id, v]) => `${RECIPES[id].name} ${Math.round(v * 100)}%`)
          .join('・')}`;
        text += `\n在庫${bill.stock}個（仕入れ${bill.quantity}個）・支払後${bill.cash}コイン`;
        text += `\n設備枠${capacity.used}/${capacity.limit}。増設の枠が足りない時は厨房を拡張できます。`;
      } else {
        text += `${cookingAdvice(g).hint}\n作業台をタップすると移動して作業します。ダッシュは移動を速めます。手持ちは近くの手ぶらの相棒へEで渡せます。\nノルマは合格に必要な皿数です。売上は次の営業資金になり、残在庫は持ち越せます。`;
        text += `\n在庫${g.stock ?? '無制限'}・配膳${g.served}/${g.quota}皿`;
        text +=
          '\n' +
          [...new Set(g.orders.map((o) => o.recipe))]
            .map((id) => `${RECIPES[id].name}：${RECIPES[id].steps}`)
            .join('\n');
      }
      if (history.length) text += `\n最近の操作（古い順）\n${history.slice(-6).join('\n')}`;
      const size = narrow ? 12 : 14;
      const cols = Math.max(1, Math.floor(inside / size));
      const lines = text
        .split('\n')
        .flatMap((line) => line.match(new RegExp(`.{1,${cols}}`, 'gu')) ?? ['']);
      const perPage = Math.max(3, Math.floor((ph - 200) / (size * 1.5)));
      const pages = Math.ceil(lines.length / perPage);
      const pageIndex = Math.min(pages - 1, Math.max(0, view.advicePage ?? 0));
      copy(
        'advice-copy',
        lines.slice(pageIndex * perPage, (pageIndex + 1) * perPage).join('\n'),
        60,
        ph - 200,
        { size },
      );
      button('advice-previous', '‹', x + 16, footerY - 54, 44, 'advice-page', {
        value: pageIndex - 1,
        disabled: pageIndex === 0,
        label: '前のヒント',
      });
      label('advice-page', `${pageIndex + 1} / ${pages}`, x + 68, footerY - 48, inside - 104, 32, {
        size: 14,
      });
      button('advice-next', '›', x + pw - 60, footerY - 54, 44, 'advice-page', {
        value: pageIndex + 1,
        disabled: pageIndex + 1 === pages,
        label: '次のヒント',
      });
    } else if (page === 'help') {
      copy(
        'help',
        `作業台をタップ、または WASD で移動\nE で作業・相棒の近くで E で受け渡し\nShift でダッシュ・注文のない料理は Q で片づけ\n切る → お皿をとる → 盛る → 配膳`,
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
        ph < 340
          ? `応答 ${s.hud.latency ?? '—'} ms ・ 判断 ${s.hud.decisions}回\nオート：${s.autoMode ? '動作中' : '停止中'}`
          : `${s.backend} / ${s.hud.via}\n応答 ${s.hud.latency ?? '—'} ms ・ 判断 ${s.hud.decisions}回\n古い回答の破棄 ${s.hud.dropped}回${s.fallback ? '\n接続待ち：固定ルールで営業を続けます' : ''}${s.autoStatus ? `\nJev：${s.autoStatus}` : ''}`,
        60,
        ph < 340 ? 40 : 106,
        { size: narrow ? 12 : 15 },
      );
      copy(
        'privacy',
        ph < 340
          ? '判断にゲーム状態をAIへ送信します。'
          : 'オートではJevが操作と開店準備を担当します。\n判断にゲーム状態をTypeSafe または Cloudflare へ送信します。',
        ph < 340 ? 100 : 172,
        ph < 340 ? 24 : 54,
        { size: 12 },
      );
      const bw = (inside - 8) / 2;
      button('back', '設定に戻る', x + 16, footerY - 54, bw, 'menu-page', {
        value: 'settings',
      });
      button('benchmark', 'jev-bench', x + 24 + bw, footerY - 54, bw, 'link', { href: '/bench' });
      if (!s.benchmark) {
        button(
          'auto-mode',
          s.autoMode ? 'オートモード：オン' : 'オートモード：オフ',
          x + 16,
          footerY - 108,
          bw,
          'auto-mode',
          { pressed: s.autoMode, size: 13, disabled: !s.ready },
        );
        const resetArmed = view.resetArmed === true;
        button(
          'reset',
          resetArmed ? 'リセット確定' : 'リセット',
          x + 24 + bw,
          footerY - 108,
          bw,
          'reset',
          {
            size: 13,
            ...(resetArmed ? { color: '#a1372f', ink: '#fff9e8' } : {}),
            label: resetArmed ? 'もう一度で保存した進行を初期化' : '保存した進行を初期化',
          },
        );
      }
    } else {
      button(
        'sound',
        s.sound ? '音オン' : '音オフ',
        x + 16,
        y + 64,
        s.benchmark ? inside : 76,
        'sound',
        {
          pressed: s.sound,
          size: 13,
        },
      );
      const nav = (inside - 24) / 4;
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
      button('hints', 'ヒント', x + 40 + nav * 3, y + 116, nav, 'menu-page', {
        value: 'hints',
        size: 13,
      });
      if (!s.benchmark)
        button('stages', 'ステージを選ぶ', x + 100, y + 64, inside - 84, 'menu-page', {
          value: 'stages',
          disabled: !Object.keys(s.stages ?? {}).length,
        });
      const lw = (inside - 8) / 2;
      button('license', 'ライセンス', x + 16, footerY - 54, lw, 'link', {
        href: '/licenses.html',
        size: 13,
      });
      button('notices', '追加通知', x + 24 + lw, footerY - 54, lw, 'link', {
        href: '/third-party-notices.html',
        size: 13,
      });
    }
    primary('閉じる', 'close-menu');
  } else if (s.phase === 'ready') {
    add('title3d', 'title', 'SIDEKICK', x + 16, y + 12, inside, narrow ? 72 : 100, {
      size: narrow ? Math.min(46, inside / 7) : 82,
    });
    copy('welcome', 'kitchen   /   ふたりで、ひと皿。', narrow ? 84 : 116, 36, {
      size: narrow ? 15 : 22,
    });
    primary(
      s.ready
        ? s.checkpoint && !s.checkpoint.completed
          ? `Lv.${s.checkpoint.level}から再開`
          : '開店'
        : 'キッチンを準備中…',
      'start',
      { disabled: !s.ready, size: 24 },
    );
    if (Object.keys(s.stages ?? {}).length)
      button('stages', 'ステージを選ぶ', x + 16, footerY - 54, inside, 'open-stages', {
        disabled: !s.ready,
      });
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
        `${g.served} / ${g.quota}皿   ・   ${g.score}点\nもう一度、開店前から。`,
        62,
        54,
        { size: narrow ? 13 : 16 },
      );
      const actionStep = actionH + 8;
      button('retry', '同じ条件で再挑戦', x + 16, footerY - actionStep * 2, inside, 'retry', {
        size: 16,
        h: actionH,
      });
      button('review', '開店準備から見直す', x + 16, footerY - actionStep, inside, 'review', {
        size: 16,
        h: actionH,
        disabled: !s.rollback?.preparation,
      });
      button('previous', '前のステージへ戻る', x + 16, footerY, inside, 'previous', {
        size: 16,
        h: actionH,
        disabled: g.level <= 1 || !s.rollback?.previous,
      });
    }
  } else {
    button('advice', 'ヒント', x + pw - 80, y + 8, 64, 'advice', { size: 13 });
    const bill = purchase(g, view);
    const hint = preparationHint(bill);
    prepStatus = view.error || hint || ((view.page ?? 0) >= 2 ? bill.error : '');
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
        label('hint', view.error || hint, x + 16, y + 250, inside, 30, {
          color: '#a1372f',
          size: 12,
        });
      primary('次のステージ', 'page', { value: g.level < 3 ? 2 : 1 });
    } else if (view.page === 1) {
      title('候補者の採用');
      const id = s.applicants[(view.applicantIndex ?? 0) % Math.max(1, s.applicants.length)];
      const staff = STAFF[id];
      if (staff) {
        button('previous-applicant', '‹', x + 16, bodyTop, 44, 'applicant-index', {
          value: -1,
          label: '前の応募者',
        });
        label(
          'applicant-name',
          `${staff.name}  ${(view.applicantIndex ?? 0) + 1}/${s.applicants.length}`,
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
        const hiring =
          view.selected === id
            ? bill
            : purchase(g, {
                ...view,
                selected: id,
                duty: (view.duty ?? []).filter((member) => member !== view.selected),
              });
        const cost = `採用 ${staff.cost}  ・  給与 ${staff.wage ?? 0}/営業  ・  予定残金 ${hiring.cash}${dash}`;
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
      } else copy('all-hired', '今日の応募はありません。', 90, 90);
      primary('仕入れと配置へ', 'page', { value: 2 });
    } else if (view.page === 2) {
      title(`Lv.${g.level + 1} 仕入れ・勤務表`);
      const roster = [
        ...new Set([...Object.keys(bill.staffState), ...(view.selected ? [view.selected] : [])]),
      ];
      const duty = [...new Set(Array.isArray(view.duty) ? view.duty : [])].filter((id) =>
        roster.includes(id),
      );
      const columns = portrait ? (height >= 540 ? 2 : 4) : height < 360 ? 4 : 3;
      const gap = 4;
      const rosterW = portrait ? inside : (inside - 24) / 2;
      const stockW = portrait ? inside : (inside - 24) / 2;
      const stockX = portrait ? x + 16 : x + 40 + rosterW;
      const cellW = (rosterW - gap * (columns - 1)) / columns;
      const dutyY = y + 80;
      label('duty-heading', '勤務表', x + 16, y + 54, rosterW, 22, { size: 14 });
      const nextState = bill.staffState;
      const fatigueVisible = levelConfig(g.level + 1).fatigueEnabled;
      roster.forEach((id, index) => {
        const staff = STAFF[id];
        const projected = nextState[id] ?? { worked: 0, rest: 0 };
        const available = (!nextState[id] && id === view.selected) || staffAvailable(nextState, id);
        const onDuty = duty.includes(id);
        const availability =
          id === 'veteran' && g.level < 3
            ? '店長'
            : fatigueVisible
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
      const sy = dutyY + dutyRows * 48 + 4;
      label(
        'duty-summary',
        duty.length === 0
          ? 'ひとりで営業  ・  給与 0'
          : `出勤 ${duty.length}/${bill.slots}人  ・  給与 ${bill.wages}`,
        x + 16,
        sy,
        rosterW,
        24,
        { size: 12 },
      );
      const stockY = portrait ? sy + 56 : dutyY + 4;
      add('food', 'stock-tomato', '', stockX, stockY - 30, 28, 28, { recipe: 'tomato' });
      label(
        'stock-label',
        `仕入れ  ${STOCK_PRICE}コイン / 個`,
        stockX + 32,
        stockY - 30,
        stockW - 32,
        24,
        { size: 13 },
      );
      button('less', '−', stockX, stockY, 44, 'quantity', {
        value: -1,
        label: '仕入れを1個減らす',
        disabled: bill.quantity <= 0,
      });
      add('number', 'quantity', String(view.quantity), stockX + 52, stockY, stockW - 104, 44, {
        label: '仕入れ個数',
        action: 'quantity-input',
      });
      button('more', '＋', stockX + stockW - 44, stockY, 44, 'quantity', {
        value: 1,
        label: '仕入れを1個増やす',
        disabled: bill.quantity >= 99,
      });
      label(
        'stock-summary',
        `在庫 ${g.stock ?? 0} → ${Number.isFinite(bill.stock) ? bill.stock : '—'}個 / 必要 ${bill.quota}個`,
        stockX,
        stockY + 48,
        stockW,
        24,
        { size: 12 },
      );
      label(
        'bill',
        `採用 ${bill.hiring} ＋ 仕入れ ${Number.isFinite(bill.quantity) ? bill.quantity * STOCK_PRICE : '—'}
給与 ${bill.wages} ＋ 設備・育成 ${bill.equipmentCost + bill.vitaminCost}`,
        stockX,
        stockY + 74,
        stockW,
        34,
        { size: 12 },
      );
      const warning = view.error || hint || bill.error;
      const balanceY = footerY - (portrait ? 42 : 34);
      panel('balance-board', stockX, balanceY, stockW, portrait ? 34 : 28, {
        color: warning ? '#f7c4af' : '#dbe3d2',
      });
      label(
        'balance',
        warning || `開店後の残金  ${Number.isFinite(bill.cash) ? bill.cash : '—'}コイン`,
        stockX + 4,
        balanceY + 2,
        stockW - 8,
        portrait ? 30 : 24,
        { size: 13, color: warning ? '#a1372f' : '#245e50', live: true },
      );
      const backW = narrow ? 64 : 120;
      const equipmentW = narrow ? 60 : 100;
      button('back', g.level < 3 ? '戻る' : '採用', x + 16, footerY, backW, 'page', {
        value: g.level < 3 ? 0 : 1,
        size: 13,
        h: actionH,
      });
      button('equipment', '設備', x + 24 + backW, footerY, equipmentW, 'page', {
        value: 3,
        size: 13,
        h: actionH,
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
          size: 16,
          h: actionH,
        },
      );
    } else {
      title(`Lv.${g.level + 1} 設備投資`);
      const baseEquipment = g.equipment ?? null;
      const pending = new Set(bill.equipmentPurchases);
      const nextLevel = g.level + 1;
      const layoutMode = view.layoutMode === 'layout' ? 'layout' : 'equipment';
      const vitaminItem =
        view.vitaminItem && Object.hasOwn(VITAMINS, view.vitaminItem) ? view.vitaminItem : null;
      const vitaminMode = vitaminItem !== null;
      const vitamins = Array.isArray(view.vitamins) ? view.vitamins : [];
      const vitaminTargets = [
        'human',
        ...new Set([...Object.keys(bill.staffState), ...(view.selected ? [view.selected] : [])]),
      ];
      const vitaminLevel = (id: string, item: string) =>
        trainingLevel(g.training, id, item as VitaminId) +
        vitamins.filter((entry) => entry.target === id && entry.item === item).length;
      const layoutGame = { ...g, level: nextLevel, equipment: bill.equipment };
      const currentLayout = bill.layout ?? view.layout ?? g.layout ?? {};
      const capacity = equipmentCapacity(bill.equipment);

      const backW = narrow ? 64 : 120;
      const modeW = narrow ? 56 : 88;
      button('back', '仕入れへ', x + 16, footerY, backW, 'page', {
        value: 2,
        size: 13,
        h: actionH,
      });
      if (vitaminMode)
        button('layout-mode', 'やめる', x + 24 + backW, footerY, modeW, 'vitamin-cancel', {
          label: '育成の対象選択をやめる',
          size: 13,
          h: actionH,
        });
      else
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
            h: actionH,
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
          size: 16,
          h: actionH,
        },
      );

      if (vitaminMode) {
        const vitamin = VITAMINS[vitaminItem ?? ''];
        label(
          'vitamin-heading',
          `${vitamin.icon} ${vitamin.name}を誰に使う？（${vitamin.ability}）`,
          x + 16,
          bodyTop,
          inside,
          44,
          { size: narrow ? 12 : 14 },
        );
        const columns = 4;
        const gap = 4;
        const cellW = (inside - gap * (columns - 1)) / columns;
        vitaminTargets.forEach((id, index) => {
          const row = Math.floor(index / columns);
          const column = index % columns;
          const current = vitaminLevel(id, vitaminItem);
          const capped = current >= MAX_TRAINING;
          button(
            `vitamin-target-${id}`,
            `${id === 'human' ? 'あなた' : staffShortName(id)}\nLv${current}${capped ? ' MAX' : `→${current + 1}`}`,
            x + 16 + column * (cellW + gap),
            bodyTop + 48 + row * 48,
            cellW,
            'vitamin-target',
            {
              value: id,
              disabled: capped,
              avatar: cellW >= 88 && id !== 'human' ? STAFF[id]?.color : undefined,
              label: `${id === 'human' ? 'あなた' : (STAFF[id]?.name ?? id)}に${vitamin.name}を使う`,
              size: narrow ? 11 : 12,
            },
          );
        });
        label(
          'vitamin-summary',
          `使用予定 ${vitamins.length}個  ・  育成費 🪙${bill.vitaminCost} / 残り 🪙${bill.cash}`,
          x + 16,
          bodyTop + 48 + Math.ceil(vitaminTargets.length / columns) * 48,
          inside,
          28,
          { size: narrow ? 11 : 13 },
        );
        if (vitamins.length)
          button(
            'vitamin-undo',
            `直前の育成を取り消す（${vitamins.length}）`,
            x + 16,
            bodyTop + 48 + Math.ceil(vitaminTargets.length / columns) * 48 + 32,
            inside,
            'vitamin-undo',
            { size: narrow ? 11 : 13 },
          );
      } else if (layoutMode === 'layout') {
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
        const selected = movable.includes(view.layoutSelection ?? '') ? view.layoutSelection : null;
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
              `${stationName(layoutGame, id)}\n${layoutPositionName(slotMap, slot ?? '')}`,
              x + 16,
              row,
              inside,
              'layout-select',
              {
                value: id,
                pressed: false,
                label: `${stationName(layoutGame, id)}を移動。現在${layoutPositionName(slotMap, slot ?? '')}`,
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
        const kinds = [...Object.keys(EQUIPMENT), ...Object.keys(VITAMINS)];
        const pageCount = Math.max(1, Math.ceil(kinds.length / 2));
        const equipmentIndex = Math.min(
          pageCount - 1,
          Math.max(0, Math.floor(Number(view.equipmentIndex) || 0)),
        );
        const visibleKinds = kinds.slice(equipmentIndex * 2, equipmentIndex * 2 + 2);
        const equipmentBudget =
          g.cash - bill.hiring - bill.quantity * STOCK_PRICE - bill.wages - bill.vitaminCost;
        const optionQuote = (id: string) => {
          const purchases = pending.has(id)
            ? bill.equipmentPurchases.filter((purchaseId) => purchaseId !== id)
            : [...bill.equipmentPurchases, id];
          return quoteEquipment(baseEquipment, purchases, nextLevel);
        };
        const optionText = (id: string, action: string) => {
          const quote = optionQuote(id);
          if (pending.has(id)) return '取消';
          const status = equipmentOptionStatus(quote.error);
          if (status) return status;
          if (quote.cost > equipmentBudget) return '資金不足';
          const incremental = Math.max(0, quote.cost - bill.equipmentCost);
          return `${action} 🪙${incremental}`;
        };
        const optionLabel = (kind: string, id: string, action: string) => {
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
          const row = rowTop + index * 44;
          if (Object.hasOwn(VITAMINS, kind)) {
            const vitamin = VITAMINS[kind];
            const count = vitamins.filter((entry) => entry.item === kind).length;
            button(
              `equipment-label-${kind}`,
              narrow
                ? `${vitamin.name}\n${vitamin.ability} ${vitamin.effect}/個`
                : `${vitamin.icon} ${vitamin.name}  ${vitamin.ability} ${vitamin.effect}/個  🪙${vitamin.cost}`,
              x + 16,
              row,
              labelW,
              'vitamin',
              {
                value: kind,
                label: `${vitamin.name}を誰に使うか選ぶ`,
                size: narrow ? 11 : 13,
              },
            );
            button(
              `equipment-buy-${kind}`,
              count ? `追加 ${count}` : '使う',
              x + 16 + labelW + 4,
              row,
              inside - labelW - 4,
              'vitamin',
              {
                value: kind,
                pressed: count > 0,
                label: `${vitamin.name}を購入して対象を選ぶ`,
                size: narrow ? 11 : 12,
              },
            );
            return;
          }
          const meta = EQUIPMENT[kind];
          const current = bill.equipment?.[kind as EquipmentKind] ?? {
            count: meta.initialCount ?? 0,
            level: 1,
          };
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
            : `設備枠 ${capacity.used}/${capacity.limit}  投資 🪙${bill.equipmentCost + bill.vitaminCost} / 残り 🪙${bill.cash}`,
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
  if (!s.menuOpen && s.phase === 'finished' && s.cleared && !s.campaignComplete) {
    const titleItem = items.find((item) => item.id === 'title');
    if (titleItem) titleItem.w -= 76;
  }
  if (!s.menuOpen && ['ready', 'paused'].includes(s.phase)) {
    const main = items.find((item) => item.id === 'primary');
    if (main) {
      main.w = Math.min(welcome ? 300 : Infinity, main.w - 60);
      if (welcome) main.x = (width - main.w - 56) / 2;
      button('sheet-menu', '≡', main.x + main.w + 16, footerY, 44, 'menu', {
        label: 'メニューを開く',
        h: actionH,
      });
    }
  }
  if (!portrait && !stockSheet && !welcome) {
    // Landscape dialogs keep the action group together in a bar at the bottom.
    const actions = items.filter(
      (item) =>
        !item.inert &&
        item.kind === 'button' &&
        (item.y === footerY ||
          ['primary', 'back', 'hire', 'skip', 'retry', 'review', 'previous'].includes(item.id)),
    );
    if (actions.length) {
      const gap = 8;
      const each = Math.min((sheetWidth - 32 - gap * (actions.length - 1)) / actions.length, 240);
      const total = each * actions.length + gap * (actions.length - 1);
      const left = x + (sheetWidth - total) / 2;
      actions.forEach((item, index) =>
        Object.assign(item, {
          x: left + index * (each + gap),
          y: footerY,
          w: each,
          h: actionH,
        }),
      );
    }
  }
  if (welcome && !portrait) {
    const actionWidth = Math.min(300, width * 0.4);
    const left = width - actionWidth - 20;
    const primaryItem = items.find((item) => item.id === 'primary');
    if (primaryItem) Object.assign(primaryItem, { x: left, w: actionWidth - 60 });
    const menuItem = items.find((item) => item.id === 'sheet-menu');
    if (menuItem) Object.assign(menuItem, { x: width - 64 });
    const stages = items.find((item) => item.id === 'stages');
    if (stages) Object.assign(stages, { x: left, w: actionWidth });
  }
  return {
    items,
    modal,
    title: items.find((i) => i.id === 'title')?.text ?? '',
    status: prepStatus,
  };
}

// Text projection for UI parity checks. Jev uses compact observations and the
// shared cooking/preparation advice instead of duplicating this whole screen. `actions` is the controlled actor's
// choice ids: on-screen controls that are not choosable keep their wording but
// drop their id, so the model cannot answer a choice that is not in `criteria`
// (e.g. the human's applicant ‹ › navigation). The
// control's own disabled state is kept as-is: a screen wording can correspond
// to a choice under a different id (e.g. 「開店」 ↔ `open_shift`).
export function screenContext(
  s: StoreState,
  view: ViewState,
  width: number,
  height: number,
  actions?: Set<string>,
) {
  const { items, modal, title, status } = screen(s, view, width, height);
  return {
    modal,
    title: title ?? null,
    status: status || null,
    items: items
      .filter((item) => item.text || item.label || item.recipe)
      .map((item) => {
        const choosable = !actions || !item.action || actions.has(item.id);
        return {
          ...(choosable ? { id: item.id } : {}),
          text: item.text || null,
          ...(item.label && item.label !== item.text ? { label: item.label } : {}),
          ...(item.recipe ? { recipe: item.recipe } : {}),
          ...(item.disabled ? { disabled: true } : {}),
          ...(item.pressed ? { pressed: true } : {}),
        };
      }),
  };
}
