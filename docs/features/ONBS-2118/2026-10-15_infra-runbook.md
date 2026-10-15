# ONBS-2118 インフラ作業手順

- Jira: https://onboarding-app.atlassian.net/browse/ONBS-2118
- 方式の根拠: [2026-10-15_access-restriction-design.md](2026-10-15_access-restriction-design.md)
- 対象フェーズ: **1（API）と 2（ALB・SG）**。フェーズ 3（Apache）は別途
- 許可する送信元: `153.125.137.243/32`（弊社 VPN の出口）

## 前提

| 項目 | 値 |
| --- | --- |
| AWS アカウント | `091413534636` |
| リージョン | `ap-northeast-1` |
| ACM 証明書 | `arn:aws:acm:ap-northeast-1:091413534636:certificate/c8e2bace-3cb9-4ef0-acdc-9c06872c1e92`（`*.onboarding-app.io`） |
| ALB | `arn:aws:elasticloadbalancing:ap-northeast-1:091413534636:loadbalancer/app/onboarding-dev/fd7258130f2b6515` |
| HTTPS リスナー | `.../listener/app/onboarding-dev/fd7258130f2b6515/f1c4c824c08b7b28` |
| TG `Onboarding-dev` | `.../targetgroup/Onboarding-dev/bc28151160618278` |
| EC2 | `i-0d78a0c019c2a71ea`（`18.177.122.187`） |
| SG（ALB と EC2 で共有） | `sg-0f8d08ae1663d8f2b` |

**Cloudflare の DNS 操作には管理画面での作業が必要。** 手元のトークンは Zone:Read と Cache Purge のみで、
DNS レコードを作成する権限が無い。

---

## フェーズ 1: API

### 1-1. カスタムドメインを作成する

prod と dev の両方を作る。dev も Cloudflare 経由のため同じ対処が要る。

```bash
# prod
aws apigateway create-domain-name --region ap-northeast-1 \
  --domain-name tools-api.onboarding-app.io \
  --regional-certificate-arn arn:aws:acm:ap-northeast-1:091413534636:certificate/c8e2bace-3cb9-4ef0-acdc-9c06872c1e92 \
  --endpoint-configuration types=REGIONAL \
  --security-policy TLS_1_2 \
  --query 'regionalDomainName' --output text

# dev
aws apigateway create-domain-name --region ap-northeast-1 \
  --domain-name dev-tools-api.onboarding-app.io \
  --regional-certificate-arn arn:aws:acm:ap-northeast-1:091413534636:certificate/c8e2bace-3cb9-4ef0-acdc-9c06872c1e92 \
  --endpoint-configuration types=REGIONAL \
  --security-policy TLS_1_2 \
  --query 'regionalDomainName' --output text
```

出力される `d-xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com` を 1-3 で使う。

**`CreateDomainName` はレート制限が厳しい。** 連続で叩くと `TooManyRequestsException` になるため、
prod と dev は間隔を空けて 1 件ずつ実行する。

#### 実施状況（2026-10-15）

| ドメイン | 状態 | regionalDomainName |
| --- | --- | --- |
| `tools-api.onboarding-app.io` | **カスタムドメイン作成・マッピング済み**（prod / `4gg04tjv40`） | `d-1wjm068e34.execute-api.ap-northeast-1.amazonaws.com` |
| `dev-tools-api.onboarding-app.io` | **カスタムドメイン作成・マッピング済み**（dev / `typ566gsc5`） | `d-c3lkajncv1.execute-api.ap-northeast-1.amazonaws.com` |

**DNS（1-3）は未登録の状態にしておく。** 「実施順序」のとおり、リソースポリシーを適用してから紐づける。

#### 一度登録して外した経緯（2026-10-15）

手順の誤りにより、リソースポリシー適用前に DNS を登録した（変更 ID `C0163703112YPDH89APQD`）。
約 5 分後に削除。この間の Lambda 呼び出しは確認作業の 3 件（prod 2 / dev 1）のみで、
第三者のアクセスは観測されていない。

登録時の到達確認では、Cloudflare を経由せず API Gateway へ直接届くことを確認できた。
この経路自体は設計どおりである。

