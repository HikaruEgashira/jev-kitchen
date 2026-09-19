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

| Method | Path                | ticket  | 課金 | 役割                                    |
| ------ | ------------------- | ------- | ---- | --------------------------------------- |
| POST   | `/api/session`      | 不要    | なし | `mode` を指定して run ticket を発行する |
| POST   | `/api/decide`       | `play`  | あり | メインゲームの Jev 判断                 |
| POST   | `/api/decide-llm`   | `play`  | あり | 比較用 LLM の判断                       |
| POST   | `/api/bench/decide` | `bench` | あり | jev-bench のモデル判断                  |
| GET    | `/api/bench/models` | 不要    | なし | 登録モデルのラベル一覧                  |
| GET    | `/api/health`       | 不要    | なし | 設定プローブ。モデルを呼ばない          |

課金ルートは `content-type: application/json` と `x-run-ticket` ヘッダを必須とする。

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

## ランキング基盤（設計。未実装）

### なぜ現状のままではランキングできないか

スコアと状態はクライアントが生成し、端末保存のみでサーバ権威が無い（`src/game.js`）。worker は「候補IDが criteria に
含まれるか」しか見ない。したがって、クライアントが提出するスコアや状態は信頼できない。改ざん不能な順位には、次のどちらかが要る。

| 案                | 内容                                                                             | 長所                                           | コスト                                                         |
| ----------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| A: サーバ実行型   | サーバ（Durable Object）が run を回し、モデル呼び出しも採点も行う                | 提出物を信頼する必要が無い。AIモデル順位に最適 | game.js をWorkerへ同梱し、長時間実行をalarm/Workflowで継続する |
| B: リプレイ検証型 | クライアントが入力と選択のログを提出し、サーバが同一revisionで再実行して照合する | 人間プレイの順位も出せる                       | 固定ステップ・seed固定のヘッドレス決定論エンジンへの抽出が必要 |

現状はどちらも未実装。**検証が無いリーダーボードは公開しない。** 実装できるまで `GET /api/leaderboard` も `POST` 提出も公開しない。

### 採用案: A → B の順

1. **AIモデル順位（A）**。`/bench` は既にヘッドレスで回る（`scripts/bench.mjs` が `tick` と `runBenchmark` を
   Nodeで実行する）。同じ処理を Durable Object へ載せ、モデル呼び出しを binding 直にすれば、スコアは構成上サーバ権威になる。
   - `POST /api/bench/runs`（ticket必須）で run を作成し、DO が実行、`GET /api/bench/runs/:id` で進捗を返す。
   - 到達レベルと条件（revision・frequency・最大call数）を記録する。モデルと条件が違えば順位を混ぜない。
2. **人間プレイ順位（B）**。固定ステップ化したヘッドレスエンジンを抽出し、入力ログを再実行してスコアを再計算する。
   - ログ: `{ revision, ticketSid, seed, events: [{ atMs, actor, actionId }] }`。
   - 応答者の抽選は `seed` から決定論的に生成する。`Math.random` をシミュレーションから排除する（`src/game.js` の `drawApplicants`）。
   - サーバは再計算したスコアだけを保存する。提出値は保存しない。

### 保存スキーマ（案）

Durable Object（単一インスタンスで直列化）または D1。

```
run:   { sid, mode, modelId, revision, conditions, startedAt, status, result }
score: { sid, mode, modelId, revision, verified, value, levelsCleared, at }
```

`GET /api/leaderboard?mode=bench|play&revision=...` は `verified = true` のみを値降順で返す。
`verified` は「サーバが実行した」または「リプレイが一致した」時だけ true。

### 追加で必要な防御（ランキング有効化まで）

- run 単位の call 予算を DO カウンタで強制する（現状はIPレート制限のみ）。
- `sid` ごとの提出は1回。ticket の `exp` と DO の状態で拒否する。
- Turnstile をセッション発行に付ける（分散IP対策。未実装）。
- 上流の spend limit を口座側で設定する。

## ロールアウトと復旧

公開前チェック:

1. `wrangler secret put TICKET_SECRET`（16文字以上）を設定する。
2. `wrangler.jsonc` の `ratelimits` が配信されていることを確認する。
3. AI Gateway / TypeSafe の spend limit を設定する。
4. `GET /api/health` の `configured.sessions` と `configured.rateLimit` が両方 true であることを確認する。
5. 未認証の `POST /api/decide` が401、`POST /api/session` が200を返すことを確認する。

復旧は `wrangler deployments list` で配信前versionを記録してから `wrangler rollback <version-id>`。
`TICKET_SECRET` を外すと課金ルートは503で閉じるので、事故時はまずこれを外して止める。
