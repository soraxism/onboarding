# ONBS-2118 アカウント管理ツールを VPN 経由の特定 IP のみに制限する

- Jira: https://onboarding-app.atlassian.net/browse/ONBS-2118
- 親エピック: ONBS-2109 不正アクセス関連の対応
- 方式の精査: [2026-10-15_access-restriction-design.md](2026-10-15_access-restriction-design.md)
- 作業手順: [2026-10-15_infra-runbook.md](2026-10-15_infra-runbook.md)

## 問題点

アカウントおよびプロダクトを作成・編集できるアカウント管理ツールが、実質的に無防備な状態にある。

### フロント（`onboarding-account-manager`）

- URL: `https://dev.onboarding.co.jp/tools/manager/`
- 経路: ALB `onboarding-dev` → EC2 `i-0d78a0c019c2a71ea`（`18.177.122.187`）/ Apache 2.4.54
- 防御は **BASIC 認証のみ**。`/home/ftpuser/html/.htaccess` でドキュメントルート全体に適用されている
- **EC2 のパブリック IP 直叩きで ALB を迂回できる**
- `dev-beacon.onboarding.co.jp` は VirtualHost が未定義で default server にフォールバックするため、
  **`dev.onboarding.co.jp` 以外のホストからも `/tools/manager/` に到達できる**（`dev-api` も同様）
- ALB と EC2 が SG `sg-0f8d08ae1663d8f2b` を共有し、80 / 443 / 20 / 21 / 40000-40010 / 60001-60010 が全開

### バック（`onboarding-api`）

- **認証が一切ない。BASIC 認証もかかっていない**
- `GET https://api.onboarding-app.io/tools/accounts` が無認証で `200`（全アカウント一覧 8,839 bytes）
- execute-api 直叩きでも同一レスポンス。Cloudflare を完全に迂回できる
- `handler.py` に認証チェックのコードが無く、CORS も `ALLOW_ORIGIN = "*"`
- 管理ツール専用エンドポイントは `/tools/*` だけではない。**`/segment-update`（ガイド JSON の本番反映）も対象**
- 同じ API Gateway に顧客向け配信 API が同居するため、**API 全体への IP 制限は配信停止を招く**
- dev（`dev-api.onboarding-app.io`）も同じ状態

## 対応方針

VPN の出口 IP `153.125.137.243/32` のみに制限する。フェーズ 1・2 を今回の対応範囲とする。

### フェーズ 1: API

管理ツール専用のカスタムドメイン `tools-api.onboarding-app.io`（dev は `dev-tools-api...`）を新設し、
Cloudflare では **DNS only（非プロキシ）** で登録する。その上で API Gateway のリソースポリシーで
`/tools/*` と `/segment-update` を VPN IP のみに許可する。

Cloudflare WAF ではなくリソースポリシーを採る理由は、ONBS-2110 で判明した
**Cloudflare 共用 IP による迂回**が API Gateway にも成立するため。
リソースポリシーは API Gateway 自身が評価するため、どの経路から来ても必ず効く。

配信 API は `Resource` の指定により対象外。`api.onboarding-app.io` 経由の `/tools/*` は
送信元が Cloudflare の IP になるため、同じポリシーで自動的に拒否される。

### フェーズ 2: ALB とセキュリティグループ

- ALB のリスナールールで `/tools/*` を VPN IP のみに許可し、それ以外へは 403 を返す。
  **ホストは 5 つすべてを列挙する**（`dev.onboarding.co.jp` だけでは `dev-api` と `dev-beacon` から素通りする）
- EC2 専用の SG を新設し、ALB からの 80 のみに絞る。SG を共有しているため既存 SG の `0.0.0.0/0` は消せない
- BASIC 認証は多層防御として残す

### フェーズ 3（今回対象外）

Apache に `mod_remoteip` と `Require ip` を設定する。`<Directory>` はファイルシステムパスに効くため
全 VirtualHost を一括で守れるが、**現状 mod_remoteip は未設定**で、設定ミス時に dev 環境全体を停止させうる。
フェーズ 2 で確実に塞いだ後に別途適用する。

## 影響範囲

| リポジトリ | 変更内容 |
| --- | --- |
| `onboarding-api` | `src/serverless.yml` に `provider.apiGateway.resourcePolicy` を追加 |
| `onboarding-account-manager` | `app/plugins/api.js` と `app/config/.env.dev` の向き先を専用ドメインへ変更 |

コード外（AWS / Cloudflare）の作業は [runbook](2026-10-15_infra-runbook.md) を参照。

## 検証

CI と同じ `serverless@3.39.0` で `serverless package --stage prod` を実行し、
生成された CloudFormation テンプレートの `AWS::ApiGateway::RestApi` に意図どおりの `Policy` が入ることを確認した。

```json
{
  "Effect": "Deny",
  "Principal": "*",
  "Action": ["execute-api:Invoke"],
  "Resource": [
    "execute-api:/*/*/tools/*",
    "execute-api:/*/*/segment-update"
  ],
  "Condition": {
    "NotIpAddress": { "aws:SourceIp": ["153.125.137.243/32"] }
  }
}
```

`provider.resourcePolicy` ではなく **`provider.apiGateway.resourcePolicy` が正**。
Serverless Framework のスキーマ定義（`lib/plugins/aws/provider.js`）と
CloudFormation への反映処理（`lib/plugins/aws/package/compile/events/api-gateway/lib/rest-api.js:62`）の
両方で参照先を確認した。

`onboarding-api` にテストは存在しない。`onboarding-account-manager` は ESLint のみ実行し、指摘なし。

## 残課題

- フェーズ 3（Apache の多層防御）
- `/tools/*` と `/segment-update` に認証機構が無く、本対応は IP 制限による暫定措置
- EC2 の FTP（20/21）と 40000-40010 / 60001-60010 が `0.0.0.0/0` に開いている
- ALB の両ターゲットグループが `unhealthy` 状態のまま
