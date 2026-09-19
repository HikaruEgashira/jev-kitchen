import { lazy, Suspense, useEffect, useRef } from 'react';
import {
  useKitchen,
  startShift,
  togglePause,
  setMode,
  setPolicy,
  toggleSound,
  installControls,
  humanInteract,
  humanDash,
  clearHands,
  goTo,
} from './game.js';
import {
  SHIFT_MS,
  STAR_SCORES,
  RECIPES,
  ITEM_EMOJI,
  ITEM_NAMES,
  STATIONS,
  STATION_IDS,
  stationAt,
  actionHint,
} from './model.js';
import './style.css';

const Kitchen = lazy(() => import('./Kitchen.jsx'));

function Icon({ name, size = 20 }) {
  const paths = {
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
    pause: (
      <>
        <path d="M8 5v14m8-14v14" />
      </>
    ),
    play: <path d="m8 4 12 8-12 8V4Z" />,
    arrow: (
      <>
        <path d="M5 12h14m-5-5 5 5-5 5" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01" />
      </>
    ),
    spark: <path d="m12 2 2.6 6.8L22 12l-7.4 3.2L12 22l-2.6-6.8L2 12l7.4-3.2L12 2Z" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Stars({ score, large = false }) {
  return (
    <span
      className={`stars ${large ? 'large' : ''}`}
      aria-label={`${STAR_SCORES.filter((s) => score >= s).length}つ星`}
    >
      {STAR_SCORES.map((threshold) => (
        <span key={threshold} className={score >= threshold ? 'earned' : ''}>
          ★
        </span>
      ))}
    </span>
  );
}

export default function App() {
  const s = useKitchen(),
    g = s.game,
    help = useRef();
  const near = stationAt(g, 'human'),
    seconds = Math.ceil((SHIFT_MS - g.time) / 1000);
  const nextStar = STAR_SCORES.find((score) => g.score < score);
  const playing = s.phase === 'playing',
    paused = s.phase === 'paused',
    finished = s.phase === 'finished';
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
  const showHelp = () => {
    if (playing) togglePause();
    help.current.showModal();
  };
  return (
    <div className="app-shell">
      <header className="page-header">
        <a className="brand" href="/" aria-label="SIDEKICK kitchen ホーム">
          <span className="brand-mark">
            sk<span>✦</span>
          </span>
          <span>
            SIDEKICK <em>kitchen</em>
          </span>
        </a>
        <span className="header-note">ふたりで、ひと皿。</span>
        <div className="header-actions">
          <button
            className="icon-button"
            onClick={toggleSound}
            aria-label={s.sound ? '音を消す' : '音を出す'}
            aria-pressed={!s.sound}
          >
            <Icon name={s.sound ? 'sound' : 'mute'} />
          </button>
          <button className="icon-button" onClick={showHelp} aria-label="遊び方">
            <Icon name="help" />
          </button>
        </div>
      </header>

      <main>
        <div className="heading-row">
          <div>
            <div className="shift-label">
              <span className="sun">☀</span> おひるの営業
            </div>
            <h1>今日も、おいしい連携を。</h1>
          </div>
          <p className="best-score">
            ベストスコア <strong>{s.best.toLocaleString()}</strong>
          </p>
        </div>
        <div className="game-layout">
          <section className="game-panel" aria-label="キッチンゲーム">
            <div className="game-toolbar">
              <div className={`time ${seconds <= 15 ? 'urgent' : ''}`}>
                <Icon name="clock" size={23} />
                <strong>
                  {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
                </strong>
                <span>のこり</span>
              </div>
              <div className="score">
                <span>スコア</span>
                <strong>{g.score.toLocaleString()}</strong>
                <Stars score={g.score} />
              </div>
              <button
                className="icon-button pause-button"
                onClick={togglePause}
                disabled={!playing && !paused}
                aria-label={paused ? 'ゲームを再開' : '一時停止'}
              >
                <Icon name={paused ? 'play' : 'pause'} size={18} />
              </button>
            </div>

            <div className="orders" aria-label="注文一覧">
              {g.orders.map((order, i) => {
                const remaining = Math.max(0, Math.ceil((order.deadline - g.time) / 1000));
                return (
                  <article
                    key={order.id}
                    className={`order-ticket ${remaining < 10 ? 'hurry' : ''}`}
                  >
                    <div className="order-top">
                      <span>注文 {String(order.id + 1).padStart(2, '0')}</span>
                      <span>
                        {i === 0 && <i className="order-next">先に作ろう</i>}
                        {remaining}
                        <small>秒</small>
                      </span>
                    </div>
                    <div className="order-dish">
                      <span className={`dish-icon ${order.recipe}`}>
                        {ITEM_EMOJI[order.recipe]}
                      </span>
                      <div>
                        <h2>{RECIPES[order.recipe].name}</h2>
                        <p>
                          {order.recipe === 'dish' ? '切る → 盛り付け' : '切る → 煮る → 盛り付け'}
                        </p>
                      </div>
                    </div>
                    <div
                      className="patience"
                      role="meter"
                      aria-label={`${RECIPES[order.recipe].name}の残り時間`}
                      aria-valuemin={0}
                      aria-valuemax={Math.ceil(order.duration / 1000)}
                      aria-valuenow={remaining}
                    >
                      <i
                        style={{
                          width: `${Math.min(100, (remaining / (order.duration / 1000)) * 100)}%`,
                        }}
                      />
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="stage" aria-label="3Dキッチン">
              <Suspense fallback={<div className="graphics-error">キッチンを準備しています…</div>}>
                <Kitchen />
              </Suspense>
              <div className="stage-caption">
                <span className="live-dot" />
                {playing
                  ? '営業中'
                  : paused
                    ? 'ひと休み'
                    : finished
                      ? '本日の営業終了'
                      : '開店準備中'}
              </div>
              {g.combo > 1 && (
                <div className="combo" key={g.served}>
                  <Icon name="spark" /> {g.combo}× コンボ <small>いい連携！</small>
                </div>
              )}
              {s.phase === 'ready' && (
                <div className="welcome-card">
                  <div>
                    <h2>ランチタイム、開店！</h2>
                    <p>相棒と90秒。めざせ、三つ星キッチン。</p>
                  </div>
                  <button className="primary" onClick={startShift} disabled={!s.ready}>
                    {s.ready ? 'お店を開ける' : '厨房を準備中…'}
                    <Icon name="arrow" size={18} />
                  </button>
                </div>
              )}
              {paused && s.ready && (
                <div className="stage-overlay">
                  <div className="result-card">
                    <span className="result-illustration">☕</span>
                    <h2>ちょっと、ひと休み。</h2>
                    <p>注文も相棒も、待っています。</p>
                    <button className="primary" onClick={togglePause}>
                      営業を再開
                      <Icon name="play" size={16} />
                    </button>
                  </div>
                </div>
              )}
              {finished && (
                <div className="stage-overlay">
                  <div className="result-card">
                    <Stars score={g.score} large />
                    <h2>
                      {g.score >= STAR_SCORES[2]
                        ? '最高のコンビ！'
                        : g.score >= STAR_SCORES[0]
                          ? 'おいしい時間を、ありがとう。'
                          : 'ひと皿ずつ、うまくなる。'}
                    </h2>
                    <div className="final-score">
                      {g.score.toLocaleString()}
                      <small>pts</small>
                    </div>
                    <p>
                      {g.served}皿をお届け · 最大 {g.bestCombo}× コンボ
                    </p>
                    <p className="result-tip">
                      {nextStar
                        ? `次の星まで、あと${nextStar - g.score}点。`
                        : '三つ星達成。次はベストスコアを更新しよう！'}
                    </p>
                    <button className="primary" onClick={startShift}>
                      もう一度、開店する
                      <Icon name="arrow" size={18} />
                    </button>
                  </div>
                </div>
              )}
              {playing && s.toast && g.time < s.toastUntil && (
                <div className="toast" role="status">
                  {s.toast}
                </div>
              )}
            </div>

            <div className="player-bar">
              <div className="held-item">
                <span>{g.human.carrying ? ITEM_EMOJI[g.human.carrying] : '✋'}</span>
                <div>
                  <small>あなたの手元</small>
                  <strong>{ITEM_NAMES[g.human.carrying] ?? '手ぶら'}</strong>
                </div>
              </div>
              <button
                className="interact-button"
                disabled={!playing || !near.inReach}
                onClick={humanInteract}
              >
                <kbd>E</kbd>
                {near.inReach ? actionHint(g, near.id) : '作業台を選んで移動'}
              </button>
              <button
                className="dash-button"
                disabled={!playing || g.time < g.human.dashReadyAt}
                onClick={humanDash}
              >
                <kbd>Shift</kbd> ダッシュ
              </button>
              <button
                className="clear-button"
                disabled={!playing || !g.human.carrying}
                onClick={clearHands}
                title="手元のものを片づける。コンボはリセット。"
              >
                <kbd>Q</kbd> 片づける
              </button>
            </div>
            <div className="station-shortcuts" aria-label="作業台の操作">
              {STATION_IDS.map((id) => (
                <button key={id} disabled={!playing} onClick={() => goTo(id)}>
                  {STATIONS[id].name}
                </button>
              ))}
            </div>
          </section>

          <aside className="side-panel">
            <section className="partner-card">
              <div className="partner-heading">
                <div className="partner-avatar">
                  👨‍🍳
                  <span />
                </div>
                <div>
                  <h2>きょうの相棒</h2>
                  <p>
                    {s.mode === 'rule'
                      ? '固定ルールでお手伝い'
                      : s.fallback
                        ? '接続待ち · 固定ルールでお手伝い'
                        : s.mode === 'jev'
                          ? 'Jev と一緒にクッキング'
                          : 'LLM と一緒にクッキング'}
                  </p>
                </div>
              </div>
              <div className="partner-speech" aria-live="polite">
                {s.hud.action}
              </div>
              <div className="mode-picker" aria-label="相棒のエンジン">
                {[
                  ['jev', 'Jev'],
                  ['rule', '固定ルール'],
                  ['llm', 'LLM'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={s.mode === value ? 'selected' : ''}
                    onClick={() => setMode(value)}
                    aria-pressed={s.mode === value}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="policy-label" htmlFor="policy">
                相棒にひとこと<span>いつでも変更OK</span>
              </label>
              <textarea
                id="policy"
                value={s.policy}
                onChange={(e) => setPolicy(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="例：スープは任せたよ！"
              />
              <div className="policy-presets">
                {['スープは任せたよ', '盛り付けは自分でやる'].map((policy) => (
                  <button key={policy} onClick={() => setPolicy(policy)}>
                    {policy}
                  </button>
                ))}
              </div>
              {(s.mode === 'rule' || s.fallback) && (
                <p className="policy-note">固定ルールでは、ひとことは反映されません。</p>
              )}
            </section>

            <section className="recipe-card">
              <div className="section-heading">
                <h2>ふたりのレシピ</h2>
                <span>本日のメニュー</span>
              </div>
              <div className="recipe">
                <span className="recipe-icon">🥗</span>
                <div>
                  <h3>トマトサラダ</h3>
                  <p>トマトを切って、お皿に盛る。</p>
                  <span className="recipe-flow">トマト → まな板 → お皿</span>
                </div>
                <b>
                  100<small>pt〜</small>
                </b>
              </div>
              <div className="recipe">
                <span className="recipe-icon">🍲</span>
                <div>
                  <h3>トマトスープ</h3>
                  <p>切ったトマトを煮て、お皿に盛る。</p>
                  <span className="recipe-flow">まな板 → 鍋 → お皿を持って鍋へ</span>
                </div>
                <b>
                  140<small>pt〜</small>
                </b>
              </div>
              <div className="recipe-tip">
                <Icon name="spark" size={17} />
                <p>
                  12秒以内に続けて配膳すると、
                  <br />
                  <strong>最大3倍のコンボボーナス！</strong>
                </p>
              </div>
            </section>

            <div className="goal-card">
              <Stars score={g.score} />
              <p>
                {nextStar
                  ? `あと ${Math.max(0, nextStar - g.score)} 点で、次の星。`
                  : '三つ星、おめでとう！'}
              </p>
              <progress max={STAR_SCORES[2]} value={g.score} aria-label="三つ星までの達成度" />
              <div>
                <span>{g.served} 皿お届け</span>
                <span>{g.missed} 注文タイムアウト</span>
              </div>
            </div>
            <details className="diagnostics">
              <summary>相棒の判断ログ</summary>
              <dl>
                <dt>描画</dt>
                <dd>{s.backend}</dd>
                <dt>応答時間</dt>
                <dd>{s.hud.latency == null ? '—' : `${s.hud.latency} ms`}</dd>
                <dt>接続先</dt>
                <dd>{s.hud.via}</dd>
                <dt>確信度</dt>
                <dd>{Number.isFinite(s.hud.confidence) ? s.hud.confidence.toFixed(2) : '—'}</dd>
                <dt>古い判断の破棄</dt>
                <dd>
                  {s.hud.dropped} / {s.hud.decisions}
                </dd>
              </dl>
              <ol>
                {s.log.map((entry, i) => (
                  <li key={i}>
                    <b>{entry.who === 'ai' ? '相棒' : 'あなた'}</b>
                    {entry.text}
                  </li>
                ))}
              </ol>
            </details>
          </aside>
        </div>
        <footer className="controls-guide">
          <span>
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> / 矢印で移動
          </span>
          <span>
            <kbd>E</kbd> 作業
          </span>
          <span>
            <kbd>Shift</kbd> ダッシュ
          </span>
          <span>
            <kbd>Esc</kbd> ひと休み
          </span>
          <span className="click-hint">作業台のクリック・タップでも遊べます</span>
        </footer>
      </main>
      <dialog ref={help} className="help-dialog">
        <form method="dialog">
          <button className="close-dialog" aria-label="遊び方を閉じる">
            ×
          </button>
          <span className="help-icon">👨‍🍳</span>
          <h2>ふたりで、三つ星をめざそう。</h2>
          <p>90秒のランチタイム。注文の残り時間を見ながら、相棒と料理を作って配膳します。</p>
          <ol>
            <li>
              作業台をクリックすると、移動して作業します。キーボードなら WASD で移動、E で作業。
            </li>
            <li>
              サラダは「トマト → まな板 → 切ったトマトを取る → お皿 →
              配膳」。お皿を持ってまな板に戻っても盛れます。
            </li>
            <li>スープは「切ったトマト → 鍋 → お皿 → 鍋 → 配膳」。煮込む間に次の準備を。</li>
            <li>12秒以内の連続配膳で最大3倍。Shift で短いダッシュ、Q で手元を片づけられます。</li>
          </ol>
          <p>Jev には自由な言葉で役割を頼めます。接続できない間は固定ルールでお手伝いします。</p>
          <button className="primary">わかった！</button>
        </form>
      </dialog>
    </div>
  );
}
