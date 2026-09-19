import { lazy, Suspense, useEffect, useState } from 'react';
import { useKitchen } from './game.js';
import { runBenchmark, stopBenchmark, useBenchmark } from './benchmark.js';
import './bench.css';

const Kitchen = lazy(() => import('./Kitchen.jsx'));
const statusNames = {
  completed: '目標クリア',
  failed: 'ノルマ未達',
  error: 'API / 実行エラー',
  stopped: '中断',
  budget: '判断上限',
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
  const [attempts, setAttempts] = useState(1);
  const [maxLevel, setMaxLevel] = useState(100);
  const [maxRequests, setMaxRequests] = useState(1000);
  const [error, setError] = useState('');
  useEffect(() => {
    document.title = 'jev-bench | SIDEKICK kitchen';
    const controller = new AbortController();
    fetch('/api/bench/models', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            'モデル一覧を取得できませんでした。接続設定を確認して再読み込みしてください。',
          );
        const data = await response.json();
        setModels(data.models);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    const hidden = () => {
      if (document.hidden && useBenchmark.getState().running)
        stopBenchmark('タブが非表示になったため中断しました');
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
    setError('');
    void runBenchmark({
      model: models.find((model) => model.id === modelId),
      attempts,
      maxLevel,
      maxRequests,
    }).catch((e) => setError(e.message));
  };
  const finished = bench.results.filter((result) =>
    ['completed', 'failed'].includes(result.status),
  );
  const cleared = finished.filter((result) => result.status === 'completed').length;
  const game = kitchen.game;
  return (
    <main className="bench-page">
      <header className="bench-header">
        <div>
          <h1>jev-bench</h1>
          <p>この厨房を、AIはどこまでクリアできるか。</p>
        </div>
        <a href="/">自分でプレイ</a>
      </header>
      <div className="bench-workspace">
        <section className="bench-controls" aria-label="ベンチマークの実行条件">
          <h2>挑戦するモデル</h2>
          <form onSubmit={start}>
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
              <div className="bench-fields">
                <label>
                  試行数
                  <input
                    type="number"
                    min="1"
                    max="5"
                    required
                    value={attempts}
                    onChange={(e) => setAttempts(Number(e.target.value))}
                  />
                </label>
                <label>
                  目標レベル
                  <input
                    type="number"
                    min="1"
                    max="100"
                    required
                    value={maxLevel}
                    onChange={(e) => setMaxLevel(Number(e.target.value))}
                  />
                </label>
              </div>
              <label>
                1試行の判断上限
                <input
                  type="number"
                  min="1"
                  max="10000"
                  required
                  value={maxRequests}
                  onChange={(e) => setMaxRequests(Number(e.target.value))}
                />
              </label>
              <button
                className="bench-start"
                type="submit"
                disabled={!kitchen.ready || !models.length}
              >
                {kitchen.ready ? '挑戦を開始' : '厨房を準備中…'}
              </button>
            </fieldset>
          </form>
          {bench.running && (
            <button className="bench-stop" onClick={() => stopBenchmark()}>
              試行を中断
            </button>
          )}
          {error && (
            <p role="alert" className="bench-error">
              {error}
            </p>
          )}
          <div className="bench-rules">
            <h3>全モデル、同じ条件で。</h3>
            <p>
              Lv.1・120コインから開始。相棒は固定ルールのハル。各営業90秒、ノルマ達成で次のレベルへ進みます。
            </p>
            <p>
              採用とダッシュは行わず、次のノルマ＋2個を自動仕入れ。APIの待ち時間も営業に含みます。
            </p>
            <p>
              実行にはモデルのAPI利用料が発生します。タブを表示したままにしてください。通常プレイの保存データは更新しません。
            </p>
          </div>
        </section>
        <section className="bench-live" aria-label="実行中のゲーム">
          <div className="bench-live-heading">
            <h2>{bench.running ? `試行 ${bench.attempt} / ${attempts}` : 'キッチン環境'}</h2>
            <span>
              {bench.running
                ? `Lv.${game.level}　${game.served} / ${game.quota}皿　${game.score}点　残り${Math.ceil((game.duration - game.time) / 1000)}秒`
                : 'プレイヤー：評価モデル / 相棒：固定ルール'}
            </span>
          </div>
          <div className="bench-stage" inert>
            <div className="app-shell">
              <Suspense fallback={<p>キッチンを準備しています…</p>}>
                <Kitchen showUI={false} />
              </Suspense>
            </div>
          </div>
          <div className="bench-action" role="status">
            <span>
              {bench.running
                ? bench.action || '開始しています…'
                : bench.results.at(-1)?.error ||
                  statusNames[bench.results.at(-1)?.status] ||
                  'モデルを選んで、挑戦を開始してください。'}
            </span>
            <span>{bench.requests} 判断</span>
          </div>
        </section>
      </div>
      <section className="bench-results" aria-label="比較結果">
        <div className="bench-results-heading">
          <div>
            <h2>挑戦の記録</h2>
            <p>
              条件が同じ試行どうしを比較してください。到達は挑戦したレベル、クリアはノルマ達成数です。
            </p>
          </div>
          <button disabled={!bench.results.length} onClick={() => download(bench.results)}>
            結果をJSONで保存
          </button>
        </div>
        {bench.results.length ? (
          <>
            <p className="bench-summary">
              {bench.results.length} 試行 / 目標クリア {cleared} / 営業で決着 {finished.length} /
              中断・エラー・判断上限 {bench.results.length - finished.length}
            </p>
            <div className="bench-table">
              <table>
                <thead>
                  <tr>
                    <th>モデル</th>
                    <th>条件</th>
                    <th>結果</th>
                    <th>到達 / クリア</th>
                    <th>判断</th>
                    <th>平均 / p95</th>
                  </tr>
                </thead>
                <tbody>
                  {bench.results.map((result, index) => (
                    <tr key={`${result.startedAt}-${index}`}>
                      <th scope="row">{result.model.name}</th>
                      <td>
                        Lv.{result.conditions.maxLevel} / {result.conditions.maxRequests}判断まで
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
                        <small>応答破棄 {result.staleResponses}</small>
                      </td>
                      <td>
                        {result.meanMs ?? '—'} / {result.p95Ms ?? '—'} ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="bench-empty">最初の試行を、比較の基準に。</p>
        )}
      </section>
      <footer className="bench-footer">
        Jev Choice互換のdecision endpointに対応。実行結果はこのタブ内に保持されます。
      </footer>
    </main>
  );
}
