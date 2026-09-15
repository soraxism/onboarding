# ONBS-1991 リリース手順

イントロのチェックマークを付けるタイミングを設定で切り替える対応。**5 リポジトリ同時リリース**。

| リポジトリ | PR | base |
|---|---|---|
| Onboarding-Manage-API | [#855](https://github.com/stands/Onboarding-Manage-API/pull/855) | release |
| Onboarding-Manage-Web | [#1198](https://github.com/stands/Onboarding-Manage-Web/pull/1198) | release |
| Onboarding-Web | [#1439](https://github.com/stands/Onboarding-Web/pull/1439) | release |
| Onboarding-Editor-Extension | [#384](https://github.com/stands/Onboarding-Editor-Extension/pull/384) | release |
| onboarding-e2e-test | [#55](https://github.com/stands/onboarding-e2e-test/pull/55) | **main**（タグ運用外） |

---

## リリース順序

```
① Onboarding-Manage-API
        ↓
② Onboarding-Manage-Web ／ Onboarding-Web ／ Onboarding-Editor-Extension（順不同）
        ↓
③ onboarding-e2e-test（いつでも可）
```

### ① を最初に出す理由（必須）

**エディタ拡張が「変更したキーだけを送る」形になっている。**

```ts
// 色の変更
styles: { checkmark: { 'background-color': color } }
// タイミングの変更
styles: { checkmarkTiming: timing }
```

Manage-API の `PUT tours/{tour_id}/intro-style` が**部分更新**になっていないと、
送らなかったキーが `styles.intro` の丸ごと置換で消える。

**先に Manage-API を出さずにエディタ拡張を出すと、エディタでチェック色を変えただけで
タイミング設定が消える。** 逆順にしてはいけない。

### ② の中は順不同

Manage-Web・Onboarding-Web・Editor-Extension の間に依存はない。

- Manage-Web（設定 UI）だけ先に出ても、配信側が未対応なら設定が効かないだけで壊れない
- Onboarding-Web（配信側）だけ先に出ても、`checkmarkTiming` を持つツアーが無いので既定動作のまま

### ③ は E2E テストのみ

タグを発行していないリポジトリなので release 経路の対象外。base は `main`。

---

## 事前確認（2026-09-15 時点）

- 5 PR とも **CodeRabbit 指摘ゼロ**
- チェックリストは**全項目消化**（§7-6 / §10 を含む）

### リリース前に終わらせること

| # | 内容 | 状態 |
|---|---|---|
| §7-6 | 本番の顧客カスタム JS を持つツアーでの確認 | **完了**（対象は `13` の 1 件に確定。既定設定では API 分岐に入り今回の分岐へ到達しない） |
| §10 | レポート整合（日次バッチのため翌日確認） | **完了**（完了UU = 2。基準は最終ステップの表示・設定はレポートに影響しない） |

### onboarding-web は release を取り込み済み（2026-09-15）

ONBS-2011 のリリースで master / release が先行し、**manifest 4 ファイルが衝突**していた。
`feature/ONBS-1991` に `origin/release` をマージして解決済み。

| manifest | 採用した値 | 理由 |
|---|---|---|
| `preview_dev` / `viewer_general_dev` | release 側（3.122.1 / 1.59.1） | 他者が採番しストアへ申請済み。下げると次の dev 申請が `PKG_INVALID_VERSION_NUMBER` で落ちる |
| `preview_prod` / `viewer_general_prod` | こちら側（6.6.0 / 3.6.0） | ストア現行 6.5.6 / 3.5.6 からの minor +1。`ext-version-bump` の再実行でも同値 |

マージ後にテストを実行し 89 files / 3240 passed。他 4 リポジトリは `MERGEABLE / CLEAN` のまま。

---

## タグのバージョン

いずれも `feature/` を含むリリースなので **マイナー +1・パッチ 0**。

| リポジトリ | 直近タグ | 発行するタグ |
|---|---|---|
| Onboarding-Manage-API | 5.104.0 | **5.105.0** |
| Onboarding-Manage-Web | 7.96.3 | **7.97.0** |
| Onboarding-Web | 6.8.5 | **6.9.0** |
| Onboarding-Editor-Extension | 1.51.0 | **1.52.0** |
| onboarding-e2e-test | — | 発行しない |

`v` プレフィックスは付けない。manifest のバージョンとタグは同期しない（**タグを正とする**）。

---

## 各リポジトリの手順

### 共通の流れ

```bash
# 1. 作業ブランチ → release（squash merge）
gh pr merge {PR番号} --repo stands/{repo} --squash

# 2. release → main / master の PR を作る（タイトルは {YYYYMMDD} Release）
gh pr create --repo stands/{repo} --base {main|master} --head release --title "20260914 Release" --body "ONBS-1991"

# 3. マージコミットでマージする（squash 禁止。タグ位置とリリース履歴が壊れる）
gh pr merge {PR番号} --repo stands/{repo} --merge

# 4. タグ + リリースノートを 1 コマンドで作る（git tag との併用禁止）
gh release create {タグ} --repo stands/{repo} --target {main|master} --title {タグ} --notes "..."
```

**release → main / master の PR で CodeRabbit のレビューは待たない。**
差分は作業ブランチ → release の PR で対応済みで、重複レビューになる。

### ① Onboarding-Manage-API（5.105.0）

```
ONBS-1991: イントロスタイル更新を部分更新にし、チェックマークのタイミング既定値を追加
```

**デプロイ完了を確認してから ② へ進む。**

### ② Onboarding-Manage-Web（7.97.0）

```
ONBS-1991: イントロのチェックマークを付けるタイミングを選択できるようにする
```

### ② Onboarding-Web（6.9.0）

```
ONBS-1991: イントロのチェックマークを付けるタイミングを設定で切り替える
```

**配信 JS は CI で配信されない。main へのマージだけでは顧客に届かない。**

```bash
npx webpack --config webpack.prod.js
# → build/prod/s3/onboarding-init.js       を (S3) assets.onboarding-app.io/js/ へ
# → build/prod/s3/onboarding-init-next.js  を 同上へ
```

**2 ファイルとも上げること。** 顧客は `use_refactored_onboarding_init` フラグで
新旧どちらかを読むため、片方だけだと一部にしか届かない。アップロードは人が行う。

prod 拡張機能（preview 6.6.0 / viewer 3.6.0）は Chrome ウェブストアへ自動申請される。
**審査に数日かかる**ため、配信 JS の反映とはタイミングがずれる。

### ② Onboarding-Editor-Extension（1.52.0）

```
ONBS-1991: イントロのチェックマークを付けるタイミングを選択できるようにする
```

prod 拡張機能（manifest 1.53.0）が Chrome ウェブストアへ自動申請される。**審査に数日かかる。**

### ③ onboarding-e2e-test

base が `main` なので、PR をマージするだけ。タグは発行しない。

```bash
gh pr merge 55 --repo stands/onboarding-e2e-test --squash
```

---

## リリース後の確認

手順と環境は [2026-09-15_prod-verification-plan.md](./2026-09-15_prod-verification-plan.md) にまとめてある。

| # | 内容 |
|---|---|
| 1 | 配信 JS が届いたかを実物で確認（`onb_last_step_displayed_goals_` を含むか。**リリース前は新旧とも 0**） |
| 2 | 管理画面のツアー「表示スタイル設定」→ イントロに「チェックマークを付けるタイミング」が出る |
| 3 | 既定は「ゴールの表示」。**既存ツアーの見え方が変わっていない**（旧JS・新TS の両方で見る） |
| 4 | 「ゴールの完了」に切り替えたツアーで、最終ステップの表示までチェックが付かない |
| 5 | エディタ拡張でチェック色だけ変更 → 管理画面でタイミングが残っている（①の部分更新が効いている。**ストア審査通過後**） |

**3 がいちばん重要。** この対応は「既定では何も変わらない」ことが前提になっている。

---

## 注意点

### 既定値なので段階的に有効化できる

`checkmarkTiming` を持たないツアーは `goal_started`（従来動作）として扱われる。
リリースしただけでは**どの顧客の見え方も変わらない**。設定はツアー単位で個別に有効化する。

### 公開 API を使っている顧客では設定が効かない

`STANDSMotion.setCheckedGoalIds()` を使っているツアー（`13`・`7738`・`7740`）では、
`setLauncher()` が API 分岐に入るため設定が判定に入らない。
これは ONBS-1991 以前からの優先順位で、今回変えていない。
移行手順は [2026-09-14_api-to-setting-migration.md](./2026-09-14_api-to-setting-migration.md) を参照。

### ロールバック

配信 JS（Onboarding-Web）は S3 の差し替えで即座に戻せる。
管理画面・API は通常のリリース手順で戻す。**拡張機能はストア審査があるため即時に戻せない**ので、
問題が出た場合は先に配信 JS を戻して影響を止める。
