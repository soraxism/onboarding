# dev 環境（onb-dify-dev）の対応手順

作成日: 2026-10-14
対象: `onb-dify-dev`（`210.131.217.130`）/ `dev.dify-stands.com`
前提: 本番側の対応（[調査結果](./2026-10-14_cloudflare-origin-protection-audit.md) /
[証明書手順](./2026-10-14_certificate-renewal-runbook.md)）

---

## 現状

`dev.dify-stands.com` は **Cloudflare 経由で dev サーバーに正常到達している**。
識別子付きリクエストが dev の nginx ログにのみ記録されることで確認済み。

```
dev.dify-stands.com → Cloudflare → 210.131.217.130（dev）
エッジ証明書: dify-stands.com, *.dify-stands.com      ← サブドメインを含む
```

### ドメインの取り違えに注意

**`dev-dify-stands.com`（ハイフン区切り）は別物で、現在は使われていない。**

| ドメイン | 状態 |
| --- | --- |
| `dev.dify-stands.com` | **実際に使用中。** `dify-stands.com` ゾーンのサブドメイン |
| `dev-dify-stands.com` | 自社保有（XServer / 2027-09-03 まで）だが、2026-09-04 に NS が XServer のパーキングへ変更され未使用 |

**dev オリジンの証明書は後者（`dev-dify-stands.com`）で発行されている。**
ドメインが違ううえに失効もしている。

---

## 課題一覧

| # | 課題 | 内容 | 優先度 |
| --- | --- | --- | --- |
| 1 | **証明書のドメイン不一致と失効** | `CN = dev-dify-stands.com` / `notAfter = 2026-02-01`（254 日超過）。実際に使うのは `dev.dify-stands.com` | **高** |
| 2 | **証明書の自動更新が無い** | 本番と同じ原因。取り直しても 90 日後に再発する | **高** |
| 3 | **ホストの certbot が有効のまま** | `certbot.timer: enabled`。本番と同じ `standalone` 問題の可能性 | 中 |
| 4 | **秘密ヘッダ検証が未導入** | ヘッダ無しで 307。Cloudflare 共用 IP による迂回が可能なまま | 中 |
| 5 | `docker-user-fw.service` の作り | `cf4` が空でも DROP を入れる。順序指定（`After=update-cf-ipset.service`）と `-i ens3` も無い | 低 |

### なぜ今動いているのか

Cloudflare の SSL/TLS モードが **「フル」**（オリジンの証明書を検証しない）ため、
**失効していてもホスト名が違っても通信が成立している**。

### 【重要】本番の Full (strict) 移行のブロッカーになっている

**SSL/TLS モードは Cloudflare のゾーン単位。**
`dev.dify-stands.com` は `dify-stands.com` と同じゾーンにある。

| 設定 | 本番 | dev |
| --- | --- | --- |
| 現在（フル） | 動作 | 動作 |
| **Full (strict)** | 動作（証明書が有効） | **即座に落ちる**（失効＋ホスト名不一致） |

**課題 1 を解決しない限り、本番の Full (strict) 移行もできない。**

---

## 本番より楽に進められる点

| 項目 | 状況 |
| --- | --- |
| Cloudflare の ACME 例外ルール | **設定済み。** `allow-acme-challenge` はゾーン全体・パス指定のため `dev.dify-stands.com` にも効く |
| Transform Rule | **設定済み。** `X-Origin-Auth` は既に dev 宛にも付与されている |
| 既知の落とし穴 | `map_hash_bucket_size` / ユニットファイルへのコマンド混入 / ルール伝播待ち は本番で把握済み |

---

## 【最重要】実行順序

**`.env` の `CERTBOT_DOMAIN` を変えた直後に nginx を再起動してはいけない。**

Dify の nginx entrypoint は `CERTBOT_DOMAIN` から証明書のパスを組み立てる。
**証明書が存在しない場合はフォールバックする。**

```sh
if [ -n "${CERTBOT_DOMAIN}" ] && [ -f "/etc/letsencrypt/live/${CERTBOT_DOMAIN}/fullchain.pem" ] && \
   [ -f "/etc/letsencrypt/live/${CERTBOT_DOMAIN}/privkey.pem" ]; then
    SSL_CERTIFICATE_PATH="/etc/letsencrypt/live/${CERTBOT_DOMAIN}/fullchain.pem"
else
    SSL_CERTIFICATE_PATH="/etc/ssl/fullchain.pem"      # ← フォールバック
fi
```

したがって即座にクラッシュはしないが、**フォールバック先の
`/root/dify/docker/nginx/ssl/fullchain.pem` が無ければ nginx は起動に失敗する**。
あっても、意図しない証明書（自己署名のプレースホルダ等）で起動してしまう。

**どちらにしても望ましくないため、証明書を取得してから nginx を再起動する。**

```
1. .env を変更          （nginx は再起動しない → 旧設定のまま動き続ける）
2. certbot コンテナだけ作り直す（新しい CERTBOT_DOMAIN を読む）
3. 証明書を取得
4. nginx を再起動       （ここで初めて新しいパスを読む）
```

