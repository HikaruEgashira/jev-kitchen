# jev-bench

`/bench`は、Jev Choice互換のdecision endpointを持つモデルをプレイヤーとして実行する。
評価対象は状態から次の調理行動を選ぶ能力であり、画面認識やマウス操作の能力ではない。
全モデルが同じ合法候補・移動速度・調理処理を使い、固定ルールのハルと協力する。

## 実行条件と結果

- 各試行をLv1・120コイン・チュートリアルなしで開始する。1営業90秒、未達で試行終了。
- 相棒は`helper`／固定ルール。採用とプレイヤーのダッシュは無効。営業間に次のノルマ＋2個までトマトを購入する。
- モデルには`controlled_actor: human`の観測状態と合法候補を送る。唯一の候補が待機ならAPIを呼ばず待機する。
- モデル待機中も時計は進む。応答と到着の両時点で合法性を再検証し、無効になった行動は実行しない。
- 既定は1試行・目標Lv100・1,000判断まで。最大5試行、1試行10,000判断まで設定できる。
- 成績は`completed`（目標達成）、`failed`（営業ノルマ未達）、`budget`（判断上限）、`error`、`stopped`を区別する。
- JSONにはソースrevision、条件、各営業の結果、各判断の行動・適用有無・往復時間、平均／p95、到達レベル、クリア数を記録する。
- 営業の皿数・得点はチーム合計。`playerServed`と`partnerServed`に配膳者別の皿数を記録する。仕込みなどの貢献を配膳数だけで評価するものではない。
- 応答時間はブラウザからWorkerを経由した往復時間。失敗したリクエストも平均／p95に含む。`staleResponses`は応答受領時の破棄数であり、移動中の候補失効は含まない。
- 同じrevision・モデルバージョン・目標レベル・判断上限・端末条件で比較する。描画速度と実ネットワークの影響を受け、厳密な決定論的リプレイは提供しない。

通常の保存データは更新しない。結果はタブ内に保持し、JSONをダウンロードして保存する。
クライアントが生成する成績なので、第三者が改ざんできないランキングには使用できない。

## モデル接続

Jevは`TYPESAFE_API_KEY`／`TYPESAFE_MODEL`（または既存Workers AI binding）を使う。
他モデルはWorker secret `BENCH_ENDPOINTS`にJSONオブジェクトで登録する。ブラウザは登録済みIDのみ選べる。

```json
{
  "candidate": {
    "name": "Candidate model",
    "url": "https://model.example/v1/decision",
    "model": "candidate-v1",
    "token": "SERVER_SIDE_TOKEN"
  }
}
```

`name`・`model`・`token`は省略できる。URLはHTTPSのみ、リダイレクトは追跡しない。
`token`は`Authorization: Bearer`で送信する。URL・トークンはモデル一覧や結果へ含めない。
値の設定は`pnpm exec wrangler secret put BENCH_ENDPOINTS`を使用する。
ローカルではgit管理外の`.dev.vars`へ同名のJSON文字列を設定する。

`POST /api/bench/decide`が受け取る`modelId`を接続先に解決し、以下の形式で転送する。
モデル入力の`model`は、登録時に指定した場合だけ付与する。

```json
{
  "model": "candidate-v1",
  "state": {
    "controlled_actor": "human",
    "human": { "carrying": null, "at_station": null },
    "ai": { "carrying": "tomato" },
    "board": "chopping",
    "orders": [{ "recipe": "dish", "seconds_left": 30 }]
  },
  "questions": {
    "next_action": {
      "type": "choice",
      "instructions": "Choose one feasible action for the HUMAN player...",
      "criteria": {
        "fetch_plate": "お皿を用意する",
        "wait": "今は動かず、様子を見る"
      }
    }
  }
}
```

`state`は説明用に省略している。実際にはレベル・在庫・注文期限・両者の位置・相棒の意図なども含む。
接続先は候補内のIDを次のJSONで返す。

```json
{
  "answers": {
    "next_action": { "type": "choice", "choice": "fetch_plate", "confidence": 0.9 }
  }
}
```

`confidence`は省略可能。HTTPエラー、不正JSON、候補外IDは試行エラーとなり、代替判断は行わない。
Workerは既存の入力64KiB／応答128KiB制限、上流8秒timeoutを共有する。
ブラウザ側の待機上限は10秒。中断・timeoutは上流処理や課金の停止を保証しない。
Cloudflare Accessの既存保護を維持する。
