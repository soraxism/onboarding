# ONBS-1991 現状調査: ゴール完了（チェックマーク / LS保存）のタイミング

対象リポジトリ: `onboarding-web`（エンドユーザー側ランタイム）
関連: `onboarding-manage-web` / `onboarding-manage-api` / `onboarding-api`（設定の追加経路は
[2026-09-07_admin-ui-and-data-design.md](./2026-09-07_admin-ui-and-data-design.md) を参照）

---

## 1. 結論（要望への回答）

### 「現在のゴール完了（LSに保存）のタイミングはどうなっているか？」

**LocalStorage への保存は 3 系統あり、"完了" と "開始（表示済み）" は別キーに分けて記録されている。**
イントロのチェックマークだけが、その 2 つを **論理和（OR）で判定している** ため、
「ゴールを開始した時点でチェックが付く」という現在の見え方になっている。

| LSキー | 書き込みタイミング | 書き込み箇所 |
|---|---|---|
| `onb_display_goals_{tourID}` | **ステップが表示されるたび**（同一ゴールは1回だけ追加）→ 実質「ゴール開始時」 | `src/stands.onbd.ts:859-870`（`STANDSMotion.stepShow`） |
| `onb_complete_goals_{tourID}` | **ゴール終了時**（最終ステップで「終了」ボタン押下） | `src/stands.onbd.ts:1200-1212`（`STANDSMotion.finish`） |
| `onb_checked_goals_ids_{tourID}` | 顧客側スクリプトが公開API `STANDSMotion.setCheckedGoalIds()` を呼んだとき | `src/stands.onbd.ts:3095-3103` |

キー定義は `src/infrastructure/storage/constants.ts:43-46`（`LS_KEY_FACTORIES`）。

### イントロのチェックマーク判定（ここが「開始時」になっている原因）

`STANDSUnit.setLauncher()` — `src/onboarding-init.ts:653-673`

```
onb_checked_goals_ids があれば          → それをそのまま「チェック済み」とする（顧客カスタム優先）
なければ  complete_goals ∪ display_goals → 重複除去して「チェック済み」とする
```

`display_goals` は 1 ステップ表示した時点で入るため、

- ゴールを開いて 1 ステップ見ただけ → **チェックが付く**
- 途中で × で閉じた（abort）→ **チェックは付いたまま**（`abort` でも `setLauncher()` が走る: `src/stands.onbd.ts:1136`）
- 最後まで進めて「終了」を押した → `complete_goals` にも入る（見た目は変わらない）

### 「完了」の定義が機能ごとにズレている（既存の不整合）

| 機能 | 参照キー | 「完了」の意味 |
|---|---|---|
| イントロのチェックマーク / ランチャーのバッジ | complete ∪ display | 開始（表示）した時点で完了扱い |
| 自動表示条件「ゴール利用状況」 | complete と display を**別々に**判定 | 完了済み / 未完了 / 表示済み / 未表示 の4択（`src/domain/auto-display/ConditionChecker.ts:64-92`） |
| 公開API `getIncompleteGoalIds()` | complete のみ | 終了ボタン押下のみ完了（`src/stands.onbd.ts:3052-3065`、`src/embed/windowAdapter.ts:51-64`） |
| レポート（完了UU） | LS非依存。`step displayed` ログを集計 | **最終ステップの表示**（§4 で裏取り。`completed` イベントは集計に使われていない） |

つまり **データとしては既に「完了」と「表示済み」が分離済み**で、
今回の要望はイントロの表示判定をどちら基準にするか選べるようにする話に落ちる。

---

## 2. チェックマークが描画される仕組みと更新タイミング

### 描画

- ゴール1件のHTML生成: `src/onboarding-init.ts:47-57`（`getGoalTemplate`）
  - チェックあり → `<div class='stands-step-item-check'>` / なし → `stands-step-item-nocheck`
