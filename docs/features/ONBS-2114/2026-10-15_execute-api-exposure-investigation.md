# execute-api 直アクセスの露出状況調査

- 関連チケット: [ONBS-2114](https://onboarding-app.atlassian.net/browse/ONBS-2114)（親: ONBS-2109 不正アクセス関連の対応）
- 対応内容: [2026-10-15_jira-summary.md](2026-10-15_jira-summary.md)
- 調査日: 2026-10-15（JST）
- 時刻はすべて JST

## 背景

不正アクセスインシデント対応として出された PR
[#888](https://github.com/stands/Onboarding-Manage-API/pull/888)（`fix: API Gateway のデフォルトエンドポイント（execute-api）を無効化する`）
について、以下2点を確認するよう依頼を受けた。

1. API Gateway のデフォルトエンドポイントを無効化した設定は正常か
2. IP アドレスでのリクエストも遮断されているか

確認の過程で、PR の対象外になっているスタックと、別リポジトリの重大な露出が見つかった。

## 1. PR #888 の設定は正しく、本番に効いている

`provider.apiGateway.disableDefaultEndpoint: true` は Serverless Framework の正規オプションで、
`AWS::ApiGateway::RestApi` の `DisableExecuteApiEndpoint` に対応する。
`frameworkVersion: "3"` / CI は `serverless@3.40.0`（`.github/actions/deploy/action.yml`）で、いずれも対応バージョン。

実機で反映を確認した。

```bash
aws apigateway get-rest-apis --region ap-northeast-1 \
  --query 'items[].{name:name,id:id,disableExecuteApiEndpoint:disableExecuteApiEndpoint}'
# onboarding-manage-api-prod (y8ozzf8hfb) → true
# onboarding-manage-api-dev  (dok86tbt9k) → true

curl https://y8ozzf8hfb.execute-api.ap-northeast-1.amazonaws.com/prod/
# → 403 {"message":"Forbidden"}
```

### 403 の読み分け

同じ 403 でも本文で経路を判別できる。調査中はこれで切り分けた。

| 本文 | 意味 |
| --- | --- |
| `{"message":"Forbidden"}` | API に到達していない（デフォルトエンドポイント無効 / ベースパスマッピング無し） |
| `{"message":"Missing Authentication Token"}` | API には到達しており、ルートが一致しなかっただけ |

## 2. manage-api は現在カスタムドメイン経由も含めて全面遮断されている

`manage-api.onboarding-app.io` はベースパスマッピングが 0 件で、全パスが 403 を返す。

```bash
aws apigateway get-base-path-mappings --domain-name manage-api.onboarding-app.io --region ap-northeast-1
# → {"items": []}

aws apigateway get-domain-name --domain-name manage-api.onboarding-app.io --region ap-northeast-1 \
  --query 'routingMode'
# → "BASE_PATH_MAPPING_ONLY"

curl https://manage-api.onboarding-app.io/v1/auth
# → 403 {"message":"Forbidden"}
```

`manage.onboarding-app.io`（管理画面）はメンテナンス画面を返す。

CloudTrail を見ると、マッピング削除は意図的な操作だった。**設定ミスや PR の副作用ではない。**

```bash
aws cloudtrail lookup-events --region ap-northeast-1 \
  --lookup-attributes AttributeKey=EventName,AttributeValue=DeleteApiMapping
```

### タイムライン（2026-10-14）

| 時刻 | 事象 |
| --- | --- |
| 12:46 | `DeleteApiMapping`（tomohiro_suzuki） |
| 12:50 | PR #888 マージ → 本番デプロイ開始 |
| 12:54 | CloudFormation スタック `onboarding-manage-api-prod` UPDATE_COMPLETE |
| 12:55 | API Gateway デプロイ作成（`disableExecuteApiEndpoint: true` 反映） |
| 12:58 | `DeleteApiMapping`（tomohiro_suzuki） |
| 12:58 以降 | `mngV1Auth-prod` の実行ログが途絶。本番管理 API へのリクエスト 0 件 |

### 削除されたマッピングの内容

ベースパスマッピングは IaC（serverless.yml）の管理外で、手動作成されたもの。
`serverless deploy` の対象ではない。

削除されたのは prod / dev それぞれ 1 件のみ。

| ドメイン | apiMappingId | 削除時刻 | 実行者 |
| --- | --- | --- | --- |
| `manage-api.onboarding-app.io` | `84wlwq` | 10/14 12:58 | tomohiro_suzuki |
| `dev-manage-api.onboarding-app.io` | `rla9l7` | 10/14 12:46 | tomohiro_suzuki |

`basePath` は `(none)`。フロントが使う `/v1` `/v2`（`NUXT_PUBLIC_API_BASE_URL`）は
ベースパスではなく API 側のリソースパスである。

```bash
aws apigateway get-resources --rest-api-id y8ozzf8hfb --region ap-northeast-1
# → /v1, /v1/auth, /v2 ... が存在する
```

## 3. 攻撃のトラフィック痕跡

`AWS/ApiGateway` の `Count` / `4XXError`（`ApiName=onboarding-manage-api-prod`）。

| 日付 | リクエスト数 | うち 4XX |
| --- | ---: | ---: |
| 10/08 | 5,411 | 152 |
| 10/09 | 6,277 | 183 |
| 10/10 | 273 | 10 |
| 10/11 | 809 | 17 |
| 10/12 | 172 | 7 |
| 10/13 | 9,546 | 3,204 |
| **10/14** | **549,684** | **542,075** |

10/14 は 01:42 台の1時間だけで 539,868 件。4XX 比率 98.6% で、認証試行の総当たりと整合する。
12:58 以降は 0 件。

## 4. IP アドレスでのリクエストについて

**API Gateway に関しては、IP 直打ちという攻撃面がそもそも存在しない。**

API Gateway は TLS SNI / Host ヘッダでしかルーティングしない。
`manage-api.onboarding-app.io` が返す A レコードはリージョン共用のフロント群であり、オリジン IP ではない。

```bash
curl -k https://52.197.23.9/mng/v1/auth                                        # → 403（SNI なし）
curl --resolve manage-api.onboarding-app.io:443:52.197.23.9 \
     https://manage-api.onboarding-app.io/mng/v1/auth                          # → 403（Host 偽装）
```

ただし **`disableDefaultEndpoint` では塞げない経路がある**。
リージョナルカスタムドメインの実体 `d-xxxxx.execute-api.ap-northeast-1.amazonaws.com` に対して
Host ヘッダを偽装すると、カスタムドメイン経由と同じレスポンスが返る。
Cloudflare を挟んでいるドメインでは、これがそのまま WAF 迂回になる（後述）。

## 5. 残っている露出（ONBS-2114 で対応）

PR #888 は `api/rest` のみが対象で、同一リポジトリの他スタックは手付かずだった。

```bash
for id in na34r1ebwb t2fu8aq041; do
  curl -s https://$id.execute-api.ap-northeast-1.amazonaws.com/prod/
done
# → いずれも {"message":"Missing Authentication Token"} ＝ 到達可能
```

| スタック | API 名 | API ID | 状態 |
| --- | --- | --- | --- |
| `api/rest` | onboarding-manage-api-prod | `y8ozzf8hfb` | 無効化済み |
| `api/rest-ext-editor` | onboarding-ext-editor-api-prod | `na34r1ebwb` | 有効のまま |
| `api/rest-ext-viewer` | onboarding-ext-viewer-api-prod | `t2fu8aq041` | 有効のまま |
| `api/websocket` | manage-sync-guide-prod | `sl3su33zt4` | 有効のまま |

ext-viewer は `auth-email` / `auth-code` / `auth-refresh` / `products-ip-authentication` を持つため、
manage-api と同種の攻撃を受けうる。

## 6. 本チケット対象外の重大な露出

### 6-1. 配信 API が Cloudflare を完全に迂回できる（最優先）

`api.onboarding-app.io` は Cloudflare 配下（CNAME → `api.onboarding-app.io.cdn.cloudflare.net`）だが、
オリジンの `onboarding-api-prod`（`4gg04tjv40`、リポジトリ `onboarding-api`）は execute-api が有効のまま。

```bash
# Cloudflare 経由
curl "https://api.onboarding-app.io/v1/onboarding-init?aid=1&pid=1"
# → 200 / server: cloudflare / cf-ray: ...

# execute-api 直叩き
curl "https://4gg04tjv40.execute-api.ap-northeast-1.amazonaws.com/prod/v1/onboarding-init?aid=1&pid=1"
# → 200 / レスポンス本文はバイト単位で同一（Cloudflare ヘッダ無し）

# リージョナルカスタムドメイン実体へ Host 偽装
curl --resolve api.onboarding-app.io:443:$(dig +short d-g8prizvuyd.execute-api.ap-northeast-1.amazonaws.com | head -1) \
     "https://api.onboarding-app.io/v1/onboarding-init?aid=1&pid=1"
# → 200
```

WAF・レート制限・キャッシュをすべて素通りする。manage-api が塞がれた今、次に狙われうる。

`disableDefaultEndpoint` だけでは3番目の経路（Host 偽装）が残るため、根本対処には次のいずれかが要る。

- API Gateway のリソースポリシーで `aws:SourceIp` を Cloudflare の IP レンジに限定する
- Cloudflare 側で共有シークレットヘッダを付与し、オリジンで検証する

あわせて、配信 JS / データのキャッシュパージ先は assets ではなく配信エンドポイント側である点に注意
（既知の運用事項）。

### 6-2. WAF がどのリソースにも関連付けられていない

```bash
aws wafv2 list-resources-for-web-acl \
  --web-acl-arn arn:aws:wafv2:ap-northeast-1:091413534636:regional/webacl/ag-onboarding-manage-api-prod/e656e1c8-6068-4df4-a0e8-144f15029609 \
  --region ap-northeast-1
# → {"ResourceArns": []}

aws apigateway get-stage --rest-api-id y8ozzf8hfb --stage-name prod --region ap-northeast-1 \
  --query 'webAclArn'
# → null
```

WebACL `ag-onboarding-manage-api-prod` は AWS マネージドルール5種
（IpReputationList / CommonRuleSet / KnownBadInputs / LinuxRuleSet / SQLiRuleSet）と
IP 許可リストを持つが、**どのリソースにも紐付いていない**。
`ag-onboarding-manage-api-dev` も同様。prod / dev いずれのステージも `webAclArn` は `null`。

10/14 の 54万リクエストは、WAF が機能していれば緩和できた可能性がある。

## 7. 参考: 本番 REST API の execute-api 到達性（調査時点）

PR #888 の対象外で、デフォルトエンドポイントが有効のまま残っているもの。

| API 名 | API ID | リポジトリ |
| --- | --- | --- |
| onboarding-api-prod | `4gg04tjv40` | onboarding-api |
| onboarding-ext-editor-api-prod | `na34r1ebwb` | Onboarding-Manage-API |
| onboarding-ext-viewer-api-prod | `t2fu8aq041` | Onboarding-Manage-API |
| onboarding-ai-server-prod | `eob6cmb4v8` | Onboarding-AI-Server |
| onboarding-screenshot-api-prod | `oocjrn7731` | — |
| ocr-api | `lbu0izwc9i` | — |

WebSocket / HTTP API（`apigatewayv2`）も全件 `DisableExecuteApiEndpoint: false`。

| API 名 | API ID | 種別 |
| --- | --- | --- |
| manage-sync-guide-prod | `sl3su33zt4` | WEBSOCKET |
| ai-websocket-prod | `8hb23gp5n5` | WEBSOCKET |
| chat-openai-websocket-prod | `2sa5gc22j8` | WEBSOCKET |

> AI チャットの WebSocket（v2ai）は Cloudflare 配下ではなく ALB 直である点に注意（既知の運用事項）。
