# ONBS-1938 途中離脱のCSV記録対応 テスト項目書（検証環境）

対象ブランチ: 各リポジトリ `feature/ONBS-1938`
詳細仕様: `2026-08-10_ai-abandonment-csv-logging-spec-changes.md`


## 判定凡例

| 記号 | 意味 |
|---|---|
| ✅ | PASS |
| ⏭ | 未実施（リリース判断を妨げない） |
| ▲ | 検証環境では確認不可（本番リリース前に別途実施） |

**検証実施日: 2026-08-13（OpenAI経路）／ 2026-08-14（Dify経路）**

結果: 全54項目のうち **✅ 47 / ⏭ 3 / ▲ 4**（**NG 0件**）

---

## 0. 検証環境のリソース

| 種別 | 値 |
|---|---|
| WebSocket API（AI-Server） | `ehcx3t1dvd` / `wss://dev-ai.onboarding-app.io` |
| Lambda（ヒント） | `aiServerAiHint-dev` |
| Lambda（評価） | `aiServerAiChatEvaluation-dev` |
| Lambda（撤去対象） | `aiServerAiChatOpenai-dev` / `aiServerAiChatDify-dev` |
| ロググループ（ヒント） | `/aws/lambda/aiServerAiHint-dev` |
| ロググループ（チャット） | `/ecs/dev-onboarding-ai-api` |
| チャット接続先 | `wss://dev-v2ai.onboarding-app.io`（AI-API / ECS） |
| Athena DB | `dev_onboarding_ai_logs_db` / `dev_onboarding_ai_chat_logs_db` |

### デプロイ前の状態（記録用）

`$connect` / `$disconnect` / `$default` は **`aiServerAiChatDify-dev`** に統合されています。
フェーズ0のデプロイでこれが `aiServerAiHint-dev` に切り替わります。

```bash
API_ID=ehcx3t1dvd
aws apigatewayv2 get-routes --profile onboarding --api-id $API_ID \
  --query 'Items[].{Route:RouteKey,Target:Target}' --output text | while read route target; do
  uri=$(aws apigatewayv2 get-integration --profile onboarding --api-id $API_ID \
    --integration-id "${target#integrations/}" --query 'IntegrationUri' --output text)
  printf "%-14s -> %s\n" "$route" "$(basename ${uri%%/invocations})"
done
```

---

## 1. 事前準備

| # | 作業 | 完了 |
|---|---|---|
| P-1 | フェーズ1（onboarding-batch）をデプロイ | ✅ |
| P-2 | dev の両テーブルに `ALTER TABLE` を実行（下記SQL） | ✅ |
| P-3 | フェーズ0（AI-Server 旧チャット撤去）をデプロイ | ✅ |
| P-4 | フェーズ2（AI-API）をデプロイ | ✅ |
| P-5 | フェーズ3（onboarding-manage-api）をデプロイ | ✅ |

> **P-1 と P-2 は P-4 より必ず先に実施してください。** 逆順だとバッチが `abandoned` 列を
> 落とし、その期間のデータは復旧できません。

```sql
ALTER TABLE dev_onboarding_ai_chat_logs_db.ai_chat_logs ADD COLUMNS (abandoned int);
ALTER TABLE dev_onboarding_ai_logs_db.ai_logs ADD COLUMNS (abandoned int);
```

### 途中離脱の再現手順（全テストで共通）

1. 回答が長くなる質問を投げる（例:「機能を1つずつ詳しく5つ説明してください」）
2. 回答がストリーミング表示され始めたら、**3〜5秒待つ**（数チャンク届いた状態にする）
3. **ブラウザのタブを閉じる**、または別ページへ遷移する

> ブラウザの「更新」ではなく**タブを閉じる**か**画面遷移**してください。
> 実測では `1001 going away`（タブを閉じる・画面遷移）と `1005`（異常終了）が該当します。

---

## 2. フェーズ0: 旧チャット撤去（AI-Server）

**このフェーズが全工程で最大のリスクです。** AIヒントの接続が確立できなくなる可能性があります。

| # | 確認内容 | 手順 | 期待結果 | 判定 |
|---|---|---|---|---|
| T0-1 | 予約ルートの統合先が切り替わっている | §0 のコマンドを実行 | `$connect` / `$disconnect` / `$default` がすべて **`aiServerAiHint-dev`** になっている | ✅ |
| T0-2 | AIヒントの WebSocket 接続が確立できる | ヒントを開く | ブラウザの開発者ツール Network で `wss://dev-ai.onboarding-app.io` が **101 Switching Protocols** になる | ✅ |
| T0-3 | AIヒントが正常に回答を返す | ヒントで質問する | 回答がストリーミング表示され、最後まで完了する | ✅ |
| T0-4 | 撤去対象のLambdaが削除されている | 下記コマンド | `aiServerAiChatOpenai-dev` / `aiServerAiChatDify-dev` が**存在しない** | ✅ |
| T0-5 | AIチャット評価が正常動作する（共有レイヤー変更の回帰） | チャットの回答に「良い/悪い」評価を付ける | 評価が記録され、エラーが出ない | ✅ |
| T0-6 | 現行AIチャットが影響を受けていない（別エンドポイント） | AIチャットで質問する | 正常に回答が返る | ✅ |

