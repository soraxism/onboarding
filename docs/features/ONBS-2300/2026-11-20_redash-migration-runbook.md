# ONBS-2300 Redash サーバーの移行手順

Ubuntu 18.04 の `redash-server` を、Ubuntu 24.04 の新サーバーへ移す。
新サーバーを横に立ててメタデータ DB を移し、最後に EIP を付け替える。旧サーバーは切り替えまで動かしたまま残す。

**2026-11-20 13:10〜13:14 に切り替え済み。** 結果は「切り替えの結果」の節。

## 構成の比較

名前タグは切り替え時に入れ替えた（新 → `redash-server`、旧 → `redash-server-old`）。

| 項目 | 旧（現 `redash-server-old`・停止中） | 新（現 `redash-server`） |
| --- | --- | --- |
| インスタンス | `i-02303b9c3be3fecd1` | `i-061f24cb685bf3aa0` |
| OS / カーネル | Ubuntu 18.04.3 / 5.4.0-1103-aws | Ubuntu 24.04.5 / 7.0.0-1017-aws |
| 型・ディスク | t3.large / gp3 15GB（暗号化なし） | t3.large / gp3 30GB（暗号化あり） |
| docker | 19.03.4 / docker-compose 1.22.0 | 29.9.3 / compose plugin 5.7.0（apt-mark hold） |
| Redash | 8.0.0.b32245 | 26.9.0 |
| メタデータ DB | postgres:9.6-alpine | postgres:17.11-alpine3.24 |
| Redis | redis:5.0-alpine | redis:7.4.11-alpine |
| SG | `redash-server-sg`（sg-0495ad392529f6fd7） | 同じ SG |
| IP | 切り替えまで EIP `3.114.93.145` | 切り替えまでは自動割り当ての `18.183.181.149`、以降は EIP `3.114.93.145` |
| SSH | 切り替えまで `ssh -i ~/.ssh/onb_redash ubuntu@3.114.93.145` | 以降は同じコマンド（`ssh onb-redash`）で新サーバーに入る |

