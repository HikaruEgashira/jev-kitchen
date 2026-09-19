# jev-bench

`/bench`（`jev-bench-v2`）は、Jev Choice互換のdecision endpointを持つモデルをプレイヤーとして実行する。
評価対象は状態から次の調理行動を選ぶ能力であり、画面認識やマウス操作の能力ではない。
全モデルが通常プレイと同じ移動速度・調理・採用・仕入れ処理を使う。画面は左上にSIDEKICK本体と同一のKitchen・SceneUI、右上に判断履歴、左下に今回クリアしたレベル・所持金・スコアと状態、右下に実行条件・開始操作を置く。SIDEKICKの配色・文字・操作部品を使い、1画面に収める。過去試行の表は表示しない。

## 実行条件と結果

- 各試行はLv1・180コインから開始する。Lv1は時間無制限・相棒なしで一皿を作ればクリアし、操作ガイドによる行動制限はない。Lv2以降は1営業90秒、未達で試行終了。
- Lv2・3の相棒は`veteran`に固定する。Lv3でスープを解放し、店長は終了後に退職する。Lv4は`helper`を初期選択とし、以後の候補抽選で店長が登場する確率は各1%。給与・再採用費・配置は通常プレイと共通。相棒の判断方式は固定ルールで、Lv3クリア後から応募者を抽選する。
- 営業間は`hire_*`／`skip_hiring`、`assign_*`／`rest_*`／`replace_*`、`stock_0`〜`stock_99`、`equipment_<add|upgrade>_<設備>`、`vitamin_<能力>_<対象>`／`vitamin_undo`で準備内容を編集し、`open_shift`で確定する。人間の準備シートが出す操作は`PREPARATION_ACTIONS`で分類し、対応する候補か省略理由のどちらかを必ず持つ（`test/bench-parity.test.mjs`が新しい操作の分類漏れを検出する）。配置（`layout-*`）だけはモデルに選ばせず、確定時に`purchase`が返す自動レイアウトを使う。初期の仕入れ予定数は人間と共通の`recommendedStock`を使い、次ノルマ＋6／前営業の販売数＋4を目安に、繰越と給与後の予算を反映する。所持金と必要在庫の検証も通常プレイと共通。
- モデルには`controlled_actor: human`の観測状態と候補を送る。調理候補は注文や相棒の手元を理由に除外しない。
- 全調理・仕上げ・返却・廃棄に加え、本編と同じ到着時の作業を伴う作業台タップ（`visit_*`）、画面基準の8方向への0.25秒移動、E相当の作業・手持ちを近くの相棒へ渡す操作、ダッシュ、ダッシュしながらの移動・調理を選べる。`continue`は現在の移動を維持し、`wait`は停止する。新しい行動で移動を変更できる。判断は調理と自由移動の2ページに分け、`navigate`で作業台タップ・8方向移動を選び、`back_to_work`で調理へ戻る。全操作への到達性をテストで検証する。NPCからプレイヤーへの手渡し・取り戻しはできない。
- 観測には現在の移動、ダッシュ再使用までの時間、調理の進捗・仕上げ使用有無を含む。準備中は応募者・採用済みスタッフの能力、採用・配置・仕入れの予定と支払い額を含む。
- 画面に表示している文字は`screen`として同じ内容を送る。レベル・皿数・残り時間・注文・在庫・位置・作業ヒント・通知・準備シートの表示と、その有効・選択状態を含み、画面追加時にモデル文脈が漏れないよう`screen`から機械的に射影する。画面の操作項目のうち、その時点の候補に無いものは文言だけを残して選択idを渡さない（人間専用の応募者送りなど、候補外のidを回答できないようにする）。
- モデル待機中も時計は進む。応答と到着の両時点で合法性を再検証し、無効になった行動は実行しない。
- 設定はfrequency（秒あたりのcall上限、既定5、0.1〜10）と最大call数（既定5,000、1〜10,000）。1回の開始で1試行する。目標レベルは設けず、ノルマ未達・call上限・全100レベルクリアまで進む。
- 呼び出しの開始間隔は`1 / frequency`秒以上。選んだ移動・作業が完了または失効するまで次の判断を待ち、応答待ちでも次を呼び出さず、並列化や遅れたcallのまとめ打ちは行わない。実際の頻度は指定値より低くなる場合がある。最後のcallで選んだ行動を終えてから停止する。
- 成績は`completed`（全100レベルクリア）、`failed`（営業ノルマ未達）、`budget`（判断上限）、`error`、`stopped`を区別する。
- JSONにはソースrevision、条件、各営業の結果、各判断の行動・適用有無・往復時間、平均／p95、到達レベル、クリア数を記録する。
- 在庫と調理中・手元の食材がすべて尽きた場合は時計だけ進め、皿の出し戻しのための無益なAPI呼び出しを止める。
- 営業の皿数・得点はチーム合計。`playerServed`と`partnerServed`にプレイヤー／全出勤者の配膳数を記録する。出勤者・採用済みスタッフ・残在庫・最終配膳時刻・設備・育成も営業ごとに記録する。仕込みなどの貢献を配膳数だけで評価するものではない。
- 応答時間はブラウザからWorkerを経由した往復時間。失敗したリクエストも平均／p95に含む。`staleResponses`は応答受領時の破棄数であり、移動中の候補失効は含まない。
- 同じrevision・モデルバージョン・frequency・最大call数・端末条件で比較する。応募者の抽選も結果に影響する。描画速度と実ネットワークの影響を受け、厳密な決定論的リプレイは提供しない。

