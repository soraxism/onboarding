# オリジン証明書の失効対応手順

**ステータス: 2026-10-14 対応完了**

作成日: 2026-10-14
対象: `onb-dify`（`162.43.85.203`）/ `dify-stands.com`
前提: [調査結果](./2026-10-14_cloudflare-origin-protection-audit.md)

---

## 実施結果（2026-10-14）

| 項目 | 結果 |
| --- | --- |
| 証明書 | **2026-10-14 取得 / 2027-01-12 まで有効**（Let's Encrypt YE2） |
| ホストの `certbot.timer` | `disabled` / `inactive`（失敗ループを停止） |
| 自動更新 | `/usr/local/sbin/dify-cert-renew.sh` + `/etc/cron.d/dify-cert-renew`（毎日 03:30） |
| 既存の防御 | 秘密ヘッダ検証・iptables ルールとも**維持**（403 / 直叩きタイムアウトを確認） |

**作業中に Cloudflare の WAF カスタムルールが ACME チャレンジを 403 でブロックしていることが判明し、
Skip ルール `証明書更新のACME許可` を追加した**（詳細は下記「Cloudflare 側の例外ルール」）。

---

## 【重要】Cloudflare 側の例外ルール

**`証明書更新のACME許可` は証明書更新のために意図的に開けた穴。消すと更新できなくなる。**

| 項目 | 内容 |
| --- | --- |
| 場所 | Cloudflare → `dify-stands.com` → セキュリティ → WAF → カスタムルール |
| ルール名 | `証明書更新のACME許可` |
| 式 | `starts_with(http.request.uri.path, "/.well-known/acme-challenge/")` |
| アクション | スキップ → 残りのカスタムルール |
| 優先順位 | **最上位**（ブロックルールより上） |

### なぜ必要か

このゾーンには**送信元 IP でアクセスを制限する WAF カスタムルール**がある
（BE・VPN からのみ許可する構成）。
一方 **Let's Encrypt の検証サーバーは世界中の任意の IP から来る**ため、
このルールに引っかかって 403 となり、HTTP-01 チャレンジが成立しなかった。

**Let's Encrypt は検証元 IP のリストを公開していない**ため、IP の許可リストに
追加する方法は採れない。パスで例外を作る必要がある。

### リスク評価

**実害はほぼ無い。**

- 配信されるのは certbot が一時的に置くランダムなトークンファイルのみ
- Dify のコンテンツや API には到達できない
- **オリジン側の秘密ヘッダ検証は引き続き有効**（Transform Rule は別フェーズのため、
  「残りのカスタムルール」をスキップしても `X-Origin-Auth` は付与される）

### 将来この例外を無くすには

**DNS-01 チャレンジへ移行する**と、HTTP の到達性が一切不要になりこのルールは削除できる。
`certbot/dns-cloudflare` イメージへの変更と、Cloudflare API トークン
（権限は Zone → DNS → Edit のみ）が必要。

---

## 問題

オリジンの証明書が **2026-01-04 に失効**し、283 日が経過している。
Cloudflare の SSL/TLS モードが **「フル」**（オリジンの証明書を検証しない）のため
通信は継続しており、**利用者側のブラウザには影響していない**
（Cloudflare が別途エッジ証明書を提示するため）。

ただし **Full (strict) への移行はこれが解決しないと不可能**。

### 原因（2026-10-14 特定）

**原因は 2 つあり、別々の問題だった。**

#### 原因 1: Dify 側の certbot に自動更新が無い（本質）

nginx が読む証明書を管理しているのは Dify の certbot で、**設定自体は正しい**。

```ini
# volumes/certbot/conf/renewal/dify-stands.com.conf
authenticator = webroot
webroot_path = /var/www/html
key_type = ecdsa
```

しかし certbot サービスは `profiles: [certbot]` かつ `command: tail -f /dev/null` で、
**人が手で実行しない限り何もしない**。

2025-10-06 に手動で取得したきり一度も更新されず、**90 日後の 2026-01-04 に自然失効**した。
**firewall は無関係。単に自動更新が仕込まれていなかっただけ。**

> 当初「Cloudflare 限定の許可ルールが HTTP-01 チャレンジを阻害した」と推測したが、
> これは誤りだった。証明書の発行日と `update-cf-ipset.sh` の設置日が同日だったことによる
> 見かけ上の相関にすぎない。

**したがって本対応で最も重要なのは、証明書の取り直しではなく cron の設定（手順 8）。**
取り直しても自動化しなければ 90 日後に同じ状況が再発する。

#### 原因 2: ホスト側の certbot が standalone で失敗し続けている

こちらは nginx が読まない証明書ストアを管理している別系統の設定。