- イントロ全体のテンプレート生成: `src/onboarding-init.ts:66-100` / `113-`（`generateCategoriesAndGoalsTemplate` / `generateStepIntroModalTemplate`）
- 生成物は `STANDSUnit.opt['modalTemplate']` に**文字列として保持**される（`src/onboarding-init.ts:687`）
- DOM 化されるのは `tourInit()` → `buildModalDOM()` のとき（`src/domain/tour/TourModalBuilder.ts:100-101`）
- チェックマークの色は表示直前に `styles.intro.checkmark` を `el.style` へ流し込む（`src/domain/tour/TourDialogs.ts:54-59`）

### テンプレートが再生成される（= チェック状態が更新される）タイミング

`STANDSUnit.setLauncher()` の呼び出し箇所がすべて。

| 呼び出し元 | 場面 |
|---|---|
| `src/onboarding-init.ts:538` | 初期化時 |
| `src/stands.onbd.ts:1136` | `abort`（イントロ / ステップを閉じた） |
| `src/stands.onbd.ts:1224` | `finish`（ゴール終了） |
| `src/stands.onbd.ts:3097` / `3103` | `setCheckedGoalIds()` / `clearCheckedGoalIds()` |
| `src/stands.onbd.ts:4045` | ガイドデータ再取得（rebuild） |

**重要**: `modalTemplate` は文字列なので、再生成しても既に DOM 化済みのイントロには反映されない。
反映されるのは次に `tourInit()` が走ったとき（ランチャークリック等）。
→ ツアー進行中にチェックを付け替えたい場合は、DOM を直接更新する実装が必要（後述）。

### ランチャーのバッジ

`src/onboarding-init.ts:717-720`

```
未完了数 = STANDSUnit.steps.goals.length - チェック済み数
```

チェック判定と同じ配列を使うため、**チェックマークのタイミングを変えるとバッジの数字も連動して変わる**。
（なお `goals` にはポップアップも merge されるため、バッジ数がツアーゴール数と合わない既存の別課題がある。
ポップアップの merge: `onboarding-api/src/functions/v2/onboarding-init/handler.py:1183-1207`）

---

## 3. ゴール終了（`finish`）はいつ発火するか

「終了時」を実装するうえで前提となる挙動。

| 操作 | 発火するイベント | complete_goals |
|---|---|---|
| 最終ステップで「終了」ボタン押下 | `finish` | **追加される** |
| 途中／最終ステップで × を押す | `abort` | 追加されない |
| イントロを閉じる | `abort` | 追加されない |

`finish` の発火経路: 「次へ」で `startIndex` がステップ数を超え、対象ステップが取得できなくなった時点で
`end()` → `destroyTour()` → `finish()`（`src/domain/step/StepExecutor.ts:138-146`）。

最終ステップ判定そのものは既に存在する: `const isLastStep = runtime.startIndex + 1 === tourOptions.steps.length`
（`src/domain/step/StepExecutor.ts:536`）。ボタンラベルを `endText` にするかの判定に使われている。

### ゴール連結（Goal Connection）との関係

`finish` 後に `connectionSetting.goal_id` があれば、次のゴールへ自動遷移する（`src/stands.onbd.ts:1253-1270`）。
連結が設定されたゴールでは最終ステップのボタンが「終了」にならず「次へ」のままになる
（`src/domain/step/StepExecutor.ts:536-546`）。
→ **「最終ステップの表示＝完了」にすると、連結ありゴールでは「まだ次へ続くのに完了になる」**という状態が生じる。
**この挙動は許容する方針で決定済み**（レポートの完了集計も同じ基準なので、レポートとイントロの表示は一致する）。

---

## 4. レポート集計の「ゴール完了」定義（裏取り結果）

**レポートは既に「最終ステップの表示」をゴール完了として集計している。**
`completed` トラッキングイベントは集計に使われていない。

```python
# onboarding-batch/src/report_goal_details/functions/aggregate.py:316-317
df_step = df_step[df_step["step_index"] == df_step["total_steps"]]
df_step["is_completed"] = 1
```

