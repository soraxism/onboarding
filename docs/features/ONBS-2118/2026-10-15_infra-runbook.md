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
| `tools-api.onboarding-app.io` | **作成済み・マッピング済み**（prod / `4gg04tjv40`） | `d-1wjm068e34.execute-api.ap-northeast-1.amazonaws.com` |
| `dev-tools-api.onboarding-app.io` | **作成済み・マッピング済み**（dev / `typ566gsc5`） | `d-c3lkajncv1.execute-api.ap-northeast-1.amazonaws.com` |

1-1 と 1-2 は実施済み。**次は 1-3 の Cloudflare DNS 登録（管理画面作業）。**

### 1-2. ベースパスマッピングを作る

```bash
aws apigateway create-base-path-mapping --region ap-northeast-1 \
  --domain-name tools-api.onboarding-app.io --rest-api-id 4gg04tjv40 --stage prod

aws apigateway create-base-path-mapping --region ap-northeast-1 \
  --domain-name dev-tools-api.onboarding-app.io --rest-api-id typ566gsc5 --stage dev
```

### 1-3. Cloudflare に DNS を登録する（管理画面）

| 項目 | 値 |
| --- | --- |
| タイプ | CNAME |
| 名前 | `tools-api` / `dev-tools-api` |
| 内容 | 1-1 で得た `d-xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com` |
| プロキシ | **DNS only（グレークラウド）** |

**オレンジクラウド（プロキシ）にしないこと。** プロキシすると API Gateway から見た送信元が
Cloudflare のエッジ IP になり、リソースポリシーが VPN の IP を判定できず全て拒否される。

反映確認。

```bash
dig +short tools-api.onboarding-app.io      # d-xxxx... が返り、Cloudflare の IP でないこと
```

### 1-4. デプロイ

`hotfixes/ONBS-2118` を `release` 経由で `main` へマージすると GitHub Actions が prod へデプロイする。
dev へ反映する場合は `develop` へマージする（CLAUDE.md「dev 環境へのデプロイ」）。

リソースポリシーはステージへの再デプロイで反映される。`serverless deploy` がこれを行うため、
手動の `create-deployment` は不要。

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

### 2-1. 既存ルールの優先度をずらす

新ルールを 1・2 に入れるため、既存の 1・2 を 3・4 へ移す。`set-rule-priorities` は原子的に適用される。

```bash
LISTENER=arn:aws:elasticloadbalancing:ap-northeast-1:091413534636:listener/app/onboarding-dev/fd7258130f2b6515/f1c4c824c08b7b28

aws elbv2 set-rule-priorities --region ap-northeast-1 --rule-priorities \
  RuleArn=arn:aws:elasticloadbalancing:ap-northeast-1:091413534636:listener-rule/app/onboarding-dev/fd7258130f2b6515/f1c4c824c08b7b28/d627b2bb7d8e6681,Priority=3 \
  RuleArn=arn:aws:elasticloadbalancing:ap-northeast-1:091413534636:listener-rule/app/onboarding-dev/fd7258130f2b6515/f1c4c824c08b7b28/a6eba844377ef9af,Priority=4
```

### 2-2. 許可ルールと拒否ルールを作る

ホストは **5 つすべてを列挙する**。`dev.onboarding.co.jp` だけでは `dev-api` と `dev-beacon` から素通りする
（設計書 1-2 を参照）。