```ini
# /etc/letsencrypt/renewal/dify-stands.com.conf
authenticator = standalone
```

`standalone` は certbot 自身が 80 番を bind して検証を受ける方式だが、
**80 番は Docker の nginx が使用中**のため毎回失敗する。

```
Failed to renew certificate dify-stands.com with error: Could not bind TCP port 80
because it is already in use by another process on this system (such as a web server).
```

`certbot.timer` は 1 日 2 回動いており、**失敗のたびに秘密鍵と CSR だけが生成され続けていた**。
その結果 `/etc/letsencrypt/csr`（28KB）と `keys`（24KB）が肥大している。

この系統は nginx の証明書とは無関係なので、**停止するだけでよい**（手順 7）。

### 証明書ストアが 2 つある

| ストア | 失効日 | 用途 |
| --- | --- | --- |
| `/etc/letsencrypt`（ホスト） | 2026-03-31 | ホスト certbot が管理。**誰も読んでいない** |
| `/root/dify/docker/volumes/certbot/conf`（Dify） | 2026-01-04 | **nginx が読んでいるのはこちら** |

**どちらも失効済み。更新ではなく新規取得が必要。**

---

## 方針: Dify の certbot コンテナ（webroot）を使う

Dify の `docker-compose.yaml` には certbot サービスが標準で定義されている。

```yaml
certbot:
  image: certbot/certbot
  profiles: [certbot]
  volumes:
    - ./volumes/certbot/conf:/etc/letsencrypt      # nginx が読む場所と同一
    - ./volumes/certbot/www:/var/www/html          # チャレンジ配信先
    - ./volumes/certbot/logs:/var/log/letsencrypt
    - ./certbot/update-cert.template.txt:/update-cert.template.txt
    - ./certbot/docker-entrypoint.sh:/docker-entrypoint.sh
  environment:
    - CERTBOT_EMAIL=${CERTBOT_EMAIL}
    - CERTBOT_DOMAIN=${CERTBOT_DOMAIN}
```

`.env` 側の設定も揃っている。

```ini
NGINX_ENABLE_CERTBOT_CHALLENGE=true    # nginx が /.well-known/acme-challenge/ を配信する
CERTBOT_DOMAIN=dify-stands.com
CERTBOT_EMAIL=developer@onboarding-app.io
```

| 方式 | 評価 |
| --- | --- |
| **Dify の certbot コンテナ（webroot）** | **採用。** 設計どおり。nginx が読む場所に直接書かれる。80 番の奪い合いが起きない |
| ホスト certbot を webroot に変更 | ストアが 2 つ残り、コピー処理が必要で煩雑 |
| DNS-01（Cloudflare プラグイン） | 最も堅く 80 番に依存しないが、プラグイン導入と API トークンが必要。**将来の移行先として残す** |

### 検証が通る条件（当初の想定と実際）

Let's Encrypt の検証リクエストは次の経路で届く。

```
Let's Encrypt → DNS解決 → Cloudflare → オリジン(nginx) → /var/www/html のチャレンジファイル
```

- Cloudflare 経由なので **`cf4` の許可に合致する**
- Cloudflare が `X-Origin-Auth` を付与するため、**秘密ヘッダ検証も通過する**
- `NGINX_ENABLE_CERTBOT_CHALLENGE=true` により nginx が `/.well-known/acme-challenge/` を配信する

**ただし実際には、これらの手前にある Cloudflare の WAF カスタムルールで
403 になっていた**（上記「Cloudflare 側の例外ルール」を参照）。
オリジンまで到達すらしていなかった。

#### 切り分けのポイント

作業端末からのテストでは ACME パスが **404**（＝通過）を返す一方、
Let's Encrypt からは **403** だった。**送信元 IP だけが違う**ことから
Cloudflare 側の IP ベース制限を疑い、セキュリティイベントで確定させた。

**作業端末が許可済み IP に該当していたため、手元のテストでは問題が再現しなかった。**
この種の切り分けでは「自分のテストが通ること」を根拠にしないよう注意する。

#### 検証は複数拠点から行われる

Skip ルール追加の直後は、3 拠点中 2 拠点が 200、1 拠点が 403 となり
`During secondary validation` で失敗した。**Cloudflare のルールが全エッジに
行き渡るまでの時間差**が原因で、数分待って再実行したら成功した。

ルールを変更した直後に certbot を走らせない。

---

## 手順

**`onb-dify` にログインし、root シェルに入って実行する。**

`/root` は `700` で root 専用のため、`t_sora` では `cd /root/dify/docker` できない。
`docker compose` は `docker-compose.yaml` と `.env` をカレントディレクトリから読むため、
**そのディレクトリにいる必要がある**。

