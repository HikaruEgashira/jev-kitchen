# SIDEKICK kitchen

AIの相棒と90秒のランチ営業。トマトサラダとスープを作り、注文期限とコンボを意識して三つ星を目指す3D協力ゲーム。

React Three Fiber・Drei・Zustand（pmndrs）、Three.js の WebGPURenderer、Vite+ を使用。
WebGPU を優先し、非対応環境は WebGL 2 にフォールバックする。実際の描画方式は「相棒の判断ログ」に表示する。

## 遊び方

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
pnpm build                   # 本番アセット → dist/
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

Worker名は `jev-kitchen`。`pnpm deploy` はVite+でビルドしてから、アセットとWorkerを同時に配信する。
デプロイ前に上記の品質検証を行い、配信後は認証済みブラウザでゲームと実APIを確認する。

```sh
pnpm exec wrangler deployments list  # 配信前のversionを記録
pnpm deploy
pnpm exec wrangler rollback <version-id> # 復旧時のみ
```

公開先は `https://jev-kitchen.egahika.dev`。custom domainとCloudflare Accessは `egahika.dev` リポジトリのTerraformが管理する。
`workers_dev` は無効。Accessのアカウントメンバー制限を維持する。未認証アクセスはAccessへリダイレクトされる。
WorkerではAPI入力の型・サイズ・候補数を検証してから有料モデルを呼ぶ。

## 残る制約

- ゲーム状態は端末内のみ。同期対戦とクラウドセーブは扱わない。
- Worker自身のAccess JWT検証とレート制限は未実装。Accessを無効化して公開しない。
- Workers AI経路はクレジット未設定の環境では動作しない。API障害時も固定ルールで継続する。
