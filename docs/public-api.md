# 公開API仕様

Cloudflare Access を外して一般公開する前提の、Worker API の境界とランキング基盤の設計。
現行の入出力の唯一の正は `src/worker.ts`・`src/session.ts` と `wrangler.jsonc`。この文書は構造と意図だけを書く。

## 前提と変化

これまでの唯一の防御は Cloudflare Access だった（`README.md` の受入境界）。Access を外すと、`/api/*` は
インターネットから到達可能になり、認証・課金保護を Worker 自身が持たなければならない。
攻撃対象は「TypeSafe APIキー／Workers AIクレジットでの有料推論」と「WorkerのCPU」、そして「ランキングの完全性」。

## 脅威モデル

| 主体                       | できること                   | 対策                                                                          |
| -------------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| 匿名の非ブラウザ（curl等） | 任意のリクエストを直接送る   | run ticket 必須化、IPレート制限、スキーマ検証                                 |
| 悪意あるWebページ          | 被害者のブラウザから送る     | CORSヘッダを返さない、`content-type: application/json` 強制、cookieを使わない |
| チートするプレイヤー       | devtools、端末保存、JS改変   | サーバ権威（未実装。後述）                                                    |
| 課金枯渇狙い               | `/api/health` 等の副作用連打 | 課金するGETを廃止、レート制限、上流spend cap                                  |

## 防御の階層

1. **run ticket**（`src/session.ts`）: 課金ルートは `POST /api/session` が発行する HMAC 署名済みチケットを要求する。
   チケットは `{sid, seed, mode, exp}` を持ち、`mode` は `play` / `bench`。`TICKET_SECRET` 未設定なら課金ルートは
   すべて503で閉じる（fail closed）。
2. **レート制限**: Cloudflare Workers Rate Limiting binding（`wrangler.jsonc` の `ratelimits`）で、
   セッション発行と課金呼び出しを別々にIP単位で制限する。limiter のエラーは拒否として扱う（fail closed）。
3. **スキーマ検証**: リクエスト/上流のサイズ上限・候補ID・質問形式を課金前に検証する。既存の `validate` を維持する。
4. **上流の予算**: AI Gateway / TypeSafe 側の spend limit を口座で設定する。アプリ内の総量上限ではない。

> `ponytail:` チケットはステートレスなので、奪ったチケットは有効期限内で再利用できる。IPレート制限がその窓を縛る。
> run 単位の正確な call 予算が必要になった時点で Durable Object のカウンタへ上げる（後述のランキング実装と同じ経路）。

## エンドポイント

| Method | Path                | ticket  | 課金 | 役割                                         |
| ------ | ------------------- | ------- | ---- | -------------------------------------------- |
| POST   | `/api/session`      | 不要    | なし | `mode` を指定して run ticket を発行する      |
| POST   | `/api/decide`       | `play`  | あり | メインゲームの Jev 判断                      |
| POST   | `/api/decide-llm`   | `play`  | あり | 比較用 LLM の判断                            |
| POST   | `/api/bench/decide` | `bench` | あり | jev-bench のモデル判断（選択を run に記録）  |
| POST   | `/api/runs/finish`  | `bench` | なし | 決定列を再実行し検証済みスコアを確定する     |
| POST   | `/api/runs/score`   | `play`  | なし | 通常プレイのキャンペーンを検証して順位化する |
| GET    | `/api/leaderboard`  | 不要    | なし | 種別ごとの上位20件                           |
| GET    | `/api/bench/models` | 不要    | なし | 登録モデルのラベル一覧                       |
| GET    | `/api/health`       | 不要    | なし | 設定プローブ。モデルを呼ばない               |

課金ルートは `content-type: application/json` と `x-run-ticket` ヘッダを必須とする。

> `ponytail:` `/bench`の「モデルを追加」でユーザーが入力したBase URL・APIキーは、ブラウザから直接呼び出し、
> このAPIを通らない。WorkerはURLもキーも見ず、決定列も記録できないため、そのrunは順位検証の対象外になる。
> 公開Workerに任意URLへの転送（SSRF面）を増やさない代わりに、その試行は検証できない。

### `POST /api/session`

```json
{ "mode": "play" }
```

応答: `{ "ok": true, "mode": "play", "seed": 123, "expiresAt": 1234567890, "ticket": "<payload>.<signature>" }`
`seed` はサーバ生成の乱数で、応答者の抽選や注文配置を run に束縛する用途を想定する。
現状クライアントは `seed` をまだ消費しない（ランキング実装で使う）。

### エラー

| status | 意味                                             |
| ------ | ------------------------------------------------ |
| 400    | 入力JSON・mode・質問形式が不正                   |
| 401    | ticket が無い・改ざん・期限切れ・mode不一致      |
| 405    | method 不一致                                    |
| 415    | `content-type` が `application/json` でない      |
| 429    | レート制限                                       |
| 503    | `TICKET_SECRET` 未設定（課金ルートを閉じている） |
| 502    | 上流の失敗・timeout（本文は秘匿）                |

## ランキング基盤（リプレイ検証。実装済み）

### 検証モデル

