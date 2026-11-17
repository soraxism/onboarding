# ONBS-2358 リリース手順

概要は [2026-11-17_jira-summary.md](./2026-11-17_jira-summary.md)。

## リリース順と版

| 順 | リポジトリ | release への PR | タグ（前 → 次） | 理由 |
| --- | --- | --- | --- | --- |
| 1 | onboarding-manage-api | #937（squash 済み） | 5.118.0 → **5.118.1** | 守りの本体（拡張機能用 `/file/upload` の実体判定）。先に出せば、画面側の変更前でも HTML・SVG は保存されない |
| 2 | onboarding-manage-web | #1258 | 7.116.0 → **7.116.1** | 画面の選択欄から SVG を外す（管理画面用 API は ONBS-2145 で既に SVG を拒否しているので、順序の依存はない） |
| 3 | Onboarding-Editor-Extension | #406（squash 済み） | 1.57.0 → **1.57.1**（manifest は prod 1.55.4） | 画像メニューの選択欄から SVG を外す。dev 版 1.54.14 の審査通過・画面確認後 |

いずれも `hotfixes/` のみのため、パッチ +1。

## 各リポジトリの手順

1. `git log origin/{main|master}..origin/release` で他者のコミットが無いことを確かめる（2026-11-17 18:40 時点で 3 リポジトリとも release は空だった）
2. release → main / master の PR（タイトル `20261117 Release`、マージコミット）
3. マージ前に Slack #onboarding-general へリリース内容を投稿（3 リポジトリを 1 投稿にまとめる）
4. マージ後 `gh release create {タグ} --target {main|master} --title {タグ} --notes "ONBS-2358: …"`
5. 本番の配備を確認
   - manage-api：`extEditorApiFileUpload-prod` の更新日時が push 後になっていること。本番で HTML を送ると 415 になることを確かめる（確認用アカウントの操作トークンで）
   - manage-web：配備の完了
   - 拡張機能：prod 版 1.55.4 のストア申請。審査通過後に反映

## 確認済み（dev）

- 拡張機能用 `/file/upload`：PNG・MP4 は 200、HTML（詐称を含む）・SVG は 415
- 管理画面：画像の選択欄に SVG が出ない・PNG が上がる
- 拡張機能 dev 版 1.54.14：画像メニューで SVG を選べない
