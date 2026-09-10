# ONBS-1991 設計案: 管理画面UI / データ設計 / 実装方針

前提となる現状調査は [2026-09-07_current-behavior-survey.md](./2026-09-07_current-behavior-survey.md) を参照。

---

## 0. 決定事項（2026-09-08）

| 項目 | 決定 |
|---|---|
| 選択肢 | **2択**（「ゴールを開いたとき」/「最後のステップを表示したとき」）。終了ボタン押下は選択肢に含めない |
| 変更範囲 | **イントロのチェックマークのみ**。レポート集計・自動表示条件・公開APIには手を入れない |
| 既定値 | **「ゴールを開いたとき」**（現行挙動を維持） |
| ゴール連結ありゴール | 「まだ次へ続くのに完了になる」挙動を**許容する** |
| 顧客個別カスタム | **標準機能には寄せない**。標準実装がカスタムを壊さないことを確認済み（調査ドキュメント §8） |
| リリース | 管理画面・エディタ拡張機能・onboarding-web を**同時リリース** |
| 設定の粒度 | ツアー単位（§1） |
| UI配置 / 保存先 | 案1 + 案A（§3 / §4）。管理API `intro-style` の部分更新化が必須 |
| 設定切替時の引き継ぎ | **許容する**（移行処理は入れない）。終了ボタンを押したゴールは論理和判定で維持される（§5-2-1、調査ドキュメント §7） |
| 旧実装（`src/js/`） | **同時反映する**。features フラグ `use_refactored_onboarding_init` 未設定のプロダクトは旧版が配信されるため（§5-6） |
| 新規ツアーのテンプレート | **既定値を入れる**（`steps_preview.json` の `settings.styles.intro`。ポップアップ用テンプレートは `styles.intro` を持たないため対象外） |
| 「デフォルトに戻す」の挙動 | **背景色だけを戻す現状の挙動を維持する**（タイミングは戻さない） |
| 入力部品 | **カード型ラジオの縦並び**（`ui-radio` の `componentType="cardVertical"`。本対応で追加したバリアント）。§3 |
| バッジ連動の注記 | **UIには書かない**。未完了ゴール数の表示自体があまり使われておらず注記がノイズになるため（仕様としては連動する） |

### レポート集計との関係（裏取り済み）

レポートの「ゴール完了」は**既に最終ステップの表示で集計されている**
（`onboarding-batch/src/report_goal_details/functions/aggregate.py:316-317`。詳細は調査ドキュメント §4）。
したがって本対応は、**イントロのチェックマークをレポートの完了定義に一致させる**変更にあたる。
`completed` トラッキングイベントは集計に使われていないため、レポートの数値は変わらない。

---

## 1. 設定の粒度

| 案 | 内容 | 評価 |
|---|---|---|
| **ツアー単位（推奨）** | `steps_json_src.settings` に1つ持つ。ツアー内の全ゴールに適用 | イントロは1ツアーに1つで、チェックマークの意味がゴールごとに違うと利用者が混乱する。既存の `settings.styles.intro.checkmark`（色）もツアー単位で、粒度が揃う |
| ゴール単位 | 各 `goals[].` に持つ | 柔軟だがUI・データ・テストのコストが跳ね上がる。ゴールごとに基準が違うイントロは読み手に説明できない |
| プロダクト単位 | プロダクト設定に持つ | ツアーごとの出し分けができない。既存のガイド設定はツアー単位が原則 |

→ **ツアー単位**で進める。

---

## 2. 選択肢（値）の設計 — 2択で確定

| 値 | ラベル（確定） | 付くタイミング |
|---|---|---|
| `goal_started`（**既定**・現行挙動） | ゴールの表示（いずれかのステップが表示） | 1ステップ目の表示時（`display_goals` 記録時） |
| `last_step_displayed` | ゴールの完了（最後のステップが表示） | 最終ステップの表示時（レポートの完了集計と同一基準） |

- 「終了ボタン押下」（`finish`）は選択肢に含めない
- `last_step_displayed` では、**最終ステップを表示して × で閉じてもチェックが付く**
- ステップ分岐で最終ステップに到達しないルートを通った場合はチェックが付かない。
  レポートの完了集計も同じ基準（最終ステップの表示）なので、レポートとイントロの表示は一致する

### ラベルの表現

設定項目名は **「チェックマークを付けるタイミング」**、選択肢は
**「ゴールの表示（いずれかのステップが表示）」/「ゴールの完了（最後のステップが表示）」**。

