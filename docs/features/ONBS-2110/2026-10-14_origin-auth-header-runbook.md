# 秘密ヘッダによるオリジン保護の実施手順

作成日: 2026-10-14
対象: `onb-dify`（`162.43.85.203`）と Cloudflare の対象ゾーン
前提: [調査結果](./2026-10-14_cloudflare-origin-protection-audit.md) の問題点 #5

---

## この手順で何が変わるか

**現状の穴**: オリジンの許可条件が「送信元が Cloudflare の IP であること」だけのため、
攻撃者が自分の Cloudflare アカウントでオリジン IP を向いたゾーンを作ると到達できる。

```
正規:   利用者 → 自社CFゾーン（WAF・IP制限が効く） → Dify
攻撃者: 攻撃者 → 攻撃者のCFゾーン（自社ルールは無関係） → Dify   ← これを塞ぐ
```

**対策後**: 自社ゾーンだけが付与する秘密ヘッダをオリジンで必須化する。
攻撃者のゾーンはそのヘッダを付けられないため、Cloudflare レンジ内から来ても 403 になる。

### Cloudflare 側だけでは塞げない

攻撃者の通信は自社ゾーンを通らないため、**自社ゾーンに設定した WAF・IP アクセスルール・
Transform Rule・Cloudflare Access はどれも実行されない**。
実際に遮断するのは**オリジン（Dify 前段 nginx）側の検証**であり、これは省略できない。

Cloudflare 側は「ヘッダを付ける」役割を担う。**順序としては Cloudflare が先**で、
先にヘッダを流しておけば、オリジンで検証を有効にした瞬間に正規トラフィックが落ちる事故を防げる。

---

## 前提条件の確認（2026-10-14 実施済み）

### SSL/TLS モード: 「フル」（Full (strict) ではない）

| 判定 | 内容 |
| --- | --- |
| **この手順は実施可能** | 「フル」でも Cloudflare → オリジン間は **TLS で暗号化される**ため、秘密ヘッダが平文で流れることはない |
| 避けるべきだったのは「フレキシブル」 | オリジンまで平文になり、この方式が成立しない。該当しない |
| 残存リスク | 「フル」は**オリジンの証明書を検証しない**。Cloudflare とオリジンの間に割り込める攻撃者がいれば、任意の証明書を提示してヘッダを読める。経路上の位置が必要なため難度は高いが、理想は Full (strict) |

### 【要対応】オリジンの証明書が失効している

**Full (strict) へは現状のまま上げられない。** オリジンの証明書が失効しているため、
切り替えた瞬間に Cloudflare 経由の通信がすべて落ちる。

```
subject : CN = dify-stands.com
issuer  : C = US, O = Let's Encrypt, CN = E7
notAfter: Jan  4 12:31:12 2026 GMT    ← 283 日超過（2026-10-14 時点）
```

「フル」モードは証明書を検証しないため、**失効したまま 9 か月以上気づかずに運用されていた**。

| 確認項目 | 結果 |
| --- | --- |
| `certbot` | インストール済み |
| `certbot.timer` | **稼働中**（直近実行 2026-10-14 17:43、次回 2026-10-15 08:10） |
| 証明書 | **283 日前に失効** |
| `/.well-known/acme-challenge/` | **404** |

**タイマーは動いているのに更新できていない。** 原因として有力なのは次の 2 つ。

1. **HTTP-01 チャレンジが成立しない** — `/.well-known/acme-challenge/` が 404 を返しており、
   Dify の nginx がチャレンジ用パスを配信していない。
   certbot が standalone モードなら、80 番を Docker の nginx が握っているため bind できない
2. **firewall による遮断** — 証明書の発行日（2025-10-06）は
   `update-cf-ipset.sh` の設置日と同日。**Cloudflare 限定の許可ルールを入れた直後から
   更新が止まった**と見るのが自然

**推奨する恒久対策は DNS-01 チャレンジへの切り替え。** Cloudflare API トークンを使う方式なら
80 番の到達性に依存しないため、現在の firewall 構成のままで更新できる。