```bash
aws lambda list-functions --profile onboarding \
  --query 'Functions[?contains(FunctionName,`aiServerAiChat`)].FunctionName' --output text
```

> **T0-1 が NG の場合は即座に切り戻してください。** ヒントが使用不能になります。

---

## 3. フェーズ1: バッチとAthena

| # | 確認内容 | 手順 | 期待結果 | 判定 |
|---|---|---|---|---|
| T1-1 | `abandoned` 列が参照できる | 下記クエリ① | エラーなく実行でき、`abandoned` 列が返る | ✅ |
| T1-2 | アプリ未デプロイ時点では全行NULL | 下記クエリ① | `non_null` が **0**、`nulls` が総件数と一致 | ▲ |
| T1-3 | 文字列 `"nan"` になっていない（ヒント側の正規化） | 下記クエリ② | 0件（`"nan"` が存在しない） | ✅ |
| T1-4 | バッチが正常終了する | §12 のコマンドで手動実行後、`exitCode` を確認 | `exitCode = 0` で完了し、Parquetが出力される | ✅ |

**クエリ①（両テーブルで実施）**

```sql
SELECT count(*) AS total,
       count(abandoned) AS non_null,
       count(*) - count(abandoned) AS nulls
FROM dev_onboarding_ai_logs_db.ai_logs
WHERE year='2026' AND month='08';
```

**クエリ②（`"nan"` 混入チェック）**

```sql
SELECT count(*) FROM dev_onboarding_ai_logs_db.ai_logs
WHERE year='2026' AND month='08' AND CAST(abandoned AS varchar) = 'nan';
```

---

## 4. フェーズ2: アプリ（正常系 = 回帰確認）

離脱していない通常利用が壊れていないことを先に確認します。

| # | 対象 | 確認内容 | 期待結果 | 判定 |
|---|---|---|---|---|
| T2-1 | ヒント | 回答が最後まで表示される | 従来どおり完了し、`end_of_message` を受信する | ✅ |
| T2-2 | ヒント | CSVログに `abandoned = 0` が入る | Athenaで当該レコードの `abandoned` が **0** | ✅ |
| T2-3 | チャット(OpenAI) | 回答が最後まで表示される | 従来どおり完了する | ✅ |
| T2-4 | チャット(OpenAI) | `abandoned = 0` が入る | Athenaで **0** | ✅ |
| T2-5 | チャット(Dify) | 回答が最後まで表示される | 従来どおり完了する | ✅ |
| T2-6 | チャット(Dify) | `abandoned = 0` が入る | Athenaで **0** | ✅ |
| T2-7 | 両方 | Slack通知が飛ばない | 離脱通知・エラー通知ともに**届かない** | ✅ |
| T2-8 | 両方 | トークン数が記録されている | `prompt_tokens` / `completion_tokens` / `total_tokens` が0でない | ✅ |

---

## 5. フェーズ2: アプリ（離脱系 = 本改修の主目的）

再現手順は §1 を参照。**離脱を発生させた日時を必ず記録**してください（バッチの手動実行時に指定します）。

Athenaへの反映は定時実行を待たず、**§12 のコマンドでバッチを手動実行**すれば数分で確認できます。
チャットは離脱した時間帯を `T` 付きで指定するのが最速です（例: `./ai-chat-logs.py 2026-08-13T18`）。

### AIヒント

| # | 確認内容 | 期待結果 | 判定 |
|---|---|---|---|
| T3-1 | **CSVログに記録される**（最重要） | Athenaに該当レコードが**存在する**（従来は保存されなかった） | ✅ |
| T3-2 | `abandoned = 1` が入る | Athenaで **1** | ✅ |
| T3-3 | **`ai_response` が完全** | 回答が途中で切れておらず、最後まで格納されている | ✅ |
| T3-4 | トークン数が記録されている | `total_tokens` が0でない | ✅ |
| T3-5 | **Lambda Errors が立たない**（最重要） | 離脱の前後で `Errors` メトリクスが増えていない | ✅ |
| T3-6 | WARNINGログが**1件だけ**出る | `Connection ... has been closed by the client.` が1リクエストにつき1件 | ✅ |
| T3-7 | エラーログが出ない | `Failed to send request to` が出力**されない** | ✅ |
| T3-8 | Slack通知が届く | 「AIヒントでユーザーの途中離脱を検知しました。」 | ✅ |
| T3-9 | **@channelメンションが付かない** | 通知本文に `@channel` が**含まれない** | ✅ |
| T3-10 | 通知にプロダクトID・ヒントIDが含まれる | 各項目が Unknown でなく値が入っている | ✅ |