- 集計元は `type = 'step' AND event = 'displayed'` のログのみ
  （`src/report_goal_details/queries/event_step_displayed.sql:20-21`）
- `is_completed = 1` の UU が `completed_uu` として集計され
  （`aggregate.py:246-257`）、管理画面のレポートAPI
  （`onboarding-manage-api/api/rest/functions/mng-v1-report-summaries-goals/method_get.py`）が参照する
- **`onboarding-batch` 内のどの集計クエリにも `event = 'completed'` は存在しない**
  （全クエリの `event` フィルタは `displayed` / `mounted` / `login` のみ）。
  つまり `STANDSMotion.finish()` が送っている `completed` イベント（`src/stands.onbd.ts:1216-1221`）は
  **送信されているが集計では消費されていない**

### 定義の対応表（現状）

| 機能 | 「完了」の判定 |
|---|---|
| **レポート（完了UU）** | **最終ステップの表示**（`step_index == total_steps`） |
| イントロのチェックマーク | 開始（1ステップ目の表示） |
| LS `onb_complete_goals_` / 自動表示条件「完了済み」/ 公開API | 終了ボタン押下（`finish`） |

3者がすべて別基準になっている。**今回の変更（チェックマークを最終ステップ表示基準にする）は、
イントロの見た目をレポートの完了定義に一致させる方向の修正**になる。

### Web側で同じ判定を作れるか

作れる。レポートの `step_index` / `total_steps` は onboarding-web が送っている値で、

- `step_index` = `step_data.index`（1始まり。`src/stands.onbd.ts:224`, `getStepData` は `:1059-1076`）
- `total_steps` = `getGoalObj(goal_id).steps.length`（`src/stands.onbd.ts:3218-3238`）

`stepShow` は `goal_data` / `step_data` を既に取得済み（`src/stands.onbd.ts:847-848`）なので、
`step_data.index === goal.steps.length` で**レポートと同一基準**の判定ができる。

---

## 5. 影響を受ける既存機能・資産の一覧

| 対象 | 内容 | 影響 |
|---|---|---|
| ランチャーのバッジ数 | チェック判定と同じ配列を参照（`src/onboarding-init.ts:717-720`） | タイミング設定に連動して数字が変わる。仕様として明示が必要 |
| 公開API `setCheckedGoalIds()` | `onb_checked_goals_ids` があると**タイミング設定より優先**される（`src/onboarding-init.ts:655-660`） | このAPIを使っている顧客では新設定が効かない。仕様として明記が必要 |
| クライアント個別カスタムJS | 下表のとおり（`src/customize/prod/`） | **既定値のままなら全顧客で無影響**。詳細は §8 |
| E2Eテスト | `onboarding-e2e-test/tests/common/intro/goalDisplayed.js:132-165`（**ゴールを開いて中断 → チェックが付く**ことを検証）、`goalCompleted.js:154` | デフォルト値を現行維持（開始時）にすれば `goalDisplayed.js` はそのまま通る。「終了時」用のシナリオを追加する |
| ユニットテスト | `tests/unit/onboarding-init.test.ts:1069,1218,1526`、`tests/unit/stands.onbd.test.ts:2674,2693,2830,4090`、`tests/unit/domain/auto-display/ConditionChecker.test.ts` | 判定分岐の追加に伴いケース追加が必要 |
| 旧実装（`src/js/`） | `src/js/onboarding-init.js:527-560`、`src/js/stands.onbd.js:760-770,1111-1119` に同じロジックが残存 | **同時反映する**（決定）。features フラグ `use_refactored_onboarding_init` 未設定のプロダクトには旧版 `js/onboarding-init.js` が配信されるため（`onboarding-api/src/functions/v1/onboarding-init/handler.py:26-28,45-70`）。dual-edit の禁則に従い旧側をリファクタしないこと |
| 仕様書 | `docs/spec/01_initialization.md:249`（setLauncher の処理フロー）、`docs/spec/16_core-engine.md:443-444`、`docs/spec/15_customer-customization.md:201-202` | 実装後に更新が必要 |
| **エディタ拡張機能** | ツアーのイントロは拡張機能でも編集でき、チェックマークの色設定が既に存在する（`Onboarding-Editor-Extension/vue-app/components/Common/TaskListMenu/index.vue` ほか） | **設定UIの実装が必須**。さらに拡張機能の保存APIが `styles.intro` を丸ごと置換するため、管理画面で設定した値が消える。詳細と対応は設計ドキュメント §4-(2) / §6 |

