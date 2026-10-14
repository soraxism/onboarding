# ONBS-2114 ext-editor / ext-viewer / WebSocket の execute-api デフォルトエンドポイントを無効化する

- Jira: https://onboarding-app.atlassian.net/browse/ONBS-2114
- 親エピック: ONBS-2109 不正アクセス関連の対応
- 調査の詳細: [2026-10-15_execute-api-exposure-investigation.md](2026-10-15_execute-api-exposure-investigation.md)

## 問題点

PR [#888](https://github.com/stands/Onboarding-Manage-API/pull/888) で `onboarding-manage-api` の REST API（`api/rest`）のみ
execute-api デフォルトエンドポイントを無効化したが、同一リポジトリの他スタックは対象外のまま残っている。

実機確認の結果、以下の本番 API はカスタムドメインを経由せず
`https://{api-id}.execute-api.ap-northeast-1.amazonaws.com/prod/` で直接到達できる。

| スタック | API 名 | API ID | execute-api |
| --- | --- | --- | --- |
| `api/rest` | onboarding-manage-api-prod | `y8ozzf8hfb` | 無効化済み（PR #888） |
| `api/rest-ext-editor` | onboarding-ext-editor-api-prod | `na34r1ebwb` | **有効のまま** |
| `api/rest-ext-viewer` | onboarding-ext-viewer-api-prod | `t2fu8aq041` | **有効のまま** |
| `api/websocket` | manage-sync-guide-prod | `sl3su33zt4` | **有効のまま** |

特に ext-viewer は `auth-email` / `auth-code` / `auth-refresh` / `products-ip-authentication` といった
認証系エンドポイントを持っており、manage-api が受けたものと同種の攻撃を受けうる。

## 対応方針

各スタックの `serverless.yml` でデフォルトエンドポイントを無効化する。

### REST API（`api/rest-ext-editor`、`api/rest-ext-viewer`）

PR #888 と同じ1行を追加する。`AWS::ApiGateway::RestApi` の `DisableExecuteApiEndpoint` に対応する。

```yaml
provider:
  apiGateway:
    shouldStartNameWithService: true
    disableDefaultEndpoint: true
```

### WebSocket（`api/websocket`）

`AWS::ApiGatewayV2::Api` のため `provider.apiGateway` の設定は効かない。
`resources.extensions` で CloudFormation のプロパティを直接差す。

```yaml
resources:
  extensions:
    WebsocketsApi:
      Properties:
        DisableExecuteApiEndpoint: true
```

論理ID `WebsocketsApi` は `manage-sync-guide-prod` スタックの実リソース（`sl3su33zt4`）と一致することを確認済み。

`@connections` の送信は `api/websocket/layers/python/lib/common.py` で
接続時の `requestContext.domainName`（= `manage-wss.onboarding-app.io`）をそのままエンドポイントに使っており、
execute-api を経由していないため影響しない。

```python
# common.py:42
os.environ["domainName"] = event.get("requestContext", {}).get("domainName")
# common.py:1728
endpoint_url = "http://localhost:5001" if is_local_env() else f"https://{os.environ['domainName']}"
```

## 影響範囲

対象リポジトリ: `Onboarding-Manage-API` のみ

| 対象 | 変更内容 |
| --- | --- |
| `api/rest-ext-editor/serverless.yml` | `disableDefaultEndpoint: true` を追加 |
| `api/rest-ext-viewer/serverless.yml` | `disableDefaultEndpoint: true` を追加 |
| `api/websocket/serverless.yml` | `resources.extensions` で `DisableExecuteApiEndpoint: true` を追加 |

いずれもカスタムドメイン（`editor-api` / `viewer-api` / `manage-wss`.onboarding-app.io）に
ベースパスマッピングが存在するため、正規経路の通信には影響しない。

## 本チケットの対象外

同じ調査で判明した以下は別チケットで扱う。詳細は調査ドキュメントを参照。

- 配信 API `api.onboarding-app.io`（`onboarding-api-prod` / `4gg04tjv40`、別リポジトリ）が
  execute-api 直叩きで Cloudflare を完全に迂回でき、WAF・レート制限・キャッシュを素通りする
- WebACL `ag-onboarding-manage-api-prod` がどのリソースにも関連付けられておらず（`ResourceArns: []`）、WAF が機能していない

## 検証

CI と同じ `serverless@3.40.0` で `serverless package --stage prod` を実行し、
生成された CloudFormation テンプレートにプロパティが入ることを確認した。

| スタック | 論理ID | DisableExecuteApiEndpoint |
| --- | --- | --- |
| `api/rest-ext-editor` | `ApiGatewayRestApi` | `true` |
| `api/rest-ext-viewer` | `ApiGatewayRestApi` | `true` |
| `api/websocket` | `WebsocketsApi` | `true` |

WebSocket の論理ID `WebsocketsApi` は、既存スタック `manage-sync-guide-prod` の
実リソース（物理ID `sl3su33zt4`）と一致することを確認済み。

```bash
aws cloudformation list-stack-resources --region ap-northeast-1 \
  --stack-name manage-sync-guide-prod \
  --query 'StackResourceSummaries[?ResourceType==`AWS::ApiGatewayV2::Api`]'
# → LogicalResourceId: WebsocketsApi / PhysicalResourceId: sl3su33zt4
```

この3スタックには pytest 等のテストは存在しない（テストがあるのは `api/rest` のみで、今回は変更していない）。

## リリース後の確認

デプロイ後、execute-api が遮断されたことを確認する。

```bash
aws apigateway get-rest-apis --region ap-northeast-1 \
  --query 'items[?name==`onboarding-ext-editor-api-prod`||name==`onboarding-ext-viewer-api-prod`].{name:name,disabled:disableExecuteApiEndpoint}'
aws apigatewayv2 get-apis --region ap-northeast-1 \
  --query 'Items[?Name==`manage-sync-guide-prod`].{name:Name,disabled:DisableExecuteApiEndpoint}'

# 直叩きが {"message":"Forbidden"} になること
curl https://na34r1ebwb.execute-api.ap-northeast-1.amazonaws.com/prod/
curl https://t2fu8aq041.execute-api.ap-northeast-1.amazonaws.com/prod/

# 正規経路が従来どおりであること（{"message":"Missing Authentication Token"} が返る）
curl https://editor-api.onboarding-app.io/
curl https://viewer-api.onboarding-app.io/
```

WebSocket はエディタ拡張でガイド同期が動くこと（`manage-wss.onboarding-app.io` への接続と
`@connections` でのブロードキャスト）を実機で確認する。