---

## 手順

```bash
ssh onb-dify-dev
sudo -i
cd /root/dify/docker
```

### 1. バックアップ

```bash
cp -a volumes/certbot/conf /root/certbot-conf-backup-20261014
cp -a .env /root/dify-env-backup-20261014
ls -la /root/certbot-conf-backup-20261014/live/
```

### 2. `.env` のドメインを変更する

```bash
vi .env
```

```ini
CERTBOT_DOMAIN=dev.dify-stands.com
```

> `NGINX_SERVER_NAME=_` はワイルドカードなので変更不要。
> `NGINX_HTTPS_ENABLED=true` もそのまま。

```bash
grep -E '^(CERTBOT_DOMAIN|NGINX_SERVER_NAME|NGINX_ENABLE_CERTBOT_CHALLENGE|NGINX_SSL_CERT)' .env
```

確認済みの値（2026-10-14 時点）:

```ini
NGINX_SERVER_NAME=_                      # ワイルドカード。変更不要
NGINX_HTTPS_ENABLED=true
NGINX_ENABLE_CERTBOT_CHALLENGE=true      # ACME チャレンジの配信が有効
NGINX_SSL_CERT_FILENAME=fullchain.pem
NGINX_SSL_CERT_KEY_FILENAME=privkey.pem
```

**この時点では nginx を再起動しない。** 旧証明書のまま動き続ける。

### 3. certbot コンテナを作り直す

```bash
docker compose --profile certbot up --force-recreate -d certbot
docker compose exec certbot cat /update-cert.sh
```

**`DOMAIN="dev.dify-stands.com"` になっていることを確認する。**
なっていなければ `.env` が読まれていないので、`docker compose config | grep CERTBOT_DOMAIN` で確認する。

### 4. 証明書を取得する

新しいドメインの `renewal/*.conf` は存在しないため、
スクリプトは **`certbot certonly`（新規取得）の経路**を通る。

```bash
docker compose exec certbot /bin/sh /update-cert.sh
```

**期待する出力**

```
Certificate does not exist. Obtaining a new certificate...
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/dev.dify-stands.com/fullchain.pem
```

```bash
ls -la volumes/certbot/conf/live/dev.dify-stands.com/
```

> **失敗したら nginx は再起動しないこと。** 旧証明書のままなら dev は動き続ける。
> Let's Encrypt の検証失敗は 1 時間あたり 5 回まで。

### 5. nginx を再起動する

**証明書の取得に成功してから実行する。**

再起動前にフォールバック先の有無を見ておくと、万一のときの挙動が予測できる。

```bash
ls -la /root/dify/docker/nginx/ssl/
```

```bash
docker compose restart nginx
docker compose ps nginx
```

`reload` ではなく `restart`。`CERTBOT_DOMAIN` の変更を entrypoint が再展開する必要があるため。

```bash
docker compose logs --tail 20 nginx
```

### 6. 確認

```bash
echo | openssl s_client -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject -dates
```

`CN = dev.dify-stands.com` かつ `notAfter` が約 90 日後になっていればよい。

```bash
exit
```

作業端末から確認する。

```bash
curl -sS -m 15 -o /dev/null -w "%{http_code}\n" -L https://dev.dify-stands.com/     # → 200
```

### 7. 自動更新を仕込む【これが無いと 90 日後に再発】

本番と同じ構成。

```bash
sudo vi /usr/local/sbin/dify-cert-renew.sh
```

> **vi に入ったら先に `:set paste` を実行する。**

```bash
#!/usr/bin/env bash
set -euo pipefail

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

cd /root/dify/docker

echo "=== $(date '+%Y-%m-%d %H:%M:%S') start ==="
docker compose --profile certbot run --rm certbot /bin/sh /update-cert.sh
docker compose exec -T nginx nginx -s reload
echo "=== $(date '+%Y-%m-%d %H:%M:%S') done ==="
```

```bash
sudo chmod +x /usr/local/sbin/dify-cert-renew.sh
sudo bash -n /usr/local/sbin/dify-cert-renew.sh && echo "構文OK"
sudo /usr/local/sbin/dify-cert-renew.sh        # cron に載せる前に手で流す
```

`Certificate not yet due for renewal.` が出れば正常。

```bash
sudo vi /etc/cron.d/dify-cert-renew
```

```
# Dify(dev) のオリジン証明書を毎日04:00に点検・更新する（ONBS-2110）
0 4 * * * root /usr/local/sbin/dify-cert-renew.sh >> /var/log/dify-cert-renew.log 2>&1
```

> **本番（03:30）と時刻をずらす。** 同時刻だと Let's Encrypt への問い合わせが重なる。
> **ファイル末尾は必ず改行で終わらせる。**

```bash
sudo touch /var/log/dify-cert-renew.log
sudo chmod 640 /var/log/dify-cert-renew.log
sudo tail -c 1 /etc/cron.d/dify-cert-renew | xxd | tail -1    # 末尾が 0a
```

