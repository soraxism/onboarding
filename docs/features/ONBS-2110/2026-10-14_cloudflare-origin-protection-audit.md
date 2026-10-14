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
| 現時点で IP 直叩きはブロックされているか | **ブロックされている**（実測で確認） |
| その防御は維持されるか | **維持されない。次回のサーバー再起動で消える** |
| Cloudflare IP の自動更新は機能しているか | **機能していない。2026-01-31 以降ずっと失敗している** |

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

## 2. 【重大】この防御は再起動で消える

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

## 3. 【重大】Cloudflare IP の自動更新が失敗し続けている

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
- Cloudflare がレンジを追加しても反映されず、**正規の Cloudflare 経由アクセスが将来ブロックされうる**
- 失敗しても Slack に通知されないため、**誰も気づけない**

---

## 4. 設計上、手順書どおりでも塞がらない穴

### Cloudflare 共用 IP による迂回

許可条件が「送信元が Cloudflare の IP であること」だけのため、
攻撃者が**自分の Cloudflare アカウントで `162.43.85.203` を向いたゾーンを作成**すると、
その通信は Cloudflare の IP から出てくるため**許可される**。

Cloudflare をオリジン保護に使う場合によく知られた回避経路で、
IP 許可リストだけでは原理的に塞げない。

対策候補:

- **Authenticated Origin Pulls（mTLS）** — Cloudflare が提示するクライアント証明書をオリジンで検証する
- **秘密ヘッダの検証** — Cloudflare 側で付与したヘッダをオリジンで必須化する

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

## 6. 未確認事項（root 権限が必要）

`t_sora` は sudo グループに属するが `sudo` がパスワードを要求するため、以下は未取得。

```bash
ssh -t onb-dify 'sudo iptables -L DOCKER-USER -n -v --line-numbers; echo ===; sudo ipset list cf4 | head -25; echo ===; sudo ipset list cf6 | head -5'
```

| 確認したいこと | 判断基準 |
| --- | --- |
| `cf4` の `Number of entries` | 14 前後なら正常。**0 なら Cloudflare 経由も落ちているはず**で、Dify への到達経路の再調査が必要 |
| DROP ルールの `pkts` カウンタ | 増加していれば、実際に直叩きを落としている動かぬ証拠になる |
| VPN 用の許可ルールの有無 | 構成図の「弊社VPN → IP許可」は手順書に記載がない。別途投入されているはず |
| `3.113.105.121`（NAT Gateway）の許可ルール | 手順書に記載あり。実在するか |

あわせて **Xserver VPS 管理コンソールのパケットフィルター設定**も確認が必要（1 節末尾の推測の裏取り）。

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
