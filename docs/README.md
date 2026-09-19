# ドキュメント索引

## 置き場所と唯一の正

| 文書                                                  | 役割               | 唯一の正とする内容                       |
| ----------------------------------------------------- | ------------------ | ---------------------------------------- |
| [`README.md`](../README.md)                           | 入口               | 遊びの意図・開発手順・構成               |
| [`docs/jev-bench.md`](jev-bench.md)                   | jev-bench接続仕様  | benchの実行条件・入出力・画面構成        |
| [`docs/public-api.md`](public-api.md)                 | 公開API仕様        | 認証境界・エラー・ランキング基盤の設計   |
| [`docs/decisions.md`](decisions.md)                   | 設計判断           | 決定時点の理由と境界（現行仕様と非同期） |
| [`docs/RELEASE.md`](RELEASE.md)                       | リリースと復旧     | 現行version・配信前チェック・rollback    |
| [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) | 依存と外部サービス | ライセンス本文の補足                     |
| `src/*.ts` / `src/*.tsx`                              | 実装               | 数値・条件・列挙・見た目                 |

## ルール

- 同じ事実を2つの文書へ書かない。詳細は所有する文書へリンクする。
- 数値・条件の唯一の正はコード。仕様書は構造と意図だけを書く。
- `docs/decisions.md`は決定時点のスナップショット。現行仕様と同期しない。
- `docs/RELEASE.md`は現行状態だけを書く。過去の配信履歴はgitに閉じ込める。
- 生成物（`dist/licenses.md`、`public/licenses.html`、`public/third-party-notices.html`、`public/fonts/kitchen.font.glb`）を手で編集しない。
