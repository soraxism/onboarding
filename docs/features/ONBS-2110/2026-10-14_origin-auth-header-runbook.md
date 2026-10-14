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

## 前提条件の確認（最優先）

### SSL/TLS モードが Full (strict) であること

**Flexible だと Cloudflare → オリジン間が平文になり、ヘッダが経路上で読み取れてしまう。**
秘密ヘッダ方式はこの前提が崩れると意味を失う。

Cloudflare ダッシュボード → 対象ゾーン → SSL/TLS → Overview で確認する。
`Full (strict)` 以外なら、**この手順を始める前に**切り替えの可否を検討すること。

### ダッシュボードの閲覧権限

Transform Rule の値は、ゾーンの閲覧権限がある全員に見える。
秘密ヘッダは共有秘密なので、**値を見られる人＝偽装できる人**になる。
閲覧権限が広い場合は、Zone-level AOP（mTLS）を検討したほうがよい。

---

## Phase 0: 情報収集

Dify の nginx 構成が分からないと Phase 2 が書けない。先に取得する。

```bash
ssh -t onb-dify 'sudo docker ps --format "{{.Names}}\t{{.Image}}\t{{.Ports}}"'
```

```bash
ssh -t onb-dify 'sudo docker inspect $(sudo docker ps -qf name=nginx) --format "{{range .Mounts}}{{.Source}} -> {{.Destination}} ({{.Mode}})\n{{end}}"'
```

```bash
ssh -t onb-dify 'sudo find / -maxdepth 6 -name "docker-compose.y*ml" -not -path "*/node_modules/*" 2>/dev/null'
```

確認したいこと:

| 項目 | なぜ必要か |
| --- | --- |
| nginx コンテナ名とイメージ | 設定の反映方法が変わる |
| **nginx 設定がホストからマウントされているか** | マウントされていればファイル編集だけで済む。イメージ内のみなら compose の変更が必要 |
| docker-compose.yaml の場所 | マウント追加が必要な場合の編集対象 |

Dify の標準構成では `docker/nginx/` 配下（`nginx.conf.template`、
`conf.d/default.conf.template` 等）がホストからマウントされている。
その場合はファイルを編集して nginx を再起動するだけでよい。

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

Cloudflare ダッシュボード → 対象ゾーン → **Rules** → **Transform Rules** →
**Modify Request Header** → **Create rule**

| 項目 | 設定 |
| --- | --- |
| Rule name | `origin-auth-header` |
| 適用条件 | `All incoming requests`（ゾーン全体に付与する） |
| Action | **Set static** |
| Header name | `X-Origin-Auth` |
| Value | 1-1 で生成した値 |

**`Add` ではなく `Set` を選ぶこと。** `Set` ならクライアントが同名ヘッダを
送ってきても上書きされるため、クライアント由来の値が混入しない。

### 1-3. 付与されているか確認する

オリジン側のアクセスログでヘッダが届いているかを見る。
ログにヘッダが出ていない場合は、Phase 2-1 のログ出力を先に入れてから確認する。

---

## Phase 2: オリジン側（ここで初めて塞がる）

**現在 Dify の利用者がいないため、ログ観察フェーズを省いて直接遮断する。**
遮断を先に確認し、そのあと疎通を確認する順で進める。

> 利用者がいる状態で再適用する場合（dev 環境など）は、
> 巻末の「付録: 利用者がいる場合の段階的な適用」に従うこと。

### 2-1. nginx に検証を入れる

`http` ブロックに追加:

```nginx
map $http_x_origin_auth $origin_auth_ok {
    default 0;
    "<1-1で生成した値>" 1;
}
```

`server` ブロックに追加:

```nginx
if ($origin_auth_ok = 0) { return 403; }
```

> `if` は nginx では避けるべきとされるが、**`server` ブロック直下の `return` は
> 公式に安全とされる用法**なので問題ない。

### 2-2. 構文確認と反映

```bash
ssh -t onb-dify 'sudo docker exec <nginxコンテナ名> nginx -t'
```

**`nginx -t` が `syntax is ok` / `test is successful` を返してから** reload する。
構文エラーのまま reload すると nginx が落ちる。

```bash
ssh -t onb-dify 'sudo docker exec <nginxコンテナ名> nginx -s reload'
```

### 2-3. 遮断の確認（先にこちら）

サーバー内部から、ヘッダ無しでアクセスして 403 になることを確認する。

```bash
ssh onb-dify 'curl -s -o /dev/null -w "ヘッダ無し: %{http_code}\n" -H "Host: <ドメイン>" http://127.0.0.1/'
```

**期待値: `403`**

| 結果 | 判断 |
| --- | --- |
| `403` | 検証が効いている。2-4 へ進む |
| `307` / `200` | **検証が効いていない。** `map` の値、ヘッダ名、`server` ブロックの位置を確認する |
| `000` / 接続エラー | nginx が落ちている可能性。`sudo docker ps` と `nginx -t` を確認し、必要ならロールバック |

### 2-4. 疎通の確認

ヘッダを付けたアクセスが通ることを確認する。

```bash
ssh onb-dify 'curl -s -o /dev/null -w "ヘッダ有り: %{http_code}\n" -H "Host: <ドメイン>" -H "X-Origin-Auth: <値>" http://127.0.0.1/'
```

**期待値: `307`（`/apps` へのリダイレクト）または `200`**

そのうえで、**正規ドメインをブラウザで開いて Dify が正常に表示されること**を必ず確認する。
ここが最終確認であり、Cloudflare の Transform Rule が実際に効いているかの検証も兼ねる。

| 結果 | 判断 |
| --- | --- |
| ブラウザで正常表示 | 完了 |
| ブラウザで 403 | **Cloudflare 側のヘッダが届いていない。** Transform Rule の値・ヘッダ名・適用条件を確認する。直らなければロールバックする |

### 2-5. 迂回経路が塞がったことの確認（任意）

別の Cloudflare アカウントでオリジン IP（`162.43.85.203`）を向いたゾーンを作り、
そこからアクセスして **403 になること**を確認するのが最も確実。
検証用アカウントが必要なため、実施可否は判断に委ねる。

---

## ロールバック

オリジン側の 1 行を消して reload するだけで即座に戻る。

```bash
# 2-3 で追加した if ブロックを削除してから
ssh -t onb-dify 'sudo docker exec <nginxコンテナ名> nginx -t && sudo docker exec <nginxコンテナ名> nginx -s reload'
```

Cloudflare 側の Transform Rule は残しておいてよい（付けるだけなら無害）。

---

## 運用

| 項目 | 内容 |
| --- | --- |
| 秘密値の保管 | 1Password 等。git には入れない |
| ローテーション | `map` に新旧 2 値を許可 → Transform Rule を新値に変更 → 旧値を `map` から削除、の順で無停止に行える |
| 再起動耐性 | nginx 設定がホストマウントなら再起動後も残る。イメージ内に直接書いた場合は消えるため、必ずマウント経由にする |
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