ランキング対象は**ベンチのフルキャンペーン**。サーバが発行した意思決定IDの列を、セッションの `seed` とともに
サーバが `runReplayCampaign`（`src/replay.ts`）で再実行し、到達レベル・クリア数・合計スコアを再計算する。
クライアントはスコアも決定列も提出しない。検証は**提出時（`/api/runs/finish`）に自動**で行い、ユーザー操作を要求しない。

- リプレイは本編と同じ `tickWorld`（`src/engine.ts`）と、シフト遷移の `nextShiftParams`（`src/nextShift.ts`）を通る。
  応募者の抽選は `seed` から決定論的に生成する（`src/applicants.ts`）。クライアントも同じ seed で抽選する。
- パートナーは固定ルール（`rulePick`）で、モデル入力はプレイヤーの意思決定だけ。
- 決定列はサーバが保持する（`GameStore`）。クライアントは分岐・取捨できない。
- `frequency` は端末側の呼び出し間隔であり順位に影響しない。
- リプレイは固定60Hzで再実行する。実プレイは可変フレームのため、表示スコアと検証スコアは一致しない。順位は検証スコアを使う。

### エンドポイント

| Method | Path               | ticket | 役割                                               |
| ------ | ------------------ | ------ | -------------------------------------------------- |
| POST   | `/api/runs/finish` | bench  | 保存済み決定列を再実行し、検証済みスコアを確定する |
| POST   | `/api/runs/score`  | play   | 通常プレイのステージ列を検証し、人間ボードへ載せる |
| GET    | `/api/leaderboard` | 不要   | 種別ごとの上位20件を返す（`?kind=human             | ai`） |

`POST /api/session`（mode `bench`）が run を作成し、`ranked: { protocol }` を返す。
`/api/bench/decide` はモデルの選択を返すたびに、その run へ順序つきで記録する。
`/api/runs/finish` は run を閉じ、決定列を `runReplayCampaign` で再実行して `GET /api/leaderboard` へ載せる。
`protocol` 不一致の run は409で拒否する（配信をまたいだ run を混ぜない）。
Bench画面は run 終了時に `submitRun` を自動で呼ぶ。ユーザーに検証操作は求めない。

### 人間ボード（スナップショット検証。実装済み）

通常プレイの順位は、`bench` の決定列再生ではなく**ステージ開店時スナップショットの妥当性**で検証する。
`/api/runs/score` が `{ protocol, owner, completed, score, snapshots }` を受け取り、各 `snapshot` を
`validateCheckpoint`（`src/checkpoint.ts`、クライアントと共有）で再検証し、`1..N` の連続したステージ列だけを受理する。
到達Lv・クリア数はサーバ側で確定し、`score` はクライアント申告値をそのまま載せる。

- これは**構造的妥当性のゲートであり、実プレイの証明ではない**。妥当な形のスナップショットを捏造すれば通る。
- 提出は `finishShift` と `beginShift` からの best-effort な POST のみ。フレームループには触れず、失敗はローカルの進行に影響しない。
- 同一 `owner`（端末UUID）は `(kind, owner)` 単位で best の1件だけを保持し、連投でボードを埋めない。
- ボードは `kind`（`human` / `ai`）ごとに上位20件を保持する。既存の bench entry は読み出し時に `kind:'ai'` として補完する。

### 保存

Cloudflare Durable Object `GameStore`（`wrangler.jsonc` の `RUNS`）。run ごとに1インスタンス、リーダーボードは `board`
インスタンス。`RunStore` インターフェース（`src/run-store.ts`）を挟み、テストは `memoryRunStore` を注入する。

### 意図的な範囲

- キャンペーン全体（複数シフトと準備）を対象とする。準備行動（`hire_*`/`crew_*`/`stock_*`/`equipment_*`/`vitamin_*`/`open_shift`）も決定列に含めて再実行する。
- リプレイは `MAX_REPLAY_STEPS`（60Hz×5分/シフト）で有界。長時間runでもサーバCPUは線形で抑えられる。
- 決定列が尽きたrun、protocol不一致、準備の循環は `truncated` として登録し、クリア数とスコアで下位に扱う。

### 追加で必要な防御（ランキング本格運用まで）

- run 単位の call 予算を DO カウンタで強制する（現状はIPレート制限と決定列の上界のみ）。
- Turnstile をセッション発行に付ける（分散IP対策。未実装）。
- 上流の spend limit を口座側で設定する。

## ロールアウトと復旧

公開前チェック:

1. `wrangler secret put TICKET_SECRET`（16文字以上）を設定する。
2. `wrangler.jsonc` の `ratelimits` と `durable_objects`（`RUNS` / `GameStore`、migration `v1`）が配信されていることを確認する。
3. AI Gateway / TypeSafe の spend limit を設定する。
4. `GET /api/health` の `configured.sessions` と `configured.rateLimit` が両方 true であることを確認する。
5. 未認証の `POST /api/decide` が401、`POST /api/session` が200を返すことを確認する。
6. `POST /api/session`（bench）→ `/api/bench/decide` → `/api/runs/finish` の順で1 run を完了し、`GET /api/leaderboard` に載ることを確認する。

復旧は `wrangler deployments list` で配信前versionを記録してから `wrangler rollback <version-id>`。
`TICKET_SECRET` を外すと課金ルートは503で閉じるので、事故時はまずこれを外して止める。
