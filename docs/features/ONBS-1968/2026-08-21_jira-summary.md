# 埋め込みタグCSV（ターゲット設定 / 自動表示条件）の件数上限がサーバー側で検証されていない

作業ブランチ: `feature/ONBS-1968`（onboarding-manage-api / Onboarding-Editor-Extension / onboarding-manage-web の3リポジトリ）

分岐元: onboarding-manage-api = `main` / Onboarding-Editor-Extension = `main` / onboarding-manage-web = `master`（いずれも取得時点の最新）

---

## 概要

「埋め込みタグのパラメーター(CSV一括登録)」（内部名 `ParameterList` 条件）で登録できる
CSVファイル数の上限は、**管理画面のフロントエンドが追加ボタンを非活性にすることだけで
成立している**。サーバー側に件数のバリデーションが無く、API を直接呼べば上限を超えた
データが保存できる。

さらにエディター拡張機能には**件数上限の制御そのものが存在せず**、CSVファイルの
サイズ検証も無い。管理画面と拡張機能で同じデータを編集できるため、拡張機能から
上限を超えたデータを作れる状態だった。

あわせて、管理画面のCSVサイズ検証がサーバー側の上限（1MB）と一致せず 4MB になっており、
1MB〜4MB のファイルは**選択時には通るが保存時に 400 で弾かれる**という食い違いがあった。

---

## 現状の仕様（調査結果）

| 対象 | 上限 | 強制している層 |
|---|---|---|
| ターゲット設定（ガイド / AIチャット）のCSVファイル数 | 100件 | 管理画面フロントのみ |
| 自動表示条件のCSVファイル数 | 10件 | 管理画面フロントのみ |
| CSV 1ファイルのサイズ | 1MB | サーバー（`CSV_TARGET_MAX_FILE_SIZE`） |
| CSV 1ファイルの行数 | 10,000行 | サーバー（`CSV_TARGET_MAX_ROWS`） |

- `ParameterList` 条件は 1 item = 1 CSVファイルなので、**items 数の上限がファイル数の上限**
- `ParameterList` は自分自身と競合する（`conflicts: ['ParameterList']`）ため、
  1つのターゲット設定 / 1つの自動表示条件に `ParameterList` 条件は最大1つ。
  よって上限は「設定1件あたり」で閉じている
- 上限値の出どころ: `mixin-goal-auto-display-condition.ts` の `enableAddItem`（100）と
  `UiGuideEditGoalAutoDisplaySettingsParameterList.vue` の
  `enableAddItemForAutoDisplayParameterList`（`invoker === 'autoDisplay'` のとき 10）

---

## 問題点

### 1. サーバー側に件数上限のバリデーションが無い（本報告の主題）

保存系エンドポイントは `conditions` をそのまま JSON として永続化しており、
`ParameterList` の items 数を見ていない。`validation.post_targetcsv` にも件数の項目は無い。

上限を超えると、CSVの各行が DynamoDB のレコードとして展開される数と、エンドユーザー側で
毎回走る条件判定の対象が線形に増える。10,000行 × 上限超のファイル数がそのまま効くため、
UI の非活性だけを頼りにするのはリスクが大きい。

**影響を受ける経路**: 管理画面（REST / WebSocket）・エディター拡張・AIチャット設定の
すべての保存 API。

### 2. エディター拡張に件数上限の制御が無い

`KeyAndValue/index.vue` の `addConditionItem` は `isMultipleCondition`（条件タイプが
複数アイテムを許すか）しか見ておらず、件数の上限判定が無い。ターゲット設定・自動表示条件の
どちらでも**無制限にCSVファイルを追加できた**。

管理画面で 10件で止められる自動表示条件に、拡張機能からは 11件以上を登録できるため、
同じデータに対して 2 つの UI が異なる上限を持つ状態になっていた。

### 3. エディター拡張にCSVファイルの検証が無い

`ParameterCsv.vue` の `handleFileChange` はファイルを無検証で `FileReader` に渡して
アップロードしていた。サイズ超過はサーバーの 400 で初めて分かり、その 400 は拡張機能の
共通ハンドラで「サーバーエラーが発生しました」＋拡張機能の強制終了として扱われる
（後述「別チケット候補」1）。

### 4. 管理画面のCSVサイズ検証がサーバーの上限と一致していない

`uploadConfig.CSV_SIZE_LIMIT` が 4MB で、サーバー側の 1MB と食い違っていた。
`message.INVALID_UPLOAD_CSV_SIZE` の文言も「4MBまでです」となっており、実際の上限と
異なる案内をしていた。

