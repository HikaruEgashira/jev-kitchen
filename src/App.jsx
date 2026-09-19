import { lazy, Suspense, useEffect, useRef } from 'react';
import {
  useKitchen,
  startShift,
  startTutorial,
  TUTORIAL_STEPS,
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
      role="img"
      aria-label={`3つ星中${STAR_SCORES.filter((s) => score >= s).length}つ獲得`}
    >
      {STAR_SCORES.map((threshold) => (
        <span key={threshold} className={score >= threshold ? 'earned' : ''} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}

function TutorialGuide({ step }) {
  const complete = step === TUTORIAL_STEPS.length;
  return (
    <section className="tutorial-guide" aria-label="練習の進み具合">
      <div className="tutorial-guide-heading">
        <span className="tutorial-kicker">練習</span>
        <strong>
          {complete
            ? 'できた！'
            : `${Math.min(step + 1, TUTORIAL_STEPS.length)} / ${TUTORIAL_STEPS.length}`}
        </strong>
      </div>
      <ol className="tutorial-steps">
        {TUTORIAL_STEPS.map((tutorialStep, index) => (
          <li
            key={tutorialStep.station + tutorialStep.label}
            className={index < step ? 'done' : index === step && !complete ? 'current' : ''}
          >
            <span aria-hidden="true">{tutorialStep.icon}</span>
            <span className="sr-only">{tutorialStep.label}</span>
          </li>
        ))}
      </ol>
      <p className="tutorial-guide-note">{complete ? 'ひと皿、できた！' : '光る台をタップ'}</p>
    </section>
  );
}

export default function App() {
  const s = useKitchen(),
    g = s.game,
    help = useRef();
  const near = stationAt(g, 'human'),
    seconds = Math.ceil((SHIFT_MS - g.time) / 1000);
  const nextStar = STAR_SCORES.find((score) => g.score < score);
  const practice = s.tutorial !== null;
  const tutorialComplete = practice && s.tutorial === TUTORIAL_STEPS.length;
  const tutorialStep = practice && !tutorialComplete ? TUTORIAL_STEPS[s.tutorial] : null;
  const tutorialTargetId = tutorialStep?.station;
  const tutorialTargetReached =
    practice && !tutorialComplete && near.id === tutorialTargetId && near.inReach;
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
            aria-label={s.sound ? '音声をオフ（現在オン）' : '音声をオン（現在オフ）'}
            aria-pressed={s.sound}
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
          <section
            className={`game-panel ${practice ? 'practice-game-panel' : ''}`}
            aria-label="キッチンゲーム"
          >
            <div className={`game-toolbar ${practice ? 'practice-toolbar' : ''}`}>
              <div className={`time ${!practice && seconds <= 15 ? 'urgent' : ''}`}>
                <Icon name="clock" size={23} />
                {practice ? (
                  <strong>練習</strong>
                ) : (
                  <strong>
                    {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
                  </strong>
                )}
                {!practice && <span>のこり</span>}
              </div>
              {!practice && (
                <div className="score">
                  <span>スコア</span>
                  <strong>{g.score.toLocaleString()}</strong>
                  <Stars score={g.score} />
                </div>
              )}
              <button
                className="icon-button pause-button"
                onClick={togglePause}
                disabled={!s.ready || (!playing && !paused)}
                aria-label={paused ? 'ゲームを再開' : '一時停止'}
              >
                <Icon name={paused ? 'play' : 'pause'} size={18} />
              </button>
            </div>

            <div
              className={`orders ${practice ? 'practice-orders' : ''}`}
              role="region"
              aria-label="注文一覧"
            >
              {g.orders.slice(0, practice ? 1 : undefined).map((order, i) => {
                const remaining = practice
                  ? null
                  : Math.max(0, Math.ceil((order.deadline - g.time) / 1000));
                return (
                  <article
                    key={order.id}
                    className={`order-ticket ${!practice && remaining < 10 ? 'hurry' : ''}`}
                  >
                    <div className="order-top">
                      <span>
                        {practice ? '練習の一皿' : `注文 ${String(order.id + 1).padStart(2, '0')}`}
                      </span>
                      <span>
                        {!practice && i === 0 && <i className="order-next">先に作ろう</i>}
                        {practice ? (
                          '時間制限なし'
                        ) : (
                          <>
                            {remaining}
                            <small>秒</small>
                          </>
                        )}
                      </span>
                    </div>
                    <div className="order-dish">
                      <span className={`dish-icon ${order.recipe}`}>
                        {ITEM_EMOJI[order.recipe]}
                      </span>
                      <div>
                        <h2>{RECIPES[order.recipe].name}</h2>
                        {!practice && (
                          <p>
                            {order.recipe === 'dish'
                              ? '切る → 盛り付け → 配膳'
                              : '切る → 煮る → 盛り付け → 配膳'}
                          </p>
                        )}
                      </div>
                    </div>
                    <div
                      className={`patience ${practice ? 'practice-patience' : ''}`}
                      {...(!practice && {
                        role: 'meter',
                        'aria-label': `${RECIPES[order.recipe].name}の残り時間`,
                        'aria-valuemin': 0,
                        'aria-valuemax': Math.ceil(order.duration / 1000),
                        'aria-valuenow': remaining,
                      })}
                    >
                      {practice ? (
                        <span>まずは一皿</span>
                      ) : (
                        <i
                          style={{
                            width: `${Math.min(100, (remaining / (order.duration / 1000)) * 100)}%`,
                          }}
                        />
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="stage" role="region" aria-label="3Dキッチン">
              <Suspense
                fallback={
                  <div className="graphics-error" role="status" aria-live="polite">
                    キッチンを準備しています…
                  </div>
                }
              >
                <Kitchen />
              </Suspense>
              <div className="stage-caption">
                <span className="live-dot" />
                {practice
                  ? tutorialComplete
                    ? '練習完了'
                    : '練習中'
                  : playing
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
                <div className="welcome-card" role="region" aria-labelledby="welcome-title">
                  <div>
                    <p className="welcome-kicker">はじめてでも大丈夫</p>
                    <h2 id="welcome-title">まずは、ひと皿。</h2>
                  </div>
                  <div className="welcome-actions">
                    <button className="primary" onClick={startTutorial} disabled={!s.ready}>
                      ひと皿、作ってみよう
                      <Icon name="arrow" size={18} />
                    </button>
                    <button className="secondary" onClick={startShift} disabled={!s.ready}>
                      すぐに90秒チャレンジ
                    </button>
                  </div>
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
                          : '次は、もうひと皿届けよう。'}
                    </h2>
                    <div className="final-score">
                      {g.score.toLocaleString()}
                      <small>点</small>
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
              {practice && !tutorialComplete && tutorialStep && (
                <>
                  <div className="tutorial-action" role="status" aria-live="polite">
                    <span className="tutorial-dots" aria-hidden="true">
                      {TUTORIAL_STEPS.map((_, index) => (
                        <i
                          key={index}
                          className={
                            index < s.tutorial ? 'done' : index === s.tutorial ? 'current' : ''
                          }
                        />
                      ))}
                    </span>
                    <span aria-hidden="true">{tutorialStep.icon}</span>
                    <strong>{tutorialStep.label}</strong>
                    <small>{STATIONS[tutorialStep.station].name}</small>
                  </div>
                  <button className="tutorial-skip" onClick={startShift}>
                    練習をスキップ
                  </button>
                </>
              )}
              {tutorialComplete && (
                <div className="stage-overlay tutorial-complete-overlay">
                  <div className="result-card tutorial-result">
                    <span className="result-illustration">✨</span>
                    <h2>ひと皿、できた！</h2>
                    <button className="primary" onClick={startShift}>
                      90秒に挑戦
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

            <div className={`player-bar ${practice ? 'practice-player-bar' : ''}`}>
              <div className="held-item">
                <span>{g.human.carrying ? ITEM_EMOJI[g.human.carrying] : '✋'}</span>
                <div>
                  <small>あなたの手元</small>
                  <strong>{ITEM_NAMES[g.human.carrying] ?? '手ぶら'}</strong>
                </div>
              </div>
              <button
                className="interact-button"
                disabled={!playing || (practice && !tutorialTargetReached) || !near.inReach}
                onClick={humanInteract}
              >
                <kbd>E</kbd>
                {practice
                  ? tutorialComplete
                    ? '練習完了'
                    : tutorialStep && tutorialTargetReached
                      ? tutorialStep.label
                      : tutorialStep
                        ? `${STATIONS[tutorialStep.station].name}へ移動`
                        : '練習中'
                  : near.inReach
                    ? actionHint(g, near.id)
                    : '作業台を選んで移動'}
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
            <div className="station-shortcuts" role="group" aria-label="作業台の操作">
              {STATION_IDS.map((id) => (
                <button
                  key={id}
                  disabled={!playing || (practice && (tutorialComplete || id !== tutorialTargetId))}
                  onClick={() => goTo(id)}
                  aria-label={`${STATIONS[id].name}へ移動して作業する`}
                >
                  {STATIONS[id].name}
                </button>
              ))}
            </div>
          </section>

          <aside className="side-panel">
            {practice ? (
              <TutorialGuide step={s.tutorial} />
            ) : (
              <>
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
                            ? '接続できません · 固定ルールでお手伝い中'
                            : s.mode === 'jev'
                              ? 'Jev と一緒にクッキング'
                              : 'LLM と一緒にクッキング'}
                      </p>
                    </div>
                  </div>
                  <div className="partner-speech" aria-live="polite">
                    {s.hud.action}
                  </div>
                  <div className="mode-picker" role="group" aria-label="相棒の判断方式">
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
                        aria-label={value === 'llm' ? '言語モデル（LLM）' : label}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="policy-label" htmlFor="policy">
                    相棒に役割を頼む<span>いつでも変更OK</span>
                  </label>
                  <textarea
                    id="policy"
                    value={s.policy}
                    onChange={(e) => setPolicy(e.target.value)}
                    rows={2}
                    maxLength={300}
                    placeholder="例：スープは任せたよ！"
                    aria-describedby="policy-privacy"
                  />
                  <p id="policy-privacy" className="policy-privacy">
                    入力とゲーム状態は相棒の判断のためTypeSafeまたはCloudflareへ送信されます。個人情報・秘密は入力しないでください。
                  </p>
                  <div className="policy-presets">
                    {['スープは任せたよ', '盛り付けは自分でやる'].map((policy) => (
                      <button key={policy} onClick={() => setPolicy(policy)}>
                        {policy}
                      </button>
                    ))}
                  </div>
                  {(s.mode === 'rule' || s.fallback) && (
                    <p className="policy-note">
                      固定ルールや接続待ちの間は、ひとことは反映されません。
                    </p>
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
                      <p>トマトを切って、お皿に盛って、配膳する。</p>
                      <span className="recipe-flow">トマト → まな板 → お皿 → 配膳</span>
                    </div>
                    <b>
                      100<small>点〜</small>
                    </b>
                  </div>
                  <div className="recipe">
                    <span className="recipe-icon">🍲</span>
                    <div>
                      <h3>トマトスープ</h3>
                      <p>切ったトマトを煮て、お皿に盛って、配膳する。</p>
                      <span className="recipe-flow">
                        トマト → まな板 → 鍋 → お皿 → 鍋で盛る → 配膳
                      </span>
                    </div>
                    <b>
                      140<small>点〜</small>
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
                    <span>時間切れ：{g.missed}件</span>
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
              </>
            )}
          </aside>
        </div>
        <footer className={`controls-guide ${practice ? 'practice-controls-guide' : ''}`}>
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
          <a className="license-link" href="/licenses.md">
            ライセンス
          </a>
          <a className="license-link" href="/third-party-notices.md">
            追加通知
          </a>
        </footer>
      </main>
      <dialog
        ref={help}
        className="help-dialog"
        aria-labelledby="help-title"
        aria-describedby="help-description"
      >
        <form method="dialog">
          <button className="close-dialog" aria-label="遊び方を閉じる">
            ×
          </button>
          <span className="help-icon">👨‍🍳</span>
          <h2 id="help-title">ふたりで、三つ星をめざそう。</h2>
          <p id="help-description">
            90秒のランチタイム。注文の残り時間を見ながら、相棒と料理を作って配膳します。
          </p>
          <h3>最初の一皿</h3>
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
          <p>
            Jev
            には自由な言葉で役割を頼めます。固定ルールや接続待ちの間は、ひとことは反映されません。
          </p>
          <button className="primary">わかった！</button>
        </form>
      </dialog>
    </div>
  );
}