```
$ dig +short tools-api.onboarding-app.io
16.76.173.248 / 35.75.124.4 / 13.192.27.43    ← AWS の IP（Cloudflare の 104.x / 172.66.x ではない）

$ curl -sI https://tools-api.onboarding-app.io/tools/accounts
HTTP/2 200
x-amzn-requestid: ...                          ← cf-ray も server: cloudflare も付かない
```

### 1-2. ベースパスマッピングを作る

```bash
aws apigateway create-base-path-mapping --region ap-northeast-1 \
  --domain-name tools-api.onboarding-app.io --rest-api-id 4gg04tjv40 --stage prod

aws apigateway create-base-path-mapping --region ap-northeast-1 \
  --domain-name dev-tools-api.onboarding-app.io --rest-api-id typ566gsc5 --stage dev
```

### 1-3. Route53 に DNS を登録する

**Cloudflare の管理画面ではなく Route53 で行う。**

`onboarding-app.io` は **Route53 が権威 DNS** で、Cloudflare は CNAME setup（partial）により
特定ホストのみを経由させている。ゾーン内に 2 つのパターンが混在している。

| パターン | レコード型 | 例 | Cloudflare |
| --- | --- | --- | --- |
| `*.cdn.cloudflare.net` を指す | CNAME | `api` / `dev-api` / `v2api` / `dev-v2api` | **経由する** |
| API Gateway を指す ALIAS | A | `editor-api` / `manage-api` / `viewer-api` / `screenshot-api` | **経由しない** |

管理ツール専用ドメインは Cloudflare を経由させたくないため、**後者（ALIAS）と同じ形で作る**。
この構成では「プロキシを DNS only にする」操作自体が不要で、Cloudflare 側の作業は発生しない。

`Z1YSHQZHG15GKL` は API Gateway（ap-northeast-1）のホストゾーン ID で、既存の `editor-api` と同一。

```bash
aws route53 change-resource-record-sets --hosted-zone-id ZHAD232M1QO6V --change-batch '{
  "Comment": "ONBS-2118 管理ツール専用ドメイン(Cloudflare非経由)",
  "Changes": [
    {"Action":"CREATE","ResourceRecordSet":{"Name":"tools-api.onboarding-app.io","Type":"A","AliasTarget":{"HostedZoneId":"Z1YSHQZHG15GKL","DNSName":"d-1wjm068e34.execute-api.ap-northeast-1.amazonaws.com.","EvaluateTargetHealth":true}}},
    {"Action":"CREATE","ResourceRecordSet":{"Name":"dev-tools-api.onboarding-app.io","Type":"A","AliasTarget":{"HostedZoneId":"Z1YSHQZHG15GKL","DNSName":"d-c3lkajncv1.execute-api.ap-northeast-1.amazonaws.com.","EvaluateTargetHealth":true}}}
  ]
}'
```

反映確認。Cloudflare の IP（`104.x` / `172.66.x`）ではなく API Gateway の IP が返ること。

```bash
dig +short tools-api.onboarding-app.io
dig +short dev-tools-api.onboarding-app.io
curl -s -o /dev/null -w "%{http_code}\n" https://tools-api.onboarding-app.io/tools/accounts
```

ロールバックは同じ change-batch の `"Action"` を `"DELETE"` に変えて実行する。

### 1-4. デプロイ

`hotfixes/ONBS-2118` を `release` 経由で `main` へマージすると GitHub Actions が prod へデプロイする。

リソースポリシーはステージへの再デプロイで反映される。`serverless deploy` がこれを行うため、
手動の `create-deployment` は不要。

#### prod だけでは終わらない。dev のデプロイを必ず別途起動する

**`main` へのマージで `develop` のコードは同期されるが、dev へのデプロイは起動しない。**
リソースポリシーは `serverless.yml` に書くため dev ステージにも適用されるべきだが、
デプロイしない限り dev API（`typ566gsc5`）のポリシーは `None` のまま残る。

2026-10-15 の作業では、これを見落として `dev-tools-api.onboarding-app.io` を
**制限が効いていない状態で DNS 登録してしまった**（prod は 403、dev は 200 で通過）。