この定数の呼び出し元は `UiGuideEditGoalAutoDisplaySettingsCsvManager.vue` の1箇所だけで、
**メンバー / ヒントのCSV一括登録はこの定数を通らない**（`accountMemberService` /
`hintService` 経由。サーバー側の上限も別値の 5MB）。したがって 1MB へ下げても
他のCSV機能には影響しない。

### 5. サーバーCSVエラー→表示文言の対応表が2コンポーネントに重複していた

`UiGuideEditTargetSettings.vue` と `UiGuideEditGoalAutoDisplaySettings.vue` に
同型の `switch` が手書きされており、エラー種別を増やすたびに 2 箇所の修正が必要だった。

---

## 対応内容

| リポジトリ | 変更概要 |
|---|---|
| **onboarding-manage-api** | 【問題1】件数上限の定数（`CSV_TARGET_MAX_FILES_FOR_TARGET` = 100 / `CSV_TARGET_MAX_FILES_FOR_AUTO_DISPLAY` = 10）と共通判定モジュール `lib/target_csv_limit.py` を追加し、保存系6エンドポイントにガードを追加／`lib/target_csv_limit.py` のユニットテストを追加（13ケース） |
| **Onboarding-Editor-Extension** | 【問題2】`constants/targetCsv.ts` + `utils/targetCsv.ts` を追加し、`KeyAndValue/index.vue` で `ParameterCsv` の件数上限（ターゲット設定100 / 自動表示条件10）に達したら追加ボタンを非活性にする（`addConditionItem` 側にも二重のガード）／【問題3】`ParameterCsv.vue` にサイズ1MB・ファイル名100字のクライアント検証と専用スナックバー（`openForInvalidCsvFile`）を追加／`utils/targetCsv.ts` のユニットテストを追加（12ケース） |
| **onboarding-manage-web** | 【問題4】`CSV_SIZE_LIMIT` / `CSV_NAME_LIMIT` を `TARGET_CSV_SIZE_LIMIT` / `TARGET_CSV_NAME_LIMIT` にリネームし、サイズ上限を 1MB に変更（用途を名前とJSDocで固定）／`INVALID_UPLOAD_CSV_SIZE` の文言を「1MBまで」に修正／【問題5】重複していたCSVエラーの対応表を `utils/targetCsvError.ts` に集約し、件数上限エラーの文言（`INVALID_CSV_FILES_LIMIT`）を追加／spec を追従 |

### サーバー側ガードを入れたエンドポイント

| エンドポイント | 利用元 | 上限 | 超過時 |
|---|---|---|---|
| `PUT /v1/targets/{target_id}`（rest） | 管理画面 ターゲット設定 | 100 | 400 + `Number of CSV files exceeds 100 limit.` |
| `PUT /targets/{target_id}`（rest-ext-editor） | エディター拡張 ターゲット設定 | 100 | 同上 |
| WebSocket `targetSave` | ターゲット設定（WebSocket経路） | 100 | 400（`send_format_error`） |
| WebSocket `goalAutoDisplaySettingsUpdate` | 管理画面 自動表示条件 | 10 | 400（`send_format_error`） |
| `PUT /goals/{goal_id}/auto-display-setting`（rest-ext-editor） | エディター拡張 自動表示条件（ゴール / ポップアップ） | 10 | 400 + `Number of CSV files exceeds 10 limit.` |
| `PATCH /v1/chats/{chat_id}/display_setting`（rest） | AIチャット ターゲット設定 | 100 | 400 + `Number of CSV files exceeds 100 limit.` |

判定は既存データを保存不能にしないよう寛容にしてある（`conditions` が配列でない・
`items` が配列でない・条件未設定で `attributes` が空配列 等は検証対象外として通す）。
上限を明確に超えている場合だけ弾く。

### 上限値の定義箇所（変更時は3リポジトリを揃える）

`layers` が rest / websocket に分かれているため、サーバー側も2箇所に同じ値を持つ。

| リポジトリ | ファイル |
|---|---|
| onboarding-manage-api | `api/rest/layers/python/lib/constants.py` / `api/websocket/layers/python/lib/constants.py` |
| Onboarding-Editor-Extension | `vue-app/constants/targetCsv.ts` |
| onboarding-manage-web | `app/mixins/mixin-goal-auto-display-condition.ts` / `UiGuideEditGoalAutoDisplaySettingsParameterList.vue` |

