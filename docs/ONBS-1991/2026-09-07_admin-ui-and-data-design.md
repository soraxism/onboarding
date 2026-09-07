# ONBS-1991 設計案: 管理画面UI / データ設計 / 実装方針

前提となる現状調査は [2026-09-07_current-behavior-survey.md](./2026-09-07_current-behavior-survey.md) を参照。

---

## 1. 設定の粒度

| 案 | 内容 | 評価 |
|---|---|---|
| **ツアー単位（推奨）** | `steps_json_src.settings` に1つ持つ。ツアー内の全ゴールに適用 | イントロは1ツアーに1つで、チェックマークの意味がゴールごとに違うと利用者が混乱する。既存の `settings.styles.intro.checkmark`（色）もツアー単位で、粒度が揃う |
| ゴール単位 | 各 `goals[].` に持つ | 柔軟だがUI・データ・テストのコストが跳ね上がる。ゴールごとに基準が違うイントロは読み手に説明できない |
| プロダクト単位 | プロダクト設定に持つ | ツアーごとの出し分けができない。既存のガイド設定はツアー単位が原則 |

→ **ツアー単位**で進める。

---

## 2. 選択肢（値）の設計

要望は当初「開始時 / 終了時」の2択だが、追加要望「完了を最終ステップの表示にしたい」を踏まえると
「終了時」の定義が 2 つに割れる。

| 値 | ラベル案 | 付くタイミング | 実装難度 |
|---|---|---|---|
| `goal_started`（既定・現行） | ゴールを開いたとき | 1ステップ目の表示時（`display_goals` 記録時） | 変更なし |
| `last_step_displayed` | 最後のステップを表示したとき | 最終ステップの表示時 | 中（進行中のDOM更新が必要） |
| `goal_finished` | ゴールを完了したとき（「終了」ボタン押下） | `finish` 時（`complete_goals` 記録時） | 低（既存の `finish` → `setLauncher` で完結） |

### 推奨: 3択で出す

「終了時」を 1 つに絞ると、要望の「最終ステップ表示にしたい」と
「終了ボタンを押して初めて完了」のどちらかを切り捨てることになる。
実装上は `last_step_displayed` の追加が主で、`goal_finished` はほぼ既存挙動の流用なので、
3択にしても増分コストは小さい。

**2択に絞る場合**は、「終了時 = 最終ステップの表示時」と定義するのが要望に合致する
（＝ `goal_finished` を採用しない）。この場合、最終ステップを表示して × で閉じてもチェックが付く。

### ラベルに「完了」を使うかどうか

レポートの「完了数」は `completed` トラッキング（終了ボタン押下）で集計しており、
LS のチェック状態とは別物（調査ドキュメント §4）。
UIに「ゴール完了のタイミング」と出すとレポートの完了率が変わると誤解されるため、
**「イントロのチェックマークを付けるタイミング」**という表現に寄せることを推奨する。

---

## 3. 管理画面UI: 配置案

### 案1（推奨）: ツアーのデザイン設定モーダル → 「イントロ」タブ → 「チェックマーク」セクション

- 対象ファイル: `app/components/ui/UiGuideEditStylesSettingTour.vue`
  - タブ定義 `tabList: ['ランチャー', 'イントロ', 'ステップ']`（L809）
  - 「チェックマーク」セクション（L333-386）に**背景色の設定が既にある**
- 既存セクションに「チェックマークを付けるタイミング」ラジオを追加する
- 併せて、現在の補足文「設定した背景色は表示済みゴールのチェックマークにのみ適用されます」（L369）を
  新仕様に合わせて修正する
- プレビュー（`UiGuideEditStylesSettingIntroPreview.vue`）はチェック済み/未チェックの見本を出しているだけなので変更不要

**利点**: 利用者が「チェックマークの設定」を探す場所と一致する。保存経路（`tourStylesUpdate`）を流用でき、
モーダル1回の保存で完結する。
**欠点**: モーダルの名前が「表示スタイル」であり、挙動設定が混ざる。

```
[ツアー] 表示スタイル設定
 ┌ ランチャー │ イントロ │ ステップ ─────────────────┐
 │ チェックマーク                    [デフォルトに戻す] │
 │  背景色            [■ #46a6ff ]                     │
 │                                                      │
 │  チェックマークを付けるタイミング                    │
 │   ○ ゴールを開いたとき（既定）                       │
 │   ○ 最後のステップを表示したとき                     │
 │   ○ ゴールを完了したとき（「終了」ボタン押下）       │
 │   ※ ランチャーの未完了バッジの数も同じ基準で数えます │
 └──────────────────────────────────────────────────────┘
```

### 案2: イントロウィジェットのオプションパネルに「イントロ設定」を新設