これは**本手順とは別タスク**として扱う（この手順の実施を妨げるものではない）。
詳細な原因は `sudo journalctl -u certbot` と `/var/log/letsencrypt/` の確認が必要。

### ダッシュボードの閲覧権限

Transform Rule の値は、ゾーンの閲覧権限がある全員に見える。
秘密ヘッダは共有秘密なので、**値を見られる人＝偽装できる人**になる。
閲覧権限が広い場合は、Zone-level AOP（mTLS）を検討したほうがよい。

---

## Phase 0: 情報収集（2026-10-14 実施済み）

### 判明した構成

Dify は `/root/dify/docker/` に標準構成で設置されている。
**nginx の設定はすべてホストにマウントされており、イメージや compose の変更は不要。**

| ホスト側 | コンテナ側 |
| --- | --- |
| `/root/dify/docker/nginx/conf.d` | `/etc/nginx/conf.d` |
| `/root/dify/docker/nginx/nginx.conf.template` | `/etc/nginx/nginx.conf.template` |
| `/root/dify/docker/nginx/https.conf.template` | `/etc/nginx/https.conf.template` |
| `/root/dify/docker/nginx/proxy.conf.template` | `/etc/nginx/proxy.conf.template` |
| `/root/dify/docker/volumes/certbot/conf` | `/etc/letsencrypt` |
| `/root/dify/docker/volumes/certbot/www` | `/var/www/html` |

nginx コンテナ名: **`docker-nginx-1`**（`nginx:latest`）

### テンプレート方式である点に注意

起動時に `docker-entrypoint.sh` が `envsubst` でテンプレートを展開する。

| | 通常の nginx | Dify の nginx |
| --- | --- | --- |
| 編集対象 | `default.conf` | **`default.conf.template`** |
| 反映方法 | `nginx -s reload` | **コンテナを `restart`**（reload では再展開されない） |

**展開後の `default.conf` を直接編集しても、コンテナ再起動で消える。**

### 設定の構造

`nginx.conf.template` の `http` ブロックに `include /etc/nginx/conf.d/*.conf;` があり、
`conf.d/default.conf.template` が**単一の `server` ブロック**を定義している。
HTTPS は `${HTTPS_CONFIG}` として同じ `server` ブロックに差し込まれる。

```nginx
http {
    ...
    include /etc/nginx/conf.d/*.conf;    # ← ここに map を置ける
}
```

```nginx
server {
    listen ${NGINX_PORT};
    server_name ${NGINX_SERVER_NAME};
    location /console/api { ... }
    location /api { ... }
    ...
    ${ACME_CHALLENGE_LOCATION}
    ${HTTPS_CONFIG}                      # listen 443 ssl もここ
}
```

**`server` ブロックが 1 つだけ**なので、そこに検証を 1 行入れれば HTTP / HTTPS の両方に効く。

---

## Phase 1: Cloudflare 側（無影響・先に実施）

この段階ではオリジンは何も検証していないため、**正規トラフィックへの影響はゼロ**。

### 1-1. 秘密値を生成する

```bash
openssl rand -base64 48 | tr -d '/+=' | head -c 48; echo
```

- **生成した値は 1Password 等に保管する。** git には絶対に入れない
- ヘッダ名は `CF-` で始めない（Cloudflare の予約接頭辞）。
  用途が推測されにくい名前にする（例: `X-Origin-Auth`）

### 1-2. Transform Rule を作成する

**ルール** → **概要** → **ルールを作成** → **リクエスト ヘッダー変換ルール**

テンプレート選択画面が出たら**スキップして白紙の設定で進める**。

| 設定項目 | 値 |
| --- | --- |
| ルール名 | `origin-auth-header` |
| 受信リクエストが一致する場合 | **すべての受信リクエスト** |
| 操作の種類 | **Set static（静的に設定）** |
| ヘッダー名 | `X-Origin-Auth` |
| 値 | 1-1 で生成した値 |

最後に **デプロイ** を押す。

#### 操作の種類は `Set static` を選ぶ

