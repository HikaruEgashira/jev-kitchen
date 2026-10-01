---
name: jev-bench
description: |
  jev-kitchen のゲームベンチで判断モデル（jev TypeSafe / clef / clef-flash / 外部 systemone プロバイダ）を評価し、レポートまで一体で実施するスキル。モデルのベンチ追加、レイテンシ（median・p95）→ スコアの順での測定、マークダウンレポート生成を含む。
  Trigger: benchにモデルを追加して評価, ベンチマーク評価して, jev/clef/clef-flash/laya を比較, レイテンシとスコアのレポート, /jev-bench
---

# jev-bench

jev-kitchen（`~/ghq/github.com/HikaruEgashira/jev-kitchen`）で、状態→次の調理行動を選ぶ**判断モデル**を同一条件で評価するプロセス。画面認識や操作能力は測らない。

## 前提

- リポジトリ: `~/ghq/github.com/HikaruEgashira/jev-kitchen`（main で作業、`pnpm test` 等の QA 後に push）
- ローカル Worker を起動して接続する: `pnpm dev:api`（port 8787、`.dev.vars` の `TYPESAFE_API_KEY` で jev=typesafe 経由、AI binding で clef 系）
- 全コマンドに `BENCH_ORIGIN=http://127.0.0.1:8787` を渡す（未指定でもデフォルトは同値）

## ① モデルの追加（bench に無いモデルを評価するときのみ）

判断モデルは Jev 形式 `{state, questions}` を返す。Cloudflare の判断モデルは worker 内蔵:

- `src/worker.ts` の `CLOUDFLARE_DECISION_MODELS` に `{ id, name, short }` を追加。
  - AI binding 経由はペイロード内 `model` に **short 名**（`clef` 等）が必要（`AI.run` の第一引数はフル ID `@cf/cloudflare/clef`）。
  - 応答は `answers.next_action.{choice, probabilities, confidence}` 形式で `projectDecision` が処理する。
  - 応答スパイク対策で `CLOUDFLARE_DECISION_TIMEOUT_MS`（60s）が適用される。interactive な jev/endpoint は 8s のまま。
- `/api/bench/models` のレジストリと `BUILTIN_BENCH_MODELS` に自動で載る。
- サーバ側の Jev 互換プロバイダは `BENCH_ENDPOINTS`（`.dev.vars`）に登録する。Jev 形式 `{state, questions}` を Bearer 認証で返す https エンドポイントなら何でも良い。例（Laya、ローカル評価用）:
  ```json
  {
    "laya": {
      "name": "Laya",
      "url": "https://jev.plenoai.com/v1/systemone",
      "token": "<key>",
      "model": "english"
    }
  }
  ```
  - プロバイダ側の契約: `instructions` 必須・`criteria` は choice で 2 以上・余分な key は forbid・`state` は string/dict 可・`model` は english/multilingual/typed-decisions。
  - ユーザーキーは provider の keys ページで発行し、ローカルファイル（例 `~/.config/jev/loadtest.key`）から読む。
- クライアント側 timeout（`src/benchmark.ts` の `decisionTimeoutMs`）と `scripts/bench.ts` / `scripts/evaluate-bench.ts` の `--model` 検証リストにも追加する。`scripts/bench-report.ts` の `MODEL_NAMES` にも表示名を追加。

## ② 実行順（固定）: latency（median・p95）→ score

**レイテンシ先、スコア後。** 1モデルずつ、測定は同一条件（frequency 3Hz・加速・repeats 3）。

```sh
# 1) レイテンシ（固定15局面 corpus、median・p95・正答率）
node scripts/evaluate-bench.ts --model <jev|clef|clef-flash> --repeats 3 --pace 400 --output /tmp/jev-bench-<model>-latency.json

# 2) スコア（Lv30 キャンペーン。移動・待機のみ加速、モデル応答は実時間）
node scripts/bench.ts --model <model> --accelerated --frequency 3 --until 30 --output /tmp/jev-bench-<model>.json
```

全部まとめて実行する場合は:

```sh
node scripts/bench-report.ts --models jev,clef,clef-flash --until 30 --frequency 3 --pace 400 --output /tmp/jev-bench-report.md
```

## ③ スコアの意味（重要）

- `BenchResult.score` = **全プレイ済みシフト（クリア・失敗とも）の per-level スコア合計**。キャンペーン通しの実力を示し、モデル間で比較可能。
- `finalShift.score` は最終シフト1回だけの値。高レベルほど quota 増で1皿あたりの点数が下がるため、**到達レベルの異なる finalShift.score 同士は絶対比較しない**（レポートの score 列には `campaign.score` を使う）。
- レイテンシだけで実力は測れない（例: clef-flash は最速だが最弱）。実力順位は cleared 数と Σscore を見る。

## ④ 既知の制約

- **rate limit**: DECIDE_LIMITER 240 calls/min/IP（wrangler dev でもエミュレートされる）。burst は 429 で試行が error 終了する → frequency は 3Hz（180/min）に。旧5Hz計測とは条件が異なるので報告に明記。
- **cold-shard stall**: Workers AI の判断モデルは温状態の数倍〜数十秒のスパイクが出る。worker 側 60s / client 側 65s の cap が効いている。cap 到達での error は infra 起因 → そのモデルのみ再試行（リトライは新試行として扱う）。
- **jev(cf)**（AI binding の `typesafe/jev`）: このアカウントでは全ペイロード形状で "User Input Error" となり実行不能。AI Gateway クレジット有効化が必要。eval は typesafe 経由で行う。
- corpus 評価は `--pace 400` でペース配分し、直後のキャンペーンと同一 rate-limit window を食わないようにする。
- **外部 RunPod プロバイダの cold start**: GPU 未接続時は初回リクエストがポッド起動を待つ（数分）。worker 側の endpoint 上限 8s に引っかかるため、評価前に `curl /ping` か1回の実推論で温めてから測定する。温状態は p50 約 80ms。

## ⑤ レポート

`scripts/bench-report.ts` が markdown を `/tmp/jev-bench-report.md` に書く。表の順序は ①レイテンシ（median・p95）→ ②スコア。成果物は `/tmp/jev-bench-<model>.json`（各判断の latencyMs・confidence・適用有無つき）。

## ⑥ QA と配布

`pnpm test && pnpm typecheck && pnpm check && pnpm build` を緑にしてから `git commit` + `git push origin main`（CI + Workers Builds が自動デプロイ）。git clean かつ remote 同期済みを完了条件とする。
