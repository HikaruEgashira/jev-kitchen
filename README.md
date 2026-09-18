# SIDEKICK kitchen

人間とAIが同じ厨房で注文をさばく、小さな協力ゲーム。AI（相棒）は指示を待たず、
人間が触っていない作業を見つけて引き継ぐ。プレイ中に方針を変えると、同じ盤面でも選ぶ行動が変わる。

Cloudflare Workers（静的アセット + API）と、Jev（TypeSafe の System One モデル）で動く。

## 責務の分担

- **この repo**: ソースコードと wrangler。Worker のデプロイは main push（`.github/workflows/deploy.yml`）。
- **egahika.dev repo**: Cloudflare リソース（custom domain `jev-kitchen.egahika.dev` と Cloudflare Access）。
  Worker 本体はここにコピーせず、Worker 名で参照する（`email_routing_rule` の `agentic-inbox` と同じ結合）。
- `workers_dev` は無効。公開経路は Access で保護された custom domain のみ。

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

## Jev への接続は2経路

| 経路 | 条件 | 課金 | 実測 |
| --- | --- | --- | --- |
| TypeSafe 直API | `TYPESAFE_API_KEY` を設定 | TypeSafe の利用枠 | 日本から 温 約430ms / 初回TLS 約1.2s |
| Workers AI バインディング | キー未設定 | AI Gateway のクレジットが必要 | 未計測 |

Workers AI は第三者が提供するモデルを AI Gateway の課金に載せるため、クレジット未購入だと
`2021: Insufficient AI Gateway credits` で失敗する。そこで**直APIを既定**にし、キーを外せば
Workers AI に切り替わるようにしてある。どちらで応答したかは `/api/health` と HUD の `via` に出る。

## ファイル

| path | 役割 |
| --- | --- |
| `public/index.html` | 画面・HUD |
| `public/game.js` | 描画・入力・意思決定ループ |
| `public/model.js` | 純粋なゲームロジック（DOM/通信なし。node から import して検証できる） |
| `src/worker.ts` | `/api/decide`（Jev）/ `/api/decide-llm`（比較用LLM）/ `/api/health` |
| `test/` | model.js と worker.ts の自己チェック |

## ローカル実行

```sh
pnpm install

cp .dev.vars.example .dev.vars   # TYPESAFE_API_KEY を入れる（.dev.vars は git 管理外）
pnpm test
pnpm typecheck

pnpm exec wrangler login         # AI バインディングを宣言しているため dev でも認証が要る
pnpm dev                         # http://127.0.0.1:8787
curl http://127.0.0.1:8787/api/health   # 会場での応答時間をここで測る（via も出る）
```

操作: WASD で移動、E で作業。右パネルの「協働方針」に自由記述（例:「最後の盛り付けは自分でやりたい」）。
エンジンは `Jev / 固定ルール / 低遅延LLM` を切り替えて比較できる。

## デプロイ

```sh
pnpm exec wrangler secret put TYPESAFE_API_KEY   # 初回のみ
pnpm deploy                                       # または main push
```

- main push で `.github/workflows/deploy.yml` が `wrangler deploy` する。
- 必要な Secrets: `CLOUDFLARE_API_TOKEN`（Workers Scripts: Edit）/ `CLOUDFLARE_ACCOUNT_ID`
- ホスト名の付与と Cloudflare Access は **egahika.dev repo の Terraform** で行う。
  初回は「egahika.dev を apply → この repo を deploy」の順（custom domain は Worker を要求する）。

## セキュリティ

- `workers_dev` を無効化しているため、公開されるのは `jev-kitchen.egahika.dev` のみ。
  そこは Cloudflare Access で `access_owner_email` だけが許可される（egahika.dev repo 側で定義）。
- **`/api/decide` は呼ばれた分だけ TypeSafe の利用枠を消費する。** Access を有効にする前に
  `TYPESAFE_API_KEY` を本番へ入れると、URL を知っている第三者が枠を燃やせる。
- アプリ層: `state` の型/長さ、`questions` の形（型・1..8問・choice 2..255・score 2..10）を検証して
  からモデルを呼ぶ（課金前に弾く）。出力は候補IDに照合し、実行直前に `isFeasible()` で再検証するので、
  プロンプト注入で自由な行動をさせられない。サーバに状態を持たない。
- 未対応: Worker 側で Access JWT を検証していない（エッジで弾かれるため必須ではない）。レート制限は未設定。

## デモ台本

1. 説明を聞かずにトマトを切り始める → 相棒が皿を用意する。
2. 途中で鍋（別の作業）へ移る → 相棒が残った下準備を引き継ぐ。
3. 自分が運ぼうとした皿には手を出さない。
4. 「最後の盛り付けは自分でやりたい」と入力 → 盛り付けを残したまま材料と皿を揃える。
5. 「今は注文を最優先。私のやりかけも引き継いでいい」→ 同じ盤面で選ぶ行動が変わる。
6. 操作を止める → 補佐役から、自分で進める役に切り替わる。

HUD には「相棒の行動」「判断に使った状態の時刻」「鮮度（観測からの経過）」「応答時間（via付き）」「確信度」「破棄した古い判断」を出す。

## 検証済み / 未検証

検証済み:

- `pnpm test` 12件 / `pnpm typecheck` / `wrangler deploy --dry-run`
- TypeSafe 直API の実呼び出し（日本から 温 0.43s / 初回 1.2s。`model` フィールド必須）

未検証:

- Workers AI バインディング経路（AI Gateway クレジット未購入のため 2021 エラー。課金すれば切り替わる）
- 実 Jev を回したときのゲームの手触り（決定ループの体感、破棄が起きる頻度）
- 日本語の方針入力の解釈精度（Jev は英語最適化）
- 比較用LLMの既定モデル `@cf/meta/llama-3.1-8b-instruct` は会場で差し替え可

## 技術負債メモ

- `.env` / `.env.keys` は dotenvx で暗号化されているが、`.env` は git 管理外なので暗号化の意味がなく、
  wrangler は復号しないため `encrypted:...` をそのまま渡して壊れていた。`.dev.vars` に一本化済み。
  `.env` / `.env.keys` は削除してよい（dotenvx を使う予定が無ければ）。
- `.github/workflows/deploy.yml` の actions はタグ参照。egahika.dev は SHA 固定なので、安定後に揃える。
- 比較用LLMは `state` を JSON で詰める素朴なプロンプト。Jev と同じ情報を渡す最小構成で、プロンプト最適化はしていない。