- 現在イントロ選択時のオプションパネルは「ゴール設定」「カテゴリ設定」のみ
  （`app/components/layouts/TheGuideEditOptionTour.vue`）
- 「イントロ設定」パネルを新設して置く
- **利点**: 挙動設定として意味論が正しく、保存先も `settings.intro` に素直に置ける
- **欠点**: 新規コンポーネント + 新規WSルートが必要で工数が最大。
  チェックマークの色が別画面（デザイン設定）にあるため、設定が2箇所に分散する

### 案3: ツアー詳細ページ（`app/pages/tours/detail/[id].vue`）のツアー設定に置く

- **欠点**: チェックマークとの距離が遠く発見されにくい。詳細ページは公開設定・ターゲット等の
  「配信」の話が中心で、表示挙動の設定を置く前例がない

→ **案1を推奨**。設定の分散を避けられ、既存の保存経路に載る。

---

## 4. データ保存先

`settings` のキーはそのまま配信APIの `opt` に載る（調査ドキュメント §6）。

| 案 | 保存パス | onboarding-web からの参照 | 必要な保存経路 |
|---|---|---|---|
| **A（推奨）** | `settings.styles.intro.checkmarkTiming` | `opt.styles.intro.checkmarkTiming` | 既存 `tourStylesUpdate` をそのまま利用（**API側の変更ゼロ**） |
| B | `settings.intro.checkmark_timing` | `opt.intro.checkmark_timing` | 新規WSルート（`route_introCheckmarkTimingUpdate.py` + `function.yml` 追記 + 管理画面の送信/受信ハンドラ） |
| C | `settings.checkmarkTiming` | `opt.checkmarkTiming` | 同上（新規WSルート） |

### 案Aの注意点（必須）

`styles.intro.checkmark` 配下は **`el.style[key] = value` に流し込まれる**
（`onboarding-web/src/domain/tour/TourDialogs.ts:54-59`）。
`checkmark` の**直下**に挙動キーを追加すると `el.style['checkmarkTiming']` への代入が発生するため、
必ず `styles.intro` 直下（`checkmark` の兄弟）に置くこと。

```json
"styles": {
  "intro": {
    "checkmark": { "background-color": "#46a6ff" },
    "checkmarkTiming": "goal_started"
  }
}
```

### 設計としての正しさ vs 工数

意味論では B（挙動は `settings.intro`）が正しい。一方 UI を案1（デザイン設定モーダル）に置くと、
モーダルの保存ボタン1つで styles と intro の**2系統のWSを投げる**ことになり保存の原子性が崩れる
（片方だけ失敗しうる）。UI位置とデータ位置は揃えるのが素直なので、

- **案1 + A** … 工数最小・保存は1トランザクション（推奨）
- 案2 + B … 設計はきれい・工数最大

の2ペアで判断する。

### 既定値と後方互換

- 既存ツアーの `steps_json_src` にキーは存在しない。**未定義は `goal_started`（現行挙動）として扱う**
- `onboarding-api` 側は `settings` をそのまま流すだけなので変更不要
- 配信JSONスキーマ（`onboarding-manage-api/api/rest/functions/mng-v1-steps-json/steps_json_schema.json`）は
  `settings` を `{"type": "object"}` としか定義していないため**変更不要**
- 新規ツアーのテンプレート（`api/rest/initial-data/tour/steps_preview.json`）に既定値を入れるかは任意。
  入れる場合は `settings.styles.intro` に追加する
- ツアーコピー（`api/rest/functions/mng-v1-tours-copy/method_post.py`）は `settings` を丸ごと引き継ぐため対応不要

---

## 5. onboarding-web 側の実装方針

### 5-1. チェック判定の分岐（必須）

`STANDSUnit.setLauncher()`（`src/onboarding-init.ts:653-673`）のチェック済み配列の算出を設定で分岐する。

```
checked_goals_ids がある                     → 現行どおり最優先（顧客カスタム）
timing = goal_started（既定）                → complete ∪ display（現行）
timing = last_step_displayed                 → complete ∪ last_step_displayed
timing = goal_finished                       → complete のみ
```

バッジ数（`src/onboarding-init.ts:717-720`）は同じ配列を使うため自動的に追従する。

### 5-2. 「最終ステップ表示」の記録（`last_step_displayed` を採用する場合）

- `STANDSMotion.stepShow`（`src/stands.onbd.ts:830-870`）で、表示中ステップが最終ステップかを判定して記録する
  - 判定式は `StepExecutor` に前例がある: `runtime.startIndex + 1 === tourOptions.steps.length`
    （`src/domain/step/StepExecutor.ts:536`）。`stepShow` では `step_data.index` とゴールの `steps.length` で判定する
