# SIDEKICK kitchen 本番リリース台帳

## 2026-09-19 jev-bench

- `/bench`にJev Choice互換モデルの挑戦画面を追加。左に厨房、右にタイマーと状態・設定、下に判断ログのRTA配置。
- 設定はfrequency（秒あたりのcall上限）と最大call数（既定1,000）。目標レベルや試行数を指定せず、到達レベルとクリア数を測る。数値は送信時だけ変換し、空欄・小数の入力を妨げない。
- 通常の人間と同じ調理・移動・ダッシュ・仕上げ・返却・廃棄・採用・配置・仕入れを選べる。移動中の変更、応募者抽選、支払いと在庫の検証も通常処理を使う。
- 通常プレイの保存を抑止し、古い応答を捨てる。エラー・call上限・中断をノルマ未達と区別し、代替判断は行わない。
- 接続先はWorkerの`BENCH_ENDPOINTS`に登録したHTTPS endpointのみ。URL・トークンをブラウザへ返さず、サイズ制限・timeout・Access保護を維持する。
- 配信前の復旧候補: `a267e2a0-5b70-4332-973a-159417bdec2c`。最終検査と配信後検証は追記する。

## 2026-09-19 加熱時間の確定

- `96c30e5`を基準に、鍋の基準調理時間を12秒、グリルを7秒へ変更する。従業員の調理速度補正と人間の一度限りのブーストは維持する。完成後の焦げ猶予は従来どおり鍋12秒・グリル7秒で、調理時間とは別に管理する。
- 描画契約は変更しない。`duration`は開始時の調理時間、`busyUntil`はブースト短縮を反映した完成時刻、`burnAt`は完成後の焦げる時刻、`boosted`は使用済みフラグとする。時刻は営業内の`g.time`と同じミリ秒単位。
- 73 tests、typecheck、check、build、`git diff --check`がpass。完成・焦げの境界、清掃後の再利用、ブースト開始境界と重複拒否、従業員補正、`tick`経由の12秒／7秒加熱とpause中の停止を検証した。既知の大容量chunk警告は継続する。実ブラウザでの操作・難易度の体感評価は未実施。
- 配信前の復旧先は100% version `1f1e455f-ddba-448e-8290-5ad7727e151a`。復旧コマンドは`pnpm exec wrangler rollback 1f1e455f-ddba-448e-8290-5ad7727e151a`。未統合の従業員シフト・旧Html UIブランチは含めない。

## 2026-09-19 スマホの固定操作UI

- スマホ幅と低い画面では作業台名を厨房上に重ねず、画面下の固定ボタンへ集約する。3Dの台と固定ボタンは同じ`goTo`で移動・作業する。調理進捗・完成・焦げの表示は残し、文字札は縮小する。
- 初皿ガイドはタップ操作を案内し、対象外の台は無効化する。320×568／390×844／568×320／844×390、厨房の各段階とLv100で、ボタンの44px以上・画面内配置・非重複を回帰検証する。
- ローカルの72 tests、typecheck、check、build、`git diff --check`がpass。大容量chunk警告は継続。操作用ブラウザが未接続のため、この差分の実描画・タップ操作は未検証であり、下記の移行時ブラウザ記録で代替しない。
- 配信前の復旧先は100% version `05502455-2b07-46ed-9d73-2efc8ab3c41c`。復旧コマンドは`pnpm exec wrangler rollback 05502455-2b07-46ed-9d73-2efc8ab3c41c`。WebGPU専用・Cloudflare Accessの保護は変更しない。

## 2026-09-19 Three UI移行

状態: mainから本番配信済み。本番配信はこの節の配信記録で判定する。以下の旧記録は移行前の履歴である。

