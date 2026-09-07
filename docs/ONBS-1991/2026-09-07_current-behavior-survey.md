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
| トラッキング（レポート集計） | LS非依存。`completed` イベント送信 | `finish` 時のみ送信（`src/stands.onbd.ts:1216-1221`） |

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
仕様として許容するか、連結ありゴールは対象外にするかの判断が必要。

---

## 4. 「ゴール完了を最終ステップの表示にしたい」の影響

要望の解釈が 2 通りあり、影響範囲が大きく変わる。

### 解釈A: イントロのチェックマークだけを最終ステップ表示時に付ける（表示上の完了）

- 変更対象は `setLauncher()` の判定と、進行中の DOM 更新のみ
- トラッキング（レポートの完了数）・自動表示条件・公開APIは**一切変わらない**
- LS は現状のキーを維持したまま、「最終ステップを表示したゴールID」を持つ新キー
  （例 `onb_last_step_displayed_goals_{tourID}`）を追加するか、判定時にステップindexから導出する
- ツアー進行中にチェックを付けるには、`stepShow` の中で
  `.stands-step-item[data-goalid="X"]` 配下のクラスを `-nocheck` → `-check` に差し替える処理が必要
  （`modalTemplate` の再生成だけでは進行中の画面に反映されない）

### 解釈B: 「完了」そのものを最終ステップ表示に変える（トラッキング含む）

- `complete_goals` の書き込みを `finish` から `stepShow`（最終ステップ）に移す
- `completed` トラッキングも同時に移すと、**レポートの「完了数 / 完了率」が跳ね上がる**
  （終了ボタンを押さず離脱したユーザーも完了に数えられる）。過去データとの比較が壊れる
- 移さない場合、LS の完了とレポートの完了が食い違い、自動表示条件「完了済み」とレポートが一致しなくなる
- 公開API `getIncompleteGoalIds()` の返り値も変わるため、顧客側スクリプトの挙動が変わる可能性がある

**推奨**: 解釈A（表示上の完了のみ）に閉じる。レポート定義には手を入れない。
「完了」という語をUIに出すとレポートとの不整合が誤解を生むため、
管理画面のラベルは「チェックマークを付けるタイミング」に寄せる（詳細は UI 設計ドキュメント）。

---

## 5. 影響を受ける既存機能・資産の一覧

| 対象 | 内容 | 影響 |
|---|---|---|
| ランチャーのバッジ数 | チェック判定と同じ配列を参照（`src/onboarding-init.ts:717-720`） | タイミング設定に連動して数字が変わる。仕様として明示が必要 |
| 公開API `setCheckedGoalIds()` | `onb_checked_goals_ids` があると**タイミング設定より優先**される（`src/onboarding-init.ts:655-660`） | このAPIを使っている顧客では新設定が効かない。仕様として明記が必要 |
| クライアント個別カスタムJS | `src/customize/prod/65/makeup_preview.js`（独自 finish で complete 書き込み + `setCheckedGoalIds`）、`src/customize/prod/7738`・`7740`・`13`（display_goals ベースで「確認済み/未確認」表示を自前実装）、`prod/28`・`23`・`722`・`957`・`982`・`999` | **今回の機能は、これら個別対応の標準化にあたる**。既存カスタムと二重制御になるため、標準機能に寄せるかカスタムを残すかを顧客ごとに判断する |
| E2Eテスト | `onboarding-e2e-test/tests/common/intro/goalDisplayed.js:132-165`（**ゴールを開いて中断 → チェックが付く**ことを検証）、`goalCompleted.js:154` | デフォルト値を現行維持（開始時）にすれば `goalDisplayed.js` はそのまま通る。「終了時」用のシナリオを追加する |
| ユニットテスト | `tests/unit/onboarding-init.test.ts:1069,1218,1526`、`tests/unit/stands.onbd.test.ts:2674,2693,2830,4090`、`tests/unit/domain/auto-display/ConditionChecker.test.ts` | 判定分岐の追加に伴いケース追加が必要 |
| 旧実装（`src/js/`） | `src/js/onboarding-init.js:529-540`、`src/js/stands.onbd.js:758-766,1111-1119` に同じロジックが残存 | TS移行済みの `src/` が現行。旧実装への同時反映が必要か要確認（`docs/knowledge/2026-05-28_onbs-1748-newside-dual-edit.md` 参照） |
| 仕様書 | `docs/spec/01_initialization.md:249`（setLauncher の処理フロー）、`docs/spec/16_core-engine.md:443-444`、`docs/spec/15_customer-customization.md:201-202` | 実装後に更新が必要 |

---

## 6. 参考: データフロー全体

```
管理画面 (onboarding-manage-web)
  steps_json_src.settings.*
        │ WebSocket（例: tourStylesUpdate / introCoverUpdate）
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