通常の保存データは更新しない。中断・ゲーム側の一時停止（「バックグラウンドモード」によるタブ非表示を含む）ではゲーム状態とcall数を保持し、再開できる。停止中の新規callはなく、停止をまたいだ応答は破棄する。画面タイマーと`activeMs`は停止時間を除外し、`wallMs`は含む。未達後のリトライは新しい試行として扱う。結果はタブ内に保持し、現在の試行のJSONをダウンロードして保存する。
クライアントが生成する成績なので、第三者が改ざんできないランキングには使用できない。

## 調整と再測定

準備は採用→勤務→仕入れ→投資の順に、一つのChoiceで一つの判断を求める。勤務は合法な出勤者の組合せを`crew_*`から一括選択し、仕入れは`stock_*`／`confirm_stock`で確定して次の準備判断へ進む。支払いは`open_shift`で一括確定する。採用は出勤を意味しない。営業中は手元と盛り付け待ちの食材に応じた短い目的を提示し、注文のない完成品をQで片づける判断を促す。相棒との受け渡しは手元・距離・相手を応答時に再検証する。共通の準備候補には`assign_*`（追加）、`rest_*`（1人解除）、`replace_*`（1人交代）も残すが、試行中は勤務表全体を一度に選ぶことで交代の往復を避ける。休養予定・次の出勤枠・料理の利益・投資費用をモデルへ渡す。投資段階は給与と仕入れを確保した残額で選択する。

`pnpm dev:api`を起動後、`node scripts/bench.mjs --until 30 --output /tmp/jev-bench.json`で描画なしの実時間試行を実行できる。既存の`runBenchmark`と60Hzの`tick`を使い、通信待ちも90秒に含む。`BENCH_ORIGIN`でローカルAPIの接続先を指定できる。Lv30クリア後は`stopped`として記録し、成功判定は`clearedLevels >= 30`とする。ブラウザ描画性能の検証とは分ける。`--accelerated`は調整用に移動・待機中の実時間だけを省き、モデル応答待ちは実時間で進める。同じ`runBenchmark`・60Hzのゲーム処理を通すが、実時間試行とは別条件としてJSONの`runtime`に記録する。

TypeSafeの[公式ガイド](https://docs.typesafe.ai/introduction)に沿って判断を分割した。長い指示だけでは投資の省略が残ったため、操作可能な範囲を段階ごとに示す。v1とv2の成績は直接比較せず、同一protocol・revisionで比較する。

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
