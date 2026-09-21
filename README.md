# SIDEKICK kitchen

AIの相棒とLv100を目指す3D協力キッチン。配膳・仕入れ・採用で厨房を広げる。
React Three Fiber / Drei / Glyph / Zustand（pmndrs）とThree.js WebGPURenderer、Vite+を使う。WebGPU必須で、非対応環境では起動案内を出す。

## 遊び方

- Lv1は時間無制限のチュートリアル。サラダを一皿配膳すると即クリアする。初期資金は180コインで、売上は次の営業へ引き継ぐ。
- Lv2以降は各90秒でノルマ判定。Lv2・3は店長のアオと組み（給与85）、Lv3終了で退職する。以後は勤務表で相棒を選ぶ。
- 工程は トマト→まな板で切る→（皿／鍋／グリル）→盛り付け→配膳。Lv3でスープ、Lv6で手動ブーストと焦げ、Lv7でグリル、Lv8で2人稼働、Lv9で連勤と休養、Lv10でラッシュが解放される。注文のない完成品はQで片づける。
- クリア後は応募者を最大3名提示し、採用または見送る。同時出勤はLv8で2人、Lv12で3人、Lv16で4人。採用費とは別に給与を毎営業支払う。
- Lv2以降はトマト在庫が有限（1皿1個）。採用・仕入れ・給与は同じ財布で、次ノルマ以上の在庫がないと開店できない。
- 開店準備で設備（まな板・鍋・グリル・保温台）の増設・改良・配置と、育成薬を扱う。支払いは開店時に一括確定する。
- 失敗時は同条件の再挑戦・開店準備の見直し・前ステージへの巻戻しを選べる。財布・在庫・雇用・疲労・設備・配置・育成をまとめて復元する。
- 操作はWASD／矢印で移動、Eで作業、Shiftでダッシュ、Qで片づけ。スマホは作業台の3Dボタン。設定でカメラ・移動基準・画質・バックグラウンドモードを切り替える。
- メニューの「ランキング」で自分の到達LvとAIの順位を切り替えて見られる。クリア・完走・順位は「Xで共有」から投稿できる。

