# ONBS-2114 ext-editor / WebSocket の execute-api デフォルトエンドポイントを無効化する

- Jira: https://onboarding-app.atlassian.net/browse/ONBS-2114
- 親エピック: ONBS-2109 不正アクセス関連の対応
- 調査の詳細: [2026-10-15_execute-api-exposure-investigation.md](2026-10-15_execute-api-exposure-investigation.md)
- 実装記録: `Onboarding-Manage-API` の `docs/features/ONBS-2114/README.md`

## 問題点

PR [#888](https://github.com/stands/Onboarding-Manage-API/pull/888) で `onboarding-manage-api` の
REST API（`api/rest`）のみ execute-api デフォルトエンドポイントを無効化したが、
同一リポジトリの他スタックは対象外のまま残っている。

実機確認の結果、以下の本番 API はカスタムドメインを経由せず
`https://{api-id}.execute-api.ap-northeast-1.amazonaws.com/prod/` で直接到達できる。

| スタック | API 名 | API ID | 本チケットでの扱い |
| --- | --- | --- | --- |
| `api/rest` | onboarding-manage-api-prod | `y8ozzf8hfb` | 対応済み（PR #888） |
| `api/rest-ext-editor` | onboarding-ext-editor-api-prod | `na34r1ebwb` | **対応する** |
| `api/websocket` | manage-sync-guide-prod | `sl3su33zt4` | **対応する** |
| `api/rest-ext-viewer` | onboarding-ext-viewer-api-prod | `t2fu8aq041` | **見送り** |

### ext-viewer を見送った理由

ビューワー拡張は顧客のエンドユーザーが利用するもので、万一遮断で停止した場合の
影響範囲が読み切れないため、本対応では見送る。

コードベース上の参照先はカスタムドメインのみで、execute-api の直指定は
リポジトリ横断で1件も見つかっていない。ただし実利用での確証までは取れていない。

| 参照元 | 参照先 |
| --- | --- |
| `onboarding-web/env/viewer_general_prod.js` | `https://viewer-api.onboarding-app.io` |
| `onboarding-web/src/json/manifest/viewer_general_prod.json` | `host_permissions: https://viewer-api.onboarding-app.io/` |
| `api/rest-ext-viewer/.env.prod` | `SAML_ENTITY_ID` / `SAML_ACS_BASE_URL` とも `viewer-api.onboarding-app.io` |

SAML SSO を使っている顧客は IdP 側に ACS URL が登録されているため、
適用するならそちらへの影響も含めて確認してから判断する。

## 対応方針

### REST API（`api/rest-ext-editor`）

PR #888 と同じ1行を追加する。`AWS::ApiGateway::RestApi` の `DisableExecuteApiEndpoint` に対応する。

```yaml
provider:
  apiGateway:
    shouldStartNameWithService: true
    disableDefaultEndpoint: true
```

エディタ拡張の参照先は `Onboarding-Editor-Extension/.env.prod` の
`VITE_ONB_EDITOR_API_BASE_URL="https://editor-api.onboarding-app.io"` でカスタムドメイン。

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

接続元は `onboarding-manage-web/app/config/.env.prod` の
`NUXT_PUBLIC_WS_BASE_URL='wss://manage-wss.onboarding-app.io'` でカスタムドメイン。

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
| `api/websocket/serverless.yml` | `resources.extensions` で `DisableExecuteApiEndpoint: true` を追加 |

いずれもカスタムドメイン（`editor-api` / `manage-wss`.onboarding-app.io）に
ベースパスマッピングが存在するため、正規経路の通信には影響しない。

## 検証

CI と同じ `serverless@3.40.0` で `serverless package --stage prod` を実行し、
生成された CloudFormation テンプレートにプロパティが入ることを確認した。

| スタック | 論理ID | DisableExecuteApiEndpoint |
| --- | --- | --- |
| `api/rest-ext-editor` | `ApiGatewayRestApi` | `true` |
| `api/websocket` | `WebsocketsApi` | `true` |

この2スタックには pytest 等のテストは存在しない（テストがあるのは `api/rest` のみで、今回は変更していない）。

## リリース後の確認

```bash
aws apigateway get-rest-apis --region ap-northeast-1 \
  --query 'items[?name==`onboarding-ext-editor-api-prod`].{name:name,disabled:disableExecuteApiEndpoint}'
aws apigatewayv2 get-apis --region ap-northeast-1 \
  --query 'Items[?Name==`manage-sync-guide-prod`].{name:Name,disabled:DisableExecuteApiEndpoint}'

# 直叩きが {"message":"Forbidden"} になること
curl https://na34r1ebwb.execute-api.ap-northeast-1.amazonaws.com/prod/

# 正規経路が従来どおりであること（{"message":"Missing Authentication Token"} が返る）
curl https://editor-api.onboarding-app.io/
```

WebSocket はエディタ拡張でガイド同期が動くこと（`manage-wss.onboarding-app.io` への接続と
`@connections` でのブロードキャスト）を実機で確認する。

## 残課題

- `api/rest-ext-viewer` の execute-api 無効化（本対応では見送り）
- 配信 API `api.onboarding-app.io`（`onboarding-api-prod` / `4gg04tjv40`、別リポジトリ）が
  execute-api 直叩きで Cloudflare を完全に迂回でき、WAF・レート制限・キャッシュを素通りする
- WebACL `ag-onboarding-manage-api-prod` がどのリソースにも関連付けられておらず（`ResourceArns: []`）、
  WAF が機能していない