管理画面側は既存実装がコンポーネント / mixin に上限値を直接書く形のままで、
今回は値を変えていないため触っていない（定数化は別チケット候補3）。

### 管理画面と拡張機能で上限到達時の見た目が異なる

- 管理画面: 追加ボタンを `v-if` で**消す**（既存挙動、変更なし）
- エディター拡張: 追加ボタンを**非活性にする**（今回の実装）

上限に達したことがユーザーに伝わるのは非活性のほうなので、拡張機能は非活性を採った。
管理画面側を揃えるかは別チケット候補2。

---

## 検証結果

| リポジトリ | 実行内容 | 結果 |
|---|---|---|
| onboarding-manage-api | `pytest tests/layers/python/lib/test_target_csv_limit.py` | 13 passed |
| onboarding-manage-api | 変更した全 `.py` の構文チェック（`py_compile`） | OK |
| Onboarding-Editor-Extension | `vitest run`（全体） | 92 files / 911 passed |
| Onboarding-Editor-Extension | `npm run typecheck` / `eslint`（変更ファイル） | エラーなし |
| onboarding-manage-web | `npm run test:run`（全体） | 500 files / 6772 passed |
| onboarding-manage-web | `npm run typecheck` / `eslint`（変更ファイル） | エラーなし |
| onboarding-manage-web | mutation（`utils/targetCsvError.ts` / `utils/fileUpload.ts`） | 100.00% / survived 0 |
| onboarding-manage-web | branch coverage（同2ファイル） | 100%（8/8・10/10） |

`docs/MUTATION_TEST_RESULTS.md` は更新不要（同ファイルは survived が残るファイルのみを
載せる方針で、今回の対象は survived 0）。

### 未実施

- **エディター拡張の E2E / 実機確認**。件数上限の非活性とCSV検証はユニットテストで
  カバーしているが、実際の拡張機能を起動して 100件目 / 10件目で追加ボタンが
  非活性になることの目視確認は未実施
- **サーバー側エンドポイントの結合テスト**。共通判定モジュールはユニットテスト済みだが、
  各エンドポイントに対する 400 応答の結合テストは既存のテスト資産が無く未整備

---

## 確認手順（サーバー側の件数上限）

UI が上限で止めるため、超過データは API を直接叩いて作る。

1. ターゲット設定に `ParameterList` 条件を 1 件作り、CSVを1つ登録して保存する
2. 保存された `targets.attribute` の `conditions[].items` を 101 件に増やしたペイロードで
   `PUT /v1/targets/{target_id}` を直接実行する
3. 400 と `Number of CSV files exceeds 100 limit.` が返り、DB が更新されていないことを確認する
4. 100 件のペイロードでは従来どおり保存できることを確認する（境界値）
5. 自動表示条件も同様に、11 件で 400 / 10 件で保存成功になることを確認する

## 確認手順（管理画面のCSVサイズ）

1. 1MB を超える（例 1.5MB）CSVを「埋め込みタグのパラメーター(CSV一括登録)」で選択する
2. 選択した時点で「アップロードできるファイルサイズは1MBまでです。」が表示され、
   ファイルが選択されないことを確認する（修正前は選択でき、保存時に別の文言で弾かれた）
3. 1MB ちょうどのCSVは従来どおり選択・保存できることを確認する
4. メンバーCSV一括招待 / ヒントCSV一括編集で、1MB を超えるファイルが従来どおり
   扱えることを確認する（この経路の上限は変えていない）

## 確認手順（エディター拡張の件数上限）

1. 拡張機能でツアーのターゲット設定を開き、「埋め込みタグ（CSV）」条件を追加する
2. アイテムを 100 件まで追加し、100 件目で追加ボタンが非活性になることを確認する
3. ゴールを選択して自動表示条件を開き、同じ条件で 10 件目で非活性になることを確認する
4. 1MB を超えるCSVを選択し、「アップロードできるファイルサイズは1MBまでです。」の
   スナックバーが出てアップロードが行われないことを確認する
5. 同じファイルを選び直したときにもスナックバーが再表示されること（`input` のクリア）を
   確認する

---

## 別チケット候補（今回は未修正）

