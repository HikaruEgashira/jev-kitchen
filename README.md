# SIDEKICK kitchen

AIの相棒とノルマ達成を目指す3D協力キッチン。配膳・仕入れ・採用で厨房を広げる戦略&アクションゲームです

https://jev-kitchen.egahika.dev

![og](https://jev-kitchen.egahika.dev/og.png)

## 遊び方

- Lv1はチュートリアル。サラダを一皿配膳しよう。
- Lv2以降は制限時間90秒。勤務表で相棒を選びノルマを達成しよう。
- 工程は トマト→まな板で切る→（皿／鍋／グリル）→盛り付け→配膳。Lv3でスープ、Lv6で手動ブーストと焦げ、Lv7でグリル、Lv8で2人稼働、Lv9で連勤と休養、Lv10でラッシュが解放されるよ。
- クリア後は応募者の採用ができる。同時出勤はLv8で2人、Lv12で3人、Lv16で4人。採用費とは別に給与を毎営業支払う。
- 開店準備でトマトの仕入れ、設備（まな板・鍋・グリル・保温台）の増設・改良・配置と、育成薬投与をして組織を強化しよう。
- 失敗時は同条件の再挑戦・開店準備の見直し・前ステージへの巻戻しを選べるよ。
- 操作はWASD／矢印で移動、Eで作業、Shiftでダッシュ、Qで片づけ。スマホは作業台の3Dボタンで操作。
- メニューの「ランキング」で自分の到達LvとAIの順位を切り替えて見られる。「Xで共有」でみんなと競争しよう。

## 開発

```sh
pnpm install
pnpm dev        # 本編: http://127.0.0.1:5173
pnpm test       # 純粋ロジック・非同期判断・Workerの入力境界
pnpm typecheck && pnpm check && pnpm build
pnpm deploy     # 本番配信（main pushでCloudflare Workers Buildsが自動配信もする）
```

`cp .dev.vars.example .dev.vars` で `TYPESAFE_API_KEY` を設定し `pnpm dev:api` を立てると、Vite+が`/api`を8787へ転送して課金ルートも動く。

依存物と外部サービスのライセンスは [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
