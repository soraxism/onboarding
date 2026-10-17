# ONBS-2118 アカウント管理ツールを VPN 経由の特定 IP のみに制限する

- Jira: https://onboarding-app.atlassian.net/browse/ONBS-2118
- 親エピック: ONBS-2109 不正アクセス関連の対応
- 方式の精査: [2026-10-15_access-restriction-design.md](2026-10-15_access-restriction-design.md)
- 作業手順・検証・ロールバック: [2026-10-15_infra-runbook.md](2026-10-15_infra-runbook.md)

本書は **実装した内容**を記載している（2026-10-18 更新）。起票時の計画から変更した点は「実装上の判断」に記す。

## 問題点

アカウントおよびプロダクトを作成・編集できるアカウント管理ツールが、実質的に無防備な状態にあった。

### フロント（`onboarding-account-manager`）

- URL: `https://dev.onboarding.co.jp/tools/manager/`
- 経路: ALB `onboarding-dev` → EC2 `i-0d78a0c019c2a71ea`（`18.177.122.187`）/ Apache 2.4.54
- 防御は **BASIC 認証のみ**。`/home/ftpuser/html/.htaccess` でドキュメントルート全体に適用されていた
- **EC2 のパブリック IP 直叩きで ALB を迂回できた**
- `dev-beacon.onboarding.co.jp` は VirtualHost が未定義で default server にフォールバックするため、
  `dev.onboarding.co.jp` 以外のホストからも `/tools/manager/` に到達できた（`dev-api.onboarding.co.jp` も同様）
- ALB と EC2 が SG `sg-0f8d08ae1663d8f2b` を共有し、80 / 443 / 20 / 21 / 40000-40010 / 60001-60010 が `0.0.0.0/0` に開いていた

### バック（`onboarding-api`）

- **認証が一切無かった。BASIC 認証もかかっていない**
- `GET https://api.onboarding-app.io/tools/accounts` が無認証で `200` を返した（全アカウント一覧 8,839 bytes）
- execute-api 直叩きでも同一レスポンス。Cloudflare を完全に迂回できた
- `handler.py` に認証チェックのコードが無く、CORS も `ALLOW_ORIGIN = "*"`
- 管理ツール専用エンドポイントは `/tools/*` だけではなく、**`/segment-update`（ガイド JSON の本番反映）も対象**。
  参照元はリポジトリ横断で `onboarding-account-manager` の 1 箇所のみ
- 同じ API Gateway に顧客向け配信 API が同居するため、**API 全体への IP 制限は配信停止を招く**
- dev（`dev-api.onboarding-app.io`）も同じ状態

## 対応内容

VPN の出口 IP `153.125.137.243/32` のみに制限した。

### フェーズ 1: API

管理ツール専用のカスタムドメインを新設し、**Route53 の ALIAS（A）レコード**で API Gateway を直接指した。

| ステージ | API ID | 専用ドメイン | regionalDomainName |
| --- | --- | --- | --- |
| prod | `4gg04tjv40` | `tools-api.onboarding-app.io` | `d-1wjm068e34.execute-api.ap-northeast-1.amazonaws.com` |
| dev | `typ566gsc5` | `dev-tools-api.onboarding-app.io` | `d-c3lkajncv1.execute-api.ap-northeast-1.amazonaws.com` |

その上で API Gateway のリソースポリシーで `/tools/*` と `/segment-update` を VPN IP のみに許可した。

```yaml
provider:
  apiGateway:
    shouldStartNameWithService: true
    resourcePolicy:
      - Effect: Allow
        Principal: "*"
        Action: execute-api:Invoke
        Resource:
          - execute-api:/*/*/*
      - Effect: Deny
        Principal: "*"
        Action: execute-api:Invoke
        Resource:
          - execute-api:/*/*/tools/*
          - execute-api:/*/*/segment-update
        Condition:
          NotIpAddress:
            aws:SourceIp: ${self:custom.toolsAllowedIps}
```

