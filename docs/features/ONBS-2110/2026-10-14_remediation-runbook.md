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

> **`onb-dify-dev`（`210.131.217.130`）に正しい版がある。**
> 手で直すより、dev から持ってくるほうが確実で早い。
>
> ```bash
> # dev の正しい版を取得して本番へ配置する（本番の既存ファイルは必ず退避してから）
> ssh onb-dify-dev 'sudo cat /usr/local/sbin/update-cf-ipset.sh' > /tmp/update-cf-ipset.sh
> # Slack Webhook URL が dev/本番で異なる場合があるため、差分を確認してから反映すること
> ssh onb-dify 'sudo cat /usr/local/sbin/update-cf-ipset.sh' > /tmp/update-cf-ipset.prod.sh
> diff /tmp/update-cf-ipset.prod.sh /tmp/update-cf-ipset.sh
> ```
>
> 以下は手で直す場合の手順。

### 2-1. 正規表現の修正

`/usr/local/sbin/update-cf-ipset.sh` の 109 行目。

```bash
# 修正前
[[ "$cidr" =~ ^([0-9]{1,3}\\\\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] || continue

# 修正後
[[ "$cidr" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] || continue
```

```bash
ssh -t onb-dify 'sudo cp /usr/local/sbin/update-cf-ipset.sh{,.bak-20261014} && \
  sudo sed -i "109s/\\\\\\\\\\\\\\\\\\./\\\\./" /usr/local/sbin/update-cf-ipset.sh && \
  sed -n "109p" /usr/local/sbin/update-cf-ipset.sh'
```

> sed のエスケープが煩雑なため、**`vi` で直接書き換えるほうが確実**。
> 置換後に 109 行目が `\.` 1 つになっていることを必ず目視確認する。

### 2-2. Slack 通知の修正

`slack_error()` 内の `curl` も同じエスケープ崩れで動作していない。
行継続の `\\\\` を `\` に直す。**通知が復旧しないと、次に壊れたときも気づけない。**

### 2-3. 動作確認（ここが本番反映になる）

```bash
ssh -t onb-dify 'sudo /usr/local/sbin/update-cf-ipset.sh'
# 期待する出力: [OK] updated: v4=14, v6=…

ssh -t onb-dify 'sudo ipset list cf4 | head -25'
```

`ipset swap` は**アトミックに入れ替わる**ため、この操作で通信が途切れることはない。

実行後、Cloudflare 経由で Dify が正常に表示されることを確認する。

---

## 手順 3: DOCKER-USER ルールの永続化（優先度: 高）

再起動でルールが消える問題への対応。手順書の「永続化」節をベースに、
**`cf4` が空のときはルールを入れない安全装置**を追加する。

dev には動作実績のある `docker-user-fw.service` があるが、
**`cf4` が空でも DROP を入れてしまう**弱点と、`update-cf-ipset.service` との
順序指定が無い問題、`-i ens3` 指定が無い問題があるため、そのままは使わない。

```bash
sudo tee /etc/systemd/system/docker-user-fw.service <<'EOF'
[Unit]
Description=Apply DOCKER-USER Cloudflare allowlist
After=docker.service network-online.target update-cf-ipset.service
Wants=network-online.target
Requires=update-cf-ipset.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/apply-docker-user-fw.sh

[Install]
WantedBy=multi-user.target
EOF
```

適用スクリプト本体。**`cf4` が空なら何もせず異常終了**させ、全遮断を防ぐ。

```bash
sudo tee /usr/local/sbin/apply-docker-user-fw.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

NIC=ens3
NAT_GW=3.113.105.121

# cf4 が空のまま DROP を入れると Cloudflare 経由も落ちるため中断する
cnt="$(ipset list cf4 2>/dev/null | awk '/^Number of entries:/ {print $4+0; exit}')"
if [[ "${cnt:-0}" -lt 10 ]]; then
  echo "cf4 has too few entries ($cnt); refusing to apply DROP rules" >&2
  exit 1
fi

add_rule() {  # 冪等に挿入する
  iptables -C "$@" 2>/dev/null || iptables -I "$@"
}

# 1: Cloudflare からの 80/443 を許可
add_rule DOCKER-USER 1 -i "$NIC" -p tcp -m set --match-set cf4 src -m multiport --dports 80,443 -j RETURN
# 2: NAT Gateway からの 80/443 を許可（DNSキャッシュでCF経由にならない経路の救済）
add_rule DOCKER-USER 2 -i "$NIC" -p tcp -s "$NAT_GW" -m multiport --dports 80,443 -j RETURN
# 3: それ以外の 80/443 は破棄
add_rule DOCKER-USER 3 -i "$NIC" -p tcp -m multiport --dports 80,443 -j DROP

echo "[OK] DOCKER-USER rules applied (cf4=$cnt)"
EOF

sudo chmod +x /usr/local/sbin/apply-docker-user-fw.sh
sudo systemctl daemon-reload
sudo systemctl enable --now docker-user-fw.service
```

> **手順 1 で確認した実際のルールに合わせること。**
> VPN 用の許可ルールが存在していた場合は、このスクリプトにも必ず追加する。
> 漏らすと再起動後に VPN から Dify へ到達できなくなる。

### 確認

```bash
ssh -t onb-dify 'sudo iptables -L DOCKER-USER -n -v --line-numbers'
ssh -t onb-dify 'systemctl status docker-user-fw.service --no-pager'
```

---

## 手順 4: 起動時 ipset 復元の復旧確認（優先度: 高）

手順 2 でスクリプトが直れば、失敗していた `update-cf-ipset.service` も通るようになる。

```bash
ssh -t onb-dify 'sudo systemctl restart update-cf-ipset.service && systemctl status update-cf-ipset.service --no-pager'
```

`Active: active (exited)` かつ `status=0` になることを確認する。

### 再起動テストの扱い

**本番稼働中のため、再起動検証は計画的に行う。**
実施する場合は Dify 利用者への事前アナウンスの上、再起動後に次を確認する。

```bash
ssh onb-dify 'systemctl is-active update-cf-ipset.service docker-user-fw.service'
ssh -t onb-dify 'sudo ipset list cf4 | grep "Number of entries"'
ssh -t onb-dify 'sudo iptables -L DOCKER-USER -n -v --line-numbers'
# 外部から直叩きが落ちること
nc -z -G 5 -w 5 -v 162.43.85.203 443   # → タイムアウトすれば正常
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