| 操作 | 内容 | 採否 |
| --- | --- | --- |
| **Set static** | 固定文字列を設定する。既存の同名ヘッダーは**上書き** | **これを選ぶ** |
| Set dynamic | 式で動的に値を組み立てる | 使わない |
| Remove | ヘッダーを削除する | 使わない |

`Set static` が重要なのは、**クライアントが `X-Origin-Auth` を自分で付けて送ってきても
上書きされる**ため。`Add` 相当の挙動だとクライアント由来の値が混入しうる。

#### テンプレート一覧から選んではいけない

ルールテンプレートの一覧には、目的に合うものが**存在しない**。
紛らわしいものがあるため注意する。

| テンプレート | なぜ違うか |
| --- | --- |
| レスポンスに静的ヘッダーを追加する | **方向が逆**。訪問者へ返す側で、オリジンには届かない |
| ヘッダーを使用して認証する | Snippets で**受信リクエストを検証**するもの。付与側ではない |
| リクエストから HTTP ヘッダーを削除する | 種別は正しいが操作が削除 |

白紙から始められない UI の場合は、**「リクエストから HTTP ヘッダーを削除する」テンプレート
から作成し、操作を `Remove` から `Set static` に変更する**。種別が同じなので同じものが作れる。

- ヘッダー名は `CF-` で始めない（Cloudflare の予約接頭辞）

### 1-3. 付与されているか確認する

オリジン側のアクセスログでヘッダが届いているかを見る。
ログにヘッダが出ていない場合は、Phase 2-1 のログ出力を先に入れてから確認する。

---

## Phase 2: オリジン側（ここで初めて塞がる）

**現在 Dify の利用者がいないため、ログ観察フェーズを省いて直接遮断する。**
遮断を先に確認し、そのあと疎通を確認する順で進める。

> 利用者がいる状態で再適用する場合（dev 環境など）は、
> 巻末の「付録: 利用者がいる場合の段階的な適用」に従うこと。

### 前提: サーバーにログインしてから実行する

以下のコマンドは **`onb-dify` にログインした状態**で実行する。

```bash
ssh onb-dify
```

最初の `sudo` でパスワードを一度聞かれ、以降はしばらくキャッシュされる。

#### 秘密値をヒストリに残さない

**秘密値をコマンドラインに直接書かない。** `~/.bash_history` に残り、
サーバー上に平文で保存されてしまう。ファイルへの記述は `vi` で行い、
疎通確認では `read -rs` で変数に読み込む。

### 2-0. バックアップ

```bash
sudo cp /root/dify/docker/nginx/conf.d/default.conf.template{,.bak-20261014}
sudo ls -la /root/dify/docker/nginx/conf.d/
```

### 2-1. `map` を新しいファイルに置く

`default.conf.template` は Dify 管理下のファイルで `envsubst` を通る。
**秘密値はそれとは別の、テンプレートではないファイルに置く。**
`conf.d/*.conf` は nginx が自動で読み込むため、新規ファイルを置くだけでよい。

```bash
sudo vi /root/dify/docker/nginx/conf.d/00-origin-auth.conf
```

内容（`<秘密値>` の部分に Phase 1 で生成した値を貼る）:

```nginx
# Cloudflare 経由でないアクセスを弾くための共有秘密（ONBS-2110）
# 値は Cloudflare の Transform Rule "origin-auth-header" と一致させること
map_hash_bucket_size 128;
map $http_x_origin_auth $origin_auth_ok {
    default 0;
    "<秘密値>" 1;
}
```

**`map_hash_bucket_size 128;` は必須。**
既定値（多くの環境で 64 バイト）はキーの長さに対して小さく、
48 文字の秘密値を入れると nginx が起動に失敗する。

```
[emerg] could not build map_hash, you should increase map_hash_bucket_size: 64
```

このエラーが出ると **nginx が再起動ループに入り、Cloudflare からは 521 に見える**。
128 で足りなければ 256 にする。`map_hash_bucket_size` は http コンテキストの
ディレクティブなので、このファイルに置ける。

**ファイル名の `00-` は必須。** nginx は `conf.d/*.conf` を名前順に読み込むため、
`default.conf` より先に `map` を定義しないと「unknown variable」で起動に失敗する。