**T3-5 の確認**

```bash
aws cloudwatch get-metric-statistics --profile onboarding \
  --namespace AWS/Lambda --metric-name Errors \
  --dimensions Name=FunctionName,Value=aiServerAiHint-dev \
  --start-time <離脱の10分前> --end-time <離脱の10分後> \
  --period 300 --statistics Sum --query 'Datapoints[].Sum' --output text
```

**T3-6 / T3-7 の確認**（CloudWatch Logs Insights・`/aws/lambda/aiServerAiHint-dev`）

```
fields @timestamp, @message
| filter @message like /has been closed by the client|Failed to send request to/
| sort @timestamp desc
| limit 20
```

### AIチャット

| # | 確認内容 | 期待結果 | 判定 |
|---|---|---|---|
| T3-11 | CSVログに記録される | Athenaに該当レコードが存在する（従来も記録されていた） | ✅ |
| T3-12 | `abandoned = 1` が入る | Athenaで **1** | ✅ |
| T3-13 | `ai_response` が完全 | 回答が途中で切れていない | ✅ |
| T3-14 | **送信失敗ログが1件だけ**（従来は平均55.8件） | `WebSocket message send failed (client disconnected)` が1件 | ✅ |
| T3-15 | 旧ログ文言が出ない | `Cannot call "send" once a close message has been sent.` が**出力されない** | ✅ |
| T3-16 | WARNINGレベルで出力される | ログの `level` が **WARNING**（ERRORでない） | ✅ |
| T3-17 | Slack通知が届く | 「AIチャットでユーザーの途中離脱を検知しました。」 | ✅ |
| T3-18 | **@channelメンションが付かない** | 通知本文に `@channel` が含まれない | ✅ |
| T3-19 | Dify経路でも同様に動作する | Dify設定のチャットで T3-11〜18 が成立する | ✅ |

**T3-14〜16 の確認**（`/ecs/dev-onboarding-ai-api`）

```
fields @timestamp, @message
| filter @message like /client disconnected|Cannot call/
| sort @timestamp desc
| limit 20
```

---

## 6. ログレベル変更の影響（AI-API のみ）

`app_logging_prod.yaml` を ERROR → WARNING に引き下げたため、想定外のログ増加がないか確認します。
※dev は元から INFO のため、**この確認は本番リリース前に prod 相当の設定で行う**必要があります。

| # | 確認内容 | 期待結果 | 判定 |
|---|---|---|---|
| T4-1 | WARNINGログが出力される | 離脱ログが実際に出ている（T3-14で確認済みなら省略可） | ▲ |
| T4-2 | サードパーティのWARNINGが大量流入していない | ログ量が従来比で極端に増えていない（`root` を ERROR に保っているため） | ▲ |
| T4-3 | 増えたWARNINGの内容が妥当 | `http_client.py` のリトライ警告など、想定内のものだけ | ▲ |

---

## 7. フェーズ3: CSV出力

### ⚠️ 最初に読む: CSVは1時間単位でキャッシュされます

`mng-v1-report/method_get.py:77-88` は、S3に同名ファイルがあれば **Athenaを再実行せずキャッシュを返します**。

```python
hour = get_end_hour(now, period["end_date"])              # :77
filename = "{}-{}-{}.csv".format(
    report_type["name"],
    period["start_date"].replace("-", "") + "00",
    period["end_date"].replace("-", "") + f"{hour:02}",   # ← 1時間単位のキャッシュキー
)
csv_file_key = get_generated_csv(bucket_name, download_src_path + filename)   # :87
if csv_file_key is None:      # ← 見つかった場合はクエリを実行しない
```

`get_end_hour`（`:473-489`）は終了日が当日の場合 **`(now - 2時間).hour`（JST）** を返します。
つまり**同じ時間台に再ダウンロードすると必ずキャッシュが返り、新しいデータは反映されません**。

> 2026-08-13 の検証で実際に発生した事象。`...2026081316.csv` が **18:42:51** に生成され、
> その21秒後（18:43:12）のチャットが2回目のダウンロードに反映されなかった。
> Athena には該当データが入っていたため、実装ではなくキャッシュが原因だった。

**回避方法（いずれか）**