### 8. ホストの certbot を停止する

```bash
sudo systemctl disable --now certbot.timer
systemctl is-enabled certbot.timer     # → disabled
```

### 9. 旧証明書の退避（任意）

`dev-dify-stands.com` の証明書と renewal 設定はもう使わない。

```bash
sudo mv /root/dify/docker/volumes/certbot/conf/renewal/dev-dify-stands.com.conf \
        /root/dify/docker/volumes/certbot/conf/renewal/dev-dify-stands.com.conf.retired
```

**削除ではなく退避**にしておく。`live/` 配下は切り戻し用に残す。

---

## 課題 4: 秘密ヘッダ検証の導入

本番と同じ手順（[origin-auth-header runbook](./2026-10-14_origin-auth-header-runbook.md)）。
**Cloudflare 側の Transform Rule は設定済み**なので、オリジンに検証を足すだけでよい。

### 秘密値は本番と同じものを使う（2026-10-14 決定）

**Transform Rule の追加・変更は不要。** 既存の `origin-auth-header` が
ゾーン全体に適用されており、`dev.dify-stands.com` 宛にも同じ値が付与されている。
**dev の nginx に検証を足すだけで完了する。**

| 方式 | 利点 | 欠点 | 採否 |
| --- | --- | --- | --- |
| **本番と同じ値** | Cloudflare 側の変更が不要 | **dev から漏れると本番も破られる** | **採用** |
| dev 専用の値 | 影響を分離できる | Transform Rule を 1 本追加する必要がある | 見送り |

**残存リスク: dev 側から秘密値が漏れた場合、本番の迂回対策も同時に破られる。**
dev は検証環境で管理が緩くなりやすいため、**将来的な分離を検討の余地として残す**。

分離する場合は、既存ルールを変更せず**追加するだけでよい**。
Transform Rule は順に実行され `Set static` は上書きのため、
後から dev 用ルールを適用すれば dev だけ値が変わる。

| ルール | 式 | 値 |
| --- | --- | --- |
| 既存 `origin-auth-header` | すべての受信リクエスト | 本番の値（変更不要） |
| 追加 `origin-auth-header-dev` | `http.host eq "dev.dify-stands.com"` | dev の値 |

### オリジン側（本番と同じ）

```bash
sudo vi /root/dify/docker/nginx/conf.d/00-origin-auth.conf
```

```nginx
map_hash_bucket_size 128;
map $http_x_origin_auth $origin_auth_ok {
    default 0;
    "<秘密値>" 1;
}
```

> **`map_hash_bucket_size 128;` を忘れない。** 本番ではこれを落として
> nginx が再起動ループに入り、Cloudflare から 521 になった。

```bash
sudo chmod 600 /root/dify/docker/nginx/conf.d/00-origin-auth.conf
sudo vi /root/dify/docker/nginx/conf.d/default.conf.template
```

`server_name` の直後に追加する。

```nginx
    # Cloudflare 経由でないアクセスを拒否する（ONBS-2110）
    if ($origin_auth_ok = 0) { return 403; }
```

```bash
sudo docker restart docker-nginx-1
sudo docker ps --filter name=docker-nginx-1 --format "{{.Names}}\t{{.Status}}"
curl -s -o /dev/null -w "ヘッダ無し: %{http_code}\n" http://127.0.0.1/      # → 403
```

---

## 課題 5: `docker-user-fw.service` の改善

dev の現状には 3 つの弱点がある。

| 弱点 | 内容 |
| --- | --- |
| `cf4` が空でも DROP を入れる | `ipset create cf4` で空のセットを作ってから DROP するため、ipset 復元前に動くと**全アクセスが遮断される** |
| 順序指定が無い | `After=docker.service network-online.target` のみ。`update-cf-ipset.service` との順序が保証されない |
| `-i ens3` が無い | docker のブリッジ経由で転送される 80/443 にもマッチする |

本番と同じ構成に置き換える（[是正手順](./2026-10-14_remediation-runbook.md) 手順 3）。

**dev の更新スクリプト自体は正常**（4 連バックスラッシュ 0 箇所、
最終ログ `[OK] updated: v4=15, v6=7`）なので、スクリプトの修正は不要。

---

## 完了後にできること

**本番ゾーンの SSL/TLS モードを Full (strict) へ変更できる。**
本番・dev の両オリジンで証明書が有効かつホスト名が一致した状態になるため。

切り替え前に、両方の証明書を必ず確認すること。

```bash
# 本番
ssh onb-dify 'echo | openssl s_client -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject -dates'
# dev
ssh onb-dify-dev 'echo | openssl s_client -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject -dates'
```

---

## 未決事項

**`dev-dify-stands.com`（ハイフン区切り）をどうするか。**

2027-09-03 まで登録されているが未使用で、NS は XServer のパーキングを向いている。
更新費用が発生するため、継続保有するか失効させるかの判断が必要。
