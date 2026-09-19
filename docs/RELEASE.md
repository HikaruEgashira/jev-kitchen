# SIDEKICK kitchen 本番リリース台帳

## 目的

MVPを短い協力料理ゲームとして本番公開するための判定台帳である。肩書きや計画ではなく、実行した変更・検証結果・証拠・採否を記録する。

## 出荷判定

| ゲート | 合格条件                                                               | 証拠                                           |
| ------ | ---------------------------------------------------------------------- | ---------------------------------------------- |
| 機能   | サラダ、スープ、配膳、注文失効、コンボ、営業終了、再挑戦が成立する     | 自動テストとブラウザ操作結果                   |
| 描画   | WebGPU優先、非対応時のWebGLフォールバック、狭い画面で操作可能          | 認証済みブラウザの診断表示とスクリーンショット |
| AI     | Jev・固定ルール・LLMの切替、候補外行動の破棄、通信失敗時の継続         | API応答、判断ログ、自動テスト                  |
| 入力   | キーボード、クリック／タップ、入力欄の文字入力、停止／再開が干渉しない | ブラウザ操作結果                               |
| 品質   | formatter、型検査、lint、単体テスト、production buildが成功する        | コマンド出力                                   |
| 配信   | mainから配信でき、Access保護を維持し、配信後の本番URLが動作する        | CI／Workers Buildsと本番確認                   |
| 復旧   | 配信前versionを記録し、rollback手順が確認できる                        | Wranglerのversion記録                          |
| 範囲   | XR、同期対戦、クラウドセーブ、広告、課金、採用、他repo変更を含めない   | 非採用理由                                     |

## 運営ルール

- 部門leadは、担当職能ごとに実際の成果、検証、採用／非採用を報告する。
- 未実施の実機確認、法的保証、公開済みとみなす表現は合格証拠にしない。
- Access、秘密、課金、外部送信、他repoの権限は本台帳の対象外であり、変更しない。
- 部門間で競合する変更は、directorがMVPの遊びやすさ・安全性・復旧性を優先して採否を決める。

## 初期スコープ判断

採用するのは、90秒の一人＋AI相棒によるサラダ／スープ協力プレイ、WebGPU優先の3D厨房、Jev連携、固定ルールフォールバック、レスポンシブ操作である。

初回導入は、既存3D厨房でサラダ1皿を自分で完成させるhands-on tutorialを採用する。時間制限とAI判断を止め、次の作業台だけを強調し、短い動詞と即時feedbackで案内する。いつでもskipでき、成功またはskip後に90秒営業へ遷移し、helpは参照用に残す。チュートリアル専用の新シーン、カットシーン、外部送信は追加しない。

以下は本番MVPでは実施しない。理由は、短い協力料理体験の完成度と本番証拠を下げるためである。

- XR対応、モーションキャプチャ、フォトグラメトリー、カットシーン、映像作品化
- 新規3Dアセット制作、声優、作曲、複雑なサウンドシステム
- 同期対戦、クラウドセーブ、分析基盤、広告、課金、採用、外部広報
- 本番Accessの解除、資格情報の新設、他リポジトリの変更

## ローカル品質確認

2026-09-19、全49職能の報告を照合し、担当leadの差分を統合した。

- `pnpm test`: 41件全件pass（tutorial、ゲーム、音声、Worker入力境界、health metadataを含む）。Nodeの各テストファイルを分離実行するため、直列化オプションを出荷条件にしていない。
- `pnpm typecheck`: pass。
- `pnpm check`: format、lintともにpass。
- `pnpm build`: pass。`Kitchen` chunkは約1.5MB（gzip約405KB）で、初回転送の改善余地を残す。
- production buildで`dist/_headers`（nosniff／no-referrer）、`dist/licenses.md`（13.5KB）、`dist/third-party-notices.md`（3.0KB）が生成される。
- `pnpm exec wrangler deploy --dry-run`: pass。AI bindingと静的assetの解決を確認。
- 配信前の直近version: `2c4b2457-e61f-4313-8166-60befc90d46d`（Wrangler一覧で100%を確認）。
- Workerはrequest/upstream body上限、timeout、候補ID検証、healthのGET限定、エラー本文の秘匿化を採用。timeoutはupstream処理を中断する保証ではなく、クライアントへの待ち時間上限として扱う。

## ブラウザ証拠（local現行コード）

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

### 出荷前に潰す負債

| 優先度 | 負債                                         | 方針                                                                                    |
| ------ | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| 高     | production URLの認証済みブラウザ証拠が未記録 | rootが配信後にWebGPU／WebGL、両レシピ、終了／再挑戦、狭い画面、実APIを実操作で採取する  |
| 高     | tutorialの本番遷移証拠が未記録               | localの成功・skipは受入済み。本番配信後に再確認する                                     |
| 中     | 追加通知のdist／本番配信を未確認             | `public/third-party-notices.md`をbuildへ含め、production URLで200を確認する             |
| 中     | 3D chunkが大きい                             | MVPでは受容。初回表示遅延が問題化した時点でThree依存の遅延ロード／asset分割を再検討する |
| 中     | Google Fontsをruntime取得する                | Access内MVPでは受容。公開範囲を広げる前にself-hostとプライバシー条件を再評価する        |
| 低     | 実機・支援技術・独立βの検証がない            | MVPの公開保証に含めず、次の検証計画で追加する                                           |

### 初回チュートリアル受入

成功・スキップの両経路をrootのlocalブラウザ操作で確認した。ready画面から5工程を進め、時間制限・AIなしで完了し、0点・3注文の90秒営業へ遷移した。

| 条件                                               | 証拠                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| 時間・AIなしでサラダ工程を開始できる               | localブラウザで5工程を操作。時間表示なし、AI判断なし                            |
| 次の台だけが強調され、短い動詞と即時feedbackが出る | localブラウザの工程ラベル／作業台目印。`src/App.jsx`／`src/Kitchen.jsx`         |
| skipが常時使え、成功後またはskip後に営業へ遷移する | 成功・skip両方の90秒遷移、0点・3注文へのresetをlocalブラウザで確認              |
| 初回導入が90秒のスコア・注文・Jev課金を消費しない  | 遷移後0点・3注文へのreset、tutorial中のAI呼出しなしをブラウザ／状態テストで確認 |

## 部門報告

以下はrootが照合した49職能の実報告である。コード根拠のある採用と、実施しなかった外部行為・MVP外作業を分ける。ブラウザ／本番の証拠はrootの後続欄で補完する。

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
| build engineer          | frozen installとCIを確認し、型検査がWorkerのみであることと整形違反を指摘。                                         | 採用                   |
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