| 方法 | 手順 | 備考 |
|---|---|---|
| **A. 期間をずらす**（最も手軽） | 開始日を1日変える（例: 08-07→08-06） | ファイル名が変わり再クエリされる |
| **B. キャッシュを削除** | 下記コマンド | 同じ期間で確認したい場合 |
| C. 1時間待つ | 次の時間台になるまで待つ | 確実だが遅い |

```bash
# 検証環境のキャッシュ一覧（132=account_id, 217=product_id は自分の値に置き換える）
aws s3 ls --profile onboarding --recursive \
  "s3://dev-onboarding-tracking-bucket/aggregated-download-src/132/217/"

# 該当ファイルを削除（ai_chat_message_sent_user / ai_hint_message_sent_user）
aws s3 rm --profile onboarding \
  "s3://dev-onboarding-tracking-bucket/aggregated-download-src/132/217/ai_chat_message_sent_user/AIチャット回答履歴-<期間>.csv"
```

**キャッシュを疑う前にAthenaで確認**すると切り分けが早くなります（§9 のクエリ）。
Athenaにデータがあり、CSVに出ない場合はキャッシュです。

| # | 確認内容 | 手順 | 期待結果 | 判定 |
|---|---|---|---|---|
| T5-1 | 列が追加されている | AIヒント回答履歴CSVをダウンロード | 最終列に **「回答の到達状況」** がある | ✅ |
| T5-2 | 列の位置が最終列 | 同上 | 「その他」の**次**（最後） | ✅ |
| T5-3 | 正常完了データの表示 | リリース後の正常レコードを確認 | **「最後まで到達」** | ✅ |
| T5-4 | 離脱データの表示 | リリース後の離脱レコードを確認 | **「途中離脱」** | ✅ |
| T5-5 | **リリース前データの表示** | リリース日より前の期間でダウンロード | **「記録開始前」**（空欄や `nan` ではない） | ✅ |
| T5-6 | 空欄が発生しない | 全行を確認 | 3値のいずれかが必ず入っている | ✅ |
| T5-7 | AIチャットCSVでも同様 | AIチャット回答履歴CSVで T5-1〜6 | 同じ結果 | ✅ |
| T5-8 | 既存列が壊れていない | 既存の列名・値を確認 | 従来と同じ内容 | ✅ |
| T5-9 | CSVダウンロードがエラーにならない | 各期間でダウンロード | Athenaエラーが発生しない | ✅ |

---

## 8. 異常系の回帰確認

| # | 確認内容 | 手順 | 期待結果 | 判定 |
|---|---|---|---|---|
| T6-1 | AI呼び出し失敗時は従来どおりエラー | Difyの APIキーを不正な値にして実行 | エラーがクライアントに返り、Slackにエラー通知が届く | ✅ |
| T6-2 | **エラー通知には@channelが付く** | 同上 | 通知本文に `@channel` が**含まれる**（離脱通知と区別できる） | ✅ |
| T6-3 | 上限超過時は429 | 上限値を1に設定して2回実行 | 2回目でエラー、カウンタが加算されない | ⏭ |
| T6-4 | preview は対象外 | 管理画面プレビューから実行 | カウンタが加算されず、CSVにも出力されない | ⏭ |
| T6-5 | AI利用上限アラートが従来どおり | 上限の90%に到達させる | Slack通知が届く（`ai_utils.py` の変更なし確認） | ⏭ |

---

## 9. Athena 確認用クエリ

**離脱レコードの確認（ヒント）**

```sql
SELECT start_time, hint_id, abandoned,
       length(ai_response) AS response_length,
       total_tokens
FROM dev_onboarding_ai_logs_db.ai_logs
WHERE year='2026' AND month='08'
  AND concat_ws('', year, month, day) = '<離脱させた日 YYYYMMDD>'
ORDER BY start_time DESC
LIMIT 20;
```

**離脱レコードの確認（チャット）**

```sql
SELECT start_time, chat_id, abandoned,
       length(ai_response) AS response_length,
       total_tokens, provider_code
FROM dev_onboarding_ai_chat_logs_db.ai_chat_logs
WHERE year='2026' AND month='08'
  AND concat_ws('', year, month, day) = '<離脱させた日 YYYYMMDD>'
ORDER BY start_time DESC
LIMIT 20;
```

**3値の分布確認（CSV表示と一致するか）**

```sql
SELECT CASE WHEN abandoned = 1 THEN '途中離脱'
            WHEN abandoned = 0 THEN '最後まで到達'
            ELSE '記録開始前' END AS status,
       count(*) AS cnt
FROM dev_onboarding_ai_logs_db.ai_logs
WHERE year='2026'
GROUP BY 1;
```

---

## 10. 合否判定の基準

### 必須（1つでもNGならリリース不可）