```bash
# develop に変更が入っていることを確認
git show origin/develop:src/serverless.yml | grep -c resourcePolicy

# dev のポリシーを確認（None なら未適用）
aws apigateway get-rest-api --region ap-northeast-1 --rest-api-id typ566gsc5 --query 'policy' --output text

# dev デプロイを手動起動（development.yml に workflow_dispatch がある）
gh workflow run "Build and Deploy (development)" --repo stands/Onboarding-API --ref develop
```

**DNS を登録する前に、prod と dev の両方でポリシーが適用済みであることを確認する。**

### 1-5. 検証

```bash
# VPN 外から — 管理 API が 403 になること
curl -s -o /dev/null -w "%{http_code}\n" https://api.onboarding-app.io/tools/accounts
curl -s -o /dev/null -w "%{http_code}\n" https://4gg04tjv40.execute-api.ap-northeast-1.amazonaws.com/prod/tools/accounts
curl -s -o /dev/null -w "%{http_code}\n" https://tools-api.onboarding-app.io/tools/accounts
# いずれも 403 を期待

# VPN 接続後 — 専用ドメインのみ 200 になること
curl -s -o /dev/null -w "%{http_code}\n" https://tools-api.onboarding-app.io/tools/accounts   # 200
curl -s -o /dev/null -w "%{http_code}\n" https://api.onboarding-app.io/tools/accounts          # 403（Cloudflare 経由のため）

# 配信 API が影響を受けないこと（VPN の内外どちらでも 200）
curl -s -o /dev/null -w "%{http_code}\n" https://api.onboarding-app.io/v1/onboarding-init
```

#### 配信 API にパラメータなしのリクエストを投げないこと

**`/decision` `/embed` `/v1/targets` へパラメータ無しで GET すると Lambda が 500 を返し、
CloudWatch アラームが `@channel` で発報する。**

| アラーム | 条件 |
| --- | --- |
| `TEPCO_DECISION_CloudWatch_Alarms` | `onboarding-api-prod` の `(GET)/decision` で 1 時間以内に 1 件以上の 500 |
| `TEPCO_EMBED_CloudWatch_Alarms` | 同 `(GET)/embed` |
| `TEPCO_TARGETS_CloudWatch_Alarms` | 同 `(GET)/v1/targets` |

2026-10-15 の作業で、リソースポリシーが配信 API を拒否していないことを確かめようとして
execute-api に直接 GET を投げ、3 つとも発報させた（Decision 3 件 / Embed 2 件 / Targets 2 件）。
データ変更は無く顧客影響も無いが、不要な通知を飛ばすことになる。

**リソースポリシーの適用範囲は実リクエストを投げずに確認できる。**

```bash
aws apigateway get-rest-api --region ap-northeast-1 --rest-api-id 4gg04tjv40 --query 'policy' --output text
```

遮断されているかを実リクエストで判定する必要がある場合は、レスポンス本文で切り分ける。

| 本文 | 意味 |
| --- | --- |
| `{"Message":"User: anonymous is not authorized to perform: execute-api:Invoke..."}` | リソースポリシーによる Deny |
| `{"message":"Missing Authentication Token"}` | パス・メソッドの組み合わせが存在しない（POST 専用を GET した等） |
| `{"message": "Internal server error"}` | **Lambda まで到達している**（＝ Deny されていない）。ただしこれがアラームの原因になる |

アラームは発生から 1 時間で OK に戻る。

**`api.onboarding-app.io/tools/*` は VPN 内からも 403 になる。** 送信元が Cloudflare の IP になるため。
これは設計どおりで、管理ツールは専用ドメインを向くよう変更済み。

### 1-6. ロールバック

```bash
# serverless.yml の resourcePolicy を削除して再デプロイするのが正。
# 緊急時のみ、ポリシーを直接外してステージを再デプロイする
aws apigateway update-rest-api --region ap-northeast-1 --rest-api-id 4gg04tjv40 \
  --patch-operations op=replace,path=/policy,value=''
aws apigateway create-deployment --region ap-northeast-1 --rest-api-id 4gg04tjv40 --stage-name prod
```

---

## フェーズ 2: ALB とセキュリティグループ