```bash
HOSTS='["dev.onboarding.co.jp","dev-api.onboarding.co.jp","dev-beacon.onboarding.co.jp","dev-reporting.onboarding.co.jp","gallery.onboarding-app.io"]'
TG=arn:aws:elasticloadbalancing:ap-northeast-1:091413534636:targetgroup/Onboarding-dev/bc28151160618278

# 優先度 1: VPN からの /tools/* を通す
aws elbv2 create-rule --region ap-northeast-1 --listener-arn $LISTENER --priority 1 \
  --conditions "[{\"Field\":\"host-header\",\"HostHeaderConfig\":{\"Values\":$HOSTS}},
                 {\"Field\":\"path-pattern\",\"PathPatternConfig\":{\"Values\":[\"/tools/*\"]}},
                 {\"Field\":\"source-ip\",\"SourceIpConfig\":{\"Values\":[\"153.125.137.243/32\"]}}]" \
  --actions "[{\"Type\":\"forward\",\"TargetGroupArn\":\"$TG\"}]"

# 優先度 2: それ以外の /tools/* を拒否する
aws elbv2 create-rule --region ap-northeast-1 --listener-arn $LISTENER --priority 2 \
  --conditions "[{\"Field\":\"host-header\",\"HostHeaderConfig\":{\"Values\":$HOSTS}},
                 {\"Field\":\"path-pattern\",\"PathPatternConfig\":{\"Values\":[\"/tools/*\"]}}]" \
  --actions '[{"Type":"fixed-response","FixedResponseConfig":{"StatusCode":"403","ContentType":"text/plain","MessageBody":"Forbidden"}}]'
```

HTTP リスナー（80）は HTTPS へリダイレクトするだけなので、制限は HTTPS 側だけでよい。

### 2-3. EC2 の直叩きを塞ぐ（SG の分離）

**ALB と EC2 が SG を共有しているため、既存 SG の `0.0.0.0/0` を消してはならない。**
消すと ALB 自身が外部からの接続を受けられなくなる。EC2 用の SG を新設して差し替える。

```bash
# 1) EC2 専用の SG を作る
SG_EC2=$(aws ec2 create-security-group --region ap-northeast-1 \
  --group-name onboarding-dev-ec2 \
  --description "onboarding-dev EC2 (ALB からの HTTP のみ)" \
  --vpc-id <VPC_ID> --query 'GroupId' --output text)

# 2) ALB の SG からの 80 のみ許可する
aws ec2 authorize-security-group-ingress --region ap-northeast-1 \
  --group-id $SG_EC2 --protocol tcp --port 80 --source-group sg-0f8d08ae1663d8f2b

# 3) SSH は従来どおり踏み台の SG から
aws ec2 authorize-security-group-ingress --region ap-northeast-1 \
  --group-id $SG_EC2 --protocol tcp --port 22 --source-group sg-0d222818fd975c6a9

# 4) EC2 の SG を差し替える
aws ec2 modify-instance-attribute --region ap-northeast-1 \
  --instance-id i-0d78a0c019c2a71ea --groups $SG_EC2
```

**差し替え前に FTP の利用有無を確認すること。** 現行 SG では 20 / 21 / 40000-40010 / 60001-60010 が
`0.0.0.0/0` に開いている。使われているなら新 SG にも同等のルールが要る。
使われていないなら、この機会に閉じる（本手順では引き継いでいない）。

SSH は `ProxyCommand` で `onb-gw`（`18.180.20.230`）を経由しており、踏み台の SG
`sg-0d222818fd975c6a9` からの 22 番を許可すれば従来どおり接続できる。

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

API を先に行う。画面には BASIC 認証があるが、API には認証が無く現に素通しのため。

```
1. フェーズ1（API）  … 1-1 → 1-2 → 1-3 → 1-4 → 1-5
2. フロントのリリース … onboarding-account-manager を rsync でデプロイ
3. フェーズ2（ALB・SG）… 2-1 → 2-2 → 2-3 → 2-4
```

**フロントのリリースはフェーズ 1 の後に行う。** 専用ドメインが出来る前に向き先を変えると管理ツールが動かなくなる。
`onboarding-account-manager` は CI が無く、`scripts/deploy.sh`（rsync）による手動デプロイ。

## 残課題

- フェーズ 3（Apache の `mod_remoteip` + `Require ip`）。vhost 追加時の取りこぼしを恒久的に防ぐ多層防御
- `/tools/*` と `/segment-update` に認証機構が無い。IP 制限は暫定措置
- EC2 の FTP（20/21）と 40000-40010 / 60001-60010 が `0.0.0.0/0` に開いている
- ALB の両ターゲットグループが `unhealthy` 状態のまま
