# アカウント管理ツールのアクセス制限 — 方式の精査

- Jira: https://onboarding-app.atlassian.net/browse/ONBS-2118
- 親エピック: ONBS-2109 不正アクセス関連の対応
- 調査日: 2026-10-15
- 許可する送信元: 弊社 VPN の出口 `153.125.137.243/32`

## 0. 結論

**「Apache の設定変更」と「専用ドメインの発行」は二者択一ではない。** 両者は別レイヤーを守るもので、
片方だけでは残る片方が無防備のまま残る。

| 守る対象 | 経路 | Apache 設定で塞げるか | 専用ドメイン＋リソースポリシーで塞げるか |
| --- | --- | --- | --- |
| 管理ツールの**画面** | ALB → EC2 → Apache | **○** | × |
| 管理ツールの **API** | Cloudflare → API Gateway → Lambda | **×（Apache を通らない）** | **○** |

**着手順は API 側が先。** 画面には BASIC 認証があるが、API には認証が一切なく、
現時点で誰でも全アカウント一覧を取得できる。画面を固めても API から素通しで取れる状態は変わらない。

```
$ curl -s -o /dev/null -w "%{http_code} %{size_download}\n" https://api.onboarding-app.io/tools/accounts
200 8839
```

## 1. 現状の構成

### 1-1. フロント

| 項目 | 値 |
| --- | --- |
| URL | `https://dev.onboarding.co.jp/tools/manager/` |
| 経路 | ALB `onboarding-dev`（internet-facing）→ EC2 `i-0d78a0c019c2a71ea`（`18.177.122.187`）:80 |
| Web サーバー | Apache 2.4.54 |
| DocumentRoot | `/home/ftpuser/html`（`demo` `iguider` `tools/manager` `tools/developer` が同居） |
| 認証 | `/home/ftpuser/html/.htaccess` による BASIC 認証のみ |

### 1-2. VirtualHost 構成（`httpd -S`）

```
*:80 is a NameVirtualHost
    default server dev.onboarding.co.jp          (httpd.conf:362)
    namevhost      gallery.onboarding-app.io     (:369)
    namevhost      dev-api.onboarding.co.jp      (:376)
    namevhost      dev-reporting.onboarding.co.jp(:403)
Main DocumentRoot: "/home/ftpuser/html"
```

**`dev-beacon.onboarding.co.jp` は VirtualHost が定義されていない。**
そのため default server（= `dev.onboarding.co.jp`）にフォールバックし、同じ DocumentRoot に到達する。
ALB を通る**未定義の Host すべて**が同様に落ちる。

実測した到達性は次のとおり。

| Host | `/tools/manager/` |
| --- | --- |
| `dev.onboarding.co.jp` | **401**（到達） |
| `dev-api.onboarding.co.jp` | **401**（到達） |
| `dev-beacon.onboarding.co.jp` | **401**（到達・vhost 未定義） |
| `gallery.onboarding-app.io` | 404 |
| `dev-reporting.onboarding.co.jp` | 404 |
| `18.177.122.187`（EC2 直叩き） | **401**（到達・ALB 迂回） |

**ALB のルールを `host-header = dev.onboarding.co.jp` で書くと、`dev-api` と `dev-beacon` から素通りする。**

### 1-3. バック

| 項目 | 値 |
| --- | --- |
| URL | `https://api.onboarding-app.io/tools/*` |
| API Gateway | `onboarding-api-prod` / `4gg04tjv40`（REGIONAL） |
| リソースポリシー | **未設定**（`policy: null`） |
| 認証 | **なし**。`handler.py` に認証チェックのコードが存在しない |
| CORS | `ALLOW_ORIGIN = "*"` |
| 同居 API | `onboarding-init` / `logger` / `targets` / `embed` / `decision`（顧客向け配信） |

配信 API が同居するため、**API 全体への IP 制限は配信の全停止を招く**。`/tools/*` に限定する必要がある。

### 1-4. 管理ツール専用エンドポイントは `/tools/*` だけではない

管理ツールの json-update 画面は `/segment-update`（ガイド JSON の本番反映）を PUT で叩いている。
`/tools/*` の外にあるため、パスだけで分類すると取りこぼす。

| エンドポイント | 用途 | 参照元 | 認証 |
| --- | --- | --- | --- |
| `/tools/accounts` | アカウント一覧・作成 | 管理ツール | **無し** |
| `/tools/products` | プロダクト一覧・更新・削除 | 管理ツール | **無し** |
| `/tools/pksha-linkage` | PKSHA 連携 | 管理ツール | **無し** |
| `/segment-update` | ガイド JSON の反映 | 管理ツール（`json-update.vue:112`） | **無し** |

