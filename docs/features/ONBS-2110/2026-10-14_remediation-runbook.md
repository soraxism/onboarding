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
ただし VPN / NAT Gateway を IP 直指定で使う運用なら、許可ルールを足した上で永続化すること
（足さずに永続化すると、現在の遮断状態が恒久化する）。

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

## 手順 5: Cloudflare 共用 IP の迂回対策（優先度: 中）

IP 許可リストだけでは、攻撃者が自分の Cloudflare アカウント経由で到達できる。
**Authenticated Origin Pulls（mTLS）** の導入を推奨する。

1. Cloudflare ダッシュボード → SSL/TLS → Origin Server → Authenticated Origin Pulls を有効化
2. Cloudflare の Origin Pull CA 証明書をオリジンに配置
3. Dify 前段の nginx コンテナで `ssl_client_certificate` と `ssl_verify_client on` を設定

nginx の設定が Docker イメージ内にあるため、**ボリュームマウントか compose の構成変更が必要**。
Dify の構成に手を入れることになるので、別途調査・検証の上で実施する。

簡易な代替案として、Cloudflare 側で秘密ヘッダを付与し、オリジンで必須化する方法もある。
mTLS より弱いが、構成変更は小さい。

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