---

## 6. 参考: データフロー全体

**編集経路は2つある**（どちらも同じ `tours.json_src` を編集する）。

```
管理画面 (onboarding-manage-web)              エディタ拡張機能 (Onboarding-Editor-Extension)
  steps_json_src.settings.*                     steps_json_src.settings.*
        │ WebSocket                                   │ REST
        │  例: tourStylesUpdate / introCoverUpdate    │  例: PUT tours/{id}/intro-style
        │                                             │      PUT tours/{id}/intro-cover-image
        ▼                                             ▼
  api/websocket                                 api/rest-ext-editor
        └─────────────────┬───────────────────────────┘
                          ▼
onboarding-manage-api
  DB tours.json_src 更新 + S3 guides/tours/{id}/steps_preview.json 出力
        │   （intro.content_blocks → intro.content 変換: api/websocket/layers/python/lib/common.py:545-576）
        │ 公開操作で steps_preview.json → steps.json にコピー
        │   （api/websocket/functions/mng-v1-sync-guide-publish-setting/route_publishSettingPublish.py:76-102 + Cloudflareパージ）
        ▼
onboarding-api（配信API v2 onboarding-init）
  event.json（既定値）に steps.json の settings を浅マージ → res_data.opt
        （src/functions/v2/onboarding-init/handler.py:886, 913-914, 925-946）
        ▼
onboarding-web
  STANDSUnit.opt = res_data['opt']（src/onboarding-init.ts:446）
```

`settings` の各キーは `opt` のトップレベルにそのまま載る（実例: `opt` = tourID / intro / styles / lang / tourMap …）。
`settings.intro` は既定値の `intro` を**丸ごと置換**する点に注意（浅マージのため）。

---

## 7. 設定を切り替えたときチェックマークは引き継がれるか（重要）

結論: **「終了ボタンまで押したゴール」は引き継がれる。「最終ステップを表示したが終了ボタンを
押さなかったゴール」は引き継がれず、チェックが外れる。**
後者は許容する方針で決定済み（移行処理は入れない）。

### 前提: 過去の「最終ステップ到達」はLSに記録されていない

| LSキー | 記録内容 | 移行に使えるか |
|---|---|---|
| `onb_display_goals_` | ゴールを開いた（1ステップでも表示した）ゴールID | 使えるが「開いただけ」も含む |
| `onb_complete_goals_` | 終了ボタンを押したゴールID | 使える（最終ステップ表示を含意する） |
| `iGuider_data-{tourID}` | ページ遷移をまたぐ復元用の `{ tourId, stepValue }`。**ゴール別の履歴ではなく、`finish` / `abort` で削除される**（`src/domain/tour/TourCallbacks.ts:88-92`, `src/domain/step/StepNavigation.ts:127-139`） | **使えない** |
| `onb_current_step_index` | 現在のステップindex（1つだけ。ゴール別ではない） | 使えない |

→ 「最終ステップまで見たが終了ボタンを押していない」状態を**過去に遡って判別する手段は存在しない**。

### 切替後の判定を `complete_goals ∪ last_step_displayed_goals` にした場合

| 過去のユーザー状態 | 現行の見た目 | 切替後 | 結果 |
|---|---|---|---|
| 終了ボタンまで押した | ✓ | `complete_goals` に残っている → ✓ | **維持される** |
| 最終ステップを表示 → × で閉じた | ✓ | どちらのキーにも記録がない → ✗ | **外れる** |
| 途中まで見て閉じた | ✓ | ✗ | 外れる（設定変更の意図どおり） |
| 未着手 | ✗ | ✗ | 変化なし |