- ラベル → HUD・メニュー・採用・仕入れ → Glyph・商品モデル・立体タイトルの順に移行した。ネイティブ要素は数値編集・キーボード・読み上げを担当する。
- タイトル画面は上部の立体ロゴと下部の開店操作だけにし、中央の厨房を隠さない。注文・Lv・スタッフ・在庫は開始後に表示する。スマホ幅では文字を20%縮小し、操作領域は44px以上を維持する。
- Chrome/WebGPUで開始、初回サラダの5工程、通常営業への移行、メニュー・手引き・Escape、数値入力を確認。ローカルの検証用状態で採用、99個購入時の資金不足、2個の確定、次レベル、失敗時の復元、Lv100完走画面を確認した。
- 採用・仕入れの検証値: 600コインから料理人180コインとトマト2個16コインを支払い、残金404・在庫14でLv4を開始。リトライも同じ残金・在庫へ復元した。
- GlyphのフォントはCanvas単位で共有し、共有GPUバッファの解放は所有者に揃える互換patchを適用する。フォントの早期破棄とGPUバッファ共有の問題、および回帰確認手順をADR 003に記録した。
- API修正 `4be43a1` も統合した。healthは`answers.ok`を検証し、decideは`next_action`だけを返す。直接APIとWorkers AIの両経路を自動検査する。
- 継続プレイ: production buildで90秒営業が7/6皿・2070点で終了し、クリア画面へ移行。途中のメニュー開閉と320px幅への変更を含め、Console errorは0件。
- 自動検査: 71テスト、型検査、format/lint、production build。ビルド時にフォント未収録文字も拒否する。
- 既知の制約: WebGPU必須。実機スマホ・低速回線での性能測定は未実施。Kitchenの圧縮後JSは約565kB、文字組みWASMは約506kB、フォントatlasは非圧縮約2.5MB。
- 配信前rollback候補: `a3a46661-5531-4325-9744-218bcb799772`（2026-09-19 03:18:46 UTC）。復旧コマンドは `pnpm exec wrangler rollback a3a46661-5531-4325-9744-218bcb799772`。

### 統合後の品質確認

- `pnpm test`（scriptは`node --test`、concurrency指定なし）は71 pass／0 fail、typecheck、check（39 files／lint23、警告なし）、build、`git diff --check`がpass。Kitchen chunkは2,046.10kB／gzip563.84kBである。
- 別ブランチ`475199e`の再接続ガードを統合し、Glyphフォントのリセットも同じ排他区間に含めた。回帰テストでdispose待機中の連打、古い世代の完了、待機終了後の再試行を検証する。
- Chrome実GPUの`device.destroy()`後に営業が停止し、再接続後も386点・経過24,349.7msを保持した。CanvasとFiber rootは各1個。意図的な切断のログ以外にConsole errorは発生していない。
- 本番への配信と認証済みURLの確認は、下記の配信記録に記す。WebGLは受入対象外とする。

### 配信記録