`/segment-update` の参照元をリポジトリ横断で確認した結果、`onboarding-account-manager` の 1 箇所のみで、
`onboarding-manage-web` / `onboarding-manage-api` / `onboarding-batch` / `onboarding-web` /
`Onboarding-Editor-Extension` からの参照は無い。

過去 30 日の Lambda 呼び出し回数も人手の操作規模で、自動システムからの利用は見られない。

| 関数 | 30日間の呼び出し |
| --- | --- |
| `v1OnbApiSegmentUpdate-prod` | 14 |
| `v1OnbApiToolsAccount-prod` | 27 |
| `v1OnbApiToolsProducts-prod` | 39 |

以上より `/segment-update` も制限対象に含める。

`https://4gg04tjv40.execute-api.ap-northeast-1.amazonaws.com/prod/tools/accounts` でも
同一レスポンスが返り、Cloudflare を完全に迂回できる。

## 2. フロント側の方式比較

### F1. Apache の設定変更（mod_remoteip + Require ip）

```apache
# httpd.conf — Server config または VirtualHost スコープでのみ設定可能
RemoteIPHeader X-Forwarded-For
RemoteIPTrustedProxy 172.31.0.0/16

<Directory /home/ftpuser/html/tools>
    <RequireAll>
        Require ip 153.125.137.243
        Require valid-user
    </RequireAll>
</Directory>
```

| 観点 | 評価 |
| --- | --- |
| カバレッジ | **全 VirtualHost に効く。** `<Directory>` はファイルシステムパスに対する設定のため、1-2 の vhost 問題を一括で解決できる |
| 将来の漏れ | **無い。** vhost が増えてもパスが同じなら自動的に効く |
| 迂回可能性 | `RemoteIPTrustedProxy` を設定すれば XFF 偽装は不可。**設定を省くと偽装で素通りする** |
| 作業リスク | **高。** 構文エラーや設定ミスで Apache が起動失敗すると、`demo` `iguider` `gallery` `dev-api` `dev-reporting` を含む **dev 環境全体が停止**する |
| ロールバック | 設定ファイルを戻して reload。sudo を伴う手作業 |
| 現状の前提 | **mod_remoteip は未設定。** モジュールはロード済みだが `RemoteIP*` ディレクティブが 1 行も無く、アクセスログの送信元は ALB の内部 IP（`172.31.5.40` / `172.31.24.233`）が記録されている |

**`.htaccess` だけでは完結しない。** `RemoteIPHeader` は Server config / VirtualHost スコープ専用で、
`.htaccess` には書けない。mod_remoteip が未設定の現状で `.htaccess` に `Require ip` を書くと、
全アクセスが `172.31.x.x` と判定され**誰も通れなくなる**。

BASIC 認証と併記する際は `<RequireAll>` が必須。Apache 2.4 の既定は `<RequireAny>`（OR）のため、
素直に並べると「IP が合えばパスワード不要／パスワードが合えば任意の IP から通る」となり、かえって緩くなる。

### F2. ALB のリスナールール（source-ip 条件）

```
pri 1: host-header ∈ {5ホスト} AND path-pattern=/tools/* AND source-ip=153.125.137.243/32 → forward
pri 2: host-header ∈ {5ホスト} AND path-pattern=/tools/*                                   → fixed-response 403
pri 3: (既存 pri1) onboarding.co.jp / www → forward onboarding-lp-prd
pri 4: (既存 pri2) 5ホスト               → forward Onboarding-dev
```

| 観点 | 評価 |
| --- | --- |
| カバレッジ | ALB を通るトラフィックのみ。**EC2 パブリック IP の直叩きは塞げない**（SG での対処が別途必要） |
| 将来の漏れ | **有り得る。** ホストを列挙するため、vhost / ALB ルールが増えたときに追従が要る |
| 迂回可能性 | `source-ip` は TCP 接続元を見るため偽装不可 |
| 作業リスク | 中。既存ルールの優先度組み替えが必要。`set-rule-priorities` で原子的に変更すれば一時的な誤ルーティングは避けられる |
| ロールバック | AWS CLI / コンソールで即時。Apache と違いサービス停止を伴わない |

### F3. セキュリティグループ（補完。単独では不可）

EC2 と ALB が SG `sg-0f8d08ae1663d8f2b` を**共有**しており、
80 / 443 / 20 / 21 / 40000-40010 / 60001-60010 が `0.0.0.0/0` に開いている。

80/443 を ALB 経由のみに絞ることで EC2 直叩きを塞げるが、**SG を共有しているため自己参照ルールが必要**。
ALB 自身の受信まで閉じないよう、適用時に注意を要する。

## 3. API 側の方式比較

いずれも API Gateway のリソースポリシーで `/tools/*` を VPN IP のみに許可する点は共通。
**違いは管理ツールが叩くエンドポイント**にある。

