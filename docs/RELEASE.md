# リリースと復旧

現行の本番状態と手順だけを記録する。過去の配信履歴はgitの履歴に残し、この文書には積まない。
文書の置き場所は[ドキュメント索引](README.md)を参照する。

## 現行リリース

| 項目             | 値                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------- |
| ブランチ         | `main`（pushで自動配信）                                                                      |
| 本番100% version | `96e51a16-9ec4-4073-908a-7e991b6c5277`                                                        |
| 配信日           | 2026-09-20                                                                                    |
| 主な内容         | 主要ボタンの拡大、横向きダイアログの下部操作バー、Eの作業台優先、厨房の6%下降と俯瞰の中央補正 |
| 公開URL          | <https://jev-kitchen.egahika.dev>                                                             |

配信はCloudflare Workers Buildsが`HikaruEgashira/jev-kitchen`のmain pushを検知し、`pnpm deploy`を実行する。
非本番ブランチのビルドは無効。GitHub SecretsにCloudflare資格情報は置かない。

## 配信前チェック

1. `pnpm test && pnpm typecheck && pnpm check && pnpm build`
2. `pnpm exec wrangler deploy --dry-run`
3. `TICKET_SECRET`（16文字以上）が設定済みであること。未設定なら課金ルートは503で閉じ、AIは固定ルールへ落ちる。
4. `wrangler.jsonc`の`ratelimits`と`durable_objects`（`RUNS` / `GameStore`、migration `v1`）が反映されていること。
5. AI Gateway / TypeSafeのspend limitを口座側で設定する。
6. 配信後、`GET /api/health`の`configured.sessions`と`configured.rateLimit`が両方trueであること。

## 復旧

```sh
pnpm exec wrangler deployments list        # 配信前versionを記録
pnpm deploy
pnpm exec wrangler rollback <version-id>   # 復旧時のみ
```

- 直前一連の変更の直前version: `af9ee6d5-1fc1-49c7-b4de-60d2cf70f158`
- 厨房の下降だけ戻す: `pnpm exec wrangler rollback 696e2038-9195-46bd-9464-308b6bc3f5ef`
- UIだけ戻す: `src/ui.ts`を`git revert`する。
- 課金事故を止める: `pnpm exec wrangler secret delete TICKET_SECRET`で課金ルートを閉じる。

Accessを外した後は、ticket保護の無い旧versionへrollbackすると課金ルートが無防備になる。旧versionへ戻す場合はAccessを戻すか`TICKET_SECRET`を削除する。

## 未実施・制約

- 実ブラウザでの目視とタップ導線は、各変更の配信時に個別に確認する（自動テストの代用にしない）。
- run単位のcall予算とTurnstileは未実装。IPレート制限と口座側のspend limitで費用を縛る。
- 表示スコアと検証スコアは一致しない（順位は検証スコア）。詳細は[公開API仕様](public-api.md)。