- **T0-1 / T0-2 / T0-3** — ヒントの接続と回答（撤去による機能停止がないこと）
- **T3-1 / T3-2** — ヒントの離脱がCSVに記録されること（本改修の主目的）
- **T3-5** — Lambda Errors が立たないこと
- **T5-5** — リリース前データが「記録開始前」と表示されること（誤分析の防止）
- **T5-9** — CSVダウンロードがエラーにならないこと

### 重要（NGなら原因調査のうえ判断）

- T3-3 / T3-13 — `ai_response` の完全性
- T3-6 / T3-14 — ログが1件に収まること
- T3-9 / T3-18 / T6-2 — @channelメンションの有無が正しいこと
- T2-1〜8 — 正常系の回帰

### 参考（記録のみ）

- T4-1〜3 — ログレベル変更の影響（prod相当設定での確認が別途必要）

---

## 11. 検証時の記録欄

| 項目 | 記録 |
|---|---|
| 検証実施日 | **2026-08-13**（OpenAI経路）／ **2026-08-14**（Dify経路・§14） |
| 離脱を発生させた日時（ヒント） | **2026-08-13 17:57:11**（OpenAI）／ **2026-08-14 15:12:10**（Dify） |
| 離脱を発生させた日時（チャット） | **2026-08-13 18:43:12**（OpenAI）／ **2026-08-14 15:11:25**（Dify） |
| バッチ実行日時 | 2026-08-13 18時台〜19時台に手動実行（§12） |
| デプロイしたコミット（AI-Server） | `3b7d5700` |
| デプロイしたコミット（AI-API） | `af04809` |
| デプロイしたコミット（batch） | `61ad636` |
| デプロイしたコミット（manage-api） | `c31cd9c6` |
| NG項目と対応 | **NG 0件**。詳細は §13 |

---

## 12. バッチの手動実行（定時実行を待たない）

定時実行（ヒント: JST 02:00 日次 / チャット・評価: 毎時0分）を待たずに ECS の `run-task` で実行できます。
**再実行は安全です**（Parquetのファイル名が日付固定、パーティション追加は `ADD IF NOT EXISTS` のため重複しません）。

### 12-1. パラメータ一覧（検証環境）

| | AIヒント | AIチャット | AIチャット評価 |
|---|---|---|---|
| クラスタ | `dev-ai-log-batch` | `dev-ai-chat-logs-batch` | `dev-ai-chat-evaluation-logs-batch` |
| タスク定義 | `dev-ai-log-batch:8` | `dev-ai-chat-logs-batch:1` | `dev-ai-chat-evaluation-logs-batch:1` |
| **コンテナ名** | `dev-ai-log-batch` | `dev-ai-chat-logs-batch` | **`dev-ai-chat-evaluation-log-batch`** |
| スクリプト | `./ai_logs.py` | `./ai-chat-logs.py` | `./ai-chat-evaluation-logs.py` |
| サブネット | `subnet-0a08394ab5578ef0f`<br>`subnet-09a6db50a790f9e83`<br>`subnet-032d570e3368e9025` | `subnet-0d29d35c19d066efa`<br>`subnet-007b8f4d270ba95c1`<br>`subnet-03d779e4e75eaf81a` | `subnet-0d29d35c19d066efa`<br>`subnet-007b8f4d270ba95c1`<br>`subnet-03d779e4e75eaf81a` |
| セキュリティグループ | `sg-0d222818fd975c6a9` | `sg-08c24b11f1843f834` | `sg-08c24b11f1843f834` |
| assignPublicIp | `DISABLED` | **`ENABLED`** | `DISABLED` |
| 定時実行 | JST 02:00 日次 | 毎時0分 | 毎時0分 |

> **注意点が2つあります。**
> - **評価バッチのコンテナ名だけ `log`（単数）** です。クラスタ名は `...logs-batch`（複数形）ですが
>   コンテナ名は `dev-ai-chat-evaluation-log-batch` で、間違えると `run-task` が失敗します。
> - **`assignPublicIp` がバッチごとに異なります**（チャットのみ `ENABLED`）。

### 12-2. 引数の指定方法

| バッチ | 引数 | 挙動 |
|---|---|---|
| ヒント | `2026-08-13` | 指定日を処理 |
| | （なし） | 前日を処理 ※定時実行時の挙動 |
| チャット | `2026-08-13T18` | **その時間帯のみ**（JST 18時台）※検証時はこれが最速 |
| | `2026-08-13` | 24時間分すべて |
| | `2026-08-13 2026-08-14` | 期間指定（終了日は23時まで） |
| | （なし） | 直近1時間 ※定時実行時の挙動 |
| 評価 | `2026-08-13` | 指定日を処理 |
| | `2026-08-13 2026-08-14` | 期間指定（未来日は自動スキップ） |
| | （なし） | 前日を処理 ※定時実行時の挙動 |

