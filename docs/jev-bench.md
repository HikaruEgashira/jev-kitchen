# jev-bench

`/bench`は、Jev Choice互換のdecision endpointを持つモデルをプレイヤーとして実行する。
評価対象は状態から次の調理行動を選ぶ能力であり、画面認識やマウス操作の能力ではない。
全モデルが通常プレイと同じ移動速度・調理・採用・仕入れ処理を使う。画面は左にSIDEKICK本体と同一のKitchen・SceneUI、右に今回のクリア時の所持金・スコア、下に判断ログを置く。SIDEKICKの配色・文字・操作部品を使い、1画面に収める。過去試行の表は表示しない。

## 実行条件と結果

- 各試行をLv1・初期120コインからハルの給与12を支払った108コイン・チュートリアルなしで開始する。1営業90秒、未達で試行終了。
- 初期の相棒は`helper`。相棒の判断方式は固定ルールで、採用と次の相棒の配置はモデルが選ぶ。応募者3人は通常プレイと同じ抽選。
- 営業間は`hire_*`／`skip_hiring`、`assign_*`、`stock_0`〜`stock_99`で準備内容を編集し、`open_shift`で確定する。初期の仕入れ予定数は人間の画面と同じ次ノルマ＋2個。所持金と必要在庫の検証も通常プレイと共通。
- モデルには`controlled_actor: human`の観測状態と候補を送る。調理候補は注文や相棒の手元を理由に除外しない。
- 全調理・仕上げ・返却・廃棄に加え、作業台への移動、画面基準の8方向への0.25秒移動、E相当の作業、ダッシュ、ダッシュしながらの移動・調理を選べる。`continue`は現在の移動を維持し、`wait`は停止する。新しい行動で移動を変更できる。
- 観測には現在の移動、ダッシュ再使用までの時間、調理の進捗・仕上げ使用有無を含む。準備中は応募者・採用済みスタッフの能力、採用・配置・仕入れの予定と支払い額を含む。
- 画面に表示している文字は`screen`として同じ内容を送る。レベル・皿数・残り時間・注文・在庫・位置・作業ヒント・通知・準備シートの表示と、その有効・選択状態を含み、画面追加時にモデル文脈が漏れないよう`screen`から機械的に射影する。
- モデル待機中も時計は進む。応答と到着の両時点で合法性を再検証し、無効になった行動は実行しない。
- 設定はfrequency（秒あたりのcall上限、既定5、0.1〜10）と最大call数（既定1,000、1〜10,000）。1回の開始で1試行する。目標レベルは設けず、ノルマ未達・call上限・全100レベルクリアまで進む。
- 呼び出しの開始間隔は`1 / frequency`秒以上。移動中も判断できるが、応答待ちでは次を呼び出さず、並列化や遅れたcallのまとめ打ちは行わない。実際の頻度は指定値より低くなる場合がある。最後のcallで選んだ行動を終えてから停止する。
- 成績は`completed`（全100レベルクリア）、`failed`（営業ノルマ未達）、`budget`（判断上限）、`error`、`stopped`を区別する。
- JSONにはソースrevision、条件、各営業の結果、各判断の行動・適用有無・往復時間、平均／p95、到達レベル、クリア数を記録する。
- 営業の皿数・得点はチーム合計。`playerServed`と`partnerServed`に配膳者別の皿数を記録する。仕込みなどの貢献を配膳数だけで評価するものではない。
- 応答時間はブラウザからWorkerを経由した往復時間。失敗したリクエストも平均／p95に含む。`staleResponses`は応答受領時の破棄数であり、移動中の候補失効は含まない。
- 同じrevision・モデルバージョン・frequency・最大call数・端末条件で比較する。応募者の抽選も結果に影響する。描画速度と実ネットワークの影響を受け、厳密な決定論的リプレイは提供しない。

通常の保存データは更新しない。中断・タブ非表示・ゲーム側の一時停止ではゲーム状態とcall数を保持し、再開できる。停止中の新規callはなく、停止をまたいだ応答は破棄する。画面タイマーと`activeMs`は停止時間を除外し、`wallMs`は含む。未達後のリトライは新しい試行として扱う。結果はタブ内に保持し、現在の試行のJSONをダウンロードして保存する。
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
    "orders": [{ "recipe": "dish", "seconds_left": 30 }],
    "screen": {
      "status": "切ったトマトを持ってこよう",
      "items": [
        { "id": "order-0", "text": "トマトスープ\nあと 30 秒" },
        { "id": "interact", "text": "E  切ったトマトを持ってこよう", "disabled": true }
      ]
    }
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

`state`は説明用に省略している。実際にはレベル・在庫・注文期限・両者の位置・相棒の意図なども含む。`screen`は画面に表示している文字の写しで、`items`は各表示物のID・文言・（あれば）読み上げラベル・料理・無効／選択状態を持つ。`modal`・`title`・`status`は表示中のシートと通知文を示す。
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