このファイルは `envsubst` を通らないため、`$http_x_origin_auth` が書き換わる心配もない。

権限を絞っておく。

```bash
sudo chmod 600 /root/dify/docker/nginx/conf.d/00-origin-auth.conf
```

> nginx は root で起動するため 600 でも読める。
> このファイルの内容は **git に入れない**。

### 2-2. `server` ブロックに検証を入れる

```bash
sudo vi /root/dify/docker/nginx/conf.d/default.conf.template
```

`server_name` の直後に 1 行追加する。

```nginx
server {
    listen ${NGINX_PORT};
    server_name ${NGINX_SERVER_NAME};

    # Cloudflare 経由でないアクセスを拒否する（ONBS-2110）
    if ($origin_auth_ok = 0) { return 403; }

    location /console/api {
```

- `server` ブロックが 1 つしかないため、**この 1 行で HTTP / HTTPS 両方に効く**
- `if` は nginx では避けるべきとされるが、**`server` ブロック直下の `return` は
  公式に安全とされる用法**なので問題ない
- ファイル冒頭に「直接編集するな」と書かれているが、`.env` にこの用途の変数は無いため
  テンプレートを編集するしかない。**Dify のアップグレード時に上書きされる**ので、
  アップグレード後は再適用すること

### 2-3. 反映（reload ではなく restart）

```bash
sudo docker restart docker-nginx-1
```

**テンプレートの再展開が必要なため `reload` では反映されない。**
利用者がいないため、数秒の停止は許容する。

起動を確認する。

```bash
sudo docker ps --filter name=docker-nginx-1 --format "{{.Names}}\t{{.Status}}"
sudo docker logs --tail 20 docker-nginx-1
```

**`Up` になっていなければ設定エラー。** ログを確認し、直らなければロールバックする。

展開結果も確認しておく。

```bash
sudo head -12 /root/dify/docker/nginx/conf.d/default.conf
```

`if ($origin_auth_ok = 0) { return 403; }` が**そのままの形で**出ていればよい。
`$origin_auth_ok` が空文字に化けていたら `envsubst` に食われている。

### 2-4. 遮断の確認（先にこちら）

ヘッダ無しでアクセスして 403 になることを確認する。

```bash
curl -s -o /dev/null -w "ヘッダ無し: %{http_code}\n" -H "Host: dify-stands.com" http://127.0.0.1/
```

**期待値: `403`**

| 結果 | 判断 |
| --- | --- |
| `403` | 検証が効いている。2-5 へ進む |
| `307` / `200` | **検証が効いていない。** `map` の値、ヘッダ名、`server` ブロックの位置を確認する |
| `000` / 接続エラー | nginx が落ちている可能性。`sudo docker ps` とログを確認し、必要ならロールバック |

#### よくある失敗

| ログに出るもの | 原因と対処 |
| --- | --- |
| `[emerg] could not build map_hash, you should increase map_hash_bucket_size: 64` | **秘密値が長すぎる。** `map_hash_bucket_size 128;` を `map` の前に入れる（2-1 参照）。nginx が再起動ループになり、ブラウザからは **521** に見える |
| `[emerg] unknown "origin_auth_ok" variable` | `map` が `default.conf` より後に読まれている。ファイル名が `00-` で始まっているか確認する |
| `nginx: [emerg] ... unexpected "}"` | `default.conf.template` の編集ミス。バックアップから戻す |

### 2-5. 疎通の確認

秘密値を変数に読み込む。**入力は画面に表示されず、ヒストリにも残らない。**

```bash
read -rs SECRET
```

（プロンプトは出ない。値を貼り付けて Enter）

```bash
curl -s -o /dev/null -w "ヘッダ有り: %{http_code}\n" \
  -H "Host: dify-stands.com" -H "X-Origin-Auth: $SECRET" http://127.0.0.1/
```

**期待値: `307`**（`/apps` へのリダイレクト）または `200`

確認が終わったら変数を消す。

```bash
unset SECRET
```

