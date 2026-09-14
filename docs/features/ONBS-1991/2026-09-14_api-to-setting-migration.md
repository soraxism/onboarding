# 公開API `setCheckedGoalIds()` から管理画面の設定へ移行する手順

ONBS-1991 で「チェックマークを付けるタイミング」を管理画面／エディタ拡張から設定できるようにした。
それ以前からチェック状態を公開APIで制御している顧客が、この設定へ移行する場合の手順をまとめる。

**移行しない（APIを使い続ける）場合、この文書の作業は不要。** 設定を変更しない限り挙動は変わらない。

---

## 前提: APIが設定より優先される

`setLauncher()` はイントロ一覧を組み立てる前に `onb_checked_goals_ids_{tourID}` を見る。

```js
if (onb_checked_goals_ids) {
    // 【API分岐】顧客が setCheckedGoalIds() で指定した集合をそのまま使う
    comps_goals = JSON.parse(onb_checked_goals_ids)
} else {
    // 【通常分岐】チェックマークのタイミング設定で判定する
}
```

値がある限りAPI分岐に入るため、**管理画面で設定を変えても効かない**。
この優先順位は ONBS-1991 以前からの仕様で、今回も変更していない。

関連API（`onboarding-web`）:

| 関数 | 実装 |
|---|---|
| `STANDSMotion.setCheckedGoalIds(goal_ids)` | `src/stands.onbd.ts:3125` / `src/js/stands.onbd.js:2829` |
| `STANDSMotion.clearCheckedGoalIds()` | `src/stands.onbd.ts:3131` / `src/js/stands.onbd.js:2835` |

いずれもエンジン内部からは呼ばれていないカスタマイズ専用API。プレビュー拡張向けに
`src/embed/windowAdapter.ts` が同名のブリッジを持つ。

---

## 移行で起きる問題

### 1. 呼び出しをやめただけでは設定が効かない

LocalStorage は永続で、sync ドメインの写しからも復元される。
**先方のコードから呼び出しを外しても、既存エンドユーザーのブラウザにはキーが残り続ける。**

`adjustmentStorage()` は `onb_complete_goals_` と `onb_last_step_displayed_goals_` から
存在しないゴールIDを剪定するが、**`onb_checked_goals_ids_` は対象外**。自動で消える経路はない。

### 2. 最後に書かれた値で凍結する

キーが残ると、**最後に `setCheckedGoalIds()` へ渡した集合が固定**される。

| 呼び出しパターン | 凍結後の見え方 |
|---|---|
| `setCheckedGoalIds([])` | **全ゴールが未チェックのまま固定**。進めてもチェックが付かない |
| `setCheckedGoalIds(完了ゴール)` | その時点でチェックが止まり、以後増えない |

「設定が効かない」だけでなく**進捗が反映されなくなる**方向に壊れるため、
エンドユーザーからは不具合として見える。

### 3. こちらのカスタムJSもキーを埋めている

`onb_ext_init` でキーが無い場合に `[]` を書く実装が入っているツアーがある。
**先方が呼び出しをやめても、こちらのJSが供給し続ける。**

```js
// 例: src/customize/prod/722/makeup_preview.js
// クライアント側でAPIが叩かれておらずローカルストレージに値がない場合に、
// イントロのカスタムステータスが上書きされるのを防ぐ
const lsKey = 'onb_checked_goals_ids_' + STANDSUnit.tour_id
if (localStorage.getItem(lsKey) == null) {
    STANDSMotion.setCheckedGoalIds([])
}
```

---

## 対象ツアー（社内カスタムJSから確認できる分）

`onboarding-web/src/customize/prod/`（配布物は `Onboarding-Makeup-JS-CSS/tours/`）

| ツアー | 呼び出し | 備考 |
|---|---|---|
| `65` | `setCheckedGoalIds(comp_goals)` × 3 | 独自の finish 処理で `onb_complete_goals_` を組み立てて渡す |
| `13` | `setCheckedGoalIds([])` | キーが無いときのみ |
| `722` | `setCheckedGoalIds([])` | キーが無いときのみ |
| `7738` | `setCheckedGoalIds([])` | **キーが `onb_checked_goals_ids_airmate` とツアーID直書き** |
| `7740` | `setCheckedGoalIds([])` | キーが無いときのみ |

**このAPIは先方の実装から直接叩かれている可能性が高く、grep では呼び出し元を網羅できない。**
上表は社内カスタムJSに現れる分のみ。移行前に先方へ利用状況を確認すること。

---

## 移行手順

3つすべてが揃わないと完了しない。

### 1. 先方の環境から呼び出しを外す

`STANDSMotion.setCheckedGoalIds()` の呼び出しを削除してもらう。

### 2. カスタムJSの供給を止める

`onb_ext_init` 等でキーを埋めている箇所を外す（上表の `13` / `722` / `7738` / `7740`）。

### 3. 既存エンドユーザーのLSを掃除する

**1・2 だけでは、すでに値が入っているブラウザに届かない。** 移行期間中だけ、
カスタムJSの該当箇所を掃除処理に差し替える。

```js
function onb_ext_init(tour_id) {
    // 移行期間中: 管理画面の設定へ寄せるため残存キーを掃除する
    // （十分な期間を置いたらこのブロックごと削除する）
    STANDSMotion.clearCheckedGoalIds()
}
```

`clearCheckedGoalIds()` は `removeItem` して `setLauncher()` を呼ぶだけなので、
キーが無い場合でも無害。再訪したユーザーから順に掃除される。

**期間はそのプロダクトの再訪サイクル次第。** 短くても数週間は置く。

### 4. 管理画面でタイミングを設定する

3 が行き渡ってから設定を変更する。順序を逆にすると、
「設定は効かないのに見た目だけ変わる」状態が長く続く。

---

## 移行中の見た目について

**手順の途中（キーが残ったまま設定を「ゴールの完了」にした状態）でも、
イントロの一覧が壊れないようにしてある。**

`markIntroGoalChecked()`（進行中のイントロへチェックを即時反映する処理）が
`setLauncher()` と同じ優先順位を持つようにガードを入れているため、
API分岐で組み立てられたイントロには手を出さない。

このガードが無かった頃は、次のようになっていた。

- 一覧のチェックだけが顧客の指定を上書きして点灯する
- ランチャーのバッジ件数は `setLauncher()` が API 準拠で計算するため**食い違う**
- ツアーを抜けてランチャーから開き直すとDOMが再構築されて直る（一時的な不整合）

詳細は `onboarding-web/docs/knowledge/2026-09-09_onbs-1991_intro-checkmark-timing.md` を参照。

---

## 確認項目

移行後に以下を確認する。

| # | 手順 | 期待結果 |
|---|---|---|
| 1 | DevTools で `onb_checked_goals_ids_{tourID}` を確認 | **キーが存在しない** |
| 2 | イントロを開く | タイミング設定に応じたチェックが付く |
| 3 | ゴールを最後まで進める（「ゴールの完了」設定時） | 最終ステップ表示でチェックが付く |
| 4 | ランチャーのバッジ | 一覧のチェック数と整合する |
| 5 | 別ブラウザ・シークレットウィンドウ | 1〜4 が同じ結果になる |

5 は、sync ドメインの写しから復元されないことの確認を兼ねる。
