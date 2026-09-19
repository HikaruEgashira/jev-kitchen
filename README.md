# SIDEKICK kitchen

AIの相棒と90秒のランチ営業。トマトサラダとスープを作り、注文期限とコンボを意識して三つ星を目指す3D協力ゲーム。

React Three Fiber・Drei・Zustand（pmndrs）、Three.js の WebGPURenderer、Vite+ を使用。
WebGPU を優先し、非対応環境は WebGL 2 にフォールバックする。実際の描画方式は「相棒の判断ログ」に表示する。

## 遊び方

- 初めてなら、時間制限のない「ひと皿、作ってみよう」で光る作業台を順に操作する。練習を飛ばして90秒の本番を始めることもできる。
- 作業台をクリック／タップすると移動して作業する。キーボードは WASD／矢印で移動、Eで作業、Shiftでダッシュ、Qで手元を片付ける。
- サラダ: トマト → まな板 → お皿を持ってまな板 → 配膳。切ったトマトをお皿の台へ運んでも作れる。
- スープ: トマト → まな板 → 切ったトマトを鍋へ → お皿を持って鍋 → 配膳。
- 12秒以内の連続配膳で最大3倍。注文の失効と片付けでコンボがリセットされる。星は300／700／1200点。
- Escで一時停止。タブを離れても自動停止する。営業終了後は再挑戦でき、ベストスコアは端末に保存される。
- 「相棒にひとこと」で協働方針を変更する。Jev／固定ルール／比較用LLMを切り替えられる。固定ルールは方針入力を解釈しない。

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
pnpm exec wrangler deploy --dry-run
```

3D描画と入力の変更時はブラウザでも、WebGPU表示、両レシピの配膳、停止／再開、営業終了／再挑戦、狭い画面の操作を確認する。
`prefers-reduced-motion` では装飾アニメーションを抑える。音はヘッダーで切り替える。

## 構成

| ファイル                        | 責務                                                |
| ------------------------------- | --------------------------------------------------- |
| `src/model.js`                  | DOM・通信に依存しない調理、注文、得点、実行可能候補 |
| `src/game.js`                   | Zustand状態、入力、移動、AI判断、効果音             |
| `src/Kitchen.jsx`               | WebGPU描画、3D厨房・キャラクター・演出              |
| `src/App.jsx` / `src/style.css` | 日本語HUD、操作、結果、レスポンシブ表示             |
| `src/worker.ts`                 | Jev・比較用LLMへのAPIプロキシ、ヘルスチェック       |

ブラウザのゲーム状態が唯一の正。コードが合法な行動を列挙し、Jevはその中から次の一手だけを選ぶ。
移動先に到着した時点で再検証する。リセット・一時停止・方針／エンジンの変更では通信を中止し、古い回答を破棄する。
通信失敗時は10秒間固定ルールで補い、その旨を表示する。秘密はWorker側にのみ保持する。

`TYPESAFE_API_KEY` があればTypeSafe直API、なければWorkers AIを使う。
後者はAI Gatewayクレジットが必要。`/api/health` と判断ログで実際の経路を確認できる。
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

## 本番MVPの受入境界

- 現在の公開範囲はCloudflare Accessの許可メンバーのみ。未認証の一般公開、外部投稿、課金を伴う提供はこのリポジトリの受入対象に含めない。
- リリース判定は自動検査（test / typecheck / check / build）、認証済みブラウザでのWebGPUまたはWebGL 2描画、両レシピの配膳、停止／再開、営業終了／再挑戦、狭い画面の確認を満たすこと。独立したβテスター、複数実機、支援技術での検証は未実施であり、完了扱いにしない。
- Jev／Workers AI／Cloudflareの利用料、上流サービスの可用性、契約・プライバシー条件はこのリポジトリから保証しない。比較用LLMはコアゲームの必須条件ではない。
- AIリクエストのabort／timeoutはブラウザの待ち時間と古い応答の破棄を制御するだけで、上流処理の停止や利用料の請求停止を保証しない。
- 自由入力の協働方針は設定されたAIプロバイダーへ送信される。個人情報・秘密情報を入力しない。依存物と外部サービスの確認は [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) に記録する。

## 残る制約

- ゲーム状態は端末内のみ。同期対戦とクラウドセーブは扱わない。
- Worker自身のAccess JWT検証とレート制限は未実装。Accessを無効化して公開しない。
- Workers AI経路はクレジット未設定の環境では動作しない。API障害時も固定ルールで継続する。