そのうえで、**正規ドメイン（`https://dify-stands.com/`）をブラウザで開いて
Dify が正常に表示されること**を必ず確認する。
ここが最終確認であり、Cloudflare の Transform Rule が実際に効いているかの検証も兼ねる。

| 結果 | 判断 |
| --- | --- |
| ブラウザで正常表示 | 完了 |
| ブラウザで 403 | **Cloudflare 側のヘッダが届いていない。** Transform Rule の値・ヘッダ名・適用条件を確認する。直らなければロールバックする |

### 2-6. 迂回経路が塞がったことの確認（任意）

別の Cloudflare アカウントでオリジン IP（`162.43.85.203`）を向いたゾーンを作り、
そこからアクセスして **403 になること**を確認するのが最も確実。
検証用アカウントが必要なため、実施可否は判断に委ねる。

---

## ロールバック

`onb-dify` にログインした状態で実行する。

```bash
sudo cp /root/dify/docker/nginx/conf.d/default.conf.template.bak-20261014 \
        /root/dify/docker/nginx/conf.d/default.conf.template
sudo rm -f /root/dify/docker/nginx/conf.d/00-origin-auth.conf
sudo docker restart docker-nginx-1
```

復旧を確認する。

```bash
sudo docker ps --filter name=docker-nginx-1 --format "{{.Names}}\t{{.Status}}"
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: dify-stands.com" http://127.0.0.1/
# → 307 に戻れば復旧
```

Cloudflare 側の Transform Rule は残しておいてよい（ヘッダを付けるだけなら無害）。

## 運用

| 項目 | 内容 |
| --- | --- |
| 秘密値の保管 | 1Password 等。git には入れない |
| ローテーション | `map` に新旧 2 値を許可 → Transform Rule を新値に変更 → 旧値を `map` から削除、の順で無停止に行える |
| 再起動耐性 | ホストマウント配下に置くため、コンテナ・サーバーの再起動後も残る |
| **Dify のアップグレード** | `default.conf.template` が上書きされ、**検証の 1 行が消える**。アップグレード後は必ず再適用し、遮断確認まで行う |
| ログの肥大化 | `origin-auth.log` は確認が終わったら出力を止めるか logrotate の対象にする |

---

## この手順で塞げないもの

- **秘密値が漏れた場合** — 共有秘密のため、値を知る者は偽装できる。
  より堅くするには Zone-level AOP（mTLS）へ移行する
- **Dify 自体の認証の弱さ** — この手順はオリジンへの到達を制限するだけ。
  Dify のログイン・API キー管理は別途確認が必要


---

## 付録: 利用者がいる場合の段階的な適用

本番に利用者がいる状態や dev 環境へ適用する場合は、いきなり 403 にせず
**まずログだけ出して、ヘッダが付かない正規アクセスが無いかを確認する。**

`http` ブロック:

```nginx
map $http_x_origin_auth $origin_auth_ok {
    default 0;
    "<値>" 1;
}

log_format origin_auth '$remote_addr "$request" auth_ok=$origin_auth_ok '
                       'host=$host ua="$http_user_agent"';
```

`server` ブロック（**遮断はまだ入れない**）:

```nginx
access_log /var/log/nginx/origin-auth.log origin_auth;
```

数時間〜1営業日ほど流してから確認する。

```bash
ssh -t onb-dify 'sudo docker exec <nginxコンテナ名> grep "auth_ok=0" /var/log/nginx/origin-auth.log | tail -50'
```

| 見えるもの | 判断 |
| --- | --- |
| スキャン系のみ（`/.env`、`/admin` 等への無差別アクセス） | 遮断に進んでよい |
| 正規の利用者・内部通信が混ざっている | 原因を特定し除外条件を足す。**この状態で 403 にしてはいけない** |

内部ヘルスチェックが引っかかる場合の除外例:

```nginx
geo $is_internal {
    default 0;
    127.0.0.1 1;
    172.16.0.0/12 1;   # docker のブリッジ網。実際のレンジに合わせる
}
```

```nginx
set $deny "${origin_auth_ok}${is_internal}";
if ($deny = "00") { return 403; }
```