判定を `last_step_displayed_goals` 単独にすると、**過去に完了したゴールのチェックまで外れる**ため、
`complete_goals` との論理和にすることが必須。
`finish` は最終ステップを表示した後にしか発火しないため（`src/domain/step/StepExecutor.ts:138-146`）、
新実装後は `complete_goals ⊆ last_step_displayed_goals` が成り立ち、論理和にしても二重計上の問題はない。
顧客カスタムが `complete_goals` に独自書き込みしている場合（`src/customize/prod/65`）も論理和なら維持される。

### 「終了ボタンを押したゴール」が維持されない例外

いずれも **LS 自体が失われるケースで、現行実装でも同じ**（今回の変更で新たに増える例外はない）。

- ブラウザのデータ削除 / シークレットウィンドウ
- 別端末・別ブラウザ・別オリジン（LS はオリジン単位）
- 第三者スクリプトによる `localStorage.clear()`
  （ONBS-1969 の自己修復はページロード中に書いた値の範囲のみ）
- プレビュー起動・停止時の `overwriteLocalStorage()`（`onb_` プレフィックスをリセット）
- `setCheckedGoalIds()` を使っている顧客（`src/customize/prod/65`）は
  `checked_goals_ids` が最優先されるため、そもそも新設定の判定に入らない

削除済みゴールのIDは `adjustmentStorage()`（`src/onboarding-init.ts:731-751`）が掃除するが、
存在するゴールには影響しない。

### 引き継ぎの穴を埋める選択肢 → 案1 + 案2 で決定

| 案 | 内容 | 評価 |
|---|---|---|
| **案1（採用）** | 何もしない。「切替後は新しい基準で再判定される」を仕様として明記 | 設定変更は顧客の意図的な操作であり説明可能。ただし「最終ステップまで見たが閉じた」ユーザーのチェックは外れる |
| **案2（採用）** | 新キーを**設定値に関わらず常に記録する**（リリース時点から記録開始） | リリース〜設定変更までの期間が長ければ穴はほぼ埋まる。追加コストは最終ステップ表示時の1書き込みのみ |
| 案3（不採用） | 一度きりの移行処理: 設定が「最終ステップ表示」で未移行なら `display_goals` を新キーへ一括コピーし、移行済みフラグを立てる | 既存ユーザーのチェックは完全に維持されるが、下記の問題がある |

### 案3（移行処理）を入れた場合に起きる問題

1. **設定変更の効果が既存ユーザーに出ない（最大の問題）**
   コピー対象に「開いただけのゴール」が含まれるため、**直したかった状態がそのまま残る**。
   新基準が効くのは「まだ開いていないゴール」のみで、顧客から
   「設定を変えたのに変わらない」という問い合わせになりやすい
2. **レポートとの乖離が残る** — 「イントロは ✓ なのにレポートでは未完了」のゴールが残り続け、
   §4 で確認した「イントロをレポートの完了定義に合わせる」という狙いが既存ユーザーでは達成されない
3. **移行フラグの管理が必要** — 一度きりを保証するフラグ（LS）が必要だが、
   `overwriteLocalStorage()` がプレビュー起動・停止時に `onb_` プレフィックスをリセットするため、
   フラグと `display_goals` の整合が崩れるケースがある
4. **設定変更のタイミングを検知できない** — 配信データに設定変更日時がないため
   「初めて `last_step_displayed` を観測したとき」に移行するしかなく、
   そのツアーを初めて触る新規ユーザーでも移行処理とフラグ書き込みが走る
5. **設定を戻して再度変えたときの挙動を説明できない** — フラグが立っているので2回目は移行されず、
   その間に増えた `display_goals` は引き継がれない
6. **端末ごとに基準が混在する** — 移行済み端末（旧基準＋新基準）と、設定変更後に初訪問した端末（新基準のみ）で
   同一ユーザーのチェック状態が食い違う