### 12-3. 実行コマンド

**AIヒント**

```bash
aws ecs run-task --profile onboarding \
  --cluster dev-ai-log-batch \
  --launch-type FARGATE \
  --task-definition dev-ai-log-batch:8 \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0a08394ab5578ef0f,subnet-09a6db50a790f9e83,subnet-032d570e3368e9025],securityGroups=[sg-0d222818fd975c6a9],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"dev-ai-log-batch","command":["python","./ai_logs.py","2026-08-13"]}]}'
```

**AIチャット**（離脱を発生させた時間帯を `T` 付きで指定するのが最速）

```bash
aws ecs run-task --profile onboarding \
  --cluster dev-ai-chat-logs-batch \
  --launch-type FARGATE \
  --task-definition dev-ai-chat-logs-batch:1 \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0d29d35c19d066efa,subnet-007b8f4d270ba95c1,subnet-03d779e4e75eaf81a],securityGroups=[sg-08c24b11f1843f834],assignPublicIp=ENABLED}" \
  --overrides '{"containerOverrides":[{"name":"dev-ai-chat-logs-batch","command":["python","./ai-chat-logs.py","2026-08-13T18"]}]}'
```

**AIチャット評価**

```bash
aws ecs run-task --profile onboarding \
  --cluster dev-ai-chat-evaluation-logs-batch \
  --launch-type FARGATE \
  --task-definition dev-ai-chat-evaluation-logs-batch:1 \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0d29d35c19d066efa,subnet-007b8f4d270ba95c1,subnet-03d779e4e75eaf81a],securityGroups=[sg-08c24b11f1843f834],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"dev-ai-chat-evaluation-log-batch","command":["python","./ai-chat-evaluation-logs.py","2026-08-13"]}]}'
```

### 12-4. 実行結果の確認

```bash
aws ecs describe-tasks --profile onboarding \
  --cluster <クラスタ名> \
  --tasks <run-taskで返ったtaskArn> \
  --query 'tasks[].{Status:lastStatus,Exit:containers[0].exitCode,Reason:stoppedReason}' --output table
```

`exitCode` が `0` なら成功です。`STOPPED` になるまで数十秒〜数分かかります。

### 12-5. 検証時の推奨フロー

1. フロントで通常の会話 → 続けて離脱を発生させる（§1 の再現手順）
2. S3の生ログに `abandoned` 列と値（`0` / `1`）が入っているか確認
3. **該当時間帯を指定して**バッチを手動実行（§12-3）
4. **Athenaで確認**（§9 のクエリ）← ここまでで実装の検証は完了する
5. CSVダウンロードで表示を確認。**反映されない場合はキャッシュを疑う**（§7）

> Athenaに入っていればアプリとバッチは正常です。CSVに出ないのは表示層（キャッシュまたはSQL）の問題として切り分けられます。

### 12-6. 本番実行時の差分

本番では以下を置き換えます（サブネット・SGは prod 用の値を EventBridge ルールから取得してください）。

| | 検証環境 | 本番 |
|---|---|---|
| クラスタ / タスク定義 / コンテナ名 | `dev-` 始まり | `prod-` 始まり |
| ヒントのサブネット・SG | 上記のとおり | prod ルール `prod-ai-log-batch` から取得 |
| チャットのサブネット・SG | 上記のとおり | prod ルール `prod-ai-chat-logs-batch` から取得 |
| キャッシュのバケット | `dev-onboarding-tracking-bucket` | `prod-onboarding-tracking-bucket` |

---

## 13. 検証結果（2026-08-13 実施）

### 結論

**必須項目はすべて PASS。NG は0件。** 検証環境でのリリース判定は合格。

| 分類 | 結果 |
|---|---|
| 必須項目（T0-1〜4 / T3-1 / T3-2 / T3-5 / T5-5 / T5-9） | **全PASS** |
| 重要項目 | **全PASS** |
| 未実施（⏭） | 3件 — 上限超過・preview・上限アラート（いずれも本改修で変更していない箇所） |
| 検証環境では確認不可（▲） | 4件 — ログレベル変更の影響、バッチ単独時の全行NULL |

### 実際に発生させたデータ

| 時刻(JST) | 対象 | `abandoned` | `ai_response` | トークン | CSV表示 |
|---|---|---|---|---|---|
| 17:56:41 | ヒント | 0 | 575文字 | 1,133 | — |
| **17:57:11** | **ヒント** | **1** | **478文字** | **1,097** | — |
| 17:58:23 | ヒント | 0 | 18文字 | 732 | — |
| 17:58:52 | チャット | 0 | 294文字 | 927 | 最後まで到達 |
| **18:43:12** | **チャット** | **1** | **1,089文字** | **1,609** | **途中離脱** |
| 18:47:53 | チャット | 0 | 285文字 | 917 | 最後まで到達 |
| 18:56:49 | ヒント | 0 | 17文字 | 738 | — |
| 2026-06-22 | チャット | NULL | — | — | **記録開始前** |