### 2-1. 既存ルールを 1 本だけ移動する

**コーポレート（`onboarding.co.jp` / `www`）の pri 1 は動かさない。** `/tools/*` の制限ルールは
既存 pri 2 より前にあれば足り、pri 1 より前である必要がない（ホストが重複しないため）。
移動するのは既存 pri 2 の 1 本だけ。

```
pri 1  [既存・不変]  onboarding.co.jp / www        → forward onboarding-lp-prd
pri 2  [新規]        5ホスト + /tools/* + VPN IP   → forward Onboarding-dev
pri 3  [新規]        5ホスト + /tools/*            → fixed-response 403
pri 4  [既存を移動]  5ホスト                        → forward Onboarding-dev
```

```bash
LISTENER=arn:aws:elasticloadbalancing:ap-northeast-1:091413534636:listener/app/onboarding-dev/fd7258130f2b6515/f1c4c824c08b7b28

aws elbv2 set-rule-priorities --region ap-northeast-1 --rule-priorities \
  RuleArn=arn:aws:elasticloadbalancing:ap-northeast-1:091413534636:listener-rule/app/onboarding-dev/fd7258130f2b6515/f1c4c824c08b7b28/a6eba844377ef9af,Priority=4
```

移動中は pri 2・3 が空くが、5 ホストへのアクセスは pri 4 が従来どおり処理するためダウンタイムは生じない。

### 2-2. 許可ルールと拒否ルールを作る

ホストは **5 つすべてを列挙する**。`dev.onboarding.co.jp` だけでは `dev-api` と `dev-beacon` から素通りする
（設計書 1-2 を参照）。`path-pattern` は `/tools/*` のみを対象とするため、
`/demo/` `/iguider/` は pri 4 で従来どおり通り、影響を受けない。

```bash
HOSTS='["dev.onboarding.co.jp","dev-api.onboarding.co.jp","dev-beacon.onboarding.co.jp","dev-reporting.onboarding.co.jp","gallery.onboarding-app.io"]'
TG=arn:aws:elasticloadbalancing:ap-northeast-1:091413534636:targetgroup/Onboarding-dev/bc28151160618278

# 優先度 2: VPN からの /tools/* を通す
aws elbv2 create-rule --region ap-northeast-1 --listener-arn $LISTENER --priority 2 \
  --conditions "[{\"Field\":\"host-header\",\"HostHeaderConfig\":{\"Values\":$HOSTS}},
                 {\"Field\":\"path-pattern\",\"PathPatternConfig\":{\"Values\":[\"/tools/*\"]}},
                 {\"Field\":\"source-ip\",\"SourceIpConfig\":{\"Values\":[\"153.125.137.243/32\"]}}]" \
  --actions "[{\"Type\":\"forward\",\"TargetGroupArn\":\"$TG\"}]"

# 優先度 3: それ以外の /tools/* を拒否する
aws elbv2 create-rule --region ap-northeast-1 --listener-arn $LISTENER --priority 3 \
  --conditions "[{\"Field\":\"host-header\",\"HostHeaderConfig\":{\"Values\":$HOSTS}},
                 {\"Field\":\"path-pattern\",\"PathPatternConfig\":{\"Values\":[\"/tools/*\"]}}]" \
  --actions '[{"Type":"fixed-response","FixedResponseConfig":{"StatusCode":"403","ContentType":"text/plain","MessageBody":"Forbidden"}}]'
```

HTTP リスナー（80）は HTTPS へリダイレクトするだけなので、制限は HTTPS 側だけでよい。

### 2-3. EC2 の直叩きを塞ぐ（SG の分離）

**ALB と EC2 が SG を共有しているため、既存 SG の `0.0.0.0/0` を消してはならない。**
消すと ALB 自身が外部からの接続を受けられなくなる。EC2 用の SG を新設して差し替える。

#### EC2 の実状（2026-10-15 確認）

| 項目 | 結果 |
| --- | --- |
| listen しているポート | **80 と 21（FTP）のみ** |
| 443 | **listen していない**。ALB が終端し EC2 へは 80 で転送している |
| FTP（21） | 外部から接続可能で、現に稼働している |

