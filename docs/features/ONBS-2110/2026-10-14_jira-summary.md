# Dify オリジンの IP 直叩き防御の点検と是正

詳細ドキュメント:
- 調査結果: [2026-10-14_cloudflare-origin-protection-audit.md](./2026-10-14_cloudflare-origin-protection-audit.md)
- 是正手順: [2026-10-14_remediation-runbook.md](./2026-10-14_remediation-runbook.md)

---

## 概要

Dify（`onb-dify` / `162.43.85.203`）に対して、**Cloudflare を経由しない IP 直叩きの
アクセスがブロックされているか**を点検した。

結論として、**現時点ではブロックされている**。
外部からの実測に加え、**iptables の DROP ルールが 246,000 パケットを破棄済み**であることを
root 権限で確認しており、推測ではなく実績として確定している。
ただし、その防御は **iptables のメモリ上のルールに依存しており永続化されていない**ため、
**次回のサーバー再起動で消える**。あわせて **Cloudflare IP の自動更新が
2026-01-31 以降ずっと失敗し続けている**ことも判明したため、これに対応する。

防御の実装方式は Notion の手順書
「[Ubuntu + iptables + ipset で Cloudflare 経由のみ HTTP/HTTPS を許可する手順](https://app.notion.com/p/Ubuntu-iptables-ipset-Cloudflare-HTTP-HTTPS-2711e89fd74b80cbb3d5c63162b1d055)」
に基づく。

---

## 現状の確認結果

社内の作業端末（Cloudflare 以外の IP）からの実測。

| 宛先 | 結果 |
| --- | --- |
| `http://162.43.85.203/` | **タイムアウト（DROP されている）** |
| `https://162.43.85.203/` | **タイムアウト（DROP されている）** |
| `22/tcp`（SSH） | 接続成功（手順書どおり全許可） |

サーバー内部からは `http://127.0.0.1/` が 307 を返しており Dify は正常稼働。
作業端末から外部の 80/443 へは到達できるため、端末側の回線制限でもない。
**サービスは生きているが外部からの直叩きだけが落ちている**状態。

IPv6 はグローバルアドレスが未割り当てで経路自体が無く、迂回は成立しない。

### 実ルールとパケットカウンタ（root 権限で確定）

```
Chain DOCKER-USER (1 references)
num   pkts bytes target  prot opt in    out  source     destination
1      51M 5271M RETURN  tcp  --  ens3  *    0.0.0.0/0  0.0.0.0/0  match-set cf4 src multiport dports 80,443
2     246K   14M DROP    tcp  --  ens3  *    0.0.0.0/0  0.0.0.0/0  multiport dports 80,443
```

- **DROP ルールが 246K パケット（14MB）を破棄済み** = 直叩きを実際に落としている動かぬ証拠
- RETURN ルールは 51M パケット（5.2GB）を通過 = 正規の Cloudflare 経由は正常
- 稼働 36 週間で 246K パケット（約 40 パケット/時）。常時スキャンの水準で、特定の攻撃の兆候ではない

`ipset cf4` は **15 件で Cloudflare 公式リストと完全一致**しており、**現時点では最新**。

### アクセス制御は二段構成（設計どおり）

```
FE ──→ BE（AI-Server / AI-API）──[IP許可]──→ Cloudflare ──[Cloudflareの IP許可]──→ Dify
                                    弊社VPN ──[IP許可]──→ ↑
```

| 層 | 役割 |
| --- | --- |
| **オリジン（iptables + ipset）** | 「Cloudflare 全体」を許可する粗い網。直叩きを落とす |
| **Cloudflare（IP アクセスルール）** | BE・VPN の送信元 IP だけに絞る細かい網 |

`DOCKER-USER` に NAT Gateway・VPN の許可ルールが無いのは**設計どおり**で、欠落ではない
（正規の通信はすべて Cloudflare を通るため）。手順書に残る `3.113.105.121` の許可はこの構成では不要。

**ただしこの構成は「オリジンに届いた＝Cloudflare 通過済み」を前提にしている。**
そのため #5 の迂回は、単なる到達ではなく**アクセス制御そのものの無効化**を意味する。

---

## 問題点

| # | 問題 | 内容 | 深刻度 |
| --- | --- | --- | --- |
| 1 | **再起動で防御が消える** | `DOCKER-USER` のルールが永続化されていない。`docker-user-fw.service` が存在せず `netfilter-persistent` も inactive。稼働 36 週間、再起動していないから残っているだけ | 高 |
| 2 | **Cloudflare IP の自動更新が失敗し続けている** | 更新スクリプト 109 行目の正規表現がコピペ時のエスケープ崩れ（`\\\\.`）で全 CIDR をスキップ。`cf4` は手動投入時のまま固定。**内容は現時点では公式リストと一致しているが**、CF がレンジを変更した時点で**正規アクセスが遮断されうる時限式の問題** | 高 |
| 3 | **失敗が通知されない** | `slack_error()` 内の `curl` も同じエスケープ崩れで動作せず、`Could not resolve host: \\` を出すだけ。**誰も気づけない** | 高 |
| 4 | **起動時の ipset 復元が失敗したまま** | `update-cf-ipset.service` が 2026-01-31 に exit code 6 で失敗して以降 failed。原因は #2 と同一 | 高 |
| 5 | ~~**Cloudflare 共用 IP による迂回で、Cloudflare 側の IP 制限ごと突破される**~~ **【2026-10-14 対応済み】** | 許可条件が「送信元が Cloudflare の IP」だけのため、攻撃者が自分の Cloudflare アカウントでオリジン IP を向いたゾーンを作れば許可される。**BE・VPN の絞り込みは Cloudflare 側の IP アクセスルールで行っているため、迂回されるとその制限ごと無効化され Dify に素通しで到達する** | **高** |
| 6 | その他の露出 | `8125/udp`（collectd statsd）が全インターフェースで LISTEN。`5003/tcp` が用途不明。SSH 全公開かつ `fail2ban` が inactive | 低 |
| 7 | IPv6 側のルールが未投入 | `cf6` は 7 件あるが `References: 0` で ip6tables ルールから参照されていない。グローバル IPv6 が無いため実害なし | 低 |

**#1 と #2 は同時に顕在化すると危険**。現状のまま再起動すると、
ルールが消えて無防備になる。逆にルールだけ永続化して ipset が空のままだと、
Cloudflare 経由を含む全アクセスが遮断されて Dify が完全停止する。

---

## dev 環境との比較（本番だけが壊れている）

同じ手順書が `onb-dify-dev`（`210.131.217.130`）にも適用されており、
**dev 側は正常に機能している。壊れているのは本番だけ。**

| 確認項目 | `onb-dify`（本番） | `onb-dify-dev`（dev） |
| --- | --- | --- |
| 更新スクリプトの正規表現 | 壊れている | 正しい |
| 更新ログの最終結果 | `Could not resolve host: \\` | `[OK] updated: v4=15, v6=7` |
| `docker-user-fw.service` | **存在しない** | 存在し `enabled` |
| `update-cf-ipset.service` | **failed**（2026-01-31 以降） | 正常 |

Notion の手順書からコピペした際、本番側だけエスケープが崩れたまま投入されたと考えられる。
**動作実績のある実物が dev にあるため、是正は「dev の構成を本番へ移植する」のが最短。**

ただし dev の `docker-user-fw.service` にも
「`cf4` が空でも DROP を入れてしまう」弱点があるため、そのままは移植しない（対応方針 3 を参照）。

---

## 対応方針

対象: `onb-dify` サーバーの設定のみ（**アプリケーションのリポジトリ変更は無し**）

実施順序が重要。**スクリプト修正を永続化より先に行う。**

1. ~~**現状の確定**~~ — **2026-10-14 実施済み**（結果は後述）。
   なお変更前バックアップ（`iptables-save` / `ipset save`）は未取得のため、
   手順 2 に着手する前に取得する
2. **更新スクリプトの修正**（#2 #3 #4）— 109 行目の正規表現と `slack_error()` の
   エスケープを修正する。**dev に正しい版があるため、そのまま持ってくるのが確実**。
   手動実行で `cf4` が正しく更新されることを確認する。
   `ipset swap` はアトミックなので通信断は発生しない
3. **ルールの永続化**（#1）— `docker-user-fw.service` を新設。
   dev の実物をベースにしつつ、**`cf4` が 10 件未満ならルールを適用せず異常終了する
   安全装置**と `After=update-cf-ipset.service` の順序指定、`-i ens3` の指定を追加する。
   ipset が空のまま全遮断する事故を防ぐため
4. **起動時復元の確認**（#4）— `update-cf-ipset.service` が成功することを確認。
   再起動検証は本番稼働中のため計画的に実施する
5. ~~**迂回対策**（#5）~~ — **2026-10-14 完了。秘密ヘッダ方式で実施済み**
   （[実施手順と結果](./2026-10-14_origin-auth-header-runbook.md)）。以下は選定時の比較。
   **標準の「Global」AOP では塞げない**点に注意（証明書が全 Cloudflare アカウント共有のため）

   | 方式 | 迂回を塞げるか | 変更規模 |
   | --- | --- | --- |
   | Authenticated Origin Pulls（Global） | **塞げない** | 小 |
   | Authenticated Origin Pulls（Zone-level / 自前証明書） | **塞げる** | 中 |
   | 秘密ヘッダの検証 | 塞げる（ヘッダ漏洩には弱い） | 中 |
   | Cloudflare Tunnel | 塞げる（攻撃面が消滅） | 大 |

   いずれも Dify 前段 nginx がコンテナ内にあるため、ボリュームマウントか compose の構成変更が必要
6. **その他**（#6）— statsd のバインド先変更、`5003/tcp` の用途特定、`fail2ban` の検討
7. **dev 側の改善** — dev の `docker-user-fw.service` にも
   「`cf4` が空でも DROP を入れる」弱点が残るため、本番の対応後に同じ安全装置を入れる

---

## 影響範囲

| 対象 | 変更内容 |
| --- | --- |
| `onb-dify`（`162.43.85.203`） | `/usr/local/sbin/update-cf-ipset.sh` の修正、`docker-user-fw.service` と `apply-docker-user-fw.sh` の新設 |
| `onb-dify-dev`（`210.131.217.130`） | `docker-user-fw.service` に安全装置を追加（本番の対応後） |

- **リポジトリの変更は無し。** サーバー設定のみ
- 手順 2〜4 はいずれも 80/443 の疎通に影響する。Dify が落ちると FE のチャット・ヒントが停止する
- SSH(22) はルールの対象外のため、作業中に締め出される心配はない
- **現在の 2 本構成（CF 許可 → RETURN / その他 DROP）をそのまま永続化すればよい。**
  NAT Gateway・VPN の許可ルールは設計上不要

---

## root 確認の結果（2026-10-14 実施済み）

| 確認項目 | 結果 |
| --- | --- |
| `DOCKER-USER` の実ルール | 2 本（CF 許可 → RETURN / その他 DROP）。`-i ens3` 指定あり |
| DROP ルールの `pkts` | **246K パケット / 14MB。直叩きを実際に落としている** |
| `ipset cf4` | **15 件。公式リストと完全一致（現時点では最新）** |
| `ipset cf6` | 7 件だが `References: 0`。IPv6 ルールは未投入（実害なし） |
| NAT Gateway / VPN の許可ルール | いずれも存在しない（**設計どおり**。Cloudflare 側で制限） |

### 残る未確認事項

- **Xserver VPS 管理コンソールのパケットフィルター設定**（未使用ポートまで無応答だったため、
  VPS 側でも遮断されていると推測しているが未裏取り）
- **`5003/tcp` の用途**
