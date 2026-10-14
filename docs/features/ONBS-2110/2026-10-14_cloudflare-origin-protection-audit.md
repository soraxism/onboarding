# Dify オリジンの IP 直叩き防御の調査結果

調査日: 2026-10-14
対象ホスト: `onb-dify`（`162.43.85.203` / Ubuntu 22.04.5 / Xserver VPS）
参照手順書: [Ubuntu + iptables + ipset で Cloudflare 経由のみ HTTP/HTTPS を許可する手順](https://app.notion.com/p/Ubuntu-iptables-ipset-Cloudflare-HTTP-HTTPS-2711e89fd74b80cbb3d5c63162b1d055)

---

## 調査の目的

Dify に対して **Cloudflare を経由しない IP 直叩きのアクセスがブロックされているか**を確認する。

想定している構成は次のとおり。

```
FE（チャット・ヒント） → BE（AI-Server / AI-API） → Cloudflare ─[IP許可]→ Dify
                                                     弊社VPN ─[IP許可]→ Dify
                                                       攻撃者 ─[?]────→ Dify
```

---

## 結論

| 問い | 答え |
| --- | --- |
| 現時点で IP 直叩きはブロックされているか | **ブロックされている**（DROP ルールの実カウンタで確定） |
| その防御は維持されるか | **維持されない。次回のサーバー再起動で消える** |
| Cloudflare IP の自動更新は機能しているか | **機能していない。2026-01-31 以降ずっと失敗している** |
| 許可リスト（`cf4`）の内容は古いか | **現時点では最新**（公式リスト15件と完全一致）。ただし更新が止まっているため今後ずれる |

---

## 1. IP 直叩きはブロックされている（確認済み）

社内の作業端末（Cloudflare 以外の IP）から `162.43.85.203` へ直接アクセスした結果。

| 宛先ポート | 結果 | 解釈 |
| --- | --- | --- |
| 22/tcp | 接続成功 | 手順書どおり SSH は全許可 |
| 80/tcp | **タイムアウト（無応答）** | DROP されている |
| 443/tcp | **タイムアウト（無応答）** | DROP されている |
| 5003/tcp | タイムアウト（無応答） | 到達不可 |
| 3306・9999/tcp（未使用） | タイムアウト（無応答） | 後述 |

「接続拒否（RST）」ではなく「無応答（タイムアウト）」である点が重要。
パケットが黙って捨てられており、DROP ルールの挙動と一致する。

### 対照実験（測定の妥当性）

| 確認項目 | 結果 |
| --- | --- |
| 作業端末 → `github.com:443` / `example.com:80` / `1.1.1.1:443` | すべて到達可（端末側の回線制限ではない） |
| サーバー内部 → `http://127.0.0.1/` | **307**（`Location: /apps`）。Dify は正常稼働 |
| サーバー内部 → `https://127.0.0.1/` | 307 |
| サーバーからの外向き通信 → `https://api.github.com` | 200（アウトバウンドは正常） |

**サービスは生きているが外部からの直叩きだけが落ちている**ため、
ホスト上のフィルタが機能していると判断できる。

### ルールが実在することの傍証

| 確認項目 | 結果 | 意味 |
| --- | --- | --- |
| 外向き NIC | `ens3`（`ip route get 8.8.8.8` → `via 162.43.85.1 dev ens3`） | 手順書の `-i ens3` と一致。不一致ならルールは素通りだった |
| ロード済みカーネルモジュール | `xt_set` / `xt_multiport` / `nft_compat` | それぞれ ipset 照合・複数ポート照合に必要。ルールが存在する証拠 |
| Web サーバー | `nginx` `apache2` とも inactive | Dify は Docker で稼働。`DOCKER-USER` チェーンでの制御が適切な構成 |

### 実ルールとパケットカウンタ（root 権限で確定・2026-10-14 取得）

```
Chain DOCKER-USER (1 references)
num   pkts bytes target  prot opt in     out  source     destination
1      51M 5271M RETURN  tcp  --  ens3   *    0.0.0.0/0  0.0.0.0/0  match-set cf4 src multiport dports 80,443
2     246K   14M DROP    tcp  --  ens3   *    0.0.0.0/0  0.0.0.0/0  multiport dports 80,443
```

```
-A DOCKER-USER -i ens3 -p tcp -m set --match-set cf4 src -m multiport --dports 80,443 -j RETURN
-A DOCKER-USER -i ens3 -p tcp -m multiport --dports 80,443 -j DROP
```

| 読み取れること | 内容 |
| --- | --- |
| **DROP ルールが 246,000 パケット（14MB）を破棄済み** | **IP 直叩きが実際にブロックされている動かぬ証拠**。推測ではなく実績 |
| RETURN ルールが 51,000,000 パケット（5.2GB）を通過 | 正規の Cloudflare 経由トラフィックは正常に流れている |
| ルールは `-i ens3` 指定つきで 2 本のみ | 手順書本体の構成と一致 |

稼働 36 週間（約 6,100 時間）で 246K パケットなので、**1 時間あたり約 40 パケット**。
TCP の再送を考えると接続試行は 1 時間あたり 10 件前後で、
インターネット上の常時スキャンの水準。特定の攻撃が続いている兆候ではない。

### `cf4` は現時点では最新（確定）

`cf4` のエントリは **15 件**で、Cloudflare 公式の IPv4 レンジ一覧
（`https://www.cloudflare.com/ips-v4`、2026-10-14 時点で 15 件）と**完全に一致**した。

つまり **「更新が失敗し続けているが、内容はたまたま最新のまま」**という状態。
Cloudflare がレンジを変更した時点で初めて実害が出る。**今は無事だが、時限式の問題**。

### `cf6` はルールから参照されていない（確定）

```
Name: cf6
Number of entries: 7
References: 0      ← どの ip6tables ルールからも参照されていない
```

`References: 0` は、**IPv6 側の DOCKER-USER ルールが投入されていない**ことを意味する。
ただしグローバル IPv6 アドレスが無いため、現時点で実害は無い。

### NAT Gateway / VPN の許可ルールが無いのは設計どおり（2026-10-14 確認）

`DOCKER-USER` には Cloudflare 許可と DROP の 2 本しか無く、
NAT Gateway（`3.113.105.121`）と弊社 VPN の許可ルールは存在しない。

当初これを欠落と判断したが、**実装者に確認したところ設計どおり**だった。
**VPN と NAT Gateway の IP 制限は Cloudflare 側で行っている。**

```
FE ──→ BE（AI-Server / AI-API）──[IP許可]──→ Cloudflare ──[Cloudflareの IP許可]──→ Dify
                                    弊社VPN ──[IP許可]──→ ↑
```

つまり二段構成になっている。

| 層 | 役割 |
| --- | --- |
| **オリジン（iptables + ipset）** | 「Cloudflare 全体」を許可する粗い網。直叩きを落とす |
| **Cloudflare（IP アクセスルール）** | BE・VPN の送信元 IP だけに絞る細かい網 |

正規の通信はすべて Cloudflare を通るため、オリジン側に個別の許可ルールは要らない。
手順書に残っている `3.113.105.121` の許可は、この構成では不要。

**この構成では「オリジンに届いた時点で Cloudflare は通過済み」が前提になる。**
したがって次節の「Cloudflare 共用 IP による迂回」は、
単にオリジンへ到達されるだけでなく、**Cloudflare 側の IP 制限ごと迂回される**ことを意味する。

### IPv6 からの迂回は成立しない

`[::]:80` `[::]:443` で LISTEN しているが、**グローバル IPv6 アドレスが未割り当て**で
IPv6 の経路自体が存在しない（`ip -6 route get` が `Network is unreachable`）。
`ip6tables` 側のルールや `cf6` の状態にかかわらず、IPv6 経由では到達できない。

### 未使用ポートまで無応答である件（推測）

`ufw` が無効（後述）で INPUT ポリシーが ACCEPT のままなら、
LISTEN していない 3306・9999 は RST を返すはずだが、実際は無応答だった。
`DOCKER-USER` のルールは 80/443 しか対象にしていないため、
**Xserver VPS 側のパケットフィルターが 22/80/443 以外を遮断している**可能性が高い。

ただしこれは外形からの推測であり、**VPS 管理コンソールでの確認が必要**。

---

## 2. 【重大】この防御は再起動で消える【2026-10-14 対応済み】

> **対応済み。** `docker-user-fw.service` を新設し、`enabled` + `active (exited)` を確認した。
> `Requires=update-cf-ipset.service` により、ipset の復元後にルールが適用される順序も保証した。
> `cf4` が 10 件未満ならルールを適用せず異常終了する安全装置付き。
>
> **2026-10-14 20:18 に再起動テストを実施し合格。**
> `update-cf-ipset`（20:19:18）→ `docker-user-fw`（20:19:19）の順で自動起動し、
> `cf4` 15 件・ルール 2 本・秘密ヘッダ検証・外部からの遮断のすべてが復元された。
>
> **2026-10-14 追記: 秘密ヘッダ対応により、最悪ケースが緩和された。**
> nginx の検証設定はホストマウント配下にあり再起動後も残るため、
> 仮に iptables ルールが消えても **オリジンは 403 を返す**。
> 再起動時のリスクは「Dify が丸見え」から「ポートは開くが 403」に下がった。
> ただし**多層防御とポートスキャン対策として永続化は引き続き必要**。

`DOCKER-USER` のルールは `iptables -I` でメモリ上に投入されているだけで、永続化されていない。

| 永続化の仕組み | 状態 |
| --- | --- |
| `/etc/systemd/system/docker-user-fw.service`（手順書「永続化」節のサービス） | **存在しない** |
| `netfilter-persistent` | inactive |

```
最終起動: 2026-01-31 00:22:45
稼働時間: 36 週間 4 日
```

**再起動していないから残っているだけ**の状態。
次回起動時に Docker が `DOCKER-USER` チェーンを初期状態で作り直すため、
**Dify は IP 直叩きに対して無防備になる。**

---

## 3. 【重大】Cloudflare IP の自動更新が失敗し続けている【2026-10-14 対応済み】

> **対応済み。** 4 連バックスラッシュを 1 個に一括置換し、dev の正しい版と同一内容にした
> （本番の Slack Webhook URL は保持）。手動実行と `systemctl restart` の双方で
> `Result=success` を確認。起動時の ipset 復元（4 節）も解消した。


### 症状

`/etc/cron.d/update-cf-ipset` により毎日 04:00 に実行されているが、失敗している。

```
# /var/log/update-cf-ipset.log （2026-10-14 04:00:02 時点）
[*] updating Cloudflare ipsets...
curl: (6) Could not resolve host: \\
curl: (6) Could not resolve host: \\
```

起動時に ipset を復元する `update-cf-ipset.service` も失敗したまま。

```
× update-cf-ipset.service - Update Cloudflare IPSet
     Loaded: loaded (/etc/systemd/system/update-cf-ipset.service; enabled)
     Active: failed (Result: exit-code) since Sat 2026-01-31 00:23:16 JST
   Main PID: 2215 (code=exited, status=6)
```

### 原因

`/usr/local/sbin/update-cf-ipset.sh` の **109 行目**。
Notion の手順書からコピーした際にバックスラッシュが多重エスケープされたまま残っている。

```bash
# 109行目（現状）
[[ "$cidr" =~ ^([0-9]{1,3}\\\\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] || continue
#                          ^^^^ 本来は \.
```

この正規表現は「数字の後にリテラルのバックスラッシュ」を要求するため、
**どの CIDR にもマッチせず全件スキップされる**。
結果 `cf4_tmp` が 0 件になり、安全装置 `MIN_IPV4_COUNT=10` に引っかかって `exit 1` する。

検証結果:

| 確認項目 | 結果 |
| --- | --- |
| サーバーから `https://www.cloudflare.com/ips-v4` の取得 | **200（成功）**。14 行取得できる |
| 正しい正規表現（`\.`）でのマッチ件数 | **14 件すべてマッチ** |
| 現状の正規表現でのマッチ件数 | **0 件** |

取得は成功しており、**壊れているのは正規表現だけ**。

なお IPv6 側（119 行目）はドットを含まないパターンのため、この不具合の影響を受けない。

### 通知も飛んでいない

ログに出ている `Could not resolve host: \\` は、
Slack 通知関数 `slack_error()` 内の `curl` でも同じエスケープ崩れが起きているもの。
`SLACK_WEBHOOK_URL` は設定済みだが、**エラーが起きても Slack に通知されない**。

ログに出る 2 件のエラーは、`slack_error` が
「sanity check 失敗時」と「`cleanup` トラップ時」の 2 回呼ばれていることと一致する。

### 影響

- `cf4` は**最後に手動投入された内容のまま固定**されている
  （**2026-10-14 時点では公式リストと完全一致しており、内容は古くない**）
- Cloudflare がレンジを追加しても反映されず、**正規の Cloudflare 経由アクセスが将来ブロックされうる**
- 失敗しても Slack に通知されないため、**誰も気づけない**

**今は無事だが時限式の問題**という位置づけ。Cloudflare のレンジ変更が引き金になる。

---

## 4. 設計上、手順書どおりでも塞がらない穴

### Cloudflare 共用 IP による迂回【2026-10-14 対応済み】

> **秘密ヘッダ方式で対応済み。**
> Cloudflare の Transform Rule `origin-auth-header` が `X-Origin-Auth` を付与し、
> Dify 前段の nginx で検証している。ヘッダ無しのアクセスは 403。
> 手順と実施結果は [2026-10-14_origin-auth-header-runbook.md](./2026-10-14_origin-auth-header-runbook.md)。
>
> 採用しなかった Zone-level AOP（mTLS）は、共有秘密を避けたい場合の移行先として残す。

許可条件が「送信元が Cloudflare の IP であること」だけのため、
攻撃者が**自分の Cloudflare アカウントで `162.43.85.203` を向いたゾーンを作成**すると、
その通信は Cloudflare の IP から出てくるため**許可される**。

**この構成では被害が IP 到達にとどまらない。** 上記のとおり BE・VPN の絞り込みは
Cloudflare 側の IP アクセスルールで行っているため、攻撃者が自分の Cloudflare を挟むと
**その IP 制限ごと迂回され、Dify に素通しで到達する**。
オリジン側の ipset は「Cloudflare であること」しか見ていないため、何も止められない。

#### 対策の選択肢

| 方式 | 迂回を塞げるか | 必要な変更 |
| --- | --- | --- |
| **Authenticated Origin Pulls（Global）** | **塞げない** | 小 |
| **Authenticated Origin Pulls（Zone-level / 自前証明書）** | **塞げる** | 中（Dify 前段 nginx の設定） |
| **秘密ヘッダの検証** | 塞げる | 中（同上） |
| **Cloudflare Tunnel（cloudflared）** | 塞げる | 大（80/443 を公開しなくなる） |

**重要: 標準の「Global」AOP では塞げない。**
Cloudflare が提供する Origin Pull CA 証明書は**全 Cloudflare アカウントで共有**されており、
「Cloudflare ネットワークから来たこと」しか証明しない。
攻撃者が自分の Cloudflare アカウントから送っても**同じ証明書を提示するため通過する**。

> Global AOP uses a Cloudflare-provided certificate shared across all accounts,
> so it only proves a request came from the Cloudflare network — not from your account specifically.
> — [Cloudflare SSL/TLS docs](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/)

塞ぐには**自前の証明書をアップロードする Zone-level AOP**（または per-hostname AOP）が必要。
証明書がアカウント専有になるため、他アカウント経由の通信は TLS ハンドシェイクで落ちる。

**秘密ヘッダ方式**は、Cloudflare の Transform Rule で固定ヘッダを付与し、
オリジンの nginx で必須化する。mTLS より弱い（ヘッダが漏れると破られる）が構成変更は小さい。

**Cloudflare Tunnel** が最も堅い。オリジンが 80/443 を公開しなくなるため、
IP 直叩きという攻撃面自体が消滅する。ただし Dify の配置変更を伴う。

いずれも **Dify 前段の nginx はコンテナ内**にあるため、
ボリュームマウントか compose の構成変更が必要。別途調査の上で実施する。

### 【重大】オリジンの証明書が 283 日前に失効している

```
subject : CN = dify-stands.com
issuer  : C = US, O = Let's Encrypt, CN = E7
notAfter: Jan  4 12:31:12 2026 GMT    ← 2026-10-14 時点で 283 日超過
```

Cloudflare の SSL/TLS モードが **「フル」**（Full (strict) ではない）で、
**オリジンの証明書を検証しないため失効に気づかず 9 か月以上運用されていた**。

**原因は 2 つあり、別々の問題だった（2026-10-14 特定）。**

| 系統 | 状態 |
| --- | --- |
| **Dify の certbot**（nginx が読む側） | 設定は正しい（`authenticator = webroot`）。だが `profiles: [certbot]` かつ `command: tail -f /dev/null` のため、**人が手で実行しない限り動かない**。2025-10-06 の手動取得以降まったく更新されず、90 日後に自然失効した |
| **ホストの certbot** | `authenticator = standalone` で 80 番を bind しようとするが、Docker の nginx が使用中のため毎回失敗。1 日 2 回の失敗が蓄積し `csr` / `keys` が肥大。**ただし nginx はこのストアを読んでいない** |

**firewall は無関係だった。** 当初「Cloudflare 限定の許可ルールが HTTP-01 を阻害した」と
推測したが、証明書の発行日と `update-cf-ipset.sh` の設置日が同日だったことによる
見かけ上の相関にすぎなかった。

**本質は「自動更新が存在しなかった」こと。**
取り直しても cron を仕込まなければ 90 日後に再発する。

| 影響 | 内容 |
| --- | --- |
| 現在 | 「フル」モードのため通信は継続している。**利用者側のブラウザには影響しない**（Cloudflare が別の証明書を提示するため） |
| Full (strict) への移行 | **現状のままでは不可**。切り替えた瞬間に Cloudflare 経由の通信がすべて落ちる |
| 恒久対策 | **DNS-01 チャレンジへの切り替えを推奨**。Cloudflare API トークンを使えば 80 番の到達性に依存しないため、現在の firewall 構成のまま更新できる |

詳細な原因特定には `sudo journalctl -u certbot` と `/var/log/letsencrypt/` の確認が必要。

### その他

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| SSH(22) | 全世界公開 | 手順書上は意図どおり。鍵認証のみかは別途確認が必要 |
| `fail2ban` | inactive | SSH が全公開である点と合わせて要検討 |
| `8125/udp` | `*`（全インターフェース）で LISTEN | collectd の statsd。本来 `127.0.0.1` に絞るべき |
| `5003/tcp` | `0.0.0.0` で LISTEN するがローカルからも応答なし | 用途不明。不要なら閉じる |

---

## 5. ufw について（誤解しやすい点）

`systemctl` 上は有効に見えるが、**ufw は使われていない**。これは手順書どおりで問題ない。

```
systemctl is-enabled ufw → enabled
systemctl is-active  ufw → active (exited)
```

| 確認項目 | 実態 |
| --- | --- |
| `/etc/ufw/ufw.conf` | `ENABLED=no`（2024-07-29 時点のまま） |
| `active (exited)` の意味 | ufw.service は oneshot。起動処理が正常終了しただけで、フィルタの有無とは無関係 |
| `/etc/default/ufw` の `DEFAULT_INPUT_POLICY="DROP"` | ufw が有効なときのみ適用される値。**現状は効いていない** |

手順書は ufw を使う旧方式から **iptables (`DOCKER-USER`) + ipset 方式へ改訂済み**であり、
`ENABLED=no` はその結果。ufw を有効化すると現行ルールと干渉するため、**安易に有効化しないこと**。

---

## 6. dev 環境との比較（本番だけが壊れている）

同じ手順書は `onb-dify-dev`（`210.131.217.130`）にも適用されている。
手順書内の実行例に `root@x210-131-217-130` が残っていることから気づき、確認した。

**結果として dev は正常に機能しており、本番側だけが壊れている。**

| 確認項目 | `onb-dify`（本番） | `onb-dify-dev`（dev） |
| --- | --- | --- |
| 更新スクリプト 109 行目の正規表現 | `\\\\.`（**壊れている**） | `\.`（**正しい**） |
| `slack_error()` の行継続 | `\\\\`（**壊れている**） | `\`（**正しい**） |
| 更新ログの最終結果 | `curl: (6) Could not resolve host: \\` | `[OK] updated: v4=15, v6=7` |
| `docker-user-fw.service` | **存在しない** | 存在し `enabled` |
| `update-cf-ipset.service` | **failed**（2026-01-31 以降） | 正常（oneshot 完了済み） |
| 外向き NIC | `ens3` | `ens3` |

本番は Notion からのコピペ時にエスケープが崩れたまま、
dev は崩れていない状態で投入されたと考えられる。

**dev に動作実績のある実物があるため、是正は「dev の構成を本番へ移植する」のが最短。**

### dev の `docker-user-fw.service`（動作実績あり）

```ini
[Unit]
Description=Apply DOCKER-USER Cloudflare allowlist
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c '\
  ipset list cf4 >/dev/null 2>&1 || ipset create cf4 hash:net family inet; \
  iptables -C DOCKER-USER -p tcp -m set --match-set cf4 src -m multiport --dports 80,443 -j RETURN 2>/dev/null || \
  iptables -I DOCKER-USER 1 -p tcp -m set --match-set cf4 src -m multiport --dports 80,443 -j RETURN; \
  iptables -C DOCKER-USER -p tcp -m multiport --dports 80,443 -j DROP 2>/dev/null || \
  iptables -I DOCKER-USER 2 -p tcp -m multiport --dports 80,443 -j DROP'

[Install]
WantedBy=multi-user.target
```

ただし**そのまま移植するのは避けたい弱点が 2 つある**。

1. **`cf4` が空でも DROP を入れてしまう** — `ipset create cf4` で空のセットを作った上で
   DROP ルールを投入するため、`update-cf-ipset.service` より先に実行されると
   **Cloudflare 経由を含む全アクセスが遮断される**。順序指定（`After=update-cf-ipset.service`）も無い
2. **`-i ens3` が無い** — 手順書本体は `-i ens3` を指定している。
   インターフェース指定が無いと docker のブリッジ経由で転送される 80/443 にもマッチするため、
   コンテナ間通信に影響しうる

是正手順では、この 2 点に安全装置を足した版を使う（[是正手順](./2026-10-14_remediation-runbook.md) 手順 3）。

また **dev 側にも 1 の弱点は残っている**ため、本番の対応後に同じ改善を入れることを推奨する。

---

## 7. root 確認の結果と、残る未確認事項

2026-10-14 に root 権限での確認を実施し、以下が確定した。

| 確認項目 | 結果 |
| --- | --- |
| `DOCKER-USER` の実ルール | 2 本（CF 許可 → RETURN / その他 DROP）。`-i ens3` 指定あり |
| DROP ルールの `pkts` | **246K パケット / 14MB。直叩きを実際に落としている** |
| RETURN ルールの `pkts` | 51M パケット / 5.2GB。正規トラフィックは正常 |
| `ipset cf4` のエントリ数 | **15 件。公式リストと完全一致（現時点では最新）** |
| `ipset cf6` | 7 件だが `References: 0`。IPv6 ルールは未投入（実害なし） |
| NAT Gateway（`3.113.105.121`）の許可ルール | 存在しない（**設計どおり**。Cloudflare 側で制限） |
| 弊社 VPN の許可ルール | 存在しない（**設計どおり**。Cloudflare 側で制限） |

### 残る未確認事項

- **Xserver VPS 管理コンソールのパケットフィルター設定** — 未使用ポートまで無応答だったため、
  VPS 側でも遮断されていると推測しているが未裏取り
- **`5003/tcp` の用途** — `0.0.0.0` で LISTEN しているがローカルからも応答が無い

---

## 調査に使ったコマンド

```bash
# 外部からの到達性（macOS には timeout が無いため nc 自前のタイムアウトを使う）
nc -z -G 5 -w 5 -v 162.43.85.203 80

# ホスト側の状態
ssh onb-dify 'ss -tulpn'
ssh onb-dify 'lsmod | grep -E "^(ip_tables|iptable_|nf_tables|nft_|x_tables)"'
ssh onb-dify 'ip route get 8.8.8.8'
ssh onb-dify 'ip -6 route get 2001:4860:4860::8888'
ssh onb-dify 'systemctl status update-cf-ipset.service --no-pager'
ssh onb-dify 'tail -5 /var/log/update-cf-ipset.log'
ssh onb-dify 'grep -n "cidr.*=~" /usr/local/sbin/update-cf-ipset.sh'
```