### 参考: サーバー側履歴からの復元は現実的でない

`event_goal_details` テーブルは `uuid × goal_id × date` 単位で `is_completed`（最終ステップ表示）を保持しており
（`onboarding-batch/mysql/sql/init.sql:146-161`）、`uuid` は LS の `onb_uuid` と同じもの。
データは存在するが、

- エンドユーザー端末から個人単位の状態を引くAPIが存在しない（新規開発）
- 配信APIは Cloudflare キャッシュ前提のため、ユーザー個別レスポンスはキャッシュできずコストとレイテンシが増える
- 日次バッチのため当日分が欠け、パーティション保持期間の範囲しか復元できない

### 影響規模の実測方法

`completed` イベントは集計に使われていないだけでログには残っている（§4）。Athena で

- 最終ステップ表示のUU（`type='step' AND event='displayed' AND step_index = total_steps`）
- 終了ボタン押下のUU（`type='goal' AND event='completed'`）

を比較すれば、**チェックが外れるユーザーの実数・割合が事前に分かる**。

### 「開いたとき」に戻す場合

`onb_display_goals_` は設定に関わらず記録し続けるため（`stepShow` の既存処理）、
**いつでも元の基準に戻せる**。データが失われることはない。

---

## 8. 顧客個別カスタムJSへの影響（調査結果）

方針として顧客カスタムは標準機能に寄せない前提で、**標準実装の変更がカスタムを壊さないか**を確認した。

| 顧客 | カスタムの内容 | 影響 |
|---|---|---|
| `prod/65` | 独自の finish 処理で `complete_goals` に書き込み、`STANDSMotion.setCheckedGoalIds(comp_goals)` を呼ぶ（`makeup_preview.js:20-54,89,155`） | **無影響**。`onb_checked_goals_ids` が設定されるため `setLauncher()` はそちらを最優先で使い、新設定は判定に入らない（設定しても効かないだけ） |
| `prod/28` | `complete_goals` を読んで「完了済みか」で次に開始するゴールを出し分ける（`makeup_preview.js:277-280`） | **新キー方式なら無影響**。`complete_goals` の書き込みタイミングを変えない設計が前提。既存キーを流用すると**この顧客のゴール出し分けが変わる** |
| `prod/7738` / `7740` / `13` | `display_goals` を読み、`stands-step-item-check` / `-nocheck` を全ゴール分自前で上書きし「確認済み/未確認」テキストを付ける。`onb_ext_create` / `onb_ext_step_show` / `onb_ext_finish` / `onb_ext_abort` を使用 | **無影響**。標準の初期クラスを自前で上書きするため最終的な見た目はカスタム側が決める。`onb_ext_step_show` は標準の `stepShow` 処理の**後**に呼ばれる（`src/stands.onbd.ts:873-875`）ので、進行中のDOM更新を追加してもカスタムが後勝ちになる |
| `prod/23` / `722` / `957` / `982` / `999` | 同系統（`display_goals` ベースの自前クラス上書き）。フックは `onb_ext_create` / `onb_ext_start` のみ | **無影響**。ただしイントロ非表示中に標準のDOM更新が走るため、カスタムの再描画（`onb_ext_create` 等）までの間だけ標準判定のクラスが残る。イントロは通常閉じているため実害なし |

### 実装条件（カスタム顧客への影響をゼロにするため）

- **`complete_goals` / `display_goals` の書き込みタイミングは変えない**。
  「最終ステップ表示」は新キー（例 `onb_last_step_displayed_goals_{tourID}`）に記録する
  → `prod/28` のゴール出し分け、自動表示条件「完了済み」、公開API `getIncompleteGoalIds()` がすべて不変
- **進行中のイントロDOM更新は、設定が「最終ステップ表示」のときだけ実行する**
  → 既定値（ゴールを開いたとき）の顧客では新しいDOM操作が一切走らない