- 「完了」という語はレポートの完了定義（最終ステップの表示）と一致するため、数値との矛盾は生じない（§0）
- 「表示」は LS キー `onb_display_goals_`（表示済みゴール）と、
  自動表示条件の選択肢「表示済み / 未表示」と用語が揃う
- 括弧内でどのステップが基準かを明示し、「開いた」「進めた」といった曖昧な表現を避ける

---

## 3. 管理画面UI: 配置案

### 案1（採用・実装済み）: ツアーのデザイン設定モーダル → 「イントロ」タブ → 「チェックマーク」セクション

- 対象ファイル: `app/components/ui/UiGuideEditStylesSettingTour.vue`
  - タブ定義 `tabList: ['ランチャー', 'イントロ', 'ステップ']`
  - 「チェックマーク」セクションに**背景色の設定が既にある**
- 既存セクションの下に inner-section を足し、「チェックマークを付けるタイミング」を置く
- **入力部品は `ui-radio` のカード型を縦並びにしたもの**（`componentType="cardVertical"`）。
  選択肢の文言が長く、フォーム欄の幅が 42% しかないため、他の部品では収まらなかった:

  | 試した部品 | 結果 |
  |---|---|
  | `ui-radio-group` | 横並び固定でラベルが折り返し、選択肢が潰れる |
  | `ui-select` | 1行に収まるが文言が幅で切れる。フォーム欄を広げるとプレビュー（`min-width: 450px`）がはみ出す |
  | `ui-radio`（従来レイアウト） | 縦並びになるが、ラベルが折り返すと 2 つ目の選択肢のインデントがずれる |
  | `ui-radio`（`card`） | カードが横並びで 1 枚あたりが狭く、4 行に折り返す |
  | **`ui-radio`（`cardVertical`）** | カードが縦に積まれて幅いっぱいになり、折り返しても各カード内でインデントが揃う |

  `cardVertical` は本対応で `UiRadio` に追加したバリアント（`c-radioCardGroup--vertical`）。
  カード型は選択状態が枠と背景色で分かるため、2 択の設定として視認性も高い
- 併せて、補足文「設定した背景色は表示済みゴールのチェックマークにのみ適用されます」を
  「設定した背景色はチェックマークが付いたゴールにのみ適用されます」に修正する
  （「表示済み」は旧仕様＝表示＝チェックの前提に基づく表現）
- **バッジ（未完了ゴール数）が連動する旨はUIに書かない**。未完了ゴール数の表示自体が
  あまり使われていない機能で、設定画面の注記としてはノイズになるため（仕様としては連動する）
- 「デフォルトに戻す」は**背景色だけを戻す現状の挙動を維持する**（タイミングは戻さない）。
  挙動設定が意図せず戻る事故を避けるため
- プレビュー（`UiGuideEditStylesSettingIntroPreview.vue`）はチェック済み/未チェックの見本を出しているだけなので変更不要

**利点**: 利用者が「チェックマークの設定」を探す場所と一致する。保存経路（`tourStylesUpdate`）を流用でき、
モーダル1回の保存で完結する。
**欠点**: モーダルの名前が「表示スタイル」であり、挙動設定が混ざる。