**離脱レコードの `ai_response` が最も長い**点が設計意図の達成を示しています。
離脱後もストリームを読み切るため、ユーザーが受け取れなかった部分まで完全に記録され、トークン数も取得できています。

### 主要な確認結果

**フェーズ0（旧チャット撤去）**

```
$connect / $disconnect / $default → aiServerAiHint-dev   （撤去前は aiServerAiChatDify-dev）
aiChatOpenai / aiChatDify ルート → 削除（6ルート → 4ルート）
aiServerAiChatOpenai-dev / aiServerAiChatDify-dev → 削除済み
```

撤去後の 18:56:49 にヒントのレコードが正常記録されており、接続・回答・保存が動作していることを確認。

**Lambda Errors（改修の主要効果）**

`aiServerAiHint-dev` の当日 Errors は **0件**。改修前は月504件（エラー率6.5%）で、その主因が
離脱時の `handle_error` → `send_error_message` での `GoneException` 再発だった。

Dify 401 エラーを意図的に発生させた際も未処理例外にならず、`handle_error:283` でERRORログを出力して
`REPORT` で正常終了することを確認（`Traceback` なし）。

**ログ件数**

| | 改修前 | 実測 |
|---|---|---|
| ヒント（離脱1件あたり） | エラー扱い + Lambda Errors | **WARNING 1件のみ** |
| チャット（離脱1件あたり） | 平均55.8件 | **1件のみ** |

`Cannot call "send" once a close message has been sent.` は0件。抑止フラグが機能している。

**Slack通知（@channelの出し分け）**

| 通知種別 | 絵文字 | @channel | 判定 |
|---|---|---|---|
| 途中離脱（ヒント・チャット） | ℹ️ | **なし** | ✅ |
| エラー（チャット） | （なし） | **あり** | ✅ |
| エラー（ヒント） | ⚠️ | **あり** | ✅ |

`mention_channel` の引数方式が両方向で正しく機能。従来の文字列マッチを置き換えた目的を達成。

### 未実施（⏭）の扱い

| # | 内容 | 判断 |
|---|---|---|
| ~~T2-5 / T2-6 / T3-19~~ | ~~Dify経路の正常系・離脱~~ | **2026-08-14 に実施しPASS（§14）** |
| ~~T5-7~~ | ~~AIヒント回答履歴CSVの表示~~ | **2026-08-14 に実施しPASS（§14）** |
| T6-3 / T6-4 / T6-5 | 上限超過・preview・上限アラート | 本改修で変更していない箇所（カウンタ加算は現状維持） |

### 本番リリース前に必要な確認（▲）

| # | 内容 | 理由 |
|---|---|---|
| T4-1〜3 | ログレベル変更（ERROR → WARNING）の影響 | **dev は元から INFO のため検証不可**。prod 相当の設定でのみ影響が出る。リリース直後にログ量を確認する |
| T1-2 | バッチのみデプロイした時点で全行NULL | 今回はアプリ配備後に検証したため未確認。T5-5（記録開始前の表示）で NULL の扱いは実証済み |

### 検証で判明した既存課題（本改修とは無関係・スコープ外）

チャットの離脱時、保存・通知が完了した**後**に `ws_router.py:39-40` の `except Exception` で
ERRORログが1件出力される。

```
"WebSocket error: WebSocket is not connected. Need to call "accept" first., payload: {...}"
```

**改修前から存在する挙動**で今回追加したものではない。ECSには Lambda の `Errors` に相当する
メトリクスがないため運用影響はないが、「離脱1件につきERRORログ1件」が残る。
厳密に「離脱をエラー扱いしない」を徹底するなら、`ws_router.py` で切断系の例外を
`WebSocketDisconnect` と同様に扱う追加対応が考えられる。**別チケットでの対応を推奨。**

---

## 14. Dify経路の追加検証（2026-08-14 実施）

2026-08-13 の検証は OpenAI 経路のみだったため、Dify 経路を追加検証した。**結果はすべて期待どおり。**

### 発生させたデータ

**AIチャット（Dify）** — `provider_code = 'dify'` / `user_env = 'prod'`

| 時刻(JST) | `abandoned` | `ai_response` | トークン | Athena反映 |
|---|---|---|---|---|
| 15:10:49 | 0 | 15文字 | 31 | ✅ |
| 15:10:59 | 0 | 64文字 | 98 | ✅ |
| **15:11:25** | **1** | **191文字** | **256** | ✅ |