Cloudflare WAF ではなくリソースポリシーを採った理由は、ONBS-2110 で判明した
**Cloudflare 共用 IP による迂回**が API Gateway にも成立するため。
リソースポリシーは API Gateway 自身が評価するため、どの経路から来ても必ず効く。

配信 API は `Resource` の指定により対象外。`api.onboarding-app.io` 経由の `/tools/*` は
送信元が Cloudflare の IP になるため、同じポリシーで自動的に拒否される。

### フェーズ 2: ALB とセキュリティグループ

ALB `onboarding-dev` の HTTPS リスナーに 2 ルールを追加し、既存ルールを 1 本だけ移動した。

| 優先度 | 条件 | 動作 |
| --- | --- | --- |
| 1 | host `onboarding.co.jp` / `www` | forward `onboarding-lp-prd`（**変更していない**） |
| 2 | path `/tools/*` + source-ip `153.125.137.243/32` | forward `Onboarding-dev` |
| 3 | path `/tools/*` | fixed-response 403 |
| 4 | host 5 件（旧 pri 2 を移動） | forward `Onboarding-dev` |
| default | — | forward `onboarding-lp-prd` |

EC2 専用の SG `sg-09f1b18be58c59233`（`onboarding-dev-ec2`）を新設し、EC2 の SG を差し替えた。

| ポート | 許可元 | 備考 |
| --- | --- | --- |
| 80 | `sg-0f8d08ae1663d8f2b`（ALB） | **ここだけが実質の変更** |
| 22 | `sg-0d222818fd975c6a9`（踏み台） | 現行どおり |
| 20-21 / 40000-40010 / 60001-60010 | `0.0.0.0/0` | FTP。現状維持 |
| 443 | — | 引き継がない（EC2 が listen していない） |

BASIC 認証は多層防御として残している。

## 実装上の判断（起票時の計画からの変更）

### DNS は Cloudflare ではなく Route53 で登録した

起票時は「Cloudflare で DNS only（非プロキシ）登録」としていたが、調査の結果
`onboarding-app.io` は **Route53 が権威 DNS** で、Cloudflare は CNAME setup（partial）により
特定ホストのみを経由させる構成だった。

| パターン | レコード型 | 例 | Cloudflare |
| --- | --- | --- | --- |
| `*.cdn.cloudflare.net` を指す | CNAME | `api` / `dev-api` / `v2api` | 経由する |
| API Gateway を指す ALIAS | A | `editor-api` / `manage-api` / `viewer-api` | 経由しない |

後者と同じ ALIAS で作れば自動的に Cloudflare 非経由になるため、
**「DNS only にする」操作も Cloudflare 側の作業も発生しない**。

### ALB のルールに host-header 条件は付けていない

起票時は「ホストを 5 つ列挙する」としていたが、ALB は 1 ルールあたりの条件値が最大 5 個で、
ホスト 5 値 + パス 1 値 + IP 1 値 = 7 値となり作成できない。

```
An error occurred (ValidationError) when calling the CreateRule operation:
A rule can only have '5' condition values and regex values
```

host-header を外しても問題はなく、**むしろ安全になる**。

- コーポレート（`onboarding.co.jp` / `www`）は **pri 1 で先にマッチして確定する**ため、新ルールに到達しない
- ホストを列挙しないので、**将来 vhost が増えても自動的に守られる**（列挙漏れが起きない）
- `path-pattern` は `/tools/*` のみなので `/demo/` `/iguider/` は pri 4 で従来どおり通る

### 既存 SG は変更していない

`sg-0f8d08ae1663d8f2b` は **コーポレートサイトの EC2（`i-01d768c75392d8a32`）も使用中**で、
さらに ALB 自身もこの SG を使っている。`0.0.0.0/0` を消すと ALB が外部から接続を受けられなくなるため、
管理ツールの EC2 だけを新 SG に差し替えた。

### DNS は IP 制限が効いてから紐づけた