```
[ツアー] 表示スタイル設定
 ┌ ランチャー │ イントロ │ ステップ ─────────────────────┐
 │ チェックマーク                        [デフォルトに戻す] │
 │                                                          │
 │  背景色                                                  │
 │  # [ 46a6ff ] ■                                          │
 │  設定した背景色はチェックマークが付いたゴールにのみ      │
 │  適用されます                                            │
 │                                                          │
 │  チェックマークを付けるタイミング                        │
 │  ┌────────────────────────────────────┐                  │
 │  │ ◉ ゴールの表示（いずれかのステップ │                  │
 │  │   が表示）                         │                  │
 │  └────────────────────────────────────┘                  │
 │  ┌────────────────────────────────────┐                  │
 │  │ ○ ゴールの完了（最後のステップが   │                  │
 │  │   表示）                           │                  │
 │  └────────────────────────────────────┘                  │
 └──────────────────────────────────────────────────────────┘
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

**編集経路は管理画面とエディタ拡張機能の2つある**（詳細は §6）。保存先の選択はこの2経路の
上書き挙動に左右されるため、下表の「エディタ拡張機能側」列が判断の要になる。

| 案 | 保存パス | onboarding-web からの参照 | 管理画面側の保存経路 | エディタ拡張機能側 |
|---|---|---|---|---|
| **A（推奨）** | `settings.styles.intro.checkmarkTiming` | `opt.styles.intro.checkmarkTiming` | 既存 `tourStylesUpdate` をそのまま利用（**管理API変更なし**） | 既存 `PUT tours/{id}/intro-style` を利用。ただし**API側が `styles.intro` を丸ごと置換しているため部分更新への修正が必須**（§6-3） |
| B | `settings.intro.checkmark_timing` | `opt.intro.checkmark_timing` | 新規WSルート（`route_introCheckmarkTimingUpdate.py` + `function.yml` 追記 + 管理画面の送信/受信ハンドラ） | 新規RESTエンドポイントが必要（intro系APIは `cover` / `content_blocks` の部分更新のみで、**この経路では値が消えない**） |
| C | `settings.checkmarkTiming` | `opt.checkmarkTiming` | 同上（新規WSルート） | 同上（新規エンドポイント） |

### 案Aの注意点（必須）

**(1) `checkmark` の直下に置かないこと**

`styles.intro.checkmark` 配下は **`el.style[key] = value` に流し込まれる**
（`onboarding-web/src/domain/tour/TourDialogs.ts:54-59`）。
`checkmark` の**直下**に挙動キーを追加すると `el.style['checkmarkTiming']` への代入が発生するため、
必ず `styles.intro` 直下（`checkmark` の兄弟）に置くこと。

**(2) エディタ拡張機能の保存で値が消える（対応必須）**

エディタ拡張機能のチェック色変更は `PUT tours/{tour_id}/intro-style` を呼び、
管理API側が `step_json_src["settings"]["styles"]["intro"] = styles` と
**`styles.intro` を丸ごと置換する**
（`onboarding-manage-api/api/rest-ext-editor/functions/tours-tour-id-intro-style/method_put.py:53`）。
拡張機能が送るのは `{ checkmark: { 'background-color': ... } }` のみのため、
**管理画面で設定した `checkmarkTiming` は、拡張機能でチェック色を変えた瞬間に失われる**。

対応（両方行うこと）:
- 管理API側を部分更新に変更する（`styles["intro"]["checkmark"] = styles["checkmark"]` の形にし、
  受け取ったキーのみ上書きする）。既存の cover 更新は既に部分更新であり、そちらに揃える形になる
- 拡張機能側の送信ペイロードにも `checkmarkTiming` を含める（受信 API を直せない期間の保険）

管理画面側の `tourStylesUpdate` は `settings["styles"]` を丸ごと置換するが、
管理画面のデザイン設定モーダルは styles 全体を組み立てて送るため、
新キーを `onSave` のペイロードに追加すれば消えない。

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

- **案1 + A** … 工数最小・保存は1トランザクション。ただし**拡張機能APIの部分更新化が必須条件**（推奨）
- 案2 + B … 設計はきれい・上書き消失のリスクなし。管理画面と拡張機能の**両方に新規エンドポイントが必要**で工数最大

の2ペアで判断する。案Aの必須条件（管理API `intro-style` の部分更新化）は、
それ自体が既存の潜在バグ（拡張機能で色を変えると styles.intro の他キーが消える構造）の修正にあたるため、
案Aを選んでも捨て仕事にはならない。

### 既定値と後方互換

- 既存ツアーの `steps_json_src` にキーは存在しない。**未定義は `goal_started`（現行挙動）として扱う**
- `onboarding-api` 側は `settings` をそのまま流すだけなので変更不要
- 配信JSONスキーマ（`onboarding-manage-api/api/rest/functions/mng-v1-steps-json/steps_json_schema.json`）は
  `settings` を `{"type": "object"}` としか定義していないため**変更不要**
- 新規ツアーのテンプレート（`api/rest/initial-data/tour/steps_preview.json`）の
  `settings.styles.intro` に既定値を**入れる**（決定）。
  `set_default_tour_styles()`（古いデータの styles 補完）もこのテンプレートを読むため、補完経路にも効く
- ツアーコピー（`api/rest/functions/mng-v1-tours-copy/method_post.py`）は `settings` を丸ごと引き継ぐため対応不要

---

## 5. onboarding-web 側の実装方針

### 5-1. チェック判定の分岐（必須）

`STANDSUnit.setLauncher()`（`src/onboarding-init.ts:653-673`）のチェック済み配列の算出を設定で分岐する。

```
checked_goals_ids がある                     → 現行どおり最優先（顧客カスタム）
timing = goal_started（既定・未設定時）      → complete ∪ display（現行と完全に同一）
timing = last_step_displayed                 → complete ∪ last_step_displayed
```

- `complete_goals` との**論理和は必須**。単独にすると過去に完了したゴールのチェックまで外れる
  （調査ドキュメント §7）
- `finish` は最終ステップ表示の後にしか発火しないため、新実装後は
  `complete_goals ⊆ last_step_displayed_goals` が成り立ち、論理和にしても不整合は生じない
- バッジ数（`src/onboarding-init.ts:717-720`）は同じ配列を使うため自動的に追従する

### 5-2. 「最終ステップ表示」の記録

**`complete_goals` / `display_goals` の書き込みタイミングは変えない。** 新規キーに記録する
（`prod/28` のゴール出し分け・自動表示条件「完了済み」・公開API `getIncompleteGoalIds()` を不変に保つため。
調査ドキュメント §8）。

- 記録先: 新規LSキー `onb_last_step_displayed_goals_{tourID}`
  - `src/infrastructure/storage/constants.ts` の `LS_KEY_FACTORIES` に追加。
    `LS_PREFIX`（`onb_`）配下なので `overwriteLocalStorage()` のリセット対象に自動で入る
- 書き込み位置: `STANDSMotion.stepShow`（`src/stands.onbd.ts:830-870`、`display_goals` の保存処理の直後）
- 判定式: `step_data.index === getGoalObj(goal_data.id).steps.length`
  → **レポートの完了集計（`step_index == total_steps`）と同一基準**（調査ドキュメント §4）
- **設定値に関わらず常に記録する**（既定値の顧客でも記録する）
  - 理由: 顧客が後から設定を切り替えたときに、切替前の到達履歴を引き継げる（調査ドキュメント §7 案2）
  - 書き込みは最終ステップ表示時の1回のみで、毎ステップではない
- `adjustmentStorage()`（`src/onboarding-init.ts:731-751`）と同様に、削除済みゴールIDの掃除を追加する

### 5-2-1. 設定切替時の引き継ぎ（仕様として明記が必要）

過去に「最終ステップを表示したが終了ボタンを押していない」状態はLSに記録がなく、遡って復元できない
（`iGuider_data-{tourID}` は `finish` / `abort` で削除されるため使えない。調査ドキュメント §7）。
**この欠落は許容する方針で決定済み**（移行処理は入れない）。

- 終了ボタンまで押したゴール → `complete_goals` に残っているのでチェックは**維持される**
  - **論理和判定（5-1）が維持の前提**。`last_step_displayed` 単独にすると維持されない
  - 維持されない例外はいずれも LS 自体が失われるケースで、現行実装でも同じ:
    ブラウザのデータ削除 / シークレットウィンドウ / 別端末・別ブラウザ・別オリジン /
    第三者スクリプトによる `localStorage.clear()` /
    プレビュー起動・停止時の `overwriteLocalStorage()`（`onb_` プレフィックスをリセット）
  - 顧客カスタムが独自に `complete_goals` へ書き込んでいる場合（`src/customize/prod/65`）も論理和で維持される
  - `setCheckedGoalIds()` を使う顧客では `checked_goals_ids` が最優先されるため、そもそも新設定の判定に入らない
- 最終ステップを表示して × で閉じたゴール → 記録がないため**チェックが外れる**
- 5-2 の「常に記録する」を入れておけば、リリース後に発生した到達分は設定切替前から蓄積される
- 「開いたとき」へ戻す場合は `display_goals` を記録し続けているため**いつでも戻せる**

### 5-6. 旧実装（`src/js/`）への同時反映

配信される JS は features フラグ `use_refactored_onboarding_init` で新旧が切り替わり、
**フラグ未設定のプロダクトには旧版（`js/onboarding-init.js`）が配信される**
（`onboarding-api/src/functions/v1/onboarding-init/handler.py:26-28,45-70`）。
旧側にも実装しないとフラグ未設定の顧客に機能が届かないため、**同時反映する**。

| 旧側の変更箇所 | 内容 | 新側の対応 |
|---|---|---|
| `src/js/onboarding-init.js:527-560`（`setLauncher`） | チェック判定の分岐 | `src/onboarding-init.ts:653-673` |
| `src/js/onboarding-init.js`（`adjustmentStorage`） | 削除済みゴールIDの掃除 | `src/onboarding-init.ts:731-751` |
| `src/js/stands.onbd.js:760-770`（`stepShow`） | 最終ステップ表示の記録 + 進行中のDOM更新 | `src/stands.onbd.ts:858-870` |
| `src/js/stands.onbd.js:1111-1119`（`finish`） | 変更なし（`complete_goals` の書き込みは維持） | `src/stands.onbd.ts:1200-1212` |

- 旧側は LS キーがハードコード文字列で、定数化されていない（`'onb_display_goals_' + tour_id` の形）。
  旧側の流儀に合わせ、**定数化などのリファクタは行わない**（dual-edit の禁則。
  `onboarding-web/docs/knowledge/2026-05-28_onbs-1748-newside-dual-edit.md`、
  `.claude/skills/dual-edit/SKILL.md`）
- **`Onboarding-Html-Template` は変更不要**。旧側のイントロHTML生成は同パッケージ
  （`main/index.js:170-176`）だが、`isCheck` を引数で受け取るだけで判定は持たない
  （新側は `src/onboarding-init.ts:47-57` にインライン化済み）

### 5-3. 進行中のイントロDOM更新

**設定が `last_step_displayed` のときだけ実行する**（既定値の顧客では新しいDOM操作を一切走らせない。
顧客カスタムへの影響をゼロにするための条件。調査ドキュメント §8）。

`modalTemplate` は文字列で、再生成しても**進行中の画面には反映されない**（調査ドキュメント §2）。
最終ステップを表示した瞬間にチェックを付けたい場合は、DOM を直接更新する。

```
document.querySelector('.stands-step-item[data-goalid="{goalId}"] .stands-step-item-nocheck')
  → クラスを stands-step-item-check に差し替え
