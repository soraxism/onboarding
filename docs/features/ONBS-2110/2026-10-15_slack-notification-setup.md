# Slack 通知の構成（ONBS-2110）

**ステータス: 2026-10-14 実施完了（本番・dev 両方）**

作成日: 2026-10-15
対象: `onb-dify`（本番）/ `onb-dify-dev`（dev）

---

## 背景

今回の一連の問題は、どれも **「静かに失敗し続けていた」** ことが長期化の原因だった。

| 事象 | 気づかれなかった期間 |
| --- | --- |
| Cloudflare IP の自動更新が失敗 | 約 9 か月（2026-01-31 〜） |
| 本番のオリジン証明書が失効 | 283 日 |
| dev のオリジン証明書が失効 | 254 日 |

Slack 通知は仕込まれていたが、**通知関数自体が壊れていて飛んでいなかった**。
証明書の更新に至っては**通知の仕組み自体が無かった**。

**検知手段を整備し、実際に飛ぶことを確認するまでが対応。**

---

## 構成

```
/etc/slack-notify.conf          ← Webhook URL（600 root）
/usr/local/sbin/slack-notify.sh ← 共通の送信スクリプト（700 root）
        ↑                ↑
        │                └── dify-cert-renew.sh（証明書）
        └─────────────────── update-cf-ipset.sh（Cloudflare IP）
```

**Webhook URL は `/etc/slack-notify.conf` の 1 箇所のみ。**
`update-cf-ipset.sh` に直書きされていたものは削除した。

### `slack-notify.sh`

```bash
#!/usr/bin/env bash
# Slack へ通知を送る共通スクリプト
# usage: slack-notify.sh "タイトル" "本文"
set -uo pipefail

CONF=/etc/slack-notify.conf
[ -r "$CONF" ] || { echo "slack-notify: $CONF が読めません" >&2; exit 0; }
. "$CONF"

[ -n "${SLACK_WEBHOOK_URL:-}" ] || { echo "slack-notify: Webhook 未設定" >&2; exit 0; }

title="${1:-notification}"
msg="${2:-}"
host="$(hostname -f 2>/dev/null || hostname)"
ts="$(date '+%Y-%m-%d %H:%M:%S %z')"

text="$(printf '*%s*\nHost: %s\nTime: %s\n%s' "$title" "$host" "$ts" "$msg")"

if command -v jq >/dev/null 2>&1; then
  payload="$(jq -n --arg t "$text" '{text: $t}')"
else
  payload="$(printf '{"text":"%s"}' "$title")"
fi

curl -fsS --max-time 5 -X POST -H 'Content-type: application/json' \
  --data "$payload" "$SLACK_WEBHOOK_URL" > /dev/null
```

**`jq` で JSON を組み立てる**ため、本文に引用符や改行が含まれても壊れない。
本番・dev とも内容は完全に同一。

---

## 通知が飛ぶ条件

### Cloudflare IP の更新（`update-cf-ipset.sh`）

| タイトル | 条件 |
| --- | --- |
| `[CF ipset] Cloudflare IP一覧の取得に失敗` | `https://www.cloudflare.com/ips-v4` の取得失敗（3 回リトライ後） |
| `[CF ipset] Cloudflare IP一覧が空` | 取得できたが中身が空 |
| `[CF ipset] 取得IPレンジが少なすぎるため更新を中止` | 取り込めたレンジが `MIN_IPV4_COUNT`（10）未満 |
| `[CF ipset] 異常終了 (exit N)` | 上記以外の異常終了（`trap` による受け皿） |

`NOTIFIED` フラグにより、**個別通知が飛んだ場合は trap 側の通知を抑止する**（重複防止）。

### 証明書の更新（`dify-cert-renew.sh`）

| タイトル | 条件 |
| --- | --- |
| `[Dify cert] 証明書の更新に失敗しました` | certbot が異常終了。**直近 30 行のログを本文に含める** |
| `[Dify cert] nginx の reload に失敗しました` | reload が異常終了 |
| `[Dify cert] 証明書の期限が迫っています（残り N 日）` | **残り `WARN_DAYS`（20）日未満。更新処理が成功していても通知** |
| `[Dify cert] 証明書ファイルが見つかりません` | 証明書ファイルが存在しない |

**3 つ目が重要。** `certbot renew` は期限が近くないと何もせず正常終了するため、
**「ずっと成功扱いなのに実は更新されていない」状態は終了コードでは検知できない**。
残り日数を直接見ることでそこを塞いでいる。今回の失効はまさにこのパターンだった。

**成功時は通知しない。** ノイズになるため。

---

## 改善前後の比較

### 改善前

```
[CF ipset] ERROR: cf4_tmp too few
count=15
```

```
[CF ipset] ERROR: script aborted (exit 1)
rc=1
last-step=sanity check
[ 4949.781716] br-f653b1393583: port 12(veth57aa323) entered disabled state
[ 4949.785199] veth3098186: renamed from eth0
...
```