| | A1. 専用ドメイン新設 | A2. execute-api 生エンドポイント | A3. Cloudflare WAF |
| --- | --- | --- | --- |
| 管理ツールの向き先 | `tools-api.onboarding-app.io` | `4gg04tjv40.execute-api...` | `api.onboarding-app.io` のまま |
| 迂回可能性 | **無し**（API Gateway 自身が評価） | **無し**（同上） | **有り**（後述） |
| 作業量 | 中（ドメイン作成＋DNS＋フロント変更） | 小（フロント変更のみ） | 小（WAF ルール追加のみ） |
| ONBS-2114 との整合 | **○** | **×**（execute-api 無効化と矛盾する） | ○ |
| 証明書 | ACM `*.onboarding-app.io`（ISSUED）を使用 | 不要 | 不要 |

### A3 を採らない理由

ONBS-2110 で特定済みの **Cloudflare 共用 IP による迂回**が、API Gateway にもそのまま成立する。
攻撃者が自分の Cloudflare アカウントでオリジンを向いたゾーンを作れば WAF ルールを迂回できる。

加えて、Cloudflare 経由だと API Gateway から見た送信元が Cloudflare のエッジ IP になるため、
**リソースポリシーの `aws:SourceIp` ではクライアント IP を判定できない**。
WAF 側で守るしかなくなり、迂回リスクを抱えたままになる。

なお `onboarding-app.io` は **Business プラン**契約済みで、WAF カスタムルールの上限は 100。
プラン上の制約で A3 を見送るわけではない。

### A2 を採らない理由

ONBS-2114 で `onboarding-manage-api` の execute-api デフォルトエンドポイントを順次無効化している。
配信 API（`4gg04tjv40`）も同残課題に挙がっており、**将来 `disableDefaultEndpoint: true` を入れると
管理ツールが動かなくなる**。今回の対応がその施策と正面から衝突する。

### dev 環境にも専用ドメインが要る

リソースポリシーは `serverless.yml` に書くため dev ステージにも適用される。
`dev-api.onboarding-app.io` も Cloudflare 経由（`server: cloudflare`）で、
`/tools/accounts` が無認証で 200 を返す状態にある。
prod と同じ理由で、dev 用にも Cloudflare を経由しない専用ドメインが必要になる。

| ステージ | API ID | 専用ドメイン |
| --- | --- | --- |
| prod | `4gg04tjv40` | `tools-api.onboarding-app.io` |
| dev | `typ566gsc5` | `dev-tools-api.onboarding-app.io` |

### A1 の副次効果

`api.onboarding-app.io` 経由の `/tools/*` は送信元が Cloudflare の IP になるため、
**同じリソースポリシーで自動的に拒否される**。別途 WAF ルールを書く必要がない。

## 4. 推奨構成

| フェーズ | 対象 | 内容 | 理由 |
| --- | --- | --- | --- |
| **1** | API | A1（専用ドメイン＋リソースポリシー） | 認証が無く現に素通しのため最優先。配信 API に影響しない |
| **2** | フロント | F2（ALB リスナールール）＋ F3（SG） | ロールバックが容易でサービス停止リスクが無い。EC2 直叩きも同時に塞ぐ |
| **3** | フロント | F1（Apache 設定） | 多層防御。vhost 追加時の取りこぼしを恒久的に防ぐ |

### フェーズ 2 と 3 を分ける理由

F1 は失敗時に dev 環境全体を停止させうる一方、**mod_remoteip が未設定**のため設定量が多く、
`RemoteIPTrustedProxy` を誤ると偽装で素通りする。
先に F2 で確実に塞いでから、F1 を落ち着いて適用する方が安全。

F1 まで入れれば F2 のホスト列挙漏れが埋まり、逆に F2 があることで F1 適用中の事故が致命傷にならない。

### 作業を最小にする場合

フェーズ 1 と 2 のみで、現に開いている経路（API の無認証公開・画面への ALB 経由アクセス・EC2 直叩き）は塞がる。
F1 は後日でも成立する。

## 5. 残課題

- `/tools/*` と `/segment-update` には認証機構そのものが無く、本対応は IP 制限による暫定措置にとどまる。恒久対応として API 側の認証導入が必要
- **ONBS-2119**: json-update 画面の環境セレクタが機能せず、常に本番データが更新される。`segment-update` の handler がリクエストボディの `env` を使わず `os.environ["ENV"]` で判定しているため
- EC2 の SG で FTP（20/21）と 40000-40010 / 60001-60010 が `0.0.0.0/0` に開いている。
  **本対応では現行の運用に影響を出さないため現状維持とする**（2026-10-15 判断）。
  FTP は認証情報が平文で流れるため、恒久的には SFTP への移行や送信元の限定を別途検討する余地がある
- ALB の両ターゲットグループが `unhealthy` 状態のまま運用されている