```

- 色（`styles.intro.checkmark`）はイントロ表示時に毎回再適用されるため（`TourDialogs.ts:54-59`）追加対応は不要
- `setLauncher()` をツアー進行中に呼ぶ方法は、ランチャーの再マウントや `opt.goal` / `opt.steps` の
  再設定を伴うため副作用が大きく、非推奨

### 5-4. ゴール連結ありゴールの扱い（許容で決定）

連結設定があるゴールは最終ステップでも「次へ」で連結先に進む（調査ドキュメント §3）。
`last_step_displayed` では「まだ続きがあるのに完了チェックが付く」状態になるが、**許容する**。
レポートの完了集計も同じ基準（最終ステップの表示）なので、レポートとイントロの表示は一致する。

### 5-5. ポップアップの扱い（実装時の注意）

ポップアップは内部的にゴール1件・ステップ1件で、`stepShow` が呼ばれた時点で
「最終ステップの表示」条件を満たす。`introDisplay = false` のためイントロ一覧には出ないが、
**ランチャーのバッジ数はポップアップも含めて数えている**（`goals` にポップアップが merge される。
調査ドキュメント §2）。

`goal_started` でも `last_step_displayed` でも、ポップアップは「表示した時点でカウントされる」点は
変わらないため既存挙動と差は出ないが、実装時に取り違えないよう確認する。

---

## 6. エディタ拡張機能（Onboarding-Editor-Extension）側の実装

**ツアーのイントロは管理画面と拡張機能の両方で編集でき、チェックマークの設定（色）は既に両方に存在する。**
片方だけに実装すると、拡張機能で編集する顧客はタイミングを変更できず、
さらに §4 の上書き消失が起きるため、**拡張機能側の実装は必須**。

### 6-1. 現在のチェックマーク設定UI（拡張機能）

拡張機能のイントロ編集は実物を模したWYSIWYGで、ゴール一覧（TaskList）を選択すると
インラインメニューが開き、そこに「チェック色」がある。

| 役割 | ファイル |
|---|---|
| インラインメニュー本体（「チェック色」ボタンがある = **追加先**） | `vue-app/components/Common/TaskListMenu/index.vue` |
| ゴール一覧要素（メニューを開き、`update:checkmarkColor` を emit） | `vue-app/components/Domain/Element/TaskList/index.vue:24,114` |
| イントロモーダル本体（emit中継） | `vue-app/components/Domain/Content/Intro/Modal/Body.vue:81,266-267` |
| イントロ画面（`changeCheckColor` に接続、`tour.checkmarkStyle` を渡す） | `vue-app/components/Domain/Content/Intro/index.vue:138,175` |
| 状態更新 + API呼び出し（`changeIntroCheckmarkColor`） | `vue-app/composables/useGuide/tour.ts:28-30,58-78` |
| APIクライアント（`PUT tours/{id}/intro-style`） | `vue-app/composables/useServices/modules/v2/tours.ts:570-592` |
| 型定義（`Settings.Styles.intro` / `UpdateIntroStyle`） | 同上 `:149-160`, `:349-358` |
| ダミーデータ | `vue-app/constants/v2/dummies.ts:216,500` |
| ユニットテスト | `tests/unit/vue-app/composables/useGuide/tour.test.ts:53-88` |

emit が UI から composable まで4段（`TaskListMenu` → `TaskList` → `Modal/Body` → `Intro/index`）で
中継されているため、**イベントを1つ増やすと4ファイルすべてに追記が必要**。

### 6-2. 拡張機能に必要な変更（案1 + A の場合）

1. `Common/TaskListMenu/index.vue` に「チェックのタイミング」の選択UIを追加（`CommonColorBtn` の隣）
2. `Domain/Element/TaskList/index.vue` / `Domain/Content/Intro/Modal/Body.vue` /
   `Domain/Content/Intro/index.vue` に emit・props を中継追加
3. `composables/useGuide/tour.ts`
   - getter を追加（`checkmarkTiming`）
   - `changeIntroCheckmarkTiming()` を追加（`changeIntroCheckmarkColor` と同型）
   - **`changeIntroCheckmarkColor` / `changeIntroCheckmarkTiming` の両方で、
     送信ペイロードに `checkmark` と `checkmarkTiming` の両方を含める**（§4 の上書き消失対策）
4. `composables/useServices/modules/v2/tours.ts` の型 2 箇所に追加
5. `constants/v2/dummies.ts` のダミーに追加
6. `tests/unit/vue-app/composables/useGuide/tour.test.ts` にケース追加

### 6-3. 管理API（rest-ext-editor）に必要な変更

`api/rest-ext-editor/functions/tours-tour-id-intro-style/method_put.py`

- L53 `step_json_src["settings"]["styles"]["intro"] = styles` を**部分更新**に変更
  （受け取ったキーのみ上書き。`checkmark` だけの旧クライアントからのリクエストでも
  `checkmarkTiming` が保持されるようにする）
- バリデーション（L38-41）は現在 `styles.get("checkmark") is None` で400を返す。
  タイミングのみを送るリクエストを許すかどうかで条件を調整する
  （`validate_put.json` は `styles` を dict 型としか見ていないため変更不要）
- 参考: cover 更新（`tours-tour-id-intro-cover-image/method_put.py:104-105`）は
  `intro["cover"] = cover` の部分更新になっており、こちらが本来の形

### 6-4. 影響しないもの（確認済み）

- **エディタ拡張機能のビューワー向けAPI**（`api/rest-ext-viewer`）は認証系のみで、ツアー設定は扱わない
- **拡張機能のツアー取得**（`api/rest-ext-editor/functions/tours-tour-id/method_get.py`）は
  `steps_json_src` をそのまま返すため、新キーは自動的に拡張機能へ届く（変更不要）
- **intro系のその他API**（`intro-blocks` / `intro-block-sort` / `intro-item-sort` /
  `intro-blocks-block-id`）はいずれも `content_blocks` の部分更新で、`settings.intro` を置換しない
- **`launcher-style` / `step-style`** も配下を丸ごと置換するが、
  クライアントが該当ブロック全体を送るため今回の追加では問題にならない
- 古いデータの styles 補完（`common.set_default_tour_styles`、
  `onboarding-manage-api/api/rest/layers/python/lib/common.py:2688-2704`）は
  `initial-data/tour/steps_preview.json` の styles をコピーする。
  テンプレートに既定値を入れる場合はここにも効く

---

## 7. 変更対象ファイル（案1 + A を選んだ場合）

| リポジトリ | ファイル | 変更内容 |
|---|---|---|
| onboarding-manage-web | `app/components/ui/UiGuideEditStylesSettingTour.vue` | **実装済み**: イントロタブにセレクト追加 / `defaultStyles.intro.checkmarkTiming` / `data()` 初期化 / `onSave` のペイロードに追加 / 補足文の修正 |
| onboarding-manage-web | `spec/components/ui/UiGuideEditStylesSettingTour.spec.ts` | **実装済み**: data 初期化 2 件 + 保存 1 件を追加（計 90 件緑） |
| onboarding-manage-web | `stories/ui/UiGuideEditStylesSettingTour.stories.ts` | **実装済み**: イントロタブを開く story を 2 件追加（`IntroTab` / `IntroTabLastStepDisplayed`） |
| onboarding-manage-web | `onClickDefaultIntroCheckmark` | **変更しない**（背景色だけを戻す現状維持で決定） |
| onboarding-manage-web | `app/store/tour.ts`（`updateStyles`） | 変更不要（styles を丸ごと差し替えるため） |
| onboarding-manage-api | — | 管理画面用WS（`tourStylesUpdate`）は**変更不要**（styles を丸ごと保存するため） |
| onboarding-manage-api | `api/rest-ext-editor/functions/tours-tour-id-intro-style/method_put.py` | **`styles.intro` の丸ごと置換を部分更新に変更（必須）** / バリデーション条件の調整 |
| Onboarding-Editor-Extension | `vue-app/components/Common/TaskListMenu/index.vue` | タイミング選択UIを追加 |
| Onboarding-Editor-Extension | `vue-app/components/Domain/Element/TaskList/index.vue`<br>`vue-app/components/Domain/Content/Intro/Modal/Body.vue`<br>`vue-app/components/Domain/Content/Intro/index.vue` | emit / props の中継追加 |
| Onboarding-Editor-Extension | `vue-app/composables/useGuide/tour.ts` | getter + `changeIntroCheckmarkTiming()` 追加 / 送信ペイロードに両キーを含める |
| Onboarding-Editor-Extension | `vue-app/composables/useServices/modules/v2/tours.ts` | 型定義 2 箇所（`Settings.Styles.intro` / `UpdateIntroStyle`） |
| Onboarding-Editor-Extension | `vue-app/constants/v2/dummies.ts` | ダミーデータに追加 |
| Onboarding-Editor-Extension | `tests/unit/vue-app/composables/useGuide/tour.test.ts` | ケース追加 |
| onboarding-api | — | **変更不要**（`settings` をそのまま配信） |
| onboarding-web | `src/onboarding-init.ts` | `setLauncher()` のチェック判定分岐 / `adjustmentStorage()` の掃除追加 |
| onboarding-web | `src/stands.onbd.ts` | `stepShow` に最終ステップ記録を追加（設定値に関わらず常に記録）+ イントロDOMの直接更新（設定が `last_step_displayed` のときのみ） |
| onboarding-web | `src/infrastructure/storage/constants.ts` | 新規LSキーの追加 |
| onboarding-web | `src/types/tour-options.d.ts` | `styles.intro` の型に追加 |
| onboarding-web | `tests/unit/onboarding-init.test.ts` ほか | 判定分岐のケース追加 |
| onboarding-web（旧側） | `src/js/onboarding-init.js`（`setLauncher` / `adjustmentStorage`）<br>`src/js/stands.onbd.js`（`stepShow`） | **同時反映**（§5-6）。旧側の流儀に合わせ定数化等のリファクタはしない |
| onboarding-manage-api | `api/rest/initial-data/tour/steps_preview.json` | 新規ツアーテンプレートの `settings.styles.intro` に既定値を追加（`set_default_tour_styles()` の補完経路にも効く）。`steps_preview_for_popup.json` は `styles.intro` を持たないため対象外 |
| onboarding-e2e-test | `tests/common/intro/goalDisplayed.js` / `goalCompleted.js` | 既定値が現行維持なのでそのまま通る。「最後のステップを表示したとき」設定のシナリオを追加 |
| onboarding-web | `docs/spec/01_initialization.md` / `16_core-engine.md` / `15_customer-customization.md` | 仕様書の更新 |

---

## 8. 実装状況

### 完了: onboarding-manage-web（ブランチ `feature/ONBS-1991`）

| ファイル | 内容 |
|---|---|
| `app/components/ui/UiGuideEditStylesSettingTour.vue` | イントロタブの「チェックマーク」セクションにタイミングの選択（縦並びカードラジオ）を追加。`defaultStyles.intro.checkmarkTiming = 'goal_started'` / `data()` 初期化 / `save()` のペイロード / 背景色の補足文を修正 |
| `app/components/ui/UiRadio.vue` | `componentType="cardVertical"`（カードの縦並び）を追加 |
| `app/assets/sass/object/component/_radio.scss` | `.c-radioCardGroup--vertical`（`flex-direction: column`） |
| `spec/components/ui/UiGuideEditStylesSettingTour.spec.ts` | data 初期化 2 件（値あり / 値なしで既定）、保存 1 件（`intro.checkmarkTiming` が渡る）を追加 |
| `spec/components/ui/UiRadio.spec.ts` | `cardVertical` で縦並びクラスが付く / `card` では付かない の 2 件を追加 |
| `stories/ui/UiGuideEditStylesSettingTour.stories.ts` | `IntroTab` / `IntroTabLastStepDisplayed` を追加（`play` でイントロタブを開く） |
| `stories/ui/UiRadio.stories.ts` | `CardLayoutVertical` を追加。既存 `CardLayout` の説明が「縦並び」と実態（横並び）で食い違っていたので修正 |

検証: 型検査 0 件 / `npm run test:run` 517 ファイル・7622 件緑 / Storybook 撮影で描画確認済み。

### 完了: onboarding-manage-api（ブランチ `feature/ONBS-1991`、commit `07e239f1`）

| ファイル | 内容 |
|---|---|
| `api/rest-ext-editor/functions/tours-tour-id-intro-style/method_put.py` | `styles.intro` の丸ごと置換を部分更新へ変更（`setdefault` + `update`）。バリデーションを「`checkmark` と `checkmarkTiming` のどちらも無いときだけ 400」に緩め、タイミングのみの更新も通す |
| `api/rest/initial-data/tour/steps_preview.json` | `settings.styles.intro.checkmarkTiming` に既定値 `goal_started` を追加 |

- rest-ext-editor には pytest のテスト基盤が無いため、テストは追加していない
  （既存の流儀に合わせた）。部分更新の挙動は 3 パターン（旧クライアントの `checkmark` のみ /
  タイミングのみ / `styles.intro` が無い）で手元検証済み
- ポップアップ用テンプレート（`steps_preview_for_popup.json`）は `styles.intro` を持たないため対象外

### 完了: Onboarding-Editor-Extension（ブランチ `feature/ONBS-1991`、commit `195899d`）

| ファイル | 内容 |
|---|---|
| `vue-app/types/intro.ts`（新規）/ `types/index.ts` | `CheckmarkTiming`（`goal_started` / `last_step_displayed`） |
| `vue-app/constants/v2/defaultSettings.ts` | `DEFAULT_SETTINGS.INTRO.CHECKMARK_TIMING` |
| `vue-app/composables/useServices/modules/v2/tours.ts` | `Settings.Styles.intro.checkmarkTiming`（optional）/ `UpdateIntroStyle.Styles.checkmarkTiming`（必須） |
| `vue-app/composables/useGuide/tour.ts` | `checkmarkTiming` getter / `changeIntroCheckmarkTiming()` / 送信 payload を組み立てる `buildIntroCheckmarkStyles()` |
| `vue-app/components/Common/TaskListMenu/CheckmarkTimingBtn.vue`（新規） | タイミング選択ボタン（`CanvasMenu/FocusBtn.vue` と同じ `BasePopup` + `BasePanelWrapper` + `BasePulldown` の構成） |
| `TaskListMenu/index.vue` / `Element/TaskList/index.vue` / `Content/Intro/Modal/Body.vue` / `Content/Intro/index.vue` / `Content/Intro/taskLists.ts` | props / emit の中継とハンドラ接続 |
| `vue-app/constants/v2/dummies.ts` | ダミーデータに既定値 |
| `tests/unit/vue-app/composables/useGuide/tour.test.ts` | getter / 色変更時の両キー送信 / タイミング変更 / guide 未設定のケース |
| `docs/features/ONBS-1991.md`（新規） | 拡張機能側の仕様と注意点（同リポジトリの慣習に従い作成） |

検証: `npm run typecheck` エラー 0 / `npm test` 92 ファイル・914 件緑 / `npm run lint` 指摘なし。

**`changeIntroCheckmarkColor()` も背景色とタイミングの両方を送るようになった**（片方だけ送る実装に戻さないこと）。

### 未着手

| 対象 | 内容 |
|---|---|
| `onboarding-web` | 判定分岐・最終ステップ記録・進行中のDOM更新（新側 §5-1〜5-3 / 旧側 §5-6） |
| `onboarding-e2e-test` | 「最後のステップを表示したとき」設定のシナリオ追加 |