したがって新 SG では **443 を引き継がない**（EC2 が開いていないため不要）。
**FTP 関連（20 / 21 / 40000-40010 / 60001-60010）はそのまま引き継ぎ、現行の運用に影響を出さない。**

```bash
VPC_ID=$(aws ec2 describe-instances --region ap-northeast-1 \
  --instance-ids i-0d78a0c019c2a71ea --query 'Reservations[0].Instances[0].VpcId' --output text)

# 1) EC2 専用の SG を作る
SG_EC2=$(aws ec2 create-security-group --region ap-northeast-1 \
  --group-name onboarding-dev-ec2 \
  --description "onboarding-dev EC2 (HTTP は ALB 経由のみ)" \
  --vpc-id $VPC_ID --query 'GroupId' --output text)

# 2) HTTP は ALB の SG からのみ
aws ec2 authorize-security-group-ingress --region ap-northeast-1 \
  --group-id $SG_EC2 --protocol tcp --port 80 --source-group sg-0f8d08ae1663d8f2b

# 3) SSH は踏み台の SG から（現行どおり）
aws ec2 authorize-security-group-ingress --region ap-northeast-1 \
  --group-id $SG_EC2 --protocol tcp --port 22 --source-group sg-0d222818fd975c6a9

# 4) FTP は現行のまま引き継ぐ（稼働中のため閉じない）
aws ec2 authorize-security-group-ingress --region ap-northeast-1 \
  --group-id $SG_EC2 --ip-permissions \
    'IpProtocol=tcp,FromPort=20,ToPort=21,IpRanges=[{CidrIp=0.0.0.0/0}]' \
    'IpProtocol=tcp,FromPort=40000,ToPort=40010,IpRanges=[{CidrIp=0.0.0.0/0}]' \
    'IpProtocol=tcp,FromPort=60001,ToPort=60010,IpRanges=[{CidrIp=0.0.0.0/0}]'

# 5) EC2 の SG を差し替える
aws ec2 modify-instance-attribute --region ap-northeast-1 \
  --instance-id i-0d78a0c019c2a71ea --groups $SG_EC2
```

#### 適用前に確認すること

**EC2 のパブリック IP に直打ちしているアクセスが無いか。** あると `/demo/` `/iguider/` を
IP 指定で開いている開発者に影響が出る（ドメイン経由なら影響しない）。

mod_remoteip が未設定のため、ALB 経由のアクセスはログに ALB の内部 IP（`172.31.x.x`）として記録される。
**`172.31.` 以外の送信元が出てくれば、それが ALB を迂回した直アクセス。**

```bash
sudo awk '{print $1}' /etc/httpd/logs/access_log | grep -v '^172\.31\.' | sort | uniq -c | sort -rn | head
```

何も出なければ直打ちのアクセスは無く、そのまま適用してよい。

### 2-4. 検証

```bash
# VPN 外から — /tools 配下が 403 になること
curl -s -o /dev/null -w "%{http_code}\n" https://dev.onboarding.co.jp/tools/manager/
curl -s -o /dev/null -w "%{http_code}\n" https://dev-api.onboarding.co.jp/tools/manager/
curl -s -o /dev/null -w "%{http_code}\n" https://dev-beacon.onboarding.co.jp/tools/manager/
curl -s -o /dev/null -w "%{http_code}\n" https://dev.onboarding.co.jp/tools/developer/
# いずれも 403 を期待（従来は 401）

# EC2 直叩きが到達しないこと
curl -s -o /dev/null -w "%{http_code}\n" -m 10 http://18.177.122.187/tools/manager/
# 接続タイムアウトを期待

# 同居コンテンツが影響を受けないこと
curl -s -o /dev/null -w "%{http_code}\n" https://dev.onboarding.co.jp/demo/        # 401 のまま
curl -s -o /dev/null -w "%{http_code}\n" https://dev.onboarding.co.jp/iguider/     # 401 のまま
curl -s -o /dev/null -w "%{http_code}\n" https://onboarding.co.jp/                 # 200 のまま
curl -s -o /dev/null -w "%{http_code}\n" https://gallery.onboarding-app.io/        # 変化しないこと

# VPN 接続後 — 従来どおり BASIC 認証が出ること
curl -s -o /dev/null -w "%{http_code}\n" https://dev.onboarding.co.jp/tools/manager/   # 401
```

