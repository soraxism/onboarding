# ONBS-2358: エディター拡張機能のファイルアップロードで、中身を検証せず HTML・SVG を配信用 S3 に置けてしまう

- Jira: https://onboarding-app.atlassian.net/browse/ONBS-2358（親 ONBS-2109）
- 関連: ONBS-2145（管理画面用 `/v1/file/upload` の同種の修正・2026-10-20）、ONBS-2357（攻撃者が置いた 56 件の削除）

## 問題点

エディター拡張機能用のファイルアップロード API（onboarding-manage-api `api/rest-ext-editor/functions/file-upload`、`POST /file/upload`）は、保存する拡張子と Content-Type を、送られてきた data URI の接頭辞（`data:text/html;base64,…`）からそのまま取り、中身を確かめていなかった。拡張機能の操作トークンがあれば、HTML や script 入りの SVG を配信用の公開バケット（`assets.onboarding-app.io/manage/product/{id}/`）に置け、URL を直接開くと当社ドメイン上でスクリプトが動く。

2026-10-14 の不正アクセスでは、管理画面用の同種 API が同じ状態で、攻撃者が試し打ちのファイル 56 件を置いていた。管理画面用は ONBS-2145 で直したが、拡張機能用は直していなかった。

あわせて、画像の選択欄（管理画面・拡張機能）が SVG を受け付けており、管理画面では SVG を選べるのに保存で 415 になる食い違いがあった。

### 実績（S3 `manage/` 配下）

| 形式 | 実績 | 扱い |
| --- | --- | --- |
| PNG・JPEG・GIF | 正規のアップロードのほぼ全て | 許可 |
| WebP | 0 件（管理画面用 API は許可済み） | 許可（管理画面用とそろえる） |
| MP4 | 拡張機能から上げ、ガイド本文にリンク（`<a href="…mp4" target="_blank">`）として利用。編集履歴で 2,600 回以上参照 | **許可** |
| PDF | 画像ブロックの `<img>` に誤って入った 1 件のみ（表示されない）。リンク利用は未確認 | 拒否 |
| SVG・HTML | 2025-07 の一括移行以降、攻撃時を除き 0 件 | 拒否 |

`accept` 属性はファイル選択画面の初期の絞り込みにすぎず、拡張機能では「すべてのファイル」から MP4 を選んでいた。

## 対応方針

許可する形式は **画像（PNG・JPEG・GIF・WebP）＋ MP4**（空判断）。

| リポジトリ | 変更 |
| --- | --- |
| onboarding-manage-api | 拡張機能用 `file-upload` を実体（マジックバイト）で判定。MP4 は `ftyp` ＋ MP4 系ブランド（isom・M4V 等）。拡張子・Content-Type はサーバーが決める。許可外は 415、data URI 不正は 400。テスト `api/rest/tests/functions/rest-ext-editor/test_file_upload.py` を追加 |
| onboarding-manage-web | `uploadConfig.ACCEPT_IMAGE_TYPES` と形式エラーの文言から SVG を外す。unit・E2E（`intro-cover-4`）を更新。ハーネス通過（`docs/feature/ONBS-2358/`） |
| Onboarding-Editor-Extension | `ImageMenu` の `accept` から SVG を外す |

管理画面用 `mngV1FileUpload` は変更しない（画像のみのまま）。既に置いてあるファイル（MP4 を含む）には影響しない。

## 範囲外

- 拡張機能でツアーの表紙画像を設定する API（`tours-tour-id-intro-cover-image`）が URL を検証せずに保存している点（別途）