- 統合commit `2714a6479c08e99cbc7191947227119b4f410c80`をmainへpush。GitHub CI [35419550131](https://github.com/HikaruEgashira/jev-kitchen/actions/runs/35419550131)とWorkers Buildsはsuccess。
- 2026-09-19 03:48:05 UTC、本番100% version `b4bfb93f-8ebb-41a4-99fb-1ea24cc02ee2`を確認した。復旧先は上記の`a3a46661-5531-4325-9744-218bcb799772`。
- Access認証済み[本番URL](https://jev-kitchen.egahika.dev)で立体タイトル、中央の厨房、開店後のHUDと初回調理を確認。配信entryはローカルbuildと同じ`index-DQFhOe7p.js`。
- 本番`GET /api/health`はHTTP 200、`ok: true`、`via: typesafe-api`、`model: jev-latest`、`upstreamMs: 385`。公開JSONは接続metadataだけであり、未認証ページはHTTP 302を維持した。

### 視覚職能報告の証拠区分

- 本スレッドの視覚職能報告は、報告者による静的読解として扱う。独立したsubagentの実行・検証を証明するものではなく、`/tmp/visual-agent-*`は参考資料に限定する。
- 該当する共有`Kitchen.jsx`の視覚差分は報告者が編集した。rootの独立レビューは、実際に読んだ差分と確認内容が記録された範囲だけを証拠とし、全職能の独立レビュー完了とは扱わない。
- `instanceColor`112件・境界球半径9.50はNode smoke testの提供報告であり、実GPU描画の証拠ではない。視覚報告者はブラウザを操作していない。上記のThree UI移行のブラウザ記録とは、実施者・対象差分を区別する。

## 移行前の記録

## 目的

MVPを短い協力料理ゲームとして本番公開するための判定台帳である。肩書きや計画ではなく、実行した変更・検証結果・証拠・採否を記録する。

## 2026-09-19 health修正の配信前検証

- 本番mainの`7ec116a`を基準に、Workerと回帰テストだけを変更する。並行中のThree.js置換、厨房登場演出、従業員・シフトの別ブランチは含めず、公開画面を変更しない。
- `runJev`は共通の通信・エラー検証を担当し、行動判断の投影は`/api/decide`で行う。healthは`answers.ok`のNoul形式を検証し、公開応答は`ok`／`engine`／`via`／`model`／`upstreamMs`に限定する。
- TypeSafe直APIとWorkers AIの両経路で、実際の応答形式に合わせたstubによる成功、異常値の拒否、answers・usage・非公開metadataの非露出、行動判断の検証維持を確認。実Jev応答と本番確認は別の検証である。
- 配信用ツリーで`pnpm test`は46 pass／0 fail、`pnpm typecheck`、`pnpm check`（23 files／lint12、警告なし）、`pnpm build`がpass。frozen/offline installもpass。並行開発中の共有ツリーのテスト件数と混同しない。
- `Kitchen` chunkは1,499.93kB／gzip406.11kB。既知のサイズ警告であり、今回のWorker修正による描画性能の検証を意味しない。
- mainへのpushでWorkers Buildsから配信する。配信前の100% versionは`b0d3ab8a-30a3-4ffe-a2e9-39d4d784e27d`。復旧時は`pnpm exec wrangler rollback b0d3ab8a-30a3-4ffe-a2e9-39d4d784e27d`を使用する。Cloudflare Accessを解除しない。

## 出荷判定

| ゲート | 合格条件                                                                         | 証拠                                           |
| ------ | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| 機能   | Lv1〜100を計算式で生成し、各90秒のノルマ判定・採用・仕入れ・再挑戦が成立する     | 自動テストとブラウザ操作結果                   |
| 描画   | WebGPU必須、非対応時の起動案内、狭い画面で操作可能                               | 認証済みブラウザの診断表示とスクリーンショット |
| AI     | Jev・固定ルール・LLMの切替、候補外行動の破棄、通信失敗時の継続                   | API応答、判断ログ、自動テスト                  |
| 入力   | キーボード、クリック／タップ、入力欄の文字入力、停止／再開が干渉しない           | ブラウザ操作結果                               |
| 品質   | formatter、型検査、lint、単体テスト、production buildが成功する                  | コマンド出力                                   |
| 配信   | mainから配信でき、Access保護を維持し、配信後の本番URLが動作する                  | CI／Workers Buildsと本番確認                   |
| 復旧   | 配信前versionを記録し、rollback手順が確認できる                                  | Wranglerのversion記録                          |
| 範囲   | XR、同期対戦、クラウドセーブ、広告、課金、実在従業員の採用、他repo変更を含めない | 非採用理由                                     |

## 運営ルール

- 部門leadは、担当職能ごとに実際の成果、検証、採用／非採用を報告する。
- 未実施の実機確認、法的保証、公開済みとみなす表現は合格証拠にしない。
- Access、秘密、課金、外部送信、他repoの権限は本台帳の対象外であり、変更しない。
- 部門間で競合する変更は、directorがMVPの遊びやすさ・安全性・復旧性を優先して採否を決める。

## 現行iterationのスコープ判断（未検証）

旧MVPの過渡的な難度案は撤回し、現行仕様だけを記録する。実装・QAは進行中で、下記は合格証拠ではない。

- Lv1〜100を各90秒で行う。レベル別設定表を作らず、レベルデザイナーが算出した成長曲線からノルマと注文を生成する。厨房・商品は三段階で開放する。
- クリアは配膳数、星は得点600／1800／3600で判定し、条件を分離する。Lv100クリアで完走とする。
- クリア後、未採用の候補から最大3名をランダム提示し、1名を採用するか見送って貯金する。説明は役割と能力に限定し、価格の評価語は使わない。担当工程・移動速度・調理速度・ダッシュ・判断間隔に差を設ける。
- 判断間隔は次のJev要求までの最短間隔に反映する。通信中と移動中は重複要求せず、モデルの推論精度が上がるとは表現しない。
- Lv2以降は有限のトマトstockを単価8 coinsで購入する。残数は持ち越し、採用とstock購入は同じ財布から準備段階で一括取引する。次のquota以上のstockがなければ開店できない。
- 初期cashは120。失敗retryは同じlevelの営業を、開始時のcashとstockへ復元して再開する。
- 初回は「開店」だけを入口にする。未完了flagの間は最初のサラダを固定し、キーボードガイドを表示し、AI timerの準備を待つ。配膳後に画面を切り替えず、通常90秒へ入り、score・cash・served=1を保持する。別tutorial入口とskipは置かない。

### 現行iterationの受入ゲート

| 項目       | 合格条件                                                                               | 状態         |
| ---------- | -------------------------------------------------------------------------------------- | ------------ |
| Lv1〜100   | 共通計算式を使い、90秒固定・三段階厨房・Lv100完走の境界が成立する                      | rootのQA待ち |
| ノルマ・星 | 計算式のノルマで合否、得点600／1800／3600で星を判定する                                | rootのQA待ち |
| 応募・採用 | クリア後に最大3名を提示し、採用・見送り・所有スタッフの無料交代が成立する              | rootのQA待ち |
| 相棒の能力 | 担当外の行動を拒否し、判断間隔・ダッシュ・速度の表示と実動作が一致する                 | rootのQA待ち |
| stock経済  | Lv2以降の単価8、持越し、初期cash120、採用との共通財布、quota不足時の開店拒否が成立する | rootのQA待ち |
| retry      | 失敗後に同じlevel、営業開始時のcash、stockへ復元される                                 | rootのQA待ち |
| 初回導線   | 開店のみで開始し、初回salad固定→keyboard guide→AI timer待機→配膳後90秒へ連続する       | rootのQA待ち |
| 配信・復旧 | Accessを維持し、現行iterationのbuild・本番URL・rollbackを別々に確認する                | rootのQA待ち |

旧90秒サラダ／スープMVPの検証は`7ec116a`の履歴として下記に残す。旧MVPのpass結果を現行iterationの合格証拠へ繰り越さない。

### 現行iterationの配信状態

- 現行iterationは自動検査のQA報告を受領済み。実ブラウザ受入と本番配信確認を待ち、リリース済みとは扱わない。
- 直近rollback候補はWrangler version `b0d3ab8a-30a3-4ffe-a2e9-39d4d784e27d`。rootが現行版の配信後にreadbackと復旧手順を確認する。
- 現行版のproduction URL、Access認証済み実API、各level、quota、採用、stock経済、初回導線は未検証である。

### 現行iterationの中間統合結果（2026-09-19）

- QA最終提供結果: body timeout回帰追加後の`pnpm test`は38 pass／0 fail。scriptは`node --test`で、直列化オプションは指定しない。Node v26.8.1で既定実行と`node --test --test-concurrency=32`の38件passが報告された。timeout回帰は8,000msタイマーだけを即時発火させ、停滞したrequest bodyに対する400応答とAI呼出し0回を検証する。対象commitは未提示であり、冒頭の統合版71件や配信済み版の合格証拠とは区別する。
- buildの`Kitchen` chunkは1,498.95kB、gzip405.66kBとの報告。既知のサイズ警告はビルド失敗ではなく、単独では出荷不可としない。ただし実機・低速回線での初回表示性能は未検証であり、旧MVPの受容判断を現行版の性能保証として扱わない。
- 描画の受入条件はWebGPU専用とする。WebGL fallbackは対象外とし、WebGPU非対応時の案内と再接続を確認する。
- rootの操作用ブラウザは未接続。現行版のWebGPU描画、320／390pxのタッチ操作、Jev実応答とoffline fallback、Escape連打・help・pause、finish／retry、実GPUの`device.destroy()`後の停止・再接続は未検証である。
- ユーザーの実ブラウザでは`http://127.0.0.1:5173/`に「3Dの描画を開始できませんでした」と表示されたとの報告がある。rootはページと`/fonts/kitchen.font.glb`のHTTP 200を確認したが、Console・スタックトレースは未取得で、描画成功の証拠ではない。この表示は`GraphicsBoundary`の共通エラーであり、端末のWebGPU非対応と断定しない。
- 未解決事項: 現行`retryGraphics`はdispose待機前に共有refを消すため、再接続の連打で2回目が待機を飛ばす。関数をそのまま抽出したロジックテストで、dispose完了前の再マウント1回、完了後の累計2回を再現した。再試行の多重実行を防ぎ、回帰テストと実GPUで確認する必要がある。
- 出荷判定は保留。描画起動失敗と再接続競合の解消、対象commitを固定した自動検査、実ブラウザ受入、本番配信確認を別々に記録して判断する。独立した人間のβテスト、複数実機・支援技術の検証も未実施である。

### 現行iterationのQA・β・映像・カットシーン報告

この会話で受領した職能別報告を記録する。静的レビューや撮影案を、実プレイ・実機検証・収録完了とは扱わない。

| 職能                              | 受領した成果・証拠                                                                                                                                                                                                    | 未実施・受入境界                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| debugger（QA）                    | 最終提供報告は38 tests pass。body timeoutとEscape repeatの回帰、既定実行と並列数32でのpassを報告。整形修正後のcheckもpass。                                                                                           | 対象commitは未提示。QAの「P0/P1なし」は報告対象の静的判定であり、統合版の実ブラウザ・本番受入とは別に扱う。                |
| βテスター                         | 初回サラダ、タッチでのスープ、AI stale／fallback、誤操作／Q、pause／help／visibility、finish／retryの受入シナリオと静的レビューを受領。ヒントと実行可能操作の不一致、連続タップ、Escape repeat、低FPS時の時計を指摘。 | レビューは完了。現行版のブラウザ操作、独立した人間によるβ、複数実機・支援技術の検証は未実施。                              |
| video creator（映像）             | 開店→協力→刻む→加熱→配膳・得点→実際の結果を見せる15秒の撮影案を受領。                                                                                                                                                 | 収録・動画作成・公開は未実施。配信commitと実Jev応答の確認後に撮影する。動画は出荷ゲートに含めない。                        |
| cutscene designer（カットシーン） | 開始・pause・help・終了・retryのテンポを静的レビュー。紙吹雪の営業間持越しと終了時残留を指摘。                                                                                                                        | 現行版の演出と紙吹雪の停止・再挑戦は実ブラウザ未確認。厨房登場アニメーションは別作業であり、この報告の実装成果に含めない。 |

## 本番適用済み: health修正（2026-09-19）

- 本番mainの`7ec116a`からWorker・回帰テスト・配信前記録だけを切り出し、`4be43a16adf34ed3819c0bb335ff14316a556fc0`をmainへpushした。GitHub CIとWorkers Buildsはsuccess。並行中のThree.js置換、厨房登場演出、従業員・シフトの別ブランチはこの配信に含まない。
- 配信用ツリーは46 tests／typecheck／check／buildがpass。共有開発ツリーにも同じhealth修正を適用し、69 tests／typecheck／check／buildを確認したが、共有ツリー全体を配信したわけではない。
- 本番100% versionは`a3a46661-5531-4325-9744-218bcb799772`。直前の復旧先は`b0d3ab8a-30a3-4ffe-a2e9-39d4d784e27d`である。
- Access認証付きの本番`/api/health`で`ok: true`、`via: typesafe-api`、`model: jev-latest`、`upstreamMs: 429`を取得。公開JSONにanswers・usageは含まれない。未認証の本番ページはHTTP 302を維持した。ブラウザでのゲーム操作は今回検証していない。
- この配信は一括リリース指示の前に開始済みだった。今後は個別修正ごとに配信せず、変更をまとめてQAした後にmainからリリースする。

## 旧MVP検証履歴（7ec116a）

以下は旧MVPで実際に取得したローカル品質・ブラウザ証拠である。現行iterationのレベル、焦げ、スタッフ、2注文UIを含まないため、現在の出荷判定には使用しない。

2026-09-19、全49職能の報告を照合し、担当leadの差分を統合した。

- `pnpm test`: 41件全件pass（tutorial、ゲーム、音声、Worker入力境界、health metadataを含む）。Nodeの各テストファイルを分離実行するため、直列化オプションを出荷条件にしていない。
- `pnpm typecheck`: pass。
- `pnpm check`: format、lintともにpass。
- `pnpm build`: pass。`Kitchen` chunkは約1.5MB（gzip約405KB）で、初回転送の改善余地を残す。
- production buildで`dist/_headers`（nosniff／no-referrer）、`dist/licenses.md`（13.5KB）、`dist/third-party-notices.md`（3.0KB）が生成される。
- `pnpm exec wrangler deploy --dry-run`: pass。AI bindingと静的assetの解決を確認。
- 配信前の直近version: `2c4b2457-e61f-4313-8166-60befc90d46d`（Wrangler一覧で100%を確認）。
- Workerはrequest/upstream body上限、timeout、候補ID検証、healthのGET限定、エラー本文の秘匿化を採用。timeoutはupstream処理を中断する保証ではなく、クライアントへの待ち時間上限として扱う。

### 旧MVPブラウザ証拠（local）

rootがブラウザでlocal現行コードを操作し、以下を確認した。本番custom domainの配信後確認とは分ける。

- WebGPU描画、プレイヤー側の操作によるサラダ／スープ配膳、4皿・713点、注文失効1件を確認。操作担当はAIエージェントであり、人間のβテストではない。
- Helpを開いてEscapeを押しても営業が再開せず、paused状態を維持することを確認。
- 320×568ではdocument幅320、dialog高544／scroll833で横溢れなし。
- 568×320ではdocument幅568、dialog高296／scroll651で横溢れなし。
- 初回tutorialをready画面から開始し、サラダの5工程（トマトをとる／切る／お皿をとる／盛る／届ける）を完了後、「90秒に挑戦」へ遷移することを確認した。開始後は0点・3注文へresetされ、tutorial中は時間制限とAI判断が発生しない。
- WebGPUのdevice loss時の停止・再接続、WebGL 2への切替・操作・context lossからの復旧を確認。GPU無効化とWebGL初期化失敗を注入し、再接続後Canvasが1個、未処理Promise拒否が0件になることを確認した。注入設定は再読み込みで解除した。
- 通常営業は90秒で終了し、8皿・1504点を表示。320px幅の再挑戦では1:30、0点、手ぶらへ戻り、ベストだけを保持した。
- 練習のスキップでも1:30、0点、3注文に初期化されることを確認。
- production URL、Access認証済み実API、WebGL fallback、営業終了／再挑戦の本番証拠はrootの配信後確認を待つ。

#### 旧MVP時点の出荷前負債

| 優先度 | 負債                                         | 方針                                                                                    |
| ------ | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| 高     | production URLの認証済みブラウザ証拠が未記録 | rootが配信後にWebGPU／WebGL、両レシピ、終了／再挑戦、狭い画面、実APIを実操作で採取する  |
| 高     | tutorialの本番遷移証拠が未記録               | localの成功・skipは受入済み。本番配信後に再確認する                                     |
| 中     | 追加通知のdist／本番配信を未確認             | `public/third-party-notices.md`をbuildへ含め、production URLで200を確認する             |
| 中     | 3D chunkが大きい                             | MVPでは受容。初回表示遅延が問題化した時点でThree依存の遅延ロード／asset分割を再検討する |
| 中     | Google Fontsをruntime取得する                | Access内MVPでは受容。公開範囲を広げる前にself-hostとプライバシー条件を再評価する        |
| 低     | 実機・支援技術・独立βの検証がない            | MVPの公開保証に含めず、次の検証計画で追加する                                           |

#### 旧MVP時点の初回チュートリアル受入

成功・スキップの両経路をrootのlocalブラウザ操作で確認した。ready画面から5工程を進め、時間制限・AIなしで完了し、0点・3注文の90秒営業へ遷移した。

| 条件                                               | 証拠                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| 時間・AIなしでサラダ工程を開始できる               | localブラウザで5工程を操作。時間表示なし、AI判断なし                            |
| 次の台だけが強調され、短い動詞と即時feedbackが出る | localブラウザの工程ラベル／作業台目印。`src/App.jsx`／`src/Kitchen.jsx`         |
| skipが常時使え、成功後またはskip後に営業へ遷移する | 成功・skip両方の90秒遷移、0点・3注文へのresetをlocalブラウザで確認              |
| 初回導入が90秒のスコア・注文・Jev課金を消費しない  | 遷移後0点・3注文へのreset、tutorial中のAI呼出しなしをブラウザ／状態テストで確認 |

## 旧MVP部門報告（7ec116a）

以下はrootが照合した49職能の実報告である。コード根拠のある採用と、実施しなかった外部行為・MVP外作業を分ける。ブラウザ／本番の証拠はrootの後続欄で補完する。

この49行は旧MVPで実際に行った役割報告の台帳であり、現行iterationのLv進行、焦げ、スタッフ、UI再設計を完了したことを意味しない。現行iterationで受領済みのQA・β・映像・カットシーン報告は上記の専用欄を正とし、それ以外の職能を現行版で再検証済みとは扱わない。

| 職能                    | 実際の成果／検証                                                                                                   | 採否                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| director                | 本台帳、出荷ゲート、リスクとMVP境界を作成。                                                                        | 採用                   |
| assistant director      | 全職能の漏れ・証拠・未実施を独立レビューし、1職能1行の報告形式を要求。                                             | 採用                   |
| producer                | 90秒協力料理、Access保護、main配信を本番MVPの範囲に固定。                                                          | 採用                   |
| assistant producer      | 自動検査の整形違反、実API証拠不足、Access維持と利用料の境界を指摘。                                                | 採用                   |
| planner                 | 無操作でも8皿・約1506点になることを測定。難度変更は人間プレイの到達性が未検証のため見送り。                        | 採用                   |
| game designer           | 状態別の作業ヒント、配膳までのJev指示、時間制限のない一皿練習を実装・テスト。                                      | 採用                   |
| level designer          | 5作業台の到達性、REACHの非重複、両レシピの導線を検証。座標変更は不要と判断。                                       | 採用                   |
| scripter                | `advance`の先行呼び出し境界と合法な有用候補をレビュー。通常到達不可の新規修正は不要と担当leadが判断。              | 非採用（修正不要）     |
| scenario writer         | 両レシピの配膳までの手順をレビューし、担当leadがJev指示、注文カード、ヘルプへ反映。                                | 採用                   |
| art director            | mint／coral基調の厨房、注文カード、相棒の視認性をレビューし、担当leadが`src/Kitchen.jsx`／`src/style.css`へ反映。  | 採用                   |
| concept artist          | 市松床と小物を含む明るい厨房のコンセプトを提示し、担当leadが`Floor`へ反映。                                        | 採用                   |
| 2D artist               | 切ったトマトの絵文字が🥬のままという矛盾を指摘し、担当leadが🍅へ修正。                                             | 採用                   |
| 3D artist（モデラー）   | 112枚の床のnative `InstancedMesh`集約を提案し、担当leadが反映。build pass。                                        | 採用                   |
| motion designer         | 運搬中の両手保持、作業中の腕振り、蒸気の動きをレビューし、担当leadが反映。                                         | 採用                   |
| motion actor            | 持ち運び中と担当作業中のモーション差分を確認し、担当leadがpause／reduced-motionと併せて反映。                      | 採用                   |
| UI designer             | 短い動詞と目印を使う練習、開始・終了・再挑戦、ARIA、狭幅表示を実装。                                               | 採用                   |
| effect designer         | 紙吹雪がリセット／再挑戦で残留する問題を指摘し、担当leadが修正・テスト。                                           | 採用                   |
| lighting artist         | ambient／directional lightとshadow mapを3Dシーンに維持。個別実機GPU比較は未実施。                                  | 条件付き採用           |
| technical artist        | WebGPU初期化競合、device loss、renderer世代破棄／再接続を指摘し、担当leadが`Kitchen.jsx`と`graphicsLost()`へ反映。 | 採用                   |
| photogrammetry artist   | 撮影素材・フォトグラメトリを追加せず、MVPの手製geometryを維持。                                                    | 非採用（範囲外）       |
| video creator           | 動画ファイル・外部公開素材を追加せず、Access内ゲームを優先。                                                       | 非採用（外部行為なし） |
| cutscene designer       | カットシーンを追加せず、90秒の連続プレイを優先。                                                                   | 非採用（範囲外）       |
| web designer            | 320px幅、landscape、dialogのスクロール、モバイル44px操作領域をレビューし、担当leadが`style.css`へ反映。            | 採用                   |
| DTP designer            | 本文12px化、コントラスト、見出し・注文カードの階層をレビューし、担当leadが反映。                                   | 採用                   |
| lead engineer           | pmndrs＋Vite+構成とクライアント差分を統合し、41テスト・typecheck・checkを通過。                                    | 採用                   |
| technical director      | 候補衝突・長いframe・上流timeoutをレビュー。供給台での同時取得は仕様内と統合担当が判定。                           | 非採用（仕様内）       |
| client engineer         | 入力欄保護、blur／visibility pause、stale AI破棄、GPU喪失停止をレビューし、担当leadが反映・テスト。                | 採用                   |
| XR engineer             | XR入力・デバイス対応を追加せず、WebGPUブラウザ体験に集中。                                                         | 非採用（範囲外）       |
| engine programmer       | 5FPS相当で時間ずれを実測し、担当leadが1秒frame clampを採用。build確認。                                            | 採用                   |
| hardware engineer       | DPRと影の省電力レビュー。DPR上限1.5、影1024、明示的high-performance指定の削除を確認。                              | 条件付き採用           |
| tools TA                | 描画復旧、音声非対応、編集欄入力、API timeoutの検証不足を指摘。担当leadとrootが回帰確認。                          | 採用                   |
| server engineer         | 入力・応答サイズ上限、timeout、health契約共通化、外部エラー秘匿を実装・実API確認。                                 | 採用                   |
| web engineer            | 課金前のmethod・criteria検証と2xxエラー本文漏えいを指摘し、server担当が修正。                                      | 採用                   |
| AI engineer             | 入力連打時の要求・古い回答・上流キャンセル限界をレビュー。デバウンスと非保証の明記へ反映。                         | 採用                   |
| build engineer          | frozen install・CI、Workerのみの型検査と整形違反を確認。`pnpm test`は`node --test`、直列化指定なし。               | 採用                   |
| infrastructure engineer | main Workers Builds、既存Access、rollback version記録を確認。資格情報を新設しない。                                | 採用                   |
| data scientist          | 固定ルールの90秒測定値を提示。新規分析基盤・trackingは追加しない。                                                 | 採用（分析のみ）       |
| sound director          | Web Audio音源、発音上限、停止・再開を実装。通常イベントへ接続し、無音でも進行可能。                                | 採用                   |
| sound designer          | Web Audioのvoice上限12、mute／pauseのstop・suspend、再開順をレビューし、担当leadが実装・テスト。                   | 採用                   |
| composer                | 終了音を下降`[784,659,523]`へ変更する案を提示し、担当leadが反映。音高列を自動テストで確認。                        | 採用                   |
| voice actor             | 音声収録・声優素材を追加せず、外部契約・配布範囲を増やさない。                                                     | 非採用（範囲外）       |
| debugger（QA）          | 自動テスト41件、typecheck、check、build、dry-runの再実行を確認。browser／本番は別証拠。                            | 採用（自動検査）       |
| βテスター               | シナリオ2本と`node:test`レビューを完了。人間βテスターによる実機検証は未実施で、公開保証に含めない。                | 採用（レビューのみ）   |
| task manager            | 未報告の職能と検証証跡の不足を指摘し、出荷条件を追跡。                                                             | 採用                   |
| localizer               | 日本語UI、ARIAのgroup／img、操作説明・レシピ工程を整合。                                                           | 採用                   |
| customer support        | FAQ 3本と自己復旧診断を作成。Access内MVPのため外部窓口は新設していない。                                           | 採用（Access内）       |
| 法務・知財              | `THIRD_PARTY_NOTICES.md`、Vite+生成`dist/licenses.md`、外部サービス／font／Accessの未保証境界を記録。              | 採用                   |
| promotion・広報         | Access限定の紹介文を作成。SNS、プレス、外部投稿は実施していない。                                                  | 採用（下書きのみ）     |
| 人事・採用              | 追加人員不要と判断。採用・外部候補者連絡は実施していない。                                                         | 採用（判断のみ）       |
