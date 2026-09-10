# ONBS-1938 本番リリース手順とチェックリスト

作成日: 2026-08-18

## 0. このドキュメントについて

本番リリースの**実行用**手順書です。設計の経緯や判断理由は以下を参照してください。

| ファイル | 内容 |
|---|---|
| `2026-08-10_ai-abandonment-csv-logging-spec-changes.md` | 仕様書（正）。意思決定①〜⑭、変更箇所の根拠 |
| `2026-08-13_ONBS-1938_test-checklist.md` | 検証環境のテスト項目書（全54項目・判定済み）、バッチ手動実行コマンド |
| `2026-08-13_jira-summary.md` | Jira 起票用の要約 |

> **仕様書 §5 との差分について**
> 仕様書 §5 は実装着手前に書かれたもので、実際には採用しなかった設計（`raise_on_gone` 引数、`handler.py` の GoneException 安全網）が含まれています。**本ドキュメントが実装後の実態に基づく最新版**です。デプロイ順序と各フェーズの依存関係は仕様書 §5 と同一です。

---

## 1. リリース対象

### 1-1. PR 一覧

| # | リポジトリ | PR | フェーズ |
|---|---|---|---|
| 1 | Onboarding-AI-Server | [#113](https://github.com/stands/Onboarding-AI-Server/pull/113) | 0 と 2 |
| 2 | onboarding-batch | [#164](https://github.com/stands/Onboarding-Batch/pull/164) | 1 |
| 3 | Onboarding-AI-API | [#31](https://github.com/stands/Onboarding-AI-API/pull/31) | 2 |
| 4 | onboarding-manage-api | [#840](https://github.com/stands/Onboarding-Manage-API/pull/840) | 3 |

いずれも `feature/ONBS-1938` → `release`。

> **AI-Server の PR は フェーズ0 と フェーズ2 の両方を含みます。**
> 旧チャット撤去（`4737653c`）と離脱記録（`3b7d5700` 以降）が同一 PR にあるため、**フェーズ0 と フェーズ2 を分けてデプロイすることはできません**。AI-Server のデプロイは1回で両方が適用されます。順序上の依存（フェーズ1 が先）を満たすため、**AI-Server のデプロイはフェーズ1 完了後に行ってください**。

### 1-2. 変更の概要

- AIヒント・AIチャットの**途中離脱を CSV に記録**（列名「回答の到達状況」／`途中離脱`・`最後まで到達`・`記録開始前` の3値）
- 離脱を**エラー扱いしない**（GoneException を raise しない、ログは WARNING）
- **離脱後の無駄な送信を抑止**
- **旧AIチャット（`aiChat`）の撤去**
- **AI利用上限到達時の Cloudflare キャッシュパージ**（AIヒント側。従来は AI-API 側にしか無かった）

---

## 2. リリース前の準備

### 2-1. 事前確認（デプロイ当日より前に済ませる）

- [ ] **Secrets Manager `prod/cloudflare` の IAM 権限**
      Lambda ロール `lambda-api-default-websocket` が `prod/cloudflare` を読めること。
      読めないとパージ時に Slack 通知だけが飛ぶ（AIヒントの応答自体は正常に完了する）。
      ```bash
      aws iam list-attached-role-policies --profile onboarding \
        --role-name lambda-api-default-websocket
      ```
- [ ] **prod のバッチ用サブネット・セキュリティグループを控える**（フェーズ1の手動実行で使用）
      ```bash
      aws events list-targets-by-rule --profile onboarding --rule <prod-ai-log-batch のルール名> \
        --query 'Targets[].EcsParameters.NetworkConfiguration'
      aws events list-targets-by-rule --profile onboarding --rule <prod-ai-chat-logs-batch のルール名> \
        --query 'Targets[].EcsParameters.NetworkConfiguration'
      ```
- [ ] **prod のタスク定義リビジョンを確認**（dev とは異なる）
- [ ] **実施時間帯の調整** — フェーズ0（AI-Server）は**アクセスの少ない時間帯**に実施する（後述の理由）
- [ ] **Slack の通知先チャンネルを開いておく**（離脱通知・パージ失敗通知の確認用）

### 2-2. ベースラインの記録（リリース前の値。事後比較に使う）

- [ ] **Lambda Errors（ヒント）** — 改修前の実測は **504件/30日（エラー率6.5%）**
      ```
      # CloudWatch Metrics: AWS/Lambda > Errors > FunctionName=aiServerAiHint-prod
      ```
- [ ] **離脱件数（ヒント）** — ロググループ `/aws/lambda/aiServerAiHint-prod`
      ```
      filter @message like /Failed to send request to/ and @message like /GoneException/
      | stats count() as abandoned
      ```
- [ ] **離脱件数（チャット）** — ロググループ `/ecs/prod-onboarding-ai-api`
      ```
      filter @message like /WebSocket message send failed/
      | fields (@message like /Cannot call/) as is_subseq
      | stats sum(1 - is_subseq) as abandoned, sum(is_subseq) as wasted_chunks, count() as total by bin(1d)
      ```
- [ ] **$connect / $disconnect / $default の現在の統合先**（フェーズ0の切り替え確認用）
      ```bash
      API_ID=8hb23gp5n5   # prod（dev は ehcx3t1dvd）
      aws apigatewayv2 get-routes --profile onboarding --api-id $API_ID \
        --query 'Items[].{Route:RouteKey,Target:Target}' --output text | while read route target; do
        uri=$(aws apigatewayv2 get-integration --profile onboarding --api-id $API_ID \
          --integration-id "${target#integrations/}" --query 'IntegrationUri' --output text)
        printf "%-16s → %s\n" "$route" "$(basename ${uri%%/invocations})"
      done
      ```
      リリース前は3ルートとも `aiServerAiChatDify-prod` を指しているはずです。

> **改修後は CloudWatch で離脱を計測できなくなります。** 離脱は `handle_error` を通らなくなるため、リリース後は CSV／Athena の `abandoned` 列が唯一の集計元になります。**ベースラインは必ずリリース前に取得してください。**

---

## 3. デプロイ順序

**この順序は必須です。** 逆順で進めると復旧不可能なデータ欠損、または顧客の CSV ダウンロード障害が発生します。

| フェーズ | 対象 | 先行フェーズが必要な理由 |
|---|---|---|
| **1** | onboarding-batch ＋ Athena | アプリを先に出すと batch の `reindex` が未知の列を落とし、**その期間の離脱情報は復旧できない** |
| **2** | Onboarding-AI-API / Onboarding-AI-Server | フェーズ1 完了後。AI-Server は旧チャット撤去も同時に適用される |
| **3** | onboarding-manage-api | 列が無い状態で CSV SQL が `abandoned` を参照すると Athena がエラーになり、**顧客の CSV ダウンロードが失敗する** |
| 4 | 事後確認・バッファ廃止 | 実データが揃わないと確認できない |

```
フェーズ1（batch + ALTER TABLE）
        ↓
フェーズ2（AI-API / AI-Server）  ← AI-Server は旧チャット撤去を含む。最大のリスク
        ↓
フェーズ3（manage-api）          ← 必ず最後
        ↓
フェーズ4（1か月後）
```

---

## 4. フェーズ1: onboarding-batch ＋ Athena

**顧客影響なし。** この時点ではアプリが値を書かず、CSV SQL も未変更です。

### 手順

- [ ] PR [#164](https://github.com/stands/Onboarding-Batch/pull/164) を `release` にマージ
- [ ] `release` → `main` のリリース PR を作成しマージ、本番デプロイ
- [ ] **本番 Athena で `ALTER TABLE` を手動実行**（`CREATE TABLE IF NOT EXISTS` は既存テーブルに効かないため必須）

```sql
ALTER TABLE prod_onboarding_ai_chat_logs_db.ai_chat_logs ADD COLUMNS (abandoned int);
ALTER TABLE prod_onboarding_ai_logs_db.ai_logs ADD COLUMNS (abandoned int);
```

> **dev 以外の環境も利用している場合は、全環境の両テーブルが対象です。**

### 確認

- [ ] `ALTER TABLE` が2テーブルとも成功した
- [ ] Athena で `abandoned` 列が参照でき、**全行 NULL** であること（アプリ未デプロイのため）
      ```sql
      SELECT CASE WHEN abandoned = 1 THEN '途中離脱'
                  WHEN abandoned = 0 THEN '最後まで到達'
                  ELSE '記録開始前' END AS status,
             count(*) AS cnt
      FROM prod_onboarding_ai_logs_db.ai_logs
      WHERE year='2026'
      GROUP BY 1;
      ```
      → この時点では **「記録開始前」のみ**が出ます。
- [ ] バッチが正常終了する（定時実行を待つか、付録Bのコマンドで手動実行）
- [ ] 既存の列・値が壊れていない

---

## 5. フェーズ2: アプリ（AI-API / AI-Server）

### 5-1. Onboarding-AI-API

- [ ] PR [#31](https://github.com/stands/Onboarding-AI-API/pull/31) を `release` にマージ
- [ ] `release` → `main`、本番デプロイ

**変更点**
- 離脱フラグ（`abandoned`）の追加、離脱後の送信・ログ抑止
- ログレベル ERROR → WARNING（`app_logging_prod.yaml` の `:10` `:15`。root は ERROR 維持）
- 離脱通知 `notify_ai_chat_abandonment` の新設（`@channel` なし）
- CSV ログ保存失敗時に通知文面を切り替え

### 5-2. Onboarding-AI-Server（最大のリスク）

> **⚠️ `$connect` / `$disconnect` / `$default` の統合先が `aiChatDify` → `aiHint` に切り替わります。**
> CloudFormation がルート更新と Lambda 削除を行う順序に依存するため、**切り替えの瞬間に新規接続が失敗し得ます。アクセスの少ない時間帯に実施し、直後に接続確認を行ってください。**

- [ ] PR [#113](https://github.com/stands/Onboarding-AI-Server/pull/113) を `release` にマージ
- [ ] `release` → `main`、本番デプロイ
- [ ] **デプロイ直後に統合先を確認**（§2-2 と同じコマンド）
      → `$connect` / `$disconnect` / `$default` が **`aiServerAiHint-prod`** に切り替わっていること
- [ ] **AIヒントの WebSocket 接続が確立でき、回答が返ること**（実際に本番サイトで確認）
- [ ] **AIチャットが従来どおり動作すること**（別システム `wss://v2ai.onboarding-app.io` のため影響しないはずだが念のため）

### 5-3. デプロイ直後の確認（両リポジトリ）

- [ ] AIヒントで**正常系**の回答が最後まで返る
- [ ] AIチャットで**正常系**の回答が最後まで返る（OpenAI / Dify 両方）
- [ ] **離脱を意図的に発生させる**（回答ストリーミング中にタブを閉じる）
  - [ ] Slack に離脱通知が届き、**`@channel` が付いていない**
  - [ ] 通知文面が「回答はCSVログに記録されています。」（保存成功時）
  - [ ] CloudWatch の離脱ログが **WARNING** レベルで、**1リクエスト1件**（改修前は平均55.8件）
- [ ] **エラー系の回帰確認** — エラー通知には `@channel` が**付く**こと（離脱通知と区別できる）
- [ ] Lambda Errors が発生していない（`aiServerAiHint-prod`）
- [ ] **T4-1〜3: ログレベル変更（ERROR → WARNING）の影響確認** ← **dev では検証できなかった唯一の項目**
      prod のログ量が想定外に増減していないこと

### 5-4. Cloudflare キャッシュパージの確認（今回の追加分）

AI利用回数はヒントとチャットで共有しています。**ヒント側の利用で上限に到達したときにパージが走ること**を確認します。

- [ ] 検証用プロダクトの `ai_usage_limit.monthly_limit` を一時的に `used_count + 1` に設定
- [ ] AIヒントを1回実行して上限に到達させる
- [ ] CloudWatch（`/aws/lambda/aiServerAiHint-prod`）に成功ログが出ること
      ```
      Cloudflare cache purge ok: product_code={code}, source=ai-server/limit-reached
      ```
- [ ] `/onboarding-init` のレスポンスで `res_data.ai_chats` が**空**になること
      （空でなければリードレプリカ遅延を疑う。Athena ではなく DB の `used_count` と突き合わせる）
- [ ] フロントで**チャットUIが表示されなくなる**こと
- [ ] Slack に「Cloudflareのキャッシュパージに失敗しました」が**届いていない**こと
- [ ] `monthly_limit` を元の値に戻す

---

## 6. フェーズ3: onboarding-manage-api（必ず最後）

> **前提: フェーズ1の `ALTER TABLE` が完了していること。** 列が無い状態でこの SQL を出すと Athena がエラーになり、**顧客の CSV ダウンロードが失敗します。**

### 手順

- [ ] フェーズ1の `ALTER TABLE` が完了していることを再確認
- [ ] PR [#840](https://github.com/stands/Onboarding-Manage-API/pull/840) を `release` にマージ
- [ ] `release` → `main`、本番デプロイ

### 確認

> **⚠️ CSV は1時間単位でキャッシュされます。** 同じ期間・同じ時間台で再ダウンロードすると必ずキャッシュが返ります。回避方法は付録C。

- [ ] **AIヒント回答履歴CSV**
  - [ ] 最終列に「**回答の到達状況**」がある（「その他」の次）
  - [ ] リリース後の正常レコードが「**最後まで到達**」
  - [ ] リリース後の離脱レコードが「**途中離脱**」
  - [ ] **リリース日より前の期間**が「**記録開始前**」（空欄や `nan` ではない）
  - [ ] 全行が3値のいずれか（空欄が無い）
- [ ] **AIチャット回答履歴CSV** で同じ確認
- [ ] 既存の列名・値が従来どおり
- [ ] どの期間でもダウンロードが Athena エラーにならない

---

## 7. リリース翌日以降の確認

バッチが1回以上回った後に実施します（ヒント: JST 02:00 日次／チャット: 毎時0分）。

- [ ] Athena で `abandoned` が `0` / `1` で入っている（NULL のままでない）
      ```sql
      SELECT CASE WHEN abandoned = 1 THEN '途中離脱'
                  WHEN abandoned = 0 THEN '最後まで到達'
                  ELSE '記録開始前' END AS status,
             count(*) AS cnt
      FROM prod_onboarding_ai_logs_db.ai_logs
      WHERE year='2026' AND month='08'
      GROUP BY 1;
      ```
- [ ] 離脱レコードの `ai_response` が**途切れていない**（離脱後もストリームを読み切る設計のため）
      ```sql
      SELECT start_time, hint_id, abandoned,
             length(ai_response) AS response_length, total_tokens
      FROM prod_onboarding_ai_logs_db.ai_logs
      WHERE year='2026' AND month='08' AND abandoned = 1
      ORDER BY start_time DESC LIMIT 20;
      ```
- [ ] **Lambda Errors が減少している**（改修前 504件/30日 → 真のエラー水準へ）
- [ ] 離脱率が想定水準（ヒント 2.30% / チャット 2.38% 前後）
- [ ] Slack の離脱通知が過剰に飛んでいない
- [ ] ログ量が想定内（離脱関連ログは 1/56 に減る見込み）

---

## 8. フェーズ4: リリース1か月後

- [ ] 実データで再測定
  - [ ] 離脱率（CSV の `abandoned` 列から算出。CloudWatch では計測不可）
  - [ ] 乖離率（カウンタ ↔ CSV）が想定水準（**0.2%程度**）に収束しているか
  - [ ] ヒント離脱件数の増加傾向（07-14〜08-13 で347件。分母未取得のため率は未確定）
- [ ] 上記を確認後、**バッファを廃止**（意思決定⑪。5% → 1%未満で足りる見込み）
- [ ] Lambda Errors のアラーム新設を検討（真のエラーだけが残るため低い閾値が実用的になる）

---

## 9. ロールバック方針

| フェーズ | 切り戻し可否 |
|---|---|
| 1 | 列を追加しただけなので影響なし。切り戻し不要（`DROP COLUMN` も不要） |
| 2 | アプリのみ切り戻せば元の挙動に戻る。既に書かれた `abandoned` は残るが害はない |
| 3 | CSV SQL を戻せば列が消えるだけ。データは残る |

> **フェーズ2 を切り戻した期間は `abandoned` が NULL になり、CSV 上は「記録開始前」と表示されます。** 長期間の切り戻しは顧客の分析に影響するため、その場合は表示方針の再検討が必要です。

**フェーズ2（AI-Server）の切り戻しに関する注意**
旧チャット撤去も同時に巻き戻るため、`$connect` などの統合先が `aiChatDify` に戻ります。切り戻し後も統合先の確認を行ってください。

---

## 10. 未実施・スコープ外

### リリース判断を妨げない未実施項目

| # | 内容 | 理由 |
|---|---|---|
| T6-3 | 上限超過時の429 | 意思決定①でカウンタ加算の実装を変更していないため |
| T6-4 | preview が対象外 | 同上 |
| T6-5 | AI利用上限アラート | 同上 |

### 別チケット推奨

- **`end_of_message` 送信時の離脱が `abandoned` に反映されない**（AI-Server / AI-API 共通）
  CodeRabbit の指摘。`save_log` 実行中に離脱した場合は `abandoned=0` になる。回答本体は全チャンク届いており、届かないのは制御メッセージのみ。「回答の到達状況」の定義に関わる仕様判断が必要なため、両リポジトリ同時に対応する。
- **チャット離脱時の ERROR ログ1件**（`Onboarding-AI-API/app/api/websocket/ws_router.py:39-40`）
  改修前から存在する挙動。ECS には Lambda の `Errors` 相当のメトリクスがないため運用影響はない。
- 離脱ログへの `product_id` / `hint_id` 付与（`logger.append_keys`）→ プロダクト別集計が可能になる
- チャットの400系 Slack 通知（ボット由来・月126件）の抑制
- 旧 WebSocket API `chat-openai-websocket-prod`（`2sa5gc22j8`・2024-05-16作成）の棚卸し
- Cloudflare の `Cache-Tag` サニタイズ漏れ（`Onboarding-API-Next/app/core/responses.py:68`）
- `monthly_limit` 未設定時の解釈が AI-API と API-Next で真逆（`app/cruds/ai_usage.py:72`）

---

## 付録A: Athena 確認用クエリ

**離脱レコードの確認（ヒント）**
```sql
SELECT start_time, hint_id, abandoned,
       length(ai_response) AS response_length, total_tokens
FROM prod_onboarding_ai_logs_db.ai_logs
WHERE year='2026' AND month='08'
  AND concat_ws('', year, month, day) = '<YYYYMMDD>'
ORDER BY start_time DESC LIMIT 20;
```

**離脱レコードの確認（チャット）**
```sql
SELECT start_time, chat_id, abandoned,
       length(ai_response) AS response_length, total_tokens, provider_code
FROM prod_onboarding_ai_chat_logs_db.ai_chat_logs
WHERE year='2026' AND month='08'
  AND concat_ws('', year, month, day) = '<YYYYMMDD>'
ORDER BY start_time DESC LIMIT 20;
```

**3値の分布確認（CSV表示と一致するか）**
```sql
SELECT CASE WHEN abandoned = 1 THEN '途中離脱'
            WHEN abandoned = 0 THEN '最後まで到達'
            ELSE '記録開始前' END AS status,
       count(*) AS cnt
FROM prod_onboarding_ai_logs_db.ai_logs
WHERE year='2026'
GROUP BY 1;
```

---

## 付録B: バッチの手動実行（本番）

定時実行を待たずに ECS の `run-task` で実行できます。**再実行は安全です**（Parquet のファイル名が日付固定、パーティション追加は `ADD IF NOT EXISTS`）。

検証環境のパラメータはテスト項目書 §12-1 を参照。本番では以下を置き換えます。

| | 検証環境 | 本番 |
|---|---|---|
| クラスタ / タスク定義 / コンテナ名 | `dev-` 始まり | `prod-` 始まり |
| サブネット・SG | テスト項目書 §12-1 | EventBridge ルールから取得（§2-1） |
| キャッシュのバケット | `dev-onboarding-tracking-bucket` | `prod-onboarding-tracking-bucket` |

**引っかかりやすい点**

- **評価バッチのコンテナ名だけ `log`（単数）** — クラスタ名は `...logs-batch`（複数形）だがコンテナ名は `prod-ai-chat-evaluation-log-batch`。間違えると `run-task` が失敗する
- **`assignPublicIp` がバッチごとに異なる** — チャットのみ `ENABLED`
- チャットは `./ai-chat-logs.py 2026-08-18T15` のように**時間帯を指定すると最速**

**実行結果の確認**
```bash
aws ecs describe-tasks --profile onboarding \
  --cluster <クラスタ名> --tasks <taskArn> \
  --query 'tasks[].{Status:lastStatus,Exit:containers[0].exitCode,Reason:stoppedReason}' --output table
```
`exitCode` が `0` なら成功。`STOPPED` になるまで数十秒〜数分かかります。

---

## 付録C: CSV キャッシュの回避

`onboarding-manage-api/api/rest/functions/mng-v1-report/method_get.py:77-88` は、S3 に同名ファイルがあれば **Athena を再実行せずキャッシュを返します**。

ファイル名は `{レポート名}-{開始日}00-{終了日}{hour}.csv` で、`get_end_hour`（`:473-489`）は終了日が当日なら **`(now - 2時間).hour`（JST）** を返します。つまり**同じ時間台の再ダウンロードでは必ずキャッシュが返ります**。

| 方法 | 手順 | 備考 |
|---|---|---|
| **A. 期間をずらす**（最も手軽） | 開始日を1日変える | ファイル名が変わり再クエリされる |
| B. キャッシュを削除 | 下記コマンド | 同じ期間で確認したい場合 |
| C. 1時間待つ | 次の時間台まで待つ | 確実だが遅い |

```bash
# キャッシュ一覧（{account_id} / {product_id} は対象の値に置き換える）
aws s3 ls --profile onboarding --recursive \
  "s3://prod-onboarding-tracking-bucket/aggregated-download-src/{account_id}/{product_id}/"

# 該当ファイルを削除
aws s3 rm --profile onboarding \
  "s3://prod-onboarding-tracking-bucket/aggregated-download-src/{account_id}/{product_id}/ai_chat_message_sent_user/<ファイル名>"
```

**切り分けのコツ**: まず Athena を直接確認する。データがあって CSV に出ないならキャッシュが原因です。

---

## 付録D: `abandoned` は必ず NULL のまま保持する

CSV の3値表示は **`abandoned` が NULL であること**で「記録開始前」を判定しています。

- `ensure_column_exists(chunk, "abandoned", None)` の既定値は **`None`**。隣の `account_id` / `product_id` が `0` を使っているため誤って踏襲しやすい
- ヒント側（`ai_logs`）に `fillna(0)` を入れてはいけない
- Parquet は nullable `Int32`。既存の `response_number` と同方式で、2025-04〜09 に NULL が実在することで fastparquet の NULL 保持を実証済み

「記録開始前」を3値目として用意した理由は、**チャット側だけリリース前データに「実は離脱だった行」が含まれる**ためです（離脱しても保存到達するため。実測2.38%）。空欄が「離脱していない」と「記録前」の両方を意味すると、顧客がリリース日をまたぐ期間を分析したときに離脱率を誤算出します。CSV レコード数の増加について事前アナウンスを行わない方針のため、CSV 自体が自己説明的である必要がありました。