- `/opt/redash/compose.yaml` は公式の [getredash/setup](https://github.com/getredash/setup) の `data/compose.yaml` をもとにした。
  変えたのは Postgres と Redis のイメージだけ（公式の `pgautoupgrade` ではなく公式イメージ `postgres` にし、版を固定）
- `/opt/redash/env` は旧サーバーのものをそのまま複製した（sha256 一致）。
  **`REDASH_SECRET_KEY` を変えるとデータソースの接続情報を復号できなくなる**ため、引き継ぎは必須
- 新サーバーのキーペアは `redash-server`（RSA）。手元の鍵とは別なので、EC2 Instance Connect で一時的に入り、
  旧サーバーの `authorized_keys` にある自分の公開鍵を登録した

## https 化（新サーバーのみ）

旧サーバーは http（80）だけで動いていた。新サーバーは `https://redash.onboarding-app.io` で受ける。

- 証明書は **Let's Encrypt**（`redash.onboarding-app.io` 単独）。ACM の `*.onboarding-app.io` はエクスポート不可で、
  EC2 の nginx には入れられないため（ACM を使うなら前段に ALB が要る）
- サーバーは VPN からしか届かず http 認証が通らないので、**Route53 の DNS 認証（dns-01）** で取る
  - certbot 2.9.0・`python3-certbot-dns-route53`（Ubuntu の apt）
  - IAM ロール `redash-server-certbot` をインスタンスに付けた。権限は `_acme-challenge.redash.onboarding-app.io` の
    TXT レコードの変更と、`ListHostedZones`・`GetChange` だけ
  - 更新は `certbot.timer` が自動で行い、`/etc/letsencrypt/renewal-hooks/deploy/reload-redash-nginx.sh` で nginx に読み込ませる。
    `certbot renew --dry-run` は成功
  - Let's Encrypt のアカウントにメールアドレスは登録していない
- nginx の設定は `/opt/redash/compose.override.yaml` で差し替えた（公式の `compose.yaml` は変えていない）
  - `/opt/redash/nginx.conf`: 80 は `https://redash.onboarding-app.io` へ 301。443 で TLS を終端して `server:5000` へ中継
  - **HTTP/2 は有効にしていない。** 2026-11-18 公開の nginx の脆弱性（CVE-2026-123633・123007）は HTTP/2 有効時のみ影響する。
    `redash/nginx:latest` は nginx 1.26.1 で、修正版は公開直後のため cooldown 中
- `X-Forwarded-Proto` を `$scheme` で渡しているので、Redash 自身のリダイレクトも https になる
- SG `redash-server-sg` は 443 を VPN の IP にすでに開けていたので、変更なし

確認（名前解決を新サーバーに向けて実施）:

| URL | 結果 |
| --- | --- |
| `http://redash.onboarding-app.io/` | 301 → `https://redash.onboarding-app.io/` |
| `https://redash.onboarding-app.io/` | 302 → `/login?next=https://…`（https のまま） |
| `https://redash.onboarding-app.io/login` | 200・証明書の検証 OK |

**DNS は変えない。** `redash.onboarding-app.io` は EIP `3.114.93.145` を指しているので、切り替え当日に EIP を付け替えれば
そのまま新サーバーの https に向く。

### 残っている http の経路

compose の `server` が `5000:5000` を公開していて、SG も VPN の IP に 5000 を開けている。nginx を通らずに http で入れる。
切り替え前の動作確認に使うので残し、**切り替え当日に SG のルールを消して閉じる**（2026-11-20 決定）。
外から届く経路はこの SG のルールだけなので、compose の `ports` は変えない。

## 利用状況（2026-11-20）

- データソース: Athena（ログ）・本番 Aurora MySQL（データ）・query_results の 3 件
- クエリ 174 件（うち有効 34）、ダッシュボード 5 件（有効 2）、ユーザー 17 人（有効 15）
- 定期実行のクエリ・アラート・有効な API キーはなし
- 直近 30 日の利用者は 4 人

## リハーサル（2026-11-20 実施）

旧サーバーは止めずに行った。

1. 旧サーバーで `pg_dump -Fc`（44MB）→ 新サーバーで `pg_restore --no-owner`
   - 9.6 のダンプは `CREATE SCHEMA public` を含むため、**先に `drop schema public cascade` が要る**。
     そのまま流すと `schema "public" already exists` で止まる
   - `docker compose exec -T` で 2 つのコマンドを `&&` でつなぐと、前のコマンドが標準入力を食う。別々に実行する
2. 件数を照合: クエリ 174・ダッシュボード 5・ユーザー 17・データソース 3（旧サーバーと一致）
3. `manage db upgrade` を段階的に流した（公式は v10.1 からの移行を前提にしているため）
   - `redash/redash:10.1.0.b50633`: `e5c7a4e2df4d` → `89bc7873a3e0`
   - `redash/redash:26.9.0`: `89bc7873a3e0` → `db0aca1ebd32`（head）
4. 全コンテナを起動し、`/ping`・`/login` が 200（VPN 経由で `http://18.183.181.149/login` も 200）
5. `manage ds test`: Athena・Aurora MySQL とも Success

### 人が確認すること（2026-11-20 担当者が `:5000` で確認・すべて OK）

- [x] 新サーバーにログインできる。切り替えまでは DNS が旧サーバーを指しているので、次のどちらかで入る
  - `/etc/hosts` に `18.183.181.149 redash.onboarding-app.io` を足して `https://redash.onboarding-app.io/` を開く（確認後に消す）
  - `http://18.183.181.149:5000/`（nginx を通らない）。`http://18.183.181.149/` は https のドメインへ転送されて旧サーバーに着く
- [x] 既存のクエリを Athena・MySQL それぞれ 1 件以上実行し、結果が出る
- [x] ダッシュボード 2 件が表示される
  - 月次レポート用ダッシュボードは、既定の条件（product_id 250・2024-09）だと全ウィジェットが空になる。
    クエリの結果が 0 行のためで、表示の不具合ではない。最近の期間に変えると表示された

`:5000` に直接つなぐと、server のログに `WORKER TIMEOUT` → `SIGKILL! Perhaps out of memory?` が出ることがある。
ブラウザが開いたまま要求を送らない接続を gunicorn が 30 秒で打ち切ったもの（`no URI read`）で、メモリ不足ではない。
nginx を通る経路では起きない。

**新サーバーで行った変更は、切り替え当日の最終ダンプで上書きされて消える。**

## 切り替え当日の手順

想定の停止時間は 30 分程度。日時は Slack の確認スレッドで事前に周知する
（[確認スレッド](https://stands-inc.slack.com/archives/C02S2JNPSUU/p1793338732571679)）。

```bash
# 1. 旧サーバーの Redash を止める（Postgres だけ残す）
OLD='ssh -i ~/.ssh/onb_redash ubuntu@3.114.93.145'
$OLD 'cd /opt/redash && sudo docker-compose stop server scheduler scheduled_worker adhoc_worker nginx'

# 2. 最終ダンプ
$OLD 'sudo docker exec redash_postgres_1 pg_dump -U postgres -Fc postgres' > redash-final.dump

# 3. 新サーバーで、リハーサルの DB を捨てて復元する
NEW='ssh -i ~/.ssh/onb_redash ubuntu@18.183.181.149'
$NEW 'cd /opt/redash && sudo docker compose stop server scheduler scheduled_worker adhoc_worker worker nginx'
$NEW 'cd /opt/redash && sudo docker compose exec -T postgres psql -U postgres -qc "drop schema public cascade"'
$NEW 'cd /opt/redash && sudo docker compose exec -T postgres pg_restore -U postgres -d postgres --no-owner --exit-on-error' < redash-final.dump

# 4. スキーマを 10.1 → 26.9 の順に上げる
$NEW 'cd /opt/redash && sudo sed -i "s|redash/redash:26.9.0|redash/redash:10.1.0.b50633|" compose.yaml && sudo docker compose run --rm server manage db upgrade'
$NEW 'cd /opt/redash && sudo sed -i "s|redash/redash:10.1.0.b50633|redash/redash:26.9.0|" compose.yaml && sudo docker compose run --rm server manage db upgrade'
$NEW 'cd /opt/redash && sudo docker compose up -d'

# 5. 件数の照合と接続テスト（リハーサルと同じ）

# 6. EIP を新サーバーへ付け替える（DNS は変えない。EIP は解放しない）
aws ec2 associate-address --region ap-northeast-1 --allocation-id eipalloc-07fa2f77a9f34f94b \
  --instance-id i-061f24cb685bf3aa0 --allow-reassociation

# 7. 旧サーバーを停止する（削除はしない）
aws ec2 stop-instances --region ap-northeast-1 --instance-ids i-02303b9c3be3fecd1

# 8. nginx を通らない http の入り口（5000 番）を閉じる。SG は旧サーバーと共用なので、旧サーバーを止めてから
aws ec2 revoke-security-group-ingress --region ap-northeast-1 --group-id sg-0495ad392529f6fd7 \
  --security-group-rule-ids sgr-0d729605ebdc859d0
```

- 5000 番を閉じたあと、VPN 内から `http://redash.onboarding-app.io:5000/` が繋がらないことを確かめる

- EIP を付けると、新サーバーの自動割り当ての IP `18.183.181.149` は外れて使えなくなる。
  `~/.ssh/config` の `onb-redash` を `3.114.93.145` に戻す
- 付け替えたあと、`3.114.93.145`・`redash.onboarding-app.io` は新サーバーにつながる。ホスト鍵が変わるので
  `ssh-keygen -R 3.114.93.145` と `ssh-keygen -R redash.onboarding-app.io` で古い鍵を消す
- 名前タグを入れ替える（新 → `redash-server`、旧 → `redash-server-old`）
- `https://redash.onboarding-app.io/` が開けること、`http://` が https へ転送されることを確かめる
- 利用者には、ブックマークが `http://` でもそのまま使える（https へ転送される）ことを伝える
- 最終ダンプは作業後に削除する（ユーザーのメールアドレス・クエリ本文を含む）

### 戻し方

新サーバーで問題が出たら、EIP を旧サーバーへ付け替え直し、旧サーバーの Redash を `docker-compose start` する。
5000 番を閉じたあとなら、旧サーバーへ戻しても nginx（80）経由で使える。
旧サーバーの DB は切り替え時点のまま残っている。

## 切り替えの結果（2026-11-20）

13:00 ごろ Slack の確認スレッドで告知し、13:10 に開始、13:14 に再開した（停止は約 4 分）。
最終ダンプはローカルに置かず、旧サーバーの `pg_dump` を新サーバーの `pg_restore` へ ssh 越しに直接流した。

| 確認 | 結果 |
| --- | --- |
| 復元後の件数（旧と比較） | クエリ 174・ダッシュボード 5・ユーザー 17・データソース 3・クエリ結果 73・最後のイベント ID 44575。すべて一致 |
| スキーマ | 10.1 → 26.9 と上げ、`db0aca1ebd32`（head） |
| データソースの接続テスト | Athena・Aurora MySQL とも Success |
| EIP | `3.114.93.145` を新サーバーへ付け替えた。DNS は変更なし |
| `http://redash.onboarding-app.io/` | 301 → https |
| `https://redash.onboarding-app.io/login`・`/ping` | 200・証明書の検証 OK |
| ホスト鍵 | 新サーバーのコンソール出力の指紋（ED25519 `SHA256:yJ7jCf9…`）と一致 |
| 旧サーバー | 停止（削除していない） |
| 5000 番 | SG のルール `sgr-0d729605ebdc859d0` を削除。外から届かないことを確認 |
| 切り替え後のログ | ERROR・Traceback なし |

## 切り替えのあと

- [x] 利用者に再開を知らせた（Slack の確認スレッド）
- [ ] しばらく様子を見てから、旧サーバー（インスタンス・EBS `vol-087169fb452710120`）を削除する
- [x] ONBS-2296 に、redash-server の対応が済んだことを記録する

## 未確認のこと

- 新サーバーのカーネル（7.0.0-1017-aws）が CVE-2026-98432 を修正済みか。
  Ubuntu の CVE ページが 503 を返していて確かめられていない。changelog に CVE 番号の記載はない
