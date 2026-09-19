# SIDEKICK kitchen

AIの相棒とLv100を目指す、3D協力キッチンゲーム。配膳、仕入れ、採用で厨房を広げる。

React Three Fiber・Drei・Glyph・Zustand（pmndrs）、Three.js の WebGPURenderer、Vite+ を使用する。
WebGPUを必須とし、非対応環境では起動案内を表示する。音の切替と描画・AIの診断はメニューにまとめる。
HUD・ダイアログ・仕入れ欄はThreeで描き、文字には看板を敷く。立体タイトルの下に厨房を見せ、プレイ情報は開店後に表示する。スマホでは文字を縮小し、操作領域は44px以上を保つ。

## 遊び方

- 入口は「開店」一つ。初回のサラダ一皿だけWASD／Eを案内し、時計と相棒は待機する。配膳後はスコア・売上・皿数を引き継いで通常営業へ自動移行する。
- 通常営業はLv1〜100、各90秒。ノルマは共通の計算式で6〜14皿へ増え、注文の待ち時間・商品比率も変化する。星は600／1800／3600点の得点評価として維持する。
- クリア後は未採用の応募者から最大3名を提示し、1人を採用するか見送って貯金する。Lv2でスープ鍋、Lv3でグリルと厨房を開放し、所有する従業員から相棒1人を配置する。Lv100クリアで完走。
- 相棒候補はhelperと6名。prep／cook／serve／canDashの特性で役割分担が変わる。候補の説明は能力と役割だけを示す。
- Lv2以降はトマト在庫が有限で、料理1皿に1個使う。余剰在庫は次営業へ繰り越し、営業間の仕入れは1個8コイン。採用と仕入れは初期120コインの同じ財布で扱い、次ノルマ以上の在庫がないと開店できない。
- 失敗時のリトライは同じLvの営業を開始時の財布・在庫から再開し、失敗営業の反復で資金や在庫を増やせない。
- 営業開始時のレベル・財布・在庫・雇用を端末に保存する。再読み込み後の「開店」で同じ営業を最初から再開する。営業途中の進捗と未確定の採用・仕入れは保存しない。
- 作業台のクリック／タップで移動し、キーボードはWASD／矢印で移動、Eで作業、Shiftでダッシュ、Qで手元を片付ける。右上は相棒の閲覧専用リストで、出勤中の1人を示す。方針入力・判断方式・能力の個別変更は設けず、採用と配置・仕入れはクリア後に行う。

従業員の判断間隔も特性の一つで、Jevが次の仕事を選ぶ頻度に反映される。間隔が短いほど状況へ細かく反応できる一方、API呼び出しが増える場合がある。モデル自体の推論精度が上がることを意味しない。

## 開発

Node.js 24 と pnpm 11 を使用する。

```sh
pnpm install
cp .dev.vars.example .dev.vars # TYPESAFE_API_KEY を設定。git管理外
pnpm exec wrangler login
pnpm dev:api                  # Worker + API: http://127.0.0.1:8787
```

別ターミナルで `pnpm dev` を実行し、`http://127.0.0.1:5173` を開く。
Vite+ が `/api` を8787へ転送する。API未接続でも固定ルールで遊べる。

```sh
pnpm test                    # 純粋ロジック、非同期判断、Workerの入力境界
pnpm typecheck               # WorkerのTypeScript検査
pnpm check                   # Vite+ format / lint
pnpm build                   # 本番アセットと検出済み依存ライセンス → dist/
pnpm fonts                   # UI文言変更時に日本語MSDFと立体タイトル用フォントを再生成
pnpm exec wrangler deploy --dry-run
```

3D描画と入力の変更時はブラウザでも、初回の一皿、90秒終了、ノルマ判定、仕入れ、採用、Lv100完走、保存からの再開、停止／再開、狭い画面を確認する。全100レベルの計算式・商品比率・再現性は自動テストで検証する。
`prefers-reduced-motion` では装飾アニメーションを抑える。

## 構成