```bash
sudo -i
cd /root/dify/docker
```

**これ以降のコマンドに `sudo` は不要**（すでに root）。

> **root シェルでは誤操作の影響が大きい。** 手順のコマンドだけを実行し、
> 終わったら速やかに `exit` すること。

### 1. バックアップ

```bash
cp -a volumes/certbot/conf /root/certbot-conf-backup-20261014
ls -la /root/certbot-conf-backup-20261014/live/dify-stands.com/
```

### 2. 取得スクリプトの中身を確認する

certbot コンテナの entrypoint が、テンプレートから `/update-cert.sh` を生成する。
**実行前にどんなオプションが使われるか確認しておく。**

```bash
cat certbot/update-cert.template.txt
```

`--webroot -w /var/www/html` が含まれていることを確認する。
`--force-renewal` の有無も見ておく（失効済みなので付いていなくても再取得される）。

### 3. certbot コンテナを起動する

```bash
docker compose --profile certbot up --force-recreate -d certbot
docker compose ps certbot
```

`command: tail -f /dev/null` なので、**起動するだけで何も実行されない**。
この時点では証明書に変化はない。

### 4. 生成されたスクリプトを確認してから実行する

```bash
docker compose exec certbot cat /update-cert.sh
```

ドメインとメールアドレスが展開されていることを確認する。

```bash
docker compose exec certbot /bin/sh /update-cert.sh
```

**期待する出力:**

```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/dify-stands.com/fullchain.pem
Key is saved at:         /etc/letsencrypt/live/dify-stands.com/privkey.pem
This certificate expires on YYYY-MM-DD.
```

失敗した場合は次節「失敗時の切り分け」を参照。

### 5. nginx に反映する

```bash
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

証明書のパス（シンボリックリンク）は変わらず、リンク先だけが新しくなるため
**`reload` で足りる**（テンプレートは変更していないので `restart` は不要）。

### 6. 確認

```bash
echo | openssl s_client -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject -dates
```

`notAfter` が **約 90 日後**になっていればよい。

作業端末からも確認する。

```bash
curl -sS -m 15 -o /dev/null -w "%{http_code}\n" -L https://dify-stands.com/     # → 200
```

### 6-2. root シェルを抜ける

ここまでで証明書の取得は完了。**root シェルから出ておく。**

```bash
exit
```

以降は通常の `t_sora` で `sudo` を付けて実行する。

### 7. ホストの certbot を停止する

**これを止めないと、失敗ループと `csr` / `keys` の肥大が続く。**

```bash
sudo systemctl disable --now certbot.timer
systemctl is-enabled certbot.timer     # → disabled
```

**`/etc/letsencrypt` はまだ削除しない。** 切り戻しの材料として当面残す。

### 8. 自動更新を仕込む【本対応の要】

**ここを忘れると 90 日後に同じ状況が再発する。** 今回の失効の本質はこれが無かったこと。

Dify の certbot コンテナは `tail -f /dev/null` で待機するだけで更新ジョブを持たない。
**cron で定期実行する。**

`update-cert.template.txt` に `--force-renewal` が含まれていないため、
**期限が近いときだけ実際に更新される**。毎日回しても Let's Encrypt の
重複証明書制限（週 5 回）には当たらない。

#### 8-1. 処理をスクリプトに切り出す

cron に長い 1 行を書くと編集もテストもしづらい。**スクリプトに分ける。**

```bash
sudo vi /usr/local/sbin/dify-cert-renew.sh
```

> **vi に入ったら先に `:set paste` を実行する。** 自動インデントで
> 貼り付け内容が崩れるのを防げる。

```bash
#!/usr/bin/env bash
set -euo pipefail

# cron は PATH が最小限なので明示する
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

cd /root/dify/docker

echo "=== $(date '+%Y-%m-%d %H:%M:%S') start ==="

# 証明書の点検・更新
# update-cert.sh は --force-renewal を使わないため、
# 期限が近いときだけ実際に更新される
docker compose --profile certbot run --rm certbot /bin/sh /update-cert.sh

# nginx に反映（証明書が変わっていなくても害はない）
docker compose exec -T nginx nginx -s reload