`onboarding-app.io` はインシデントにより探索されている可能性があるため、
リソースポリシー未適用のまま DNS を向けると無防備な攻撃面を公開することになる。
ダウンタイムを許容して制限を先に効かせた。

### prod と dev でデプロイ経路が別

`main` へのマージで `develop` のコードは同期されるが、**dev へのデプロイは起動しない**。
dev は `workflow_dispatch` で手動起動した。

## 影響範囲

| リポジトリ | 変更内容 | リリース |
| --- | --- | --- |
| `onboarding-api` | `src/serverless.yml` に `provider.apiGateway.resourcePolicy` を追加 | タグ `2.53.4` |
| `onboarding-account-manager` | `app/plugins/api.js` と `app/config/.env.dev` の向き先を専用ドメインへ変更 | rsync で手動デプロイ（タグ運用なし） |

コード外の作業はすべて AWS 内で完結した（Cloudflare 側の作業は発生していない）。

- API Gateway カスタムドメイン 2 件とベースパスマッピング
- Route53 ALIAS レコード 2 件
- ALB リスナールール 2 件追加、1 件移動
- EC2 専用 SG 1 件新設と差し替え

## 検証

CI と同じ `serverless@3.39.0` で `serverless package --stage prod` を実行し、
生成された CloudFormation の `AWS::ApiGateway::RestApi` に意図どおりの `Policy` が入ることを確認した。
`provider.resourcePolicy` ではなく **`provider.apiGateway.resourcePolicy` が正**
（スキーマ定義と `rest-api.js:62` の参照先で確認）。

SG 適用前に Apache のアクセスログを全期間確認し、
ALB 経由（`172.31.x.x`）以外の送信元が 1 件も無いことを確認している。

### 実機検証の結果

| 経路 | VPN 外 | VPN 内 |
| --- | --- | --- |
| `dev.onboarding.co.jp/tools/manager/` | **403** | 401（BASIC 認証） |
| `dev.onboarding.co.jp/tools/developer/` | **403** | 401 |
| `dev-api.onboarding.co.jp/tools/manager/`（vhost 迂回） | **403** | — |
| `tools-api.onboarding-app.io/tools/accounts` | **403** | 200 |
| `api.onboarding-app.io/tools/accounts` | **403** | 403（Cloudflare 経由のため常に拒否） |
| `http://18.177.122.187/tools/manager/`（ALB 迂回） | **到達せず** | **到達せず** |

影響が無いことも確認済み。

| 対象 | 結果 |
| --- | --- |
| `dev.onboarding.co.jp/demo/` `/iguider/` | 401（従来どおり） |
| `onboarding.co.jp/`（コーポレート） | 200 |
| `gallery.onboarding-app.io/` | 200 |
| SSH（踏み台経由） | 接続可 |
| FTP（21） | 接続可 |
| 配信 API（`/v1/onboarding-init` 等） | `Resource` の指定により対象外 |

ブラウザでの動作確認も完了。

`onboarding-api` にテストは存在しない。`onboarding-account-manager` は ESLint のみ実行し、指摘なし。

## 本チケットでは未対応とするもの

| 項目 | 内容 |
| --- | --- |
| フェーズ 3 | Apache の `mod_remoteip` + `Require ip` による多層防御。`<Directory>` は全 VirtualHost に効くため恒久的な取りこぼし防止になるが、現状 mod_remoteip が未設定で、設定ミス時に dev 環境全体を停止させうる |
| ONBS-2119 | json-update 画面の環境セレクタが機能せず常に本番データが更新される既存バグ |
| FTP の公開範囲 | 20/21 / 40000-40010 / 60001-60010 が `0.0.0.0/0`。現行の運用に影響を出さないため現状維持とした。平文認証のため恒久的には SFTP への移行等を検討する余地がある |
| API の認証 | `/tools/*` と `/segment-update` には認証機構そのものが無く、本対応は IP 制限による暫定措置 |
| ALB の TG | 両ターゲットグループが `unhealthy` 状態のまま運用されている |
