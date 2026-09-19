import { lazy, Suspense, useEffect, useState } from 'react';
import { useKitchen } from './game.js';
import {
  runBenchmark,
  pauseBenchmark,
  pauseBenchmarkWhenAway,
  resumeBenchmark,
  stopBenchmark,
  useBenchmark,
} from './benchmark.js';
import './bench.css';

const Kitchen = lazy(() => import('./Kitchen.jsx'));
// The decision endpoint always serves Jev, so keep it selectable even when the
// API is unreachable (local dev without `pnpm dev:api`).
const DEFAULT_MODELS = [{ id: 'jev', name: 'Jev' }];
const statusNames = {
  completed: '全レベルクリア',
  failed: 'ノルマ未達',
  error: '実行エラー',
  stopped: '終了',
  budget: 'call 上限',
};
const timer = (ms) => {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
function download(result) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `jev-bench-${new Date().toISOString().replaceAll(':', '-')}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Bench() {
  const bench = useBenchmark();
  const kitchen = useKitchen();
  const [models, setModels] = useState(DEFAULT_MODELS);
  const [modelId, setModelId] = useState('jev');
  const [error, setError] = useState('');
  useEffect(() => {
    document.title = 'jev-bench | SIDEKICK kitchen';
    const controller = new AbortController();
    fetch('/api/bench/models', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('モデル一覧の取得に失敗しました');
        const list = (await response.json()).models;
        if (Array.isArray(list))
          setModels([
            ...DEFAULT_MODELS,
            ...list.filter((model) => !DEFAULT_MODELS.some((known) => known.id === model.id)),
          ]);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    const hidden = () => {
      if (document.hidden) pauseBenchmarkWhenAway();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', hidden);
      if (useBenchmark.getState().running) stopBenchmark();
    };
  }, []);
  const start = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    void runBenchmark({
      model: models.find((model) => model.id === modelId),
      frequency: Number(form.get('frequency')),
      maxRequests: Number(form.get('maxRequests')),
    }).catch((e) => setError(e.message));
  };
  const latest = bench.results.at(-1);
  const paused = bench.paused || kitchen.phase === 'paused' || kitchen.menuOpen;
  return (
    <main className="bench-page">
      <header className="bench-header">
        <h1>jev-bench</h1>
        <a href="/">自分でプレイ</a>
      </header>
      <div className="bench-broadcast">
        <section className="bench-screen" aria-label="ゲーム画面">
          <div className="app-shell">
            <div id="ui-access" />
            <Suspense fallback={null}>
              <Kitchen />
            </Suspense>
          </div>
        </section>
        <section className="bench-commentary" aria-label="AIの判断ログ">
          <ol>
            {bench.log
              .slice(0, -1)
              .reverse()
              .map((entry) => (
                <li key={entry.call}>
                  <span>#{entry.call}</span> {entry.action}
                </li>
              ))}
          </ol>
        </section>
        <section className="bench-summary" aria-label="今回のクリア記録">
          <div className="bench-status">
            <strong className="bench-clock" aria-label="経過時間">
              {timer(bench.running ? bench.elapsedMs : (latest?.activeMs ?? 0))}
            </strong>
            <p className="bench-current" role={error ? 'alert' : 'status'}>
              {error ||
                (bench.running
                  ? paused
                    ? '一時停止'
                    : bench.action
                  : latest?.error || statusNames[latest?.status])}
            </p>
          </div>
          <span className="bench-calls">{bench.requests} calls</span>
          <div className="bench-splits">
            <table>
              <thead>
                <tr>
                  <th>レベル</th>
                  <th>所持金</th>
                  <th>スコア</th>
                </tr>
              </thead>
              <tbody>
                {bench.splits.map((split) => (
                  <tr key={split.level}>
                    <th scope="row">{split.level}</th>
                    <td>{split.cash}</td>
                    <td>{split.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="bench-controls-panel" aria-label="実行条件">
          <form className="bench-controls" onSubmit={start} aria-label="実行条件">
            <select
              aria-label="モデル"
              value={modelId}
              disabled={bench.running}
              onChange={(e) => setModelId(e.target.value)}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <div className="bench-actions">
              <button
                type={bench.running ? 'button' : 'submit'}
                onClick={bench.running ? (paused ? resumeBenchmark : pauseBenchmark) : undefined}
                disabled={!bench.running && (!kitchen.ready || !models.length)}
              >
                {bench.running ? (paused ? '再開' : '中断') : '開始'}
              </button>
              <button
                type="button"
                disabled={bench.running || !latest}
                onClick={() => download(latest)}
              >
                JSON
              </button>
            </div>
            <label>
              frequency（Hz）
              <input
                name="frequency"
                type="number"
                inputMode="decimal"
                min="0.1"
                max="10"
                step="any"
                required
                disabled={bench.running}
                defaultValue="5"
              />
            </label>
            <label>
              最大 call 数
              <input
                name="maxRequests"
                type="number"
                inputMode="numeric"
                min="1"
                max="10000"
                step="1"
                required
                disabled={bench.running}
                defaultValue="5000"
              />
            </label>
          </form>
        </aside>
      </div>
    </main>
  );
}