| # | 内容 | 深刻度 |
|---|---|---|
| 1 | エディター拡張は保存APIの 400 を `openForBadRequest`（「サーバーエラーが発生しました。担当CSにお問い合わせ下さい」＋拡張機能の強制終了）で扱う。今回のガードで 400 が返り得る経路が増えたが、バリデーションエラーに対してこの文言と強制終了は誤解を招く。ただし 400 のハンドリングは全APIで共有されており影響範囲が広いため分離した | 中 |
| 2 | 管理画面は件数上限に達すると追加ボタンが `v-if` で消えるだけで、上限に達したことがユーザーに伝わらない。拡張機能と同様に非活性＋理由の提示にするのが望ましい | 軽微（UX） |
| 3 | 管理画面の上限値がコンポーネント / mixin に直接書かれている（`items.length < 100` / `< 10`）。`constants/` へ出して拡張機能・サーバーと対応関係を明示したい | 軽微（保守性） |
| 4 | 管理画面の WebSocket エラーハンドラ（`useWebsocket.ts`）は 400 を `console.error` のみで扱う。自動表示条件の保存で 400 が返ると**ユーザーには何も表示されず保存中のまま**になる。「振る舞いを変えない」という既存の意図的な設計のため今回は触っていないが、サーバー側ガードの追加で 400 の発生経路が増えた | 中 |
| 5 | バルーンの自動表示条件（`PUT /balloon-groups/...`）はサーバー実装が本リポジトリ群に存在せず、ガードを適用できていない。拡張機能の `main` にはバルーン自体が未搭載だが、`develop` には `balloonAutoDisplay` があるため、develop 取り込み時に上限判定（`utils/targetCsv.ts` の `getMaxFiles`）とサーバー側ガードの追随が必要 | 中 |
| 6 | 拡張機能の `stepBranch` は `ParameterCsv` を選択肢に持たないため件数上限は不要だが、`getMaxFiles` は既定値としてターゲット設定の 100 を返す。将来 `stepBranch` に `ParameterCsv` を追加する場合は上限の意図を明示する必要がある | 軽微 |
| 7 | CSV削除対象の `file_id` を抽出する既存関数（`extract_file_ids` / `get_csv_file_ids`）が `conditions` / `items` を無条件に辞書として添字アクセスするため、型不正データで `TypeError` → 500 になる。実測: `conditions=["broken"]` で両関数、`items="broken"` で `get_csv_file_ids` が失敗。`get_csv_file_ids` は `item['file_id']` を無条件に読むため特に脆い。**本チケットの変更前から同じ挙動**（該当関数は未変更）で、件数上限の判定はこの挙動を変えないが、CodeRabbit のレビューで顕在化した | 中 |

---

## 据え置いた既存債務（今回の変更で触ったファイル / リポジトリ内）

- `onboarding-manage-web`: 分岐対応表と `it` の乖離 13 件（`UiGuideEditStylesSettingTour.spec.ts` /
  `UiGuideEditStylesSettingPopup.spec.ts` / `UiGuideEditGoalAutoDisplaySettingsParameter.spec.ts` /
  `UiGuideEditGoalAutoDisplaySettingsParameterList.spec.ts`）。いずれも今回変更していない
  ファイルで、`master` と同数（本ブランチで増やした分は 0）
- `onboarding-manage-web`: `check-lexicon.mjs --changed` の語彙違反 2 件
  （`docs/regression-tests/discovered-bugs.md` / `e2e/specs/ai-chat-edit.spec.ts`）。
  いずれも今回変更していないファイル
- `onboarding-manage-web`: component spec の `no-explicit-any`。`master` の 210 件に対し
  本ブランチは 195 件（テスト集約により減少。新規に増やした分は 0）
- `onboarding-manage-api`: `layers` が rest / websocket に分かれているため、
  `constants.py` と `target_csv_limit.py` を 2 箇所に複製している。
  統合は `api/rest-ext-editor/serverless.yml` の `# TODO: batch, rest, websocketのlayersをまとめる`
  が担当する既存課題

---

## 問題なしを確認した箇所

- メンバーCSV一括招待 / ヒントCSV一括編集は `validateCsv` を通らないため、
  1MB 化の影響を受けない（サーバー側の上限も別定数の 5MB）
- CSV 1ファイルの行数（10,000行）・サイズ（1MB）・単一列・空データ・重複値の検証は
  従来どおりサーバー側で機能している
- `ParameterList` は自分自身と競合するため、1設定に複数の `ParameterList` 条件を
  作って上限を回避することはできない（管理画面・拡張機能の双方で確認）
- `goalCopy` / `chats-copy` は `ParameterList` の `file_id` を複製するが、items 数は
  増えないため上限を超えない
