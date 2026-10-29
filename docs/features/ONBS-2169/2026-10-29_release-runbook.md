# ONBS-2169 リリース手順（2026-10-29）

アクセスログの有効化と保存期間の統一。決定の経緯は Jira ONBS-2169 のコメント（2026-10-29「本番の実態と方針」）にある。

## リリース前に AWS で済ませたこと（コード外）

| 変更 | 対象 | 確認 |
| --- | --- | --- |
| WAF ログでトークンのヘッダ 4 種を伏せ字（RedactedFields） | ACL `ag-onboarding-manage-api-prod` / `-dev` | 本番 06:30 UTC 以降、132 件すべて `REDACTED`・平文 0 件 |
| S3 の保存期限 365 日 | `aws-waf-logs-stands-onboarding` の `AWSLogs/091413534636/WAFLogs/ap-northeast-1/` のみ | ライフサイクル規則 `expire-apigw-waf-logs-365d` |

- `WAFLogs/cloudfront/`（2023-07 から約 425GB）には期限を付けていない。確報の後に判断する
- WAF の記録設定は IaC 管理外（2026-10-18 に手で設定されたもの）

## リリース順序

2 つは互いに依存しない。影響の大きい Manage-API を先にする。

| 順 | リポジトリ | PR | 版 | 本番での確認 |
| --- | --- | --- | --- | --- |
| 1 | Onboarding-Manage-API | #930 | 5.114.2 → 5.115.0 | `/aws/websocket/manage-sync-guide-prod` が作られ保持 365 日。管理画面の操作で監査ログ `[AUDIT][REQUEST]` に `source_ip` が出る |
| 2 | Onboarding-AI-Server | #129 | 1.41.0 → 1.42.0 | `/aws/websocket/onboarding-ai-server-prod` の保持が 365 日 |

## 変更内容

- Manage-API
  - ガイド保存の WebSocket（`manage-sync-guide`）のアクセスログを有効化（JSON・保持 365 日・実行ログ OFF）
  - REST の監査ログ `[AUDIT][REQUEST]` に `source_ip` を追加（rest-ext-editor / rest-ext-viewer も同じレイヤー）
- AI-Server
  - AI ヒントの WebSocket のアクセスログの保持を 90 日 → 365 日

## 戻し方

- コード: `main` の該当マージコミットを revert してリリースし直す。WebSocket のロググループは CloudFormation から外れて削除される（ログも消えるため、残したいなら先に書き出す）
- WAF の伏せ字: `put-logging-configuration` を `RedactedFields` なしで実行し直す
- S3 の保存期限: `delete-bucket-lifecycle`（規則はこの 1 本だけ）