**AIヒント（Dify）**

| 時刻(JST) | `abandoned` | `ai_response` | トークン | Athena反映 |
|---|---|---|---|---|
| 15:11:43 | 0 | 14文字 | 28 | 日次バッチ待ち |
| **15:12:10** | **1** | **293文字** | **228** | 日次バッチ待ち |

ヒントは日次バッチ（JST 02:00）のため実行時点では未反映。S3生ログで `abandoned = 1` を確認済みで、
バッチ→Athenaのパイプラインは 2026-08-13 の検証（OpenAI経路）で実証済み。パイプラインはプロバイダ非依存。

### ログ

**Difyチャット離脱（15:11:25）**

```
06:11:27 [WARNING] "WebSocket message send failed (client disconnected): "   ← 1件のみ
06:11:28 [ERROR]   "WebSocket error: WebSocket is not connected..."          ← 既存課題（§13末尾）
```

**Difyヒント離脱（15:12:10）**

```
06:12:12 [WARNING] send_over_websocket:121
  "Connection gXM2wW7rMbGYKEheWA== has been closed by the client."           ← 1件のみ
```

`Cannot call "send" once...` / `Failed to send request to` はいずれも **0件**。

### Slack通知

15:11 に「AIチャットでユーザーの途中離脱を検知しました。」「AIヒントでユーザーの途中離脱を検知しました。」の
2件が届き、**いずれも @channel なし**。

### この検証で確認できた重要点

**離脱後もトークン数が取得できている**（チャット256 / ヒント228）。

Dify はトークン使用量を `message_end` イベントで返すため、**離脱後もストリームを読み切っていなければ
トークン数は空になります**。値が入っていることが、`StreamSender` による「送信は止めるがストリームは読み切る」
設計が Dify 経路でも機能している直接的な証拠です。

また離脱レコードの `ai_response` が両方とも最長（191文字 / 293文字）で、ユーザーが受け取れなかった部分まで
完全に記録されています。

### 判定の更新

| # | 内容 | 更新前 | 更新後 |
|---|---|---|---|
| T2-5 | チャット(Dify) 回答が最後まで表示される | ⏭ | **✅** |
| T2-6 | チャット(Dify) `abandoned = 0` | ⏭ | **✅** |
| T3-19 | Dify経路でも離脱が同様に動作する | ⏭ | **✅** |

あわせて **AIヒントのDify経路**も離脱・正常系ともに確認済み（専用のテストIDは設けていないが T3-1〜10 と同等）。

### 管理画面CSVでの最終確認（2026-08-14）

期間 **2026-08-08〜08-14** でダウンロードし、両プロダクトのCSVを確認した。

**AIチャット回答履歴**（23列・最終列が「回答の到達状況」）

| 時刻 | 到達状況 | 回答 | トークン | 経路 |
|---|---|---|---|---|
| 08-13 17:58:52 | 最後まで到達 | 294文字 | 927 | OpenAI |
| **08-13 18:43:12** | **途中離脱** | 1,089文字 | 1,609 | OpenAI |
| 08-13 18:47:53 | 最後まで到達 | 285文字 | 917 | OpenAI |
| 08-14 15:10:49 | 最後まで到達 | 15文字 | 31 | Dify |
| 08-14 15:10:59 | 最後まで到達 | 64文字 | 98 | Dify |
| **08-14 15:11:25** | **途中離脱** | 191文字 | 256 | Dify |

**AIヒント回答履歴**（21列・最終列が「回答の到達状況」）→ **T5-7 PASS**

| 時刻 | 到達状況 | 回答 | トークン | 経路 |
|---|---|---|---|---|
| 08-13 17:56:41 | 最後まで到達 | 575文字 | 1,133 | OpenAI |
| **08-13 17:57:11** | **途中離脱** | 478文字 | 1,097 | OpenAI |
| 08-13 17:58:23 | 最後まで到達 | 18文字 | 732 | OpenAI |
| 08-13 18:56:49 | 最後まで到達 | 17文字 | 738 | OpenAI |
| 08-14 15:11:43 | 最後まで到達 | 14文字 | 28 | Dify |
| **08-14 15:12:10** | **途中離脱** | 293文字 | 228 | Dify |

**両CSVとも 空欄0件 / `nan` 0件。**

確認できたこと:

- ヒント側の `fillna` 正規化（チャット側にあった処理を `ai_logs` へ追加した箇所）が機能し、`"nan"` 文字列が発生していない
- OpenAI経路とDify経路が**同一CSVに混在しても正しく判定**される
- ヒント側も **CSVの最終列**に列が追加されている（既存列の位置は変わっていない）
