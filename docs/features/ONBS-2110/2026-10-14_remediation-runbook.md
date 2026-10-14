# Dify オリジン防御の是正手順

作成日: 2026-10-14
前提: [2026-10-14_cloudflare-origin-protection-audit.md](./2026-10-14_cloudflare-origin-protection-audit.md)
対象ホスト: `onb-dify`（`162.43.85.203`）

---

## 作業前の注意

- **すべて 80/443 の疎通に影響する変更**。Dify が落ちると FE のチャット・ヒントが停止する
- **SSH(22) はルールの対象外**なので、作業中に締め出される心配はない
- 作業は `sudo` が必要。`t_sora` はパスワード入力が要る
- 緊急時の全解除は `sudo iptables -F DOCKER-USER`（Dify は復旧するが**無防備になる**）

### 実施順序が重要

**手順 2（スクリプト修正）を手順 3（ルール永続化）より先に行うこと。**

現状は ipset の更新が失敗しているため、先に永続化だけ入れると、
再起動時に `cf4` が空のまま DROP ルールが適用され、
**Cloudflare 経由を含む全アクセスが遮断されて Dify が完全停止する**。

---

## 手順 1: 現状の確定（2026-10-14 実施済み）

```bash
ssh -t onb-dify 'sudo iptables -L DOCKER-USER -n -v --line-numbers; echo ===; sudo ipset list cf4 | head -25; echo ===; sudo ipset list cf6 | head -5'
```

### 取得結果

```
Chain DOCKER-USER (1 references)
num   pkts bytes target  prot opt in    out  source     destination
1      51M 5271M RETURN  tcp  --  ens3  *    0.0.0.0/0  0.0.0.0/0  match-set cf4 src multiport dports 80,443
2     246K   14M DROP    tcp  --  ens3  *    0.0.0.0/0  0.0.0.0/0  multiport dports 80,443
```

| 項目 | 結果 |
| --- | --- |
| `cf4` のエントリ数 | **15 件。公式リストと完全一致** |
| `cf6` | 7 件だが `References: 0`（ルール未投入） |
| VPN 許可ルール | **存在しない** |
| `3.113.105.121`（NAT Gateway）許可ルール | **存在しない** |

**手順 3 の永続化スクリプトは、この 2 本構成をそのまま再現すればよい。**
NAT Gateway・VPN の許可ルールが無いのは**設計どおり**（IP 制限は Cloudflare 側で実施）のため、
追加は不要。手順書に残る `3.113.105.121` の許可もこの構成では要らない。

変更前のバックアップも取っておく。

```bash
ssh -t onb-dify 'sudo iptables-save > /root/iptables-backup-20261014.rules; sudo ipset save > /root/ipset-backup-20261014.conf'
```

---

## 手順 2: 更新スクリプトの修正（優先度: 高）

**`onb-dify` にログインした状態で実行する。**

### 2-0. 壊れ方の実態

本番と dev のスクリプトを突き合わせた結果、**差分はすべて
「バックスラッシュが 4 倍になっている」だけ**だった。

| 箇所 | 本番 | 正しい値 |
| --- | --- | --- |
| 109 行目の正規表現 | `\\\\.` | `\.` |
| `slack_error()` の行継続 | `\\\\` | `\` |
| 改行エスケープ | `\\\\n` | `\n` |
| `sed 's/"/..../g'` | バックスラッシュ 8 個 | 2 個 |

いずれも **1/4 になる**ため、`\\\\`（4 個）→ `\`（1 個）の一括置換で直る。
8 個の箇所も 4 個 2 組として処理されるため同時に直る。

**Slack Webhook URL は dev と本番で異なる。** dev のファイルをそのまま持ち込むと
通知先が変わるため、**置換方式を採る**（本番の値がそのまま残る）。

### 2-1. バックアップ

```bash
sudo cp /usr/local/sbin/update-cf-ipset.sh{,.bak-20261014}
sudo iptables-save > /root/iptables-backup-20261014.rules
sudo ipset save > /root/ipset-backup-20261014.conf
```

### 2-2. 置換を適用する

```bash
sudo sed -i 's/\\\\\\\\/\\/g' /usr/local/sbin/update-cf-ipset.sh
```

> この置換は事前に手元で検証済み。適用後のファイルは
> **dev の正しい版と完全一致**し、本番の Webhook URL は保持される。

### 2-3. 適用結果を確認する

```bash
# 構文チェック
sudo bash -n /usr/local/sbin/update-cf-ipset.sh && echo "構文OK"