| 問題 | 内容 |
| --- | --- |
| **ホスト名が無い** | **どのサーバーか分からない**。本番か dev かも判別できなかった |
| dmesg が混入 | カーネルのノイズで、障害と無関係 |
| 2 通に分かれる | 個別通知と trap の両方が飛んでいた |

ホスト名が消えていたのは、元の `slack_error()` 内の **jq に構文エラーがあった**ため。

```bash
text:("*Detail:*\n```" + $m + "```"}}] }'
#                                   ↑ 閉じ括弧が足りない
```

jq が失敗し `2>/dev/null || printf ...` のフォールバックに落ちていた。
フォールバック側は**ホスト名も時刻も含まない**。

### 改善後

```
*[CF ipset] 取得IPレンジが少なすぎるため更新を中止*
Host: x162-43-85-203
Time: 2026-10-14 23:46:27 +0900
取得=15件 / 最低=999件
```

```
*[Dify cert] 証明書の期限が迫っています（残り 89 日）*
Host: x162-43-85-203
Time: 2026-10-14 23:48:52 +0900
dify-stands.com / 更新処理自体は成功しています
```

---

## 動作確認（2026-10-14 実施・全経路合格）

**通知は「仕込んだ」だけでは意味がない。実際に飛ぶことを確認するまでが設置作業。**

| 経路 | 確認方法 | 結果 |
| --- | --- | --- |
| 疎通 | `slack-notify.sh` を直接実行 | 合格 |
| IP 更新の失敗 | `MIN_IPV4_COUNT=999` にして意図的に安全装置を発動 | 合格 |
| 証明書の期限警告 | `WARN_DAYS=999` にして発動 | 合格 |
| 証明書ファイル不在 | `CERT` のパスを `.notexist` に変更 | 合格 |

いずれも**証明書や ipset には一切触れない**方法で確認できる。
`MIN_IPV4_COUNT` のテストは `ipset swap` の手前で止まるため、本番の `cf4` は変更されない。

### テスト手順

```bash
# IP 更新の失敗経路
sudo sed -i 's/^MIN_IPV4_COUNT=10/MIN_IPV4_COUNT=999/' /usr/local/sbin/update-cf-ipset.sh
sudo /usr/local/sbin/update-cf-ipset.sh; echo "終了コード: $?"
sudo sed -i 's/^MIN_IPV4_COUNT=999/MIN_IPV4_COUNT=10/' /usr/local/sbin/update-cf-ipset.sh
grep '^MIN_IPV4_COUNT' /usr/local/sbin/update-cf-ipset.sh    # ← 復元を必ず確認

# 証明書の期限警告
sudo sed -i 's/^WARN_DAYS=20/WARN_DAYS=999/' /usr/local/sbin/dify-cert-renew.sh
sudo /usr/local/sbin/dify-cert-renew.sh
sudo sed -i 's/^WARN_DAYS=999/WARN_DAYS=20/' /usr/local/sbin/dify-cert-renew.sh
grep '^WARN_DAYS' /usr/local/sbin/dify-cert-renew.sh         # ← 復元を必ず確認
```

> **閾値の復元を必ず確認すること。** 戻し忘れると毎日通知が飛び続け、
> **本物の異常が埋もれる**。今回の問題の再現になってしまう。

---

## cron の実行時刻

4 本が重ならないよう 1 時間ずつずらしている。

| サーバー | 時刻 | ジョブ |
| --- | --- | --- |
| 本番 | 03:30 | `dify-cert-renew.sh` |
| 本番 | 04:00 | `update-cf-ipset.sh` |
| dev | 04:00 | `dify-cert-renew.sh` |
| dev | 05:00 | `update-cf-ipset.sh` |

通知先チャンネルは本番・dev で共通。**ホスト名で区別する。**

| ホスト名 | サーバー |
| --- | --- |
| `x162-43-85-203` | 本番（`onb-dify`） |
| `x210-131-217-130` | dev（`onb-dify-dev`） |

---

## 運用上の注意

- **Webhook URL は `/etc/slack-notify.conf` の 1 箇所のみ。** 再生成した場合はここだけ更新する
- **本番と dev で Webhook URL は異なる**（どちらも同じチャンネルに届く）
- `slack-notify.sh` は `700` / `slack-notify.conf` は `600`。**どちらも root 専用**
- **スクリプトを編集したら、通知経路も再確認する。** 今回の失効は
  「通知が仕込まれているのに壊れていた」ことが原因だった

---

## 残課題

| 項目 | 内容 |
| --- | --- |
| `apply-docker-user-fw.sh` の通知 | 現状は通知なし。起動時のルール適用が失敗しても気づけない |
| Webhook の再生成 | 作業中のスクリーンショットに URL が写り込んだため、気になる場合は Slack 側で再生成する |
| 旧バックアップの削除 | `/usr/local/sbin/*.bak-*` が本番・dev に残っている。数日様子を見てから削除 |
