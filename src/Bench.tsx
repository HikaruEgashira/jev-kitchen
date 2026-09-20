import { lazy, Suspense, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useKitchen } from './game.ts';
import {
  runBenchmark,
  submitRun,
  pauseBenchmark,
  pauseBenchmarkWhenAway,
  resumeBenchmark,
  stopBenchmark,
  useBenchmark,
  directEndpoint,
} from './benchmark.ts';
import type { DirectEndpoint } from './benchmark.ts';
import './bench.css';
import type { BenchResult } from './types.ts';
import type { BoardEntry } from './run-store.ts';

const Kitchen = lazy(() => import('./Kitchen.tsx'));
// A model the user added in this page. It carries its own endpoint and is called
// directly from the browser, so it never reaches the Worker.
interface BenchModel {
  id: string;
  name: string;
  endpoint?: DirectEndpoint;
}
// The decision endpoint always serves Jev, so keep it selectable even when the
// API is unreachable (local dev without `pnpm dev:api`).
const DEFAULT_MODELS: BenchModel[] = [{ id: 'jev', name: 'Jev' }];
const statusNames: Record<string, string> = {
  completed: '全レベルクリア',
  failed: 'ノルマ未達',
  error: '実行エラー',
  stopped: '終了',
  budget: 'call 上限',
};
const timer = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
function download(result: BenchResult) {
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
  const [models, setModels] = useState<BenchModel[]>(DEFAULT_MODELS);
  const [modelId, setModelId] = useState('jev');
  const [error, setError] = useState('');
  const [modelError, setModelError] = useState('');
  const [board, setBoard] = useState<BoardEntry[]>([]);
  useEffect(() => {
    document.title = 'jev-bench | SIDEKICK kitchen';
    useKitchen.setState({ benchmark: true });
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
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/leaderboard', { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (data?.ok && Array.isArray(data.board)) setBoard(data.board);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [bench.verified]);
  const start = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    const selected = models.find((entry) => entry.id === modelId) ?? null;
    void runBenchmark({
      model: selected,
      frequency: Number(form.get('frequency')),
      maxRequests: Number(form.get('maxRequests')),
    })
      // A browser-direct model is not recorded server-side, so there is nothing
      // to verify or rank.
      .then(() => (selected?.endpoint ? undefined : submitRun()))
      .catch((e) => setError(e.message));
  };
  // Session-only: the endpoint (and its API key) lives in this component's state
  // and disappears on reload.
  const addModel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const token = String(form.get('token') ?? '').trim();
    const remote = String(form.get('model') ?? '').trim();
    const endpoint = directEndpoint({
      url: String(form.get('url') ?? '').trim(),
      ...(token ? { token } : {}),
      ...(remote ? { model: remote } : {}),
    });
    if (!endpoint) {
      setModelError('Base URL は https:// で始まるURLを入力してください');
      return;
    }
    const id = `custom:${crypto.randomUUID()}`;
    const name = String(form.get('name') ?? '').trim() || new URL(endpoint.url).hostname;
    setModels((list) => [...list, { id, name, endpoint }]);
    setModelId(id);
    setModelError('');
    event.currentTarget.reset();
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
                  : latest
                    ? latest.error || statusNames[latest.status]
                    : '')}
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
          {bench.verified && (
            <p className="bench-current" role="status">
              検証済み {bench.verified.clearedLevels}クリア・{bench.verified.score}点（到達Lv
              {bench.verified.reachedLevel}）
            </p>
          )}
          <div className="bench-splits" aria-label="検証済みランキング">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>クリア</th>
                  <th>到達Lv</th>
                  <th>スコア</th>
                </tr>
              </thead>
              <tbody>
                {board.map((entry, index) => (
                  <tr key={entry.sid}>
                    <th scope="row">{index + 1}</th>
                    <td>{entry.clearedLevels}</td>
                    <td>{entry.reachedLevel}</td>
                    <td>{entry.score}</td>
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
                onClick={() => {
                  if (latest) download(latest);
                }}
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
          <form className="bench-add-model" onSubmit={addModel} aria-label="モデルを追加">
            <h2>モデルを追加</h2>
            <label>
              名前
              <input
                name="name"
                maxLength={80}
                placeholder="既定はホスト名"
                disabled={bench.running}
              />
            </label>
            <label>
              Base URL
              <input
                name="url"
                type="url"
                required
                placeholder="https://…/v1/decision"
                disabled={bench.running}
              />
            </label>
            <label>
              モデルID（任意）
              <input name="model" maxLength={100} disabled={bench.running} />
            </label>
            <label>
              APIキー（任意）
              <input name="token" type="password" autoComplete="off" disabled={bench.running} />
            </label>
            <button type="submit" disabled={bench.running}>
              追加
            </button>
            <p className="bench-model-note" role={modelError ? 'alert' : undefined}>
              {modelError ||
                'ページ内だけに保持し、ブラウザから直接呼び出します（Worker・順位検証の対象外）。'}
            </p>
          </form>
        </aside>
      </div>
    </main>
  );
}