# 109 行目が正しくなったか
sed -n '109p' /usr/local/sbin/update-cf-ipset.sh
```

期待する出力:

```
  [[ "$cidr" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] || continue
```

```bash
# 4 連バックスラッシュが残っていないか（0 になること）
grep -c '\\\\\\\\' /usr/local/sbin/update-cf-ipset.sh
```

### 2-4. 手動実行する（ここで ipset が実際に更新される）

```bash
sudo /usr/local/sbin/update-cf-ipset.sh
```

**期待する出力: `[OK] updated: v4=15, v6=7`**

`ipset swap` はアトミックに入れ替わるため、**この操作で通信が途切れることはない**。

```bash
sudo ipset list cf4 | grep "Number of entries"
sudo ipset list cf6 | grep "Number of entries"
```

実行後、**Cloudflare 経由で Dify が正常に表示されること**を確認する。

---

## 手順 3: ルールの永続化（優先度: 高）

**手順 2 が成功してから実施する。** `cf4` が空のまま永続化すると、
再起動時に Cloudflare 経由を含む全アクセスが遮断される。

### 3-1. 適用スクリプトを作る

```bash
sudo vi /usr/local/sbin/apply-docker-user-fw.sh
```

```bash
#!/usr/bin/env bash
set -euo pipefail

NIC=ens3
MIN=10

# cf4 が空のまま DROP を入れると Cloudflare 経由も落ちるため中断する
cnt="$(ipset list cf4 2>/dev/null | awk '/^Number of entries:/ {print $4+0; exit}')"
cnt="${cnt:-0}"
if [[ "$cnt" -lt "$MIN" ]]; then
  echo "cf4 has too few entries ($cnt); refusing to apply DROP rules" >&2
  exit 1
fi

# 1: Cloudflare からの 80/443 を許可
iptables -C DOCKER-USER -i "$NIC" -p tcp -m set --match-set cf4 src -m multiport --dports 80,443 -j RETURN 2>/dev/null \
  || iptables -I DOCKER-USER 1 -i "$NIC" -p tcp -m set --match-set cf4 src -m multiport --dports 80,443 -j RETURN

# 2: それ以外の 80/443 は破棄
iptables -C DOCKER-USER -i "$NIC" -p tcp -m multiport --dports 80,443 -j DROP 2>/dev/null \
  || iptables -I DOCKER-USER 2 -i "$NIC" -p tcp -m multiport --dports 80,443 -j DROP

echo "[OK] DOCKER-USER rules applied (cf4=$cnt)"
```

```bash
sudo chmod +x /usr/local/sbin/apply-docker-user-fw.sh
```

- **`iptables -C` で既存を確認してから挿入する**ため、何度実行してもルールは重複しない
- **`cf4` が 10 件未満なら何もせず異常終了する。** 全遮断の事故を防ぐための安全装置
- NAT Gateway・VPN の許可ルールは**設計上不要**（IP 制限は Cloudflare 側で実施）

### 3-2. systemd ユニットを作る

```bash
sudo vi /etc/systemd/system/docker-user-fw.service
```

```ini
[Unit]
Description=Apply DOCKER-USER Cloudflare allowlist
After=docker.service network-online.target update-cf-ipset.service
Wants=network-online.target
Requires=docker.service update-cf-ipset.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/apply-docker-user-fw.sh

[Install]
WantedBy=multi-user.target
```

**`Requires=update-cf-ipset.service` が重要。** ipset の復元が失敗した場合は
このユニットも起動せず、DROP ルールが入らない。
**可用性を優先する倒れ方**であり、オリジンの秘密ヘッダ検証が残るため無防備にはならない。

dev の既存ユニットには**この順序指定と安全装置が無い**ため、そのまま移植していない。

### 3-3. 有効化する

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now docker-user-fw.service
sudo systemctl status docker-user-fw.service --no-pager
```

`Active: active (exited)` かつ `[OK] DOCKER-USER rules applied (cf4=15)` が出ればよい。

```bash
sudo iptables -L DOCKER-USER -n -v --line-numbers
```

**ルールが 2 本のままで、重複していないこと**を確認する。

---

## 手順 4: 再起動テスト（優先度: 高）

**手順 3 までで「再起動しても残る設定」は入ったが、実際に残るかは再起動しないと分からない。**
現在 Dify の利用者がいないため、**検証に適したタイミング**。

### 4-1. 再起動前の状態を記録する

```bash
sudo iptables -L DOCKER-USER -n -v --line-numbers
sudo ipset list cf4 | grep "Number of entries"
sudo systemctl is-enabled update-cf-ipset.service docker-user-fw.service
```

### 4-2. 再起動する

```bash
sudo reboot
```

2〜3 分待ってから再接続する。

### 4-3. 復旧を確認する

```bash
ssh onb-dify
```

```bash
# サービスが成功しているか
systemctl status update-cf-ipset.service --no-pager | head -5
systemctl status docker-user-fw.service --no-pager | head -5

# ipset が復元されているか（15 件）
sudo ipset list cf4 | grep "Number of entries"

# ルールが復元されているか（2 本）
sudo iptables -L DOCKER-USER -n -v --line-numbers

# Dify が起動しているか
sudo docker ps --format "{{.Names}}\t{{.Status}}"

# 秘密ヘッダ検証が残っているか
curl -s -o /dev/null -w "ヘッダ無し: %{http_code}\n" -H "Host: dify-stands.com" http://127.0.0.1/
# → 403 なら正常
```

作業端末からも確認する。

```bash
curl -sS -m 15 -o /dev/null -w "%{http_code}\n" -L https://dify-stands.com/   # → 200
nc -z -G 5 -w 5 -v 162.43.85.203 443                                          # → タイムアウト
```

### 4-4. 失敗したときの応急処置

`docker-user-fw.service` が起動していない場合、手動で適用できる。

```bash
sudo /usr/local/sbin/update-cf-ipset.sh      # ipset を復元
sudo /usr/local/sbin/apply-docker-user-fw.sh # ルールを適用
```

原因は `journalctl` で追う。

```bash
sudo journalctl -u update-cf-ipset.service -u docker-user-fw.service -b --no-pager
```

---

## 手順 5: Cloudflare 共用 IP の迂回対策（優先度: 高）

IP 許可リストだけでは、攻撃者が自分の Cloudflare アカウント経由で到達できる。
**この構成では BE・VPN の絞り込みも Cloudflare 側で行っているため、
迂回されるとアクセス制御ごと無効化される。** 優先度は中ではなく高。

### 方式の比較

| 方式 | 迂回を塞げるか | 変更規模 | 備考 |
| --- | --- | --- | --- |
| AOP（Global） | **塞げない** | 小 | 証明書が全 Cloudflare アカウント共有 |
| AOP（Zone-level / 自前証明書） | **塞げる** | 中 | 証明書がアカウント専有 |
| 秘密ヘッダの検証 | 塞げる | 中 | ヘッダが漏れると破られる |
| Cloudflare Tunnel | 塞げる | 大 | 80/443 を公開しなくなる |

### 【重要】Global AOP では塞げない

Cloudflare が提供する Origin Pull CA 証明書は**全 Cloudflare アカウントで共有**されており、
「Cloudflare ネットワークから来たこと」しか証明しない。
攻撃者が自分の Cloudflare アカウントから送っても**同じ証明書を提示するため通過する**。

> Global AOP uses a Cloudflare-provided certificate shared across all accounts,
> so it only proves a request came from the Cloudflare network — not from your account specifically.
> — [Cloudflare SSL/TLS docs](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/)

### Zone-level AOP（推奨）

1. 自前のクライアント証明書を作成し、Cloudflare にアップロードする
   （[Zone-level AOP](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/zone-level/)）
2. 対象ゾーンで AOP を有効化する
3. Dify 前段の nginx で検証を有効にする

```nginx
ssl_client_certificate /etc/nginx/certs/cloudflare-origin-pull-ca.pem;
ssl_verify_client on;
```

**nginx の設定は Dify の Docker イメージ内にあるため、ボリュームマウントか
compose の構成変更が必要。** 事前に Dify の compose 構成を調査すること。

### 検証方法

設定後、**正規ドメイン経由で Dify が正常に表示されること**を必ず確認する。
証明書の配置を誤ると、Cloudflare 経由の通信もすべて TLS ハンドシェイクで落ちる。

迂回経路を塞げたかの確認は、別の Cloudflare アカウントでオリジン IP を向いたゾーンを作り、
そこからアクセスして拒否されることを見るのが確実（検証用アカウントが必要）。

---

## 手順 6: その他の対応（優先度: 低）

| 項目 | 対応 |
| --- | --- |
| `8125/udp` が全インターフェースで LISTEN | collectd の statsd プラグインを `127.0.0.1` にバインドする |
| `5003/tcp` が用途不明 | 何のプロセスか特定し、不要なら停止する |
| `fail2ban` が inactive | SSH が全世界公開のため、導入を検討する |
| Xserver VPS のパケットフィルター | 管理コンソールで設定内容を確認し、22/80/443 以外が閉じていることを裏取りする |

---

## ロールバック

```bash
# iptables を調査時点に戻す
ssh -t onb-dify 'sudo iptables-restore < /root/iptables-backup-20261014.rules'

# ipset を戻す
ssh -t onb-dify 'sudo ipset restore -! < /root/ipset-backup-20261014.conf'

# スクリプトを戻す
ssh -t onb-dify 'sudo cp /usr/local/sbin/update-cf-ipset.sh.bak-20261014 /usr/local/sbin/update-cf-ipset.sh'

# 永続化サービスを無効化
ssh -t onb-dify 'sudo systemctl disable --now docker-user-fw.service'
```
