# オリジン証明書の失効対応手順

作成日: 2026-10-14
対象: `onb-dify`（`162.43.85.203`）/ `dify-stands.com`
前提: [調査結果](./2026-10-14_cloudflare-origin-protection-audit.md)

---

## 問題

オリジンの証明書が **2026-01-04 に失効**し、283 日が経過している。
Cloudflare の SSL/TLS モードが **「フル」**（オリジンの証明書を検証しない）のため
通信は継続しており、**利用者側のブラウザには影響していない**
（Cloudflare が別途エッジ証明書を提示するため）。

ただし **Full (strict) への移行はこれが解決しないと不可能**。

### 原因（2026-10-14 特定）

ホストの certbot が **`standalone` モード**で設定されていた。

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

### 検証が通る理由

Let's Encrypt の検証リクエストは次の経路で届く。

```
Let's Encrypt → DNS解決 → Cloudflare → オリジン(nginx) → /var/www/html のチャレンジファイル
```

- Cloudflare 経由なので **`cf4` の許可に合致する**
- Cloudflare が `X-Origin-Auth` を付与するため、**秘密ヘッダ検証も通過する**
- `NGINX_ENABLE_CERTBOT_CHALLENGE=true` により nginx が `/.well-known/acme-challenge/` を配信する

---

## 手順

**`onb-dify` にログインした状態で実行する。**

```bash
sudo -v        # パスワードをキャッシュしておく
cd /root/dify/docker
```

> `cd` は `sudo` 不要（ディレクトリに入るだけなら読み取り権限が要る）。
> 入れない場合は各コマンドでフルパスを指定するか `sudo -i` で root シェルに入る。

### 1. バックアップ

```bash
sudo cp -a /root/dify/docker/volumes/certbot/conf /root/certbot-conf-backup-20261014
sudo sh -c 'ls -la /root/certbot-conf-backup-20261014/live/dify-stands.com/'
```

### 2. 取得スクリプトの中身を確認する

certbot コンテナの entrypoint が、テンプレートから `/update-cert.sh` を生成する。
**実行前にどんなオプションが使われるか確認しておく。**

```bash
sudo cat /root/dify/docker/certbot/update-cert.template.txt
```

`--webroot -w /var/www/html` が含まれていることを確認する。
`--force-renewal` の有無も見ておく（失効済みなので付いていなくても再取得される）。

### 3. certbot コンテナを起動する

```bash
sudo docker compose --profile certbot up --force-recreate -d certbot
sudo docker compose ps certbot
```

`command: tail -f /dev/null` なので、**起動するだけで何も実行されない**。
この時点では証明書に変化はない。

### 4. 生成されたスクリプトを確認してから実行する

```bash
sudo docker compose exec certbot cat /update-cert.sh
```

ドメインとメールアドレスが展開されていることを確認する。

```bash
sudo docker compose exec certbot /bin/sh /update-cert.sh
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
sudo docker compose exec nginx nginx -t
sudo docker compose exec nginx nginx -s reload
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

### 7. ホストの certbot を停止する

**これを止めないと、失敗ループと `csr` / `keys` の肥大が続く。**

```bash
sudo systemctl disable --now certbot.timer
systemctl is-enabled certbot.timer     # → disabled
```

**`/etc/letsencrypt` はまだ削除しない。** 切り戻しの材料として当面残す。

### 8. 自動更新を仕込む

Dify の certbot コンテナは常駐しない（`tail -f /dev/null` で待機するだけで、
更新ジョブは持たない）。**cron で定期実行する。**

```bash
sudo tee /etc/cron.d/dify-certbot-renew > /dev/null <<'EOF'
# Dify のオリジン証明書を毎月1日・15日の03:30に更新する
30 3 1,15 * * root cd /root/dify/docker && /usr/bin/docker compose --profile certbot run --rm certbot /bin/sh /update-cert.sh >> /var/log/dify-certbot-renew.log 2>&1 && /usr/bin/docker compose exec -T nginx nginx -s reload >> /var/log/dify-certbot-renew.log 2>&1
EOF
```

```bash
sudo cat /etc/cron.d/dify-certbot-renew
```

> **`update-cert.sh` が `--force-renewal` を含む場合は頻度に注意。**
> Let's Encrypt の重複証明書は **1週間に5回まで**。
> 月2回なら余裕があるが、`--force-renewal` 付きで毎日回すと枠を使い切る。

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
sudo mkdir -p /root/dify/docker/volumes/certbot/www/.well-known/acme-challenge
sudo sh -c 'echo test-token > /root/dify/docker/volumes/certbot/www/.well-known/acme-challenge/test'
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
sudo rm -f /root/dify/docker/volumes/certbot/www/.well-known/acme-challenge/test
```

### certbot のログ

```bash
sudo tail -50 /root/dify/docker/volumes/certbot/logs/letsencrypt.log
```

---

## ロールバック

```bash
sudo rm -rf /root/dify/docker/volumes/certbot/conf
sudo cp -a /root/certbot-conf-backup-20261014 /root/dify/docker/volumes/certbot/conf
sudo docker compose exec nginx nginx -s reload
```

失効した証明書に戻るが、SSL/TLS が「フル」である限り通信は継続する。

---

## この対応の先にあるもの

| 項目 | 内容 |
| --- | --- |
| **Full (strict) への移行** | 証明書が有効になれば切り替え可能。オリジン証明書が検証されるようになり、Cloudflare とオリジンの間の中間者攻撃を塞げる |
| **DNS-01 への移行** | 80 番の到達性に依存しなくなる。firewall 構成を変えても証明書更新が壊れない。Cloudflare API トークンが必要 |
| `TLSv1.1` の無効化 | `.env` の `NGINX_SSL_PROTOCOLS` から外す。非推奨かつ脆弱 |
