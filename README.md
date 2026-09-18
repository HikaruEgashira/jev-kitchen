# SIDEKICK kitchen

人間とAIが同じ厨房で注文をさばく、小さな協力ゲーム。AI（相棒）は指示を待たず、
人間が触っていない作業を見つけて引き継ぐ。プレイ中に方針を変えると、同じ盤面でも選ぶ行動が変わる。

Cloudflare Workers（静的アセット + API）と Workers AI の `typesafe/jev` で動く。

## 仕組み

```
ゲーム内の実状態・人間の直近操作・現在の方針   ← ブラウザが唯一の正（サーバに状態を持たない）
        ↓
コードで実行可能な行動候補を列挙（model.js の buildCandidates）
        ↓
Jev が Choice で次の一手を選ぶ（Worker は薄いプロキシ）
        ↓
実行直前に isFeasible() で再検証 → 古い判断は捨てる
        ↓
実行して再観測（次の一手）
```

- 担当の分離: 移動・調理時間・前提条件・候補列挙はコード（`public/model.js`）。**協働方針に照らした選択だけ**を Jev が持つ。
- 行動と対象はセットで選ばせる（`{id, label, station}` をそのまま Choice の criteria にする）。組み合わせの不整合が起きない。
- 判断は約420msごと。飛行中の観測は積まず、応答が来たら最新状態で再検証して無効なら破棄する（HUDの「破棄した古い判断」）。
- `confidence` は確率分布から出る指標なので確率として扱わない。表示のみ。

## ファイル

| path | 役割 |
| --- | --- |
| `public/index.html` | 画面・HUD |
| `public/game.js` | 描画・入力・意思決定ループ |
| `public/model.js` | 純粋なゲームロジック（DOM/通信なし。node から import して検証できる） |
| `src/worker.ts` | `/api/decide`（Jev）/ `/api/decide-llm`（比較用LLM）/ `/api/health` |
| `terraform/` | `jev-kitchen.egahika.dev` のカスタムドメインだけを管理 |
| `test/` | model.js と worker.ts の自己チェック |

## ローカル実行

```sh
pnpm install
pnpm test
pnpm typecheck

# AI バインディングは remote 実行のため認証が要る
pnpm exec wrangler login        # または .env に CLOUDFLARE_API_TOKEN を置く
pnpm dev                        # http://127.0.0.1:8787
curl http://127.0.0.1:8787/api/health   # 会場でのモデル応答時間をここで測る
```

操作: WASD で移動、E で作業。右パネルの「協働方針」に自由記述（例:「最後の盛り付けは自分でやりたい」）。
エンジンは `Jev / 固定ルール / 低遅延LLM` を切り替えて比較できる。

## デプロイ

Worker 本体は wrangler（main push で `.github/workflows/deploy.yml`）。Terraform はカスタムドメインだけを持つ。

```sh
pnpm deploy                                   # Worker を配布
cd terraform && terraform init && terraform apply   # domain を接続（deploy の後）
```

- state: R2 `terraform-state` / key `jev-kitchen/terraform.tfstate`（egahika.dev と同バケット）
- 初回は **wrangler deploy → terraform apply** の順。custom domain は Worker が無いと作れない。
- 必要な Secrets: `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`

## デモ台本

1. 説明を聞かずにトマトを切り始める → 相棒が皿を用意する。
2. 途中で鍋（別の作業）へ移る → 相棒が残った下準備を引き継ぐ。
3. 自分が運ぼうとした皿には手を出さない。
4. 「最後の盛り付けは自分でやりたい」と入力 → 盛り付けを残したまま材料と皿を揃える。
5. 「今は注文を最優先。私のやりかけも引き継いでいい」→ 同じ盤面で選ぶ行動が変わる。
6. 操作を止める → 補佐役から、自分で進める役に切り替わる。

HUD には「相棒の行動」「判断に使った状態の時刻」「鮮度（観測からの経過）」「応答時間」「確信度」「破棄した古い判断」を出す。

## 検証済み / 未検証

検証済み（`pnpm test` / `pnpm typecheck` / `wrangler deploy --dry-run`）:

- 4工程パイプライン、まな板の排他、stale 判断の破棄、候補列挙、固定ルールの配慮
- Worker の入力検証と Jev への転送（`env.AI` をスタブして実ハンドラを実行）

未検証（Cloudflare 未ログインのため）:

- 実 Jev の応答時間と、日本からの会場相当の遅延（`/api/health` で要測定）
- 日本語の方針入力の解釈精度（Jev は英語最適化）
- `cloudflare_workers_domain` の実 apply、`wrangler login` 後の実 deploy
- 比較用LLMの既定モデル `@cf/meta/llama-3.1-8b-instruct` は会場で差し替え可

## 技術負債メモ

- `.env` / `.env.keys` は旧案（TypeSafe 直API）の名残。今は Workers AI バインディング経由なので不要。削除するか、CLOUDFLARE_* だけにする。
- `.github/workflows/*.yml` の actions はタグ参照。egahika.dev は SHA 固定なので、安定後に揃える。
- 比較用LLMは `state` を JSON で詰める素朴なプロンプト。Jev と同じ情報を渡す最小構成で、プロンプト最適化はしていない。
