import { lazy, Suspense, useEffect, useState } from 'react';
import { useKitchen } from './game.js';
import { STAFF } from './staff.js';
import { runBenchmark, stopBenchmark, useBenchmark } from './benchmark.js';
import './bench.css';

const Kitchen = lazy(() => import('./Kitchen.jsx'));
const statusNames = {
  completed: '全レベルクリア',
  failed: 'ノルマ未達',
  error: '実行エラー',
  stopped: '中断',
  budget: 'call 上限',
};
const timer = (ms) => {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

function download(results) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `jev-bench-${new Date().toISOString().replaceAll(':', '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Bench() {
  const bench = useBenchmark();
  const kitchen = useKitchen();
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState('jev');
  const [error, setError] = useState('');
  useEffect(() => {
    document.title = 'jev-bench | SIDEKICK kitchen';
    const controller = new AbortController();
    fetch('/api/bench/models', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('モデル一覧の取得に失敗しました');
        setModels((await response.json()).models);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    const hidden = () => {
      if (document.hidden && useBenchmark.getState().running) stopBenchmark('タブ非表示で中断');
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
  const game = kitchen.game;
  const latest = bench.results.at(-1);
  const status = bench.running
    ? kitchen.phase === 'finished'
      ? '開店準備'
      : '営業中'
    : statusNames[latest?.status] || '待機中';
  return (
    <main className="bench-page">
      <header className="bench-header">
        <h1>jev-bench</h1>
        <a href="/">自分でプレイ</a>
      </header>
      <div className="bench-broadcast">
        <section className="bench-screen" aria-label="実行中のゲーム">
          <div className="bench-screen-title">
            <span>SIDEKICK kitchen</span>
            <span>{status}</span>
          </div>
          <div className="bench-stage" inert>
            <div className="app-shell">
              <Suspense fallback={<p>厨房を準備中…</p>}>
                <Kitchen showUI={false} />
              </Suspense>
            </div>
          </div>
        </section>
        <aside className="bench-sidebar" aria-label="進行状況と設定">
          <section className="bench-clock" aria-label="経過時間">
            <span>TIME</span>
            <strong>{timer(bench.running ? bench.elapsedMs : (latest?.wallMs ?? 0))}</strong>
          </section>
          <dl className="bench-stats">
            <div>
              <dt>LEVEL</dt>
              <dd>
                {game.level}
                <small> / 100</small>
              </dd>
            </div>
            <div>
              <dt>配膳</dt>
              <dd>
                {game.served}
                <small> / {game.quota}</small>
              </dd>
            </div>
            <div>
              <dt>営業残り</dt>
              <dd>
                {Math.max(0, Math.ceil((game.duration - game.time) / 1000))}
                <small> 秒</small>
              </dd>
            </div>
            <div>
              <dt>CALLS</dt>
              <dd>{bench.requests}</dd>
            </div>
            <div>
              <dt>SCORE</dt>
              <dd>{game.score}</dd>
            </div>
            <div>
              <dt>所持金</dt>
              <dd>{game.cash}</dd>
            </div>
            <div>
              <dt>相棒</dt>
              <dd className="bench-staff">{STAFF[game.staffId]?.name}</dd>
            </div>
          </dl>
          <form className="bench-controls" onSubmit={start} aria-label="実行条件">
            <fieldset disabled={bench.running}>
              <label>
                モデル
                <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                frequency / 秒
                <input
                  name="frequency"
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  max="10"
                  step="any"
                  required
                  defaultValue="1"
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
                  defaultValue="1000"
                />
              </label>
              <button type="submit" disabled={!kitchen.ready || !models.length}>
                {kitchen.ready ? 'START' : '準備中…'}
              </button>
            </fieldset>
          </form>
          {bench.running && (
            <button className="bench-stop" onClick={() => stopBenchmark()}>
              STOP
            </button>
          )}
          {error && (
            <p role="alert" className="bench-error">
              {error}
            </p>
          )}
        </aside>
        <section className="bench-commentary" aria-label="AIの判断ログ">
          <div className="bench-runner">
            <strong>{models.find((model) => model.id === modelId)?.name || '—'}</strong>
            <span>{status}</span>
          </div>
          <div className="bench-log">
            <p className="bench-current" role="status">
              {bench.running ? bench.action || '開始中…' : latest?.error || status}
            </p>
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
          </div>
        </section>
      </div>
      <section className="bench-results" aria-label="比較結果">
        <div className="bench-results-heading">
          <h2>RESULTS</h2>
          <button disabled={!bench.results.length} onClick={() => download(bench.results)}>
            JSON 保存
          </button>
        </div>
        {bench.results.length > 0 && (
          <div className="bench-table">
            <table>
              <thead>
                <tr>
                  <th>モデル</th>
                  <th>frequency / 上限</th>
                  <th>結果</th>
                  <th>到達 / クリア</th>
                  <th>calls</th>
                  <th>平均 / p95</th>
                </tr>
              </thead>
              <tbody>
                {bench.results.map((result, index) => (
                  <tr key={`${result.startedAt}-${index}`}>
                    <th scope="row">{result.model.name}</th>
                    <td>
                      {result.conditions.frequency} / {result.conditions.maxRequests}
                    </td>
                    <td>
                      {statusNames[result.status]}
                      {result.error && <small>{result.error}</small>}
                    </td>
                    <td>
                      Lv.{result.reachedLevel} / {result.clearedLevels}
                    </td>
                    <td>
                      {result.requests}
                      <small>破棄 {result.staleResponses}</small>
                    </td>
                    <td>
                      {result.meanMs ?? '—'} / {result.p95Ms ?? '—'} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