| ファイル                           | 責務                                              |
| ---------------------------------- | ------------------------------------------------- |
| `src/model.js`                     | DOM・通信に依存しない調理、営業、在庫、得点、候補 |
| `src/staff.js`                     | 相棒候補の能力と役割                              |
| `src/game.js`                      | Zustand状態、入力、移動、営業、採用、AI判断、音   |
| `src/Kitchen.jsx`                  | WebGPU描画、3D厨房・商品・オンボーディング演出    |
| `src/ui.js` / `src/SceneUI.jsx`    | ThreeのHUD・設定・結果・フォームと操作用DOM       |
| `src/Surface.jsx` / `src/Food.jsx` | Glyphの文字、看板、共有商品モデル                 |
| `src/App.jsx` / `src/style.css`    | Canvasの起動、不可視の操作要素、描画障害時の案内  |
| `src/worker.ts`                    | Jev・比較用LLMへのAPIプロキシ、ヘルスチェック     |

ブラウザのゲーム状態が唯一の正。コードが合法な行動を列挙し、Jevはその中から次の一手だけを選ぶ。
移動先に到着した時点で再検証する。リセット・一時停止では通信を中止し、古い回答を破棄する。
通信失敗時は10秒間固定ルールで補い、その旨を表示する。秘密はWorker側にのみ保持する。

`TYPESAFE_API_KEY` があればTypeSafe直API、なければWorkers AIを使う。
後者はAI Gatewayクレジットが必要。`/api/health` と設定内のAIログで実際の経路を確認できる。
比較用LLMの経路と日本語方針の解釈精度は、別途モデルごとに検証する。

## 配信と復旧

Cloudflare Workers Buildsが `HikaruEgashira/jev-kitchen` のmainへのpushを検知し、自動配信する。
非本番ブランチのビルドは無効。既存のGitHub接続とWorkers Builds用トークンを使用し、GitHub SecretsにCloudflare資格情報は置かない。

| Workers Builds設定    | 値                                            |
| --------------------- | --------------------------------------------- |
| 本番ブランチ / ルート | `main` / `/`                                  |
| ビルドコマンド        | `pnpm test && pnpm typecheck && pnpm check`   |
| デプロイコマンド      | `pnpm deploy`                                 |
| Node / pnpm           | `.node-version` の24 / `PNPM_VERSION=11.26.0` |

Worker名は `jev-kitchen`。`pnpm deploy` はVite+でビルドしてから、アセットとWorkerを同時に配信する。
Viteの `build.license` が検出したbundle依存のライセンス本文を `dist/licenses.md` に生成する。fiber内のvendor実装を含む補足通知は [`/third-party-notices.md`](https://jev-kitchen.egahika.dev/third-party-notices.md) に同梱し、両方を配信する。
GitHub Actionsもテスト・型検査・lint・ビルドを実行する。配信後は認証済みブラウザでゲームと実APIを確認する。
手元からの配信は復旧時に使う。

```sh
pnpm exec wrangler deployments list  # 配信前のversionを記録
pnpm deploy
pnpm exec wrangler rollback <version-id> # 復旧時のみ
```

公開先は `https://jev-kitchen.egahika.dev`。custom domainとCloudflare Accessは `egahika.dev` リポジトリのTerraformが管理する。
`workers_dev` は無効。Accessのアカウントメンバー制限を維持する。未認証アクセスはAccessへリダイレクトされる。
WorkerではAPI入力の型・サイズ・候補数を検証してから有料モデルを呼ぶ。

## 受入境界

- 現在の公開範囲はCloudflare Accessの許可メンバーのみ。未認証の一般公開、外部投稿、課金を伴う提供はこのリポジトリの受入対象に含めない。
- リリース判定は自動検査（test / typecheck / check / build）、認証済みブラウザでの描画、初回の一皿、ノルマ・星、仕入れ、採用、リトライ、設定内ログ、停止／再開、狭い画面の確認を満たすこと。
- Jev／Workers AI／Cloudflareの利用料、上流サービスの可用性、契約・プライバシー条件はこのリポジトリから保証しない。比較用LLMはコアゲームの必須条件ではない。
- AIリクエストのabort／timeoutはブラウザの待ち時間と古い応答の破棄を制御するだけで、上流処理の停止や利用料の請求停止を保証しない。
- 相棒の判断に必要なゲーム状態をAIプロバイダーへ送信する。依存物と外部サービスの確認は [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) に記録する。

## 残る制約

- ゲーム状態は端末内のみ。同期対戦とクラウドセーブは扱わない。
- Worker自身のAccess JWT検証とレート制限は未実装。Accessを無効化して公開しない。
- Workers AI経路はクレジット未設定の環境では動作しない。API障害時も固定ルールで継続する。

## 現在の状態

検証・配信の状態は [リリース台帳](docs/RELEASE.md) に記録する。