### 2-5. ロールバック

```bash
# 作成した 2 ルールを削除し、既存ルールの優先度を 1・2 に戻す
aws elbv2 delete-rule --region ap-northeast-1 --rule-arn <新ルールのARN>
aws elbv2 set-rule-priorities --region ap-northeast-1 --rule-priorities \
  RuleArn=<旧pri1のARN>,Priority=1 RuleArn=<旧pri2のARN>,Priority=2

# SG を元に戻す
aws ec2 modify-instance-attribute --region ap-northeast-1 \
  --instance-id i-0d78a0c019c2a71ea --groups sg-0f8d08ae1663d8f2b
```

---

## 実施順序

**DNS の紐づけは、IP 制限が効いたあとに行う。**

`onboarding-app.io` はセキュリティインシデントにより探索されている可能性があるため、
リソースポリシー未適用のまま DNS を向けると、**無防備な新しい攻撃面を公開することになる**。
ダウンタイムを許容してでも、制限を先に効かせる（2026-10-15 判断）。

```
1. 1-1 / 1-2    カスタムドメイン作成・ベースパスマッピング       ← 完了済み
2. 1-4          onboarding-api をデプロイ（リソースポリシー適用）
3. 1-3          Route53 に DNS を登録
4.              フロントを rsync デプロイ
5. 1-5          検証
6. フェーズ2     2-1 → 2-2 → 2-3 → 2-4
```

**ステップ 2 〜 4 の間、管理ツールは停止する。** `api.onboarding-app.io/tools/*` は
送信元が Cloudflare の IP と判定されて 403 になり、専用ドメインはまだ DNS が無いため到達できない。

### カスタムドメインを残したまま DNS だけ外してよい理由

API Gateway のカスタムドメインは **Host ヘッダが一致しないと振り分けられない**。
DNS が無ければドメイン名の発見が困難で、`regionalDomainName` に直接アクセスしても到達しない。
証明書はワイルドカード（`*.onboarding-app.io`）のため、証明書透明性ログにも個別名は出ない。

### DNS を一時的に外す

誤って先に登録してしまった場合は、`"Action"` を `"DELETE"` にして同じ change-batch を実行する。

```bash
aws route53 change-resource-record-sets --hosted-zone-id ZHAD232M1QO6V --change-batch '{
  "Comment": "ONBS-2118 IP制限適用まで一時削除",
  "Changes": [
    {"Action":"DELETE","ResourceRecordSet":{"Name":"tools-api.onboarding-app.io","Type":"A","AliasTarget":{"HostedZoneId":"Z1YSHQZHG15GKL","DNSName":"d-1wjm068e34.execute-api.ap-northeast-1.amazonaws.com.","EvaluateTargetHealth":true}}},
    {"Action":"DELETE","ResourceRecordSet":{"Name":"dev-tools-api.onboarding-app.io","Type":"A","AliasTarget":{"HostedZoneId":"Z1YSHQZHG15GKL","DNSName":"d-c3lkajncv1.execute-api.ap-northeast-1.amazonaws.com.","EvaluateTargetHealth":true}}}
  ]
}'
```

`DELETE` は `ResourceRecordSet` が登録内容と完全一致している必要がある。

`onboarding-account-manager` は CI が無く、`scripts/deploy.sh`（rsync）による手動デプロイ。

## 残課題

- フェーズ 3（Apache の `mod_remoteip` + `Require ip`）。vhost 追加時の取りこぼしを恒久的に防ぐ多層防御
- `/tools/*` と `/segment-update` に認証機構が無い。IP 制限は暫定措置
- EC2 の FTP（20/21）と 40000-40010 / 60001-60010 が `0.0.0.0/0` に開いている。
  **本対応では現行の運用に影響を出さないため現状維持とする**（2026-10-15 判断）。
  FTP は認証情報が平文で流れるため、恒久的には SFTP への移行や送信元の限定を別途検討する余地がある
- ALB の両ターゲットグループが `unhealthy` 状態のまま