echo "=== $(date '+%Y-%m-%d %H:%M:%S') done ==="
```

```bash
sudo chmod +x /usr/local/sbin/dify-cert-renew.sh
sudo bash -n /usr/local/sbin/dify-cert-renew.sh && echo "構文OK"
```

#### 8-2. cron に載せる前に手で流す

```bash
sudo /usr/local/sbin/dify-cert-renew.sh
```

取得直後であれば `Certificate not yet due for renewal.` が出る。**これが正常**。

#### 8-3. cron に 1 行だけ登録する

```bash
sudo vi /etc/cron.d/dify-cert-renew
```

```
# Dify のオリジン証明書を毎日03:30に点検・更新する（ONBS-2110）
30 3 * * * root /usr/local/sbin/dify-cert-renew.sh >> /var/log/dify-cert-renew.log 2>&1
```

> **ファイル末尾は必ず改行で終わらせる。**
> `/etc/cron.d` 配下は最終行に改行が無いとその行が無視される。

```bash
sudo cat /etc/cron.d/dify-cert-renew
sudo tail -c 1 /etc/cron.d/dify-cert-renew | xxd | tail -1    # 末尾が 0a なら改行あり
sudo touch /var/log/dify-cert-renew.log
sudo chmod 640 /var/log/dify-cert-renew.log
```

#### 8-4. 翌日以降に確認する

```bash
sudo tail -20 /var/log/dify-cert-renew.log
```

> **ログは誰かが見なければ意味がない。** 今回の失効も「誰も気づかなかった」ことが
> 長期化の原因だった。期限が 30 日を切っても更新されない場合に気づける仕組み
> （Slack 通知など）の追加を別途検討すること。

#### 8-5. 常駐コンテナを止める

cron は `run --rm` で都度起動するため、`docker-certbot-1` を常駐させる必要はない。

```bash
sudo docker stop docker-certbot-1 && sudo docker rm docker-certbot-1
```

---

### 9. 掃除（任意・後日でよい）

失敗の痕跡として溜まった鍵と CSR を削除する。

```bash
sudo sh -c 'ls /etc/letsencrypt/csr | wc -l; ls /etc/letsencrypt/keys | wc -l'
```

**`live` から参照されているものを消さないよう注意。** ホスト側の certbot はもう使わないため、
`/etc/letsencrypt` ごと退避するのが安全。

```bash
sudo mv /etc/letsencrypt /root/letsencrypt-host-retired-20261014
```

**この操作の前に、手順 6 で新しい証明書が機能していることを必ず確認する。**

---

## 失敗時の切り分け

### チャレンジファイルが配信されているか

certbot が置いたファイルを nginx が返せるか、手で確認できる。

```bash
mkdir -p /root/dify/docker/volumes/certbot/www/.well-known/acme-challenge
echo test-token > /root/dify/docker/volumes/certbot/www/.well-known/acme-challenge/test
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: dify-stands.com" http://127.0.0.1/.well-known/acme-challenge/test
```

| 結果 | 判断 |
| --- | --- |
| `200` | nginx の配信は正常。問題は外部からの到達性 |
| `403` | **秘密ヘッダ検証に引っかかっている。** ACME のパスを除外する必要がある |
| `404` | nginx が `/.well-known/` を配信していない。`NGINX_ENABLE_CERTBOT_CHALLENGE` を確認 |

外部からも確認する（作業端末で実行）。

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://dify-stands.com/.well-known/acme-challenge/test
```

**ここが 403 になる場合**は、Cloudflare 経由でもヘッダが付いていない可能性がある。
その場合は ACME のパスだけ検証を除外する。

```nginx
# default.conf.template の server ブロック内、検証の if より前に置く
location ^~ /.well-known/acme-challenge/ {
    root /var/www/html;
}
```

> `location` は `server` レベルの `if` より後に評価されるため、
> **この方法では除外できない**。除外が必要な場合は `if` の条件に
> `$request_uri` の判定を足す方式に切り替える。

確認が済んだらテストファイルを消す。

```bash
rm -f /root/dify/docker/volumes/certbot/www/.well-known/acme-challenge/test
```

### certbot のログ

```bash
tail -50 /root/dify/docker/volumes/certbot/logs/letsencrypt.log
```

---

## ロールバック

```bash
rm -rf /root/dify/docker/volumes/certbot/conf
cp -a /root/certbot-conf-backup-20261014 /root/dify/docker/volumes/certbot/conf
docker compose exec nginx nginx -s reload
```

失効した証明書に戻るが、SSL/TLS が「フル」である限り通信は継続する。

---

## この対応の先にあるもの

| 項目 | 内容 |
| --- | --- |
| **Full (strict) への移行** | 証明書が有効になれば切り替え可能。オリジン証明書が検証されるようになり、Cloudflare とオリジンの間の中間者攻撃を塞げる |
| **DNS-01 への移行** | 80 番の到達性に依存しなくなる。firewall 構成を変えても証明書更新が壊れない。Cloudflare API トークンが必要 |
| `TLSv1.1` の無効化 | `.env` の `NGINX_SSL_PROTOCOLS` から外す。非推奨かつ脆弱 |