数値・条件の唯一の正はコード（[構成](#構成)の各モジュール）。ここには遊びの意図だけを書く。

## 開発

Node.js 24とpnpm 11を使う。

```sh
pnpm install
cp .dev.vars.example .dev.vars # TYPESAFE_API_KEY を設定（git管理外）
pnpm exec wrangler login
pnpm dev:api                    # Worker + API: http://127.0.0.1:8787
```

別ターミナルで`pnpm dev`（http://127.0.0.1:5173）。Vite+が`/api`を8787へ転送する。API未接続でも固定ルールで遊べる。

```sh
pnpm test        # 純粋ロジック、非同期判断、Workerの入力境界（node --test）
pnpm typecheck   # 全ソースのTypeScript検査
pnpm check       # Vite+ format / lint
pnpm build       # 本番アセットと検出済み依存ライセンス → dist/
pnpm fonts       # UI文言変更時にフォントを再生成
pnpm exec wrangler deploy --dry-run
```

`pnpm test`は`.test.ts`を直接実行する。3D描画と入力の変更時はブラウザで、初回の一皿、90秒終了、ノルマ判定、仕入れ、採用、保存再開、停止／再開、狭い画面を確認する。`prefers-reduced-motion`では装飾アニメーションを抑える。

## 構成

| ファイル                                                             | 責務                                              |
| -------------------------------------------------------------------- | ------------------------------------------------- |
| `src/types.ts`                                                       | 共有するドメイン型（GameState・Checkpoint等）     |
| `src/model.ts`                                                       | DOM・通信に依存しない調理、営業、在庫、得点、候補 |
| `src/progression.ts`                                                 | Lv1〜100の解放条件、難易度曲線、同時出勤上限      |
| `src/equipment.ts`                                                   | 設備価格・効果・設置上限・投資の検証              |
| `src/training.ts`                                                    | 育成薬の価格・効果・段階上限・対象の検証          |
| `src/staff.ts`                                                       | 相棒候補の能力と役割                              |
| `src/game.ts`                                                        | Zustand状態、入力、移動、営業、採用、AI判断、音   |
| `src/engine.ts`                                                      | 本編とリプレイで共有する決定論的な1フレーム処理   |
| `src/applicants.ts` / `src/nextShift.ts`                             | 応募者抽選とシフト遷移（seed注入可能な純粋計算）  |
| `src/replay.ts`                                                      | ベンチ決定列のキャンペーン再実行と検証済みスコア  |
| `src/Kitchen.tsx` / `src/camera.ts`                                  | WebGPU描画、3D厨房、固定角度の追従・全体カメラ    |
| `src/ui.ts` / `src/SceneUI.tsx` / `src/Surface.tsx` / `src/Food.tsx` | HUD・設定・結果の記述とThree描画、商品モデル      |
| `src/Bench.tsx` / `src/benchmark.ts`                                 | jev-benchの試行ループと画面                       |
| `src/worker.ts` / `src/session.ts`                                   | 課金APIの入口、入力検証、Jev・比較用LLMへの転送   |
| `src/api-client.ts` / `src/run-store.ts` / `src/game-store.ts`       | ticket付き呼び出しと検証済みrunの保存             |

ブラウザのゲーム状態が唯一の正。コードが合法な行動を列挙し、Jevはその中から次の一手だけを選ぶ。移動先に到着した時点で再検証する。通信失敗時は10秒間固定ルールで補う。秘密はWorker側にのみ保持する。

課金ルートは`POST /api/session`が発行するrun ticketを必須とする。`TICKET_SECRET`未設定なら503で閉じる。IPレート制限は`wrangler.jsonc`で設定する。境界とランキング基盤は[公開API仕様](docs/public-api.md)を正とする。`TYPESAFE_API_KEY`があればTypeSafe直API、なければWorkers AIを使う。

## 配信と復旧

Cloudflare Workers Buildsが`HikaruEgashira/jev-kitchen`のmainへのpushを検知し、`pnpm deploy`でアセットとWorkerを同時に配信する。ビルドは`pnpm test && pnpm typecheck && pnpm check`。詳細は[リリース手順](docs/RELEASE.md)。

```sh
pnpm exec wrangler deployments list        # 配信前versionを記録
pnpm deploy
pnpm exec wrangler rollback <version-id>   # 復旧時のみ
```

`TICKET_SECRET`未設定のまま配信すると課金ルートが503になり、AIは固定ルールへ落ちる。事故時は`wrangler secret delete TICKET_SECRET`で課金ルートを閉じられる。公開先は`https://jev-kitchen.egahika.dev`。

## 受入境界と制約

- 一般公開。Accessは使わない。課金ルートはrun ticketとIPレート制限で保護し、入力の型・サイズ・候補数を検証してから有料モデルを呼ぶ。
- ランキングは人間とAIで別ボード。AIはベンチのフルキャンペーンを、run終了時にサーバが同じseedと決定列から再実行して確定する。人間は通常プレイのステージ開店スナップショットをサーバが再検証して到達Lvを確定し、スコアはクライアント申告値を載せる。設計は[公開API仕様](docs/public-api.md)。
- ゲーム状態は端末内のみで、同期対戦とクラウドセーブは扱わない。run ticketはステートレスで有効期限内の再利用を防がない。
- `/bench`の「モデルを追加」で入力したBase URL・APIキーはページ内だけに保持し、Workerを経由せずブラウザから直接呼び出す（HTTPSのみ・常時有効）。この経路はrun ticket・レート制限・順位検証の対象外で、上流がCORSを許可しない場合は呼び出せない。
- リプレイは固定60Hzで再実行するため、表示スコアと検証スコアは一致しない（順位は検証スコア）。人間入力の記録は対象外。
- AIリクエストのabort／timeoutは待ち時間と古い応答の破棄を制御するだけで、上流処理や課金の停止を保証しない。依存物と外部サービスは[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)に記録する。
- リリース判定はtest / typecheck / check / buildと、ブラウザでの描画・初回の一皿・ノルマ・星・仕入れ・採用・リトライ・停止／再開・狭い画面の確認を満たすこと。
