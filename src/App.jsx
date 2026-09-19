import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  useKitchen,
  startShift,
  nextShift,
  retryShift,
  TUTORIAL_STEPS,
  togglePause,
  toggleSound,
  installControls,
  humanInteract,
  humanDash,
  clearHands,
} from './game.js';
import {
  STAR_SCORES,
  RECIPES,
  ITEM_EMOJI,
  STOCK_PRICE,
  STATIONS,
  activeStationIds,
  quotaForLevel,
  stationAt,
  actionHint,
} from './model.js';
import { STAFF } from './staff.js';
import './style.css';

const Kitchen = lazy(() => import('./Kitchen.jsx'));

function Icon({ name, size = 18 }) {
  const paths = {
    menu: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </>
    ),
    sound: (
      <>
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
      </>
    ),
    mute: (
      <>
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="m16 9 5 6m0-6-5 6" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    pause: <path d="M8 5v14m8-14v14" />,
    play: <path d="m8 4 12 8-12 8V4Z" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Stars({ score, large = false }) {
  const earned = STAR_SCORES.filter((threshold) => score >= threshold).length;
  return (
    <span
      className={`stars ${large ? 'large' : ''}`}
      role="img"
      aria-label={`3つ星中${earned}つ獲得`}
    >
      {STAR_SCORES.map((threshold) => (
        <span key={threshold} className={score >= threshold ? 'earned' : ''} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}

function OrderCard({ order, index, g, practice }) {
  const remaining = practice ? null : Math.max(0, Math.ceil((order.deadline - g.time) / 1000));
  const duration = order.duration;
  const ratio = remaining == null ? 1 : Math.min(1, Math.max(0, remaining / (duration / 1000)));
  const name = RECIPES[order.recipe].name;
  return (
    <article
      className={`compact-order ${remaining != null && remaining <= 10 ? 'urgent' : ''}`}
      aria-label={`${index + 1}番目の注文、${name}${remaining == null ? '' : `、残り${remaining}秒`}`}
    >
      <span className="order-emoji" aria-hidden="true">
        {ITEM_EMOJI[order.recipe]}
      </span>
      <span
        className="order-meter"
        {...(!practice && {
          role: 'meter',
          'aria-label': `${name}の残り時間`,
          'aria-valuemin': 0,
          'aria-valuemax': duration / 1000,
          'aria-valuenow': remaining,
        })}
      >
        <i style={{ width: `${ratio * 100}%` }} />
      </span>
      <span className="order-seconds" aria-hidden="true">
        {remaining == null ? '∞' : `${remaining}s`}
      </span>
    </article>
  );
}

function TutorialHint({ step }) {
  if (!step) return null;
  return (
    <>
      <div className="tutorial-hint" role="status" aria-live="polite">
        <span className="tutorial-keyboard">WASD 移動 → E 作業</span>
        <span className="tutorial-icon" aria-hidden="true">
          {step.icon}
        </span>
        <strong>{step.label}</strong>
        <small>{STATIONS[step.station].name}</small>
      </div>
    </>
  );
}

function Diagnostics({ s }) {
  return (
    <details className="diagnostics">
      <summary>診断情報</summary>
      <dl>
        <dt>描画</dt>
        <dd>{s.backend}</dd>
        <dt>接続先</dt>
        <dd>{s.hud.via}</dd>
        <dt>応答</dt>
        <dd>{s.hud.latency == null ? '—' : `${s.hud.latency} ms`}</dd>
        <dt>破棄</dt>
        <dd>
          {s.hud.dropped} / {s.hud.decisions}
        </dd>
      </dl>
    </details>
  );
}

function SettingsSection({ s }) {
  return (
    <section className="dialog-section settings-section" aria-labelledby="settings-title">
      <div className="section-intro">
        <div>
          <span className="eyebrow">SETTINGS</span>
          <h2 id="settings-title">設定</h2>
        </div>
        <button type="button" className="sound-toggle" onClick={toggleSound} aria-pressed={s.sound}>
          <Icon name={s.sound ? 'sound' : 'mute'} size={16} />
          {s.sound ? '音オン' : '音オフ'}
        </button>
      </div>
      <div className="settings-details">
        <details>
          <summary>遊び方</summary>
          <ul>
            <li>作業台をタップ、またはWASDで移動してEで作業します。</li>
            <li>料理を完成させたら配膳台へ。注文は最大2枚表示されます。</li>
            <li>Shiftでダッシュ、Qで手元を片づけます。</li>
          </ul>
        </details>
        <Diagnostics s={s} />
      </div>
      <p className="privacy-note">相棒の判断にゲーム状態をTypeSafeまたはCloudflareへ送信します。</p>
      <div className="legal-links" aria-label="ライセンス">
        <a href="/licenses.md">ライセンス</a>
        <a href="/third-party-notices.md">追加通知</a>
      </div>
    </section>
  );
}

const CAPABILITY_NAMES = { prep: '仕込み', cook: '加熱', serve: '配膳' };

function StaffCard({ id, selected, onSelect }) {
  const staff = STAFF[id];
  const frequency = `${(staff.decisionMs / 1000).toFixed(1)}秒ごと`;
  return (
    <button
      type="button"
      className={`applicant-card ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(id)}
      aria-pressed={selected}
    >
      <span className="applicant-icon" aria-hidden="true">
        {staff.icon}
      </span>
      <span className="applicant-copy">
        <strong>{staff.name}</strong>
        <small>{staff.description}</small>
        <span>
          {staff.capabilities.map((capability) => CAPABILITY_NAMES[capability]).join('・')}
          {staff.canDash ? '・ダッシュ' : ''}・速さ×{staff.speed}
        </span>
        <span>判断：{frequency}</span>
      </span>
      <span className="applicant-cost">🪙 {staff.cost}</span>
    </button>
  );
}

function PreparationPanel({ s, g }) {
  const [selectedApplicantId, setSelectedApplicantId] = useState(null);
  const [assignedId, setAssignedId] = useState(g.staffId);
  const nextLevel = g.level + 1;
  const nextQuota = quotaForLevel(nextLevel);
  const [buyStock, setBuyStock] = useState(Math.max(0, nextQuota + 2 - (g.stock ?? 0)));
  const [error, setError] = useState('');
  const stock = g.stock ?? 0;
  const hired = new Set(g.hired);
  const selectedStaff = selectedApplicantId ? STAFF[selectedApplicantId] : null;
  const hiringCost = selectedStaff && !hired.has(selectedApplicantId) ? selectedStaff.cost : 0;
  const purchaseCost = buyStock * STOCK_PRICE;
  const totalCost = hiringCost + purchaseCost;
  const remainingCash = g.cash - totalCost;
  const stockAfter = stock + buyStock;
  const enoughStock = stockAfter >= nextQuota;
  const canOpen = enoughStock && remainingCash >= 0;
  const setQuantity = (value) => {
    setError('');
    setBuyStock(Math.min(99, Math.max(0, Math.floor(Number(value) || 0))));
  };
  const chooseStaff = (id) => {
    setError('');
    setSelectedApplicantId(id);
    setAssignedId(id);
  };
  const skipApplicant = () => {
    setError('');
    setSelectedApplicantId(null);
    if (!hired.has(assignedId)) setAssignedId(g.staffId);
  };
  const openNextShift = () => {
    if (!canOpen) {
      setError(
        !enoughStock
          ? `仕入れがあと${nextQuota - stockAfter}個必要です。`
          : `資金が🪙${Math.abs(remainingCash)}不足しています。`,
      );
      return;
    }
    if (!nextShift(selectedApplicantId, buyStock, assignedId))
      setError('この準備では開店できません。');
  };
  return (
    <div className="preparation-card" role="dialog" aria-labelledby="preparation-title">
      <div className="prep-result">
        <Stars score={g.score} large />
        <span className="eyebrow">営業クリア</span>
        <h2 id="preparation-title">
          {g.served}皿 / ノルマ {g.quota}皿
        </h2>
        <p>
          スコア {g.score.toLocaleString()}点 · 残り資金 🪙{g.cash}
        </p>
      </div>
      <section className="applicant-section" aria-labelledby="applicant-title">
        <div className="prep-heading">
          <div>
            <span className="eyebrow">NEXT PARTNER</span>
            <h3 id="applicant-title">{s.applicants.length ? '応募者から1名' : '相棒を配置'}</h3>
          </div>
          <span>{s.applicants.length}名</span>
        </div>
        <div className="applicant-grid">
          {!s.applicants.length && <p>全員採用済みです。</p>}
          {s.applicants.map((id) => (
            <StaffCard
              key={id}
              id={id}
              selected={selectedApplicantId === id}
              onSelect={chooseStaff}
            />
          ))}
        </div>
        <button
          type="button"
          className="secondary-action skip-applicant"
          onClick={skipApplicant}
          aria-pressed={selectedApplicantId === null}
        >
          今回は見送る
        </button>
        <label className="roster-select-label" htmlFor="roster-select">
          配置する相棒
          <select
            id="roster-select"
            value={assignedId}
            onChange={(event) => setAssignedId(event.target.value)}
          >
            <option value={g.staffId}>{STAFF[g.staffId].name}（現在）</option>
            {g.hired.map(
              (id) =>
                id !== g.staffId && (
                  <option key={id} value={id}>
                    {STAFF[id].name}
                  </option>
                ),
            )}
            {selectedApplicantId && !hired.has(selectedApplicantId) && (
              <option value={selectedApplicantId}>{STAFF[selectedApplicantId].name}（応募）</option>
            )}
          </select>
        </label>
      </section>
      <section className="stock-section" aria-labelledby="stock-title">
        <div className="prep-heading">
          <div>
            <span className="eyebrow">SUPPLY</span>
            <h3 id="stock-title">仕入れ Lv.{nextLevel}</h3>
          </div>
          <span>🪙{STOCK_PRICE} / 個</span>
        </div>
        <p className="stock-summary">
          在庫 {stock}個 → {stockAfter}個 / 次のノルマ {nextQuota}皿
        </p>
        <div className="stock-stepper">
          <button
            type="button"
            onClick={() => setQuantity(buyStock - 1)}
            aria-label="仕入れを1個減らす"
          >
            −
          </button>
          <input
            type="number"
            min="0"
            max="99"
            value={buyStock}
            onChange={(event) => setQuantity(event.target.value)}
            aria-label="仕入れ個数"
          />
          <button
            type="button"
            onClick={() => setQuantity(buyStock + 1)}
            aria-label="仕入れを1個増やす"
          >
            ＋
          </button>
        </div>
        <div className="prep-costs">
          <span>採用・交代 {hiringCost ? `🪙${hiringCost}` : '🪙0'}</span>
          <span>仕入れ 🪙{purchaseCost}</span>
          <strong className={remainingCash < 0 ? 'overspend' : ''}>残り 🪙{remainingCash}</strong>
        </div>
        {!canOpen && <p className="overspend-note">{error || '在庫と資金を整えてください。'}</p>}
        {canOpen && error && <p className="overspend-note">{error}</p>}
      </section>
      <div className="prep-actions">
        <button className="primary" type="button" onClick={openNextShift} disabled={!canOpen}>
          この準備で開店
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}

function MenuDialog({ dialog, s }) {
  return (
    <dialog ref={dialog} className="menu-dialog" aria-labelledby="menu-title">
      <form method="dialog" className="menu-sheet">
        <header className="dialog-header">
          <div>
            <span className="eyebrow">SIDEKICK</span>
            <h2 id="menu-title">メニュー</h2>
          </div>
          <button className="close-dialog" type="submit" aria-label="メニューを閉じる">
            ×
          </button>
        </header>
        <SettingsSection s={s} />
        <button className="dialog-done" type="submit">
          閉じる
        </button>
      </form>
    </dialog>
  );
}

export default function App() {
  const s = useKitchen();
  const g = s.game;
  const menu = useRef();
  const practice = s.tutorial !== null;
  const rawStep = practice ? TUTORIAL_STEPS[s.tutorial] : null;
  const tutorialStep = rawStep ? { ...rawStep, index: s.tutorial } : null;
  const near = stationAt(g, 'human');
  const tutorialTargetReached = Boolean(
    practice && tutorialStep && near.id === tutorialStep.station && near.inReach,
  );
  const level = g.level;
  const goal = g.quota;
  const served = g.served;
  const remainingMs = Math.max(0, g.duration - g.time);
  const seconds = Math.ceil(remainingMs / 1000);
  const playing = s.phase === 'playing';
  const paused = s.phase === 'paused';
  const finished = s.phase === 'finished';
  const stationIds = activeStationIds(g);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => useKitchen.setState({ reducedMotion: media.matches });
    motion();
    media.addEventListener('change', motion);
    const cleanup = installControls();
    return () => {
      cleanup();
      media.removeEventListener('change', motion);
    };
  }, []);

  const openMenu = () => {
    if (playing) togglePause();
    if (!menu.current?.open) menu.current?.showModal();
  };

  const actionLabel = practice
    ? tutorialTargetReached
      ? tutorialStep.label
      : `${STATIONS[tutorialStep.station].name}へ移動`
    : near.inReach
      ? actionHint(g, near.id)
      : '作業台へ移動';

  return (
    <div className="app-shell">
      <header className="hud" aria-label="営業情報">
        <a className="brand" href="/" aria-label="SIDEKICK kitchen ホーム">
          <span className="brand-mark">
            sk<span>✦</span>
          </span>
          <span className="brand-word">SIDEKICK</span>
        </a>
        <div className="level-readout" aria-label={`レベル${level}、${served}皿提供`}>
          <div>
            <strong>LV {level}</strong>
            <span>
              {Math.min(served, goal)}/{goal}
            </span>
          </div>
          <progress max={goal} value={Math.min(served, goal)} />
        </div>
        <div className={`clock-readout ${!practice && seconds <= 15 ? 'urgent' : ''}`}>
          <Icon name="clock" size={17} />
          <strong>
            {practice
              ? '最初の一皿'
              : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
          </strong>
        </div>
        <div className="score-readout" aria-label={`スコア${g.score.toLocaleString()}点`}>
          <span> SCORE</span>
          <strong>{g.score.toLocaleString()}</strong>
        </div>
        <button
          className="hud-button"
          type="button"
          onClick={togglePause}
          disabled={!s.ready || (!playing && !paused)}
          aria-label={paused ? 'ゲームを再開' : 'ゲームを一時停止'}
        >
          <Icon name={paused ? 'play' : 'pause'} size={16} />
        </button>
        <button
          className="hud-button menu-button"
          type="button"
          onClick={openMenu}
          aria-label="メニューを開く"
        >
          <Icon name="menu" size={19} />
        </button>
      </header>

      <main className="playfield">
        <section
          className="stage"
          data-level={level}
          data-stations={stationIds.join(' ')}
          role="region"
          aria-label={`レベル${level}の3Dキッチン`}
        >
          <Suspense
            fallback={
              <div className="graphics-error" role="status" aria-live="polite">
                キッチンを準備しています…
              </div>
            }
          >
            <Kitchen />
          </Suspense>
          <div className="hud-orders" role="region" aria-label="注文">
            {g.orders.slice(0, 2).map((order, index) => (
              <OrderCard key={order.id} order={order} index={index} g={g} practice={practice} />
            ))}
          </div>
          <ul className="partner-roster" aria-label="相棒一覧">
            {[g.staffId, ...g.hired.filter((id) => id !== g.staffId)].map((id) => (
              <li key={id} className={id === g.staffId ? 'on-duty' : ''}>
                <span aria-hidden="true">{STAFF[id].icon}</span>
                <span>{STAFF[id].name}</span>
                {id === g.staffId && <small>出勤中</small>}
              </li>
            ))}
          </ul>
          {g.burned > 0 && (
            <div className="burned-badge" role="status">
              焦げ {g.burned}
            </div>
          )}
          {s.phase === 'ready' && (
            <div className="welcome-card" role="dialog" aria-labelledby="welcome-title">
              <span className="welcome-mark" aria-hidden="true">
                🍅
              </span>
              <div>
                <span className="eyebrow">READY?</span>
                <h1 id="welcome-title">
                  {g.level > 1 ? `Lv.${g.level}から、続きを始めよう` : 'ひと皿、作ってみよう'}
                </h1>
              </div>
              <div className="welcome-actions">
                <button className="primary" type="button" onClick={startShift} disabled={!s.ready}>
                  開店
                  <Icon name="arrow" size={16} />
                </button>
              </div>
            </div>
          )}
          {paused && s.ready && (
            <div className="stage-overlay">
              <div className="result-card pause-card">
                <span className="result-illustration" aria-hidden="true">
                  ☕
                </span>
                <h2>一時停止中</h2>
                <button className="primary" type="button" onClick={togglePause}>
                  再開する
                  <Icon name="play" size={15} />
                </button>
              </div>
            </div>
          )}
          {finished && (
            <div className={`stage-overlay ${s.cleared ? 'prep-overlay' : ''}`}>
              {s.cleared ? (
                s.campaignComplete ? (
                  <div className="preparation-card campaign-result" role="dialog">
                    <Stars score={g.score} large />
                    <span className="eyebrow">CAMPAIGN CLEAR</span>
                    <h2>全レベルクリア！</h2>
                    <p>
                      {g.served}皿をお届け · スコア {g.score.toLocaleString()}点
                    </p>
                    <button className="primary" type="button" onClick={startShift}>
                      最初から再挑戦
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                ) : (
                  <PreparationPanel s={s} g={g} />
                )
              ) : (
                <div className="result-card">
                  <span className="result-illustration" aria-hidden="true">
                    ⏱️
                  </span>
                  <h2>ノルマ未達でした</h2>
                  <div className="final-score">
                    {g.score.toLocaleString()}
                    <small>点</small>
                  </div>
                  <p>
                    {g.served}皿 / ノルマ {g.quota}皿
                  </p>
                  <button className="primary" type="button" onClick={retryShift}>
                    同じ営業をやり直す
                    <Icon name="arrow" size={16} />
                  </button>
                </div>
              )}
            </div>
          )}
          {practice && <TutorialHint step={tutorialStep} />}
          {playing && s.toast && g.time < s.toastUntil && (
            <div className="toast" role="status">
              {s.toast}
            </div>
          )}
          <div className={`action-bar ${practice ? 'practice-action-bar' : ''}`}>
            <button
              className="action-button action-primary"
              type="button"
              disabled={!playing || (practice && !tutorialTargetReached) || !near.inReach}
              onClick={humanInteract}
            >
              <kbd>E</kbd>
              <span>{actionLabel}</span>
            </button>
            <button
              className="action-button dash-action"
              type="button"
              disabled={!playing || g.time < g.human.dashReadyAt}
              onClick={humanDash}
            >
              <kbd>Shift</kbd>
              <span>ダッシュ</span>
            </button>
            <button
              className="action-button clear-action"
              type="button"
              disabled={!playing || !g.human.carrying}
              onClick={clearHands}
            >
              <kbd>Q</kbd>
              <span>片づけ</span>
            </button>
          </div>
        </section>
      </main>
      <MenuDialog dialog={menu} s={s} />
    </div>
  );
}