- 記録先は新規LSキー `onb_last_step_displayed_goals_{tourID}` を追加する案を推奨
  - `complete_goals` に直接書くと、公開API `getIncompleteGoalIds()` / 自動表示条件「完了済み」/
    レポートの完了定義に波及する（調査ドキュメント §4 解釈B）
  - キーは `src/infrastructure/storage/constants.ts` の `LS_KEY_FACTORIES` に追加し、
    `LS_PREFIX`（`onb_`）配下なので `overwriteLocalStorage()` のリセット対象に自動で入る
- `adjustmentStorage()`（`src/onboarding-init.ts:731-751`）と同様に、削除済みゴールIDの掃除を追加する

### 5-3. 進行中のイントロDOM更新（`last_step_displayed` を採用する場合）

`modalTemplate` は文字列で、再生成しても**進行中の画面には反映されない**（調査ドキュメント §2）。
最終ステップを表示した瞬間にチェックを付けたい場合は、DOM を直接更新する。

```
document.querySelector('.stands-step-item[data-goalid="{goalId}"] .stands-step-item-nocheck')
  → クラスを stands-step-item-check に差し替え
```

- 色（`styles.intro.checkmark`）はイントロ表示時に毎回再適用されるため（`TourDialogs.ts:54-59`）追加対応は不要
- `setLauncher()` をツアー進行中に呼ぶ方法は、ランチャーの再マウントや `opt.goal` / `opt.steps` の
  再設定を伴うため副作用が大きく、非推奨

### 5-4. ゴール連結ありゴールの扱い（要判断）

連結設定があるゴールは最終ステップでも「次へ」で連結先に進む（調査ドキュメント §3）。
`last_step_displayed` では「まだ続きがあるのに完了チェックが付く」状態になる。

- 案i: 仕様として許容する（実装が単純）
- 案ii: 連結ありゴールは `goal_finished` 相当にフォールバックする（挙動の説明が難しくなる）

→ 案i（許容）を推奨。イントロ上は「そのゴールのステップは見終えた」ことを示すため、業務的な破綻は小さい。

---

## 6. 変更対象ファイル（案1 + A を選んだ場合）

| リポジトリ | ファイル | 変更内容 |
|---|---|---|
| onboarding-manage-web | `app/components/ui/UiGuideEditStylesSettingTour.vue` | イントロタブにラジオ追加 / `defaultStyles.intro` に既定値 / `onSave` のペイロードに追加 / 補足文の修正 |
| onboarding-manage-web | 同上（`onClickDefaultIntroCheckmark`） | 「デフォルトに戻す」でタイミングも既定へ戻すか要判断 |
| onboarding-manage-web | `app/store/tour.ts`（`updateStyles`） | 変更不要（styles を丸ごと差し替えるため） |
| onboarding-manage-api | — | **変更不要**（`tourStylesUpdate` が styles を丸ごと保存） |
| onboarding-api | — | **変更不要**（`settings` をそのまま配信） |
| onboarding-web | `src/onboarding-init.ts` | `setLauncher()` のチェック判定分岐 / `adjustmentStorage()` の掃除追加 |
| onboarding-web | `src/stands.onbd.ts` | `stepShow` に最終ステップ記録を追加 + イントロDOMの直接更新 |
| onboarding-web | `src/infrastructure/storage/constants.ts` | 新規LSキーの追加 |
| onboarding-web | `src/types/tour-options.d.ts` | `styles.intro` の型に追加 |
| onboarding-web | `tests/unit/onboarding-init.test.ts` ほか | 判定分岐のケース追加 |
| onboarding-e2e-test | `tests/common/intro/goalDisplayed.js` / `goalCompleted.js` | 既定値が現行維持ならそのまま通る。「終了時」シナリオを追加 |
| onboarding-web | `docs/spec/01_initialization.md` / `16_core-engine.md` / `15_customer-customization.md` | 仕様書の更新 |

---

## 7. 確認が必要な事項

1. **選択肢は2択か3択か**（「終了時」を「最終ステップ表示」と定義するか、「終了ボタン押下」と分けるか）
2. **要望の「ゴール完了」は表示上のチェックマークだけか、レポートの完了数も含むか**
   （後者ならレポート数値が変動する。調査ドキュメント §4 解釈B）
3. **既定値は現行維持（ゴール開始時）でよいか** — 既存ツアーの見え方を変えないため推奨
4. **UI配置とデータ保存先のペア**（案1+A = 工数最小 / 案2+B = 設計優先）
5. **ゴール連結ありゴールで「最終ステップ表示＝チェック」を許容するか**
6. **顧客個別カスタム（`src/customize/prod/65`・`7738`・`7740`・`13` など）を標準機能へ寄せるか**
   — 特に `prod/65` は `setCheckedGoalIds()` を使っており、新設定より優先されるため効かない
7. **旧実装 `src/js/` 側にも同時反映が必要か**（現行は `src/` の TS 実装）
