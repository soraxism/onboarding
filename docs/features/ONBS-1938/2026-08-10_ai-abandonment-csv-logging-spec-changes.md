# 途中離脱のCSV記録対応：仕様変更箇所と意思決定事項

作成日: 2026-08-10 ／ 最終更新: 2026-08-13（意思決定①〜⑭すべて確定。要件は §1-3、デプロイ手順は §5）
対象リポジトリ: `Onboarding-AI-API` / `Onboarding-AI-Server` / `onboarding-batch` / `onboarding-manage-api`
前提資料: [実測レポート（Artifact）](https://claude.ai/code/artifact/c0ed93be-30f5-4d63-8668-0915b5f5f596) / [処理フロー図（Artifact）](https://claude.ai/code/artifact/3a50e0e0-c082-48c4-85ef-71f22aa35501) / `.claude/handoffs/2026-08-07_ai-usage-counter-vs-csv-discrepancy.md`

---

## 0. 決定事項

承認日: 仕様3項目 = 2026-08-10 ／ 意思決定①〜⑭ = 2026-08-13

### ① 「利用した」の定義

**確定版の定義文（2026-08-13 承認）**

> AI-API / AI-Server が、**プロダクトおよびチャット設定／ヒントウィジェットを特定でき、月間上限内であるリクエストを受け付けた時点**で1回とカウントする。
> AI応答が成功したか、ユーザーが応答を最後まで受け取れたか（途中離脱）は**問わない**。
> ただし管理画面プレビュー（preview）および検証タグ（dev）は対象外とする。

当初の合意は「AI-API・AI-Server にリクエストがあった時点」でしたが、
プロダクトが特定できないリクエスト（不正リクエスト等）は**加算先のレコードが決まらず物理的に加算できない**ため、
実装と1対1で対応する上記の表現に精緻化した（根拠は §2-1）。

**この定義により確定すること**

- 加算位置は**現状のコードのまま変更しない**
- 途中離脱も「利用1回」として計上する（決定②③と整合）
- 上限超過リクエストは加算しない（加算すると上限管理が破綻するため）

### ② AIヒントの途中離脱の仕様変更
AIヒントの途中離脱時のCSVログ記録仕様を AIチャットに寄せる（離脱をエラー扱いせず、処理を継続してログ保存まで到達させる）。

### ③ 途中離脱のCSV記録
新規仕様として、AIチャット／AIヒント共に途中離脱をCSVに記録する。

---

## 1. 前提の確認

### 1-1. 用語の精確化

決定②を「握りつぶさずCSVに記録する」と表現すると実装時に誤解を生みます。機構は逆で、**ヒント側で `GoneException` を握りつぶす（raise しない）ことで処理が継続し保存に到達**します。

仕様書上は「**離脱をエラー扱いせず、処理を継続してログ保存まで到達させる**」と記述するのが正確です。

### 1-2. 決定①による作業削減

「利用した ＝ リクエストがあった時点」と定義されたため、handoff §5-1 の
**「加算タイミングを後ろへ（設定取得後・AI呼び出し直前に移動）」は棄却**となり、実装不要です。
加算位置は現状維持となります。

### 1-3. 満たすべき要件（2026-08-13 確認・これが判断の基準）

| # | 要件 | 実装方針 | 対応する意思決定 |
|---|---|---|---|
| **要件1** | 途中離脱が発生してもCSVには記録する | ヒント: 送信層で `GoneException` を raise せず処理を継続し `save_log` に到達させる／チャット: 現状すでに到達 | 決定②③ |
| **要件2** | 途中離脱後のチャンクデータは送信しない（無駄になるため） | 離脱検知フラグを立て、以降の送信呼び出しをスキップする。**ストリーム自体は読み切る**（`ai_response` を完全に保ちCSVに残すため） | ⑥ = (a) |
| **要件3** | 途中離脱をCSVに記録する | 「回答の到達状況」列（`abandoned int`） | ④（案3） |
| **要件4** | 途中離脱が発生したことを Lambda / アプリのログに記録する | **`raise` はやめるがログ出力は残す**。レベルは **WARNING**（チャット・ヒント共通）。要件2により1リクエストあたり1件になる | ⑦ = (a)／⑭ = WARNING |

**要件2と要件4は両立します。** 送信試行を止めるとログも1件だけになりますが、
「発生したことが記録される」という要件は満たされます（現状チャットは平均55.8件出ており、これが1件に減る）。

**`raise` をやめること ≠ ログを消すこと。** `response.py:118` のログ出力はそのまま残し、`raise e` のみ外します。

### 1-4. 改修前ベースライン（実測値）

改修後は同じ方法で計測できなくなるため、以下を改修前の基準値として扱います。

| 指標 | チャット | ヒント |
|---|---|---|
| 離脱率 | 2.38%（86件 / 3,607） | 2.30%（190件 / 8,261） |
| 乖離率（離脱を含む） | 0.05% | 2.49% |
| 乖離率（実エラーのみ） | 0.05% | 0.19% |
| 集計期間 | 2026-07-28〜08-08（12日） | 2026-07-07〜08-06（30日） |

---

## 2. 仕様変更箇所一覧

### 2-1. カウンタ加算（決定①）→ コード変更なし

**結論: 実装変更は不要。** §0 の確定定義文は現状の実装と一致します。

#### 加算までのチェック順序

```
リクエスト受信
  ├─ ① ディスパッチャ層（action / スキーマ）  → 400  加算なし
  ├─ ② プロダクト情報取得 / モデル名取得       → 404  加算なし
  ├─ ③ AI利用可能性チェック                  → 403  加算なし
  ├─ ④ 上限値レコード存在確認                 → 429  加算なし
  ├─ ⑤ preview / dev 判定                   → スキップ（加算なし）
  ├─ ⑥ 上限超過チェック                      → 429  加算なし
  └─ ★ ここで +1 ──────────────────────────────────
     以降（設定取得失敗422 / AI失敗 / 離脱 / 保存失敗）は加算済み
```

| 処理 | チャット（Onboarding-AI-API） | ヒント（Onboarding-AI-Server） |
|---|---|---|
| ディスパッチャ | `app/api/websocket/action_handler.py:36-73` | `src/layers/custom-libs/python/validation.py:204`（`validate_ai_hint`） |
| preview / dev 判定 | `app/services/validators/ai_chat.py:93` | `src/layers/custom-libs/python/ai_utils.py:236` |
| 上限値レコード存在確認 | `app/services/validators/ai_chat.py:100-106` | `src/layers/custom-libs/python/ai_utils.py:239-240` |
| 上限超過チェック | `app/services/validators/ai_chat.py:158-161` | `src/layers/custom-libs/python/ai_utils.py:95-97` |
| **加算（+1）** | `app/services/validators/ai_chat.py:164-168` | `src/layers/custom-libs/python/ai_utils.py:99-108`<br>（`src/functions/aiHint/main.py:66` から呼び出し） |

#### 加算されないケースと実測頻度

**チャット**（`/ecs/prod-onboarding-ai-api`・2026-07-30〜08-13 / 14日）

| ケース | コード | 件数 |
|---|---|---|
| `action` フィールド欠落 | 400 | **53** |
| スキーマ不正 | 400 | **6** |
| 未対応 `action` | 400 | 0 |
| プロダクト未検出 | 404 | 0 |
| モデル名取得失敗 | 404 | 0 |
| AI利用不可 | 403 | 0 |
| 上限超過 | 429 | 0 |
| （参考）設定取得失敗＝加算後 | 422 | 0 |

**ヒント**（`/aws/lambda/aiServerAiHint-prod`・2026-07-14〜08-13 / 30日）

`handle_error` は30日間で363件のみで、**その全件がAI呼び出し関連**（離脱347＋API異常16）。
400 / 403 / 404 / 429 は**すべて0件**。

#### ケースの分類と判断根拠

実測で発生しているのは**チャットの400系のみ（59件/14日 ≒ 126件/月）**です。

| グループ | ケース | 定義上カウントすべきか | 技術的に可能か |
|---|---|---|---|
| **A** | ① 400系 | **いいえ** | **不可能** |
| **B** | ② 404 / ③ 403 / ④ 429（上限値未設定） | 議論の余地あり | 可能 |
| **C** | ⑥ 429（上限超過） | いいえ | 可能だが有害 |
| **D** | ⑤ preview / dev | いいえ | 可能 |

- **グループA が定義文を精緻化した理由。** `action_handler.py:37` は `chat_id = raw_data.get("chatId", "")` で、不正リクエストではこれが空文字になる（handoff §2-4 の「プロダクトID=Unknown のSlackエラー」がこれ）。**プロダクトが特定できないため加算対象のレコードが決まらず、物理的に加算できない**。またこれらはボット等による不正リクエストであり、顧客の「利用」を取りこぼしているのではなく**非利用を正しく除外している**のが実態。
- **グループB** はプロダクトは特定できるがAI利用の設定自体が不備なケースで、AIも呼ばれない。実測ゼロで、発生するとしても設定ミス時のみ。
- **グループC（上限超過）は加算してはいけない。** 加算するとカウンタが上限を超えて増え続け、上限管理という本来の目的が壊れる。
- **グループD（preview / dev）** はCSV側でも除外されている（`ai_hint_message_sent_user.sql` の preview 除外条件、`ai_chat_message_sent_user.sql` の `user_env = 'prod'`）ため、カウンタとCSVで整合が取れている。

#### 却下した選択肢

グループBまで加算する案は、以下の理由で費用対効果が見合わないため却下。

- グループAは**依然として加算不可**（プロダクト不明）＝完全一致は達成できない
- 加算を前倒しすると、上限値レコード未設定のプロダクトで加算先がなく新たな例外処理が必要
- 実測ゼロのケースのために、上限チェックと加算の順序を組み替えるリスクを負うことになる

### 2-2. AIヒント 離脱時の挙動変更（決定②）

**Onboarding-AI-Server**

| ファイル | 変更内容 |
|---|---|
| `src/layers/custom-libs/python/response.py:107-126` | `send_over_websocket()` に `raise_on_gone: bool = True` を追加。`False` 時は `GoneException` を raise せず戻り値で通知 |
| `src/layers/custom-libs/python/response.py:118` | ログ出力は**残す**（要件4）。`logger.info` → **`logger.warning`** に変更（⑭ 決定） |
| `src/layers/custom-libs/python/response.py:39-48` | `send_message()` が送信可否の bool を返すよう変更（現状は戻り値なし） |
| `src/layers/custom-libs/python/ai.py:182-232` | `send_openai_request()` のストリーミングループで送信結果を拾い、離脱情報を戻り値に追加 |
| `src/layers/custom-libs/python/ai.py`（`send_dify_request`） | 同様。現状の戻り値は4要素タプルのため **dict / dataclass 化を推奨**（⑨の撤去後は呼び出し元が `aiHint` のみになるため制約なく変更可能） |
| `src/functions/aiHint/main.py:83-95` | 離脱を `except` で捕まえずストリーミングを完走させる（`ai_response` を完全に保つ） |
| `src/functions/aiHint/main.py:99-106` | `save_log` に到達（結果としての変更。コード変更は不要な想定） |
| `src/functions/aiHint/main.py:107` | `send_end_of_message` も `raise_on_gone=False` に。未対応だと Lambda 未処理例外が残る（→ 意思決定 ⑦） |
| `src/layers/custom-libs/python/response.py:51-64`（`send_error_message`） | 同様に抑止対象。**ここが現在の Lambda Errors の主因**（`main.py:257` の `handle_error` から呼ばれ、離脱済み接続に送信して `GoneException` が再発 → 未処理例外） |
| `src/functions/aiHint/handler.py:36` | `GoneException` 限定の try/except を安全網として追加（将来の送信経路追加への備え） |

> **前提: 旧チャットは先に撤去する（意思決定 ⑨）**
> `response.py` / `ai.py` は共有レイヤーで、撤去前は旧チャット（`aiChat/openai`・`aiChat/dify`）も使用しています。
> **フェーズ0で旧チャットを撤去した後**は呼び出し元が `aiHint` のみになるため、
> `send_openai_request` / `send_dify_request` の**戻り値を制約なく変更できます**（dict / dataclass 化が容易）。
> 撤去作業は §2-5、デプロイ順序は §5 のフェーズ0を参照。

#### 握りつぶす位置の選択（重要）

例外は `ai.py:219` の `for partial_message in stream:` の内側から飛んできます。

| 位置 | `ai_response` の中身 | チャットとの整合 |
|---|---|---|
| (a) `aiHint/main.py:93` の `except` で捕まえる | 離脱時点で途切れた不完全な文字列 | ✗ |
| **(b) 送信層（`response.py`）で握りつぶす** | **完全な回答** | **✓** |

チャットは握りつぶして完走するため完全な回答を保存します。
(a) を選ぶと CSV の「AIの回答」列の意味が両者で食い違うため、**(b) を採用**します。

### 2-3. 離脱のCSV記録（決定③）

#### カラム仕様（2026-08-13 確定）

| 項目 | 内容 |
|---|---|
| **CSVヘッダー名**（顧客が見る文言） | **回答の到達状況** |
| **CSV上の値**（3値・空欄なし） | `途中離脱` ／ `最後まで到達` ／ `記録開始前` |
| 記録内容 | **離脱有無のみ**。送達チャンク数・総チャンク数は記録しない（意思決定 ③ = (a)） |
| 対象 | AIチャット・AIヒント **両方** |
| Athena / Parquet | 両テーブルの**末尾に1列**追加（`abandoned int`） |

**列名を「途中離脱」ではなく「回答の到達状況」にした理由**

実装が検知しているのは厳密には「クライアントとの接続が切れた」ことで、実測の内訳は
`1001 going away`（タブを閉じる・画面遷移）62件、`1005 no status received`（異常終了・ネットワーク断）24件でした。
**ユーザーが意図的に離れた場合とネットワーク断・ブラウザのクラッシュが混在**するため、
「途中離脱」を列名にすると原因を断定してしまいます。「到達状況」なら事象のみを表現でき、過大な主張になりません。

##### データ層の表現（確定）

**`abandoned int`：1 = 途中離脱 / 0 = 最後まで到達 / NULL = 記録開始前**

CSV上の3値への変換は manage-api の CSV SQL で行います。

```sql
CASE WHEN abandoned = 1 THEN '途中離脱'
     WHEN abandoned = 0 THEN '最後まで到達'
     ELSE '記録開始前' END AS "回答の到達状況"
```

この構成にする理由:

- Athena を直接参照する社内分析（離脱率の集計など）が容易になる
- リリース前データ（NULL）とリリース後の非離脱（0）を**データ上で区別できる**（意思決定 ⑬ の解決に必須）
- 表示文言を変更する際、バッチ再集計が不要
- CSV側は空欄が発生しないため、ピボットテーブルでそのまま集計できる

型を `boolean` ではなく `int` にする理由: バッチは S3 の CSV を一度 TSV に落としてから Parquet 化するため、
`boolean` は文字列 `"True"` / `"False"` を経由して曖昧になります。既存の数値カラムと同様に `int` が安全です。

アプリが直接日本語文字列を書き込む方式は採用しません。表示文言の変更時に過去データと不整合になり、
NULL / 0 の区別もできなくなるためです。

#### アプリ層

**Onboarding-AI-API（チャット）**

| ファイル | 変更内容 |
|---|---|
| `app/api/websocket/messaging/base.py:25-39` | `WebSocketMessenger` に `send_failed` フラグを追加。`app/api/websocket/ws_router.py:33` でメッセージ毎に生成されるため自然にリクエストスコープになる。**意思決定⑥(a) により、このフラグは「離脱記録用」と「以降の送信・ログ抑止用」を兼ねる**（チャンク数カウンタは ③(a) のため不要） |
| `app/api/websocket/actions/ai_chat_openai.py:64-78` | `create_chat_log_entry()` に離脱情報を渡す |
| `app/api/websocket/actions/ai_chat_dify.py:70` 付近 | 同様 |
| `app/services/analytics/chat_logs.py:122` | ログエントリに離脱フィールドを追加 |

**Onboarding-AI-Server（ヒント）**

| ファイル | 変更内容 |
|---|---|
| `src/functions/aiHint/main.py:197` | `generate_log_data()` に離脱フィールドを追加 |

#### 下流（案B採用により **必須**）

> **記録形式は案B（独立カラム）に決定**（2026-08-13）。顧客が分析に使うための追加であるため、
> `options` JSON への埋め込み（案A）ではなく独立カラムとする。以下はすべて必須作業。

| リポジトリ | ファイル | 変更内容 |
|---|---|---|
| onboarding-batch | `src/ai_chat_logs/functions/aggregate.py:173-182` | `expected_columns` の**末尾**（`options` の後）に追加 |
| | 同 `:159-170` | `ensure_column_exists()` に追加（過去ファイル対応） |
| | 同 `:383` | `CREATE EXTERNAL TABLE` の**末尾**に追加。`IF NOT EXISTS` かつ**毎回のバッチ実行で呼ばれる**ため（`:314`）既存テーブルには効かず、**`ALTER TABLE ADD COLUMNS` の手動実行が必要** |
| | `src/ai_logs/functions/aggregate.py:122-129` | `expected_columns` の**末尾**（`options` の後）に追加 |
| | 同 `:174-194` | **ヒント側には `where(pd.notna(df), None)` 相当の正規化がない**（チャット側は `src/ai_chat_logs/functions/aggregate.py:185` にある）。`fillna` を明示追加しないと過去ファイルの欠損が **文字列 `"nan"`** として Athena に入る |
| | 同 `:287` | `CREATE EXTERNAL TABLE` の**末尾**に追加（呼び出しは `:221` `create_ai_log_table`）＋`ALTER TABLE` 手動実行 |
| onboarding-manage-api | `api/rest/functions/mng-v1-report/athena-queries/ai_chat_message_sent_user.sql` | `CASE` による3値変換で `AS "回答の到達状況"` を追加（現在の最終列 `options AS "その他"` の後）。SQL は §2-3 参照 |
| | `api/rest/functions/mng-v1-report/athena-queries/ai_hint_message_sent_user.sql` | 同 |
| | `api/rest/functions/mng-v1-report/method_get.py:85-99` | **期間ベースキャッシュにより、リリース後も既存期間は旧CSVがキャッシュ返却される** |

##### 案B 実施時の必須要件

**1. カラムは必ずテーブル定義の末尾に追加する**

Athena の Parquet 読み取りは既定で**カラム名**によるマッピングを行うため、末尾に追加すれば
既存 Parquet ファイル（新カラムを持たない）は **NULL** として読めます。
途中に挿入すると既存データの列対応がずれる恐れがあります。

`expected_columns` の順序は Athena テーブル定義と一致させる必要があります
（batch のコード内コメントにも明記あり）。両テーブルとも現在の末尾は `options` なので、その後に追加します。

**2. `ALTER TABLE ADD COLUMNS` は全環境で実行する**

Athena DB 名は `f"{env}_onboarding_ai_logs_db"` / `f"{env}_onboarding_ai_chat_logs_db"`
（`src/ai_logs/functions/aggregate.py:22` / `src/ai_chat_logs/functions/aggregate.py:24`）と
環境変数 `ENV` から組まれます。**dev / prod など利用中の全環境の両テーブル（計4つ以上）**に対して実行が必要です。

**3. リリース前データは必ず NULL にする（0 や `"nan"` にしてはいけない）**

CSVの3値表示は `abandoned` が **NULL であること**をもって「記録開始前」と判定します（§2-3 の `CASE`）。
そのため、新カラムを持たない過去ファイル由来の行が NULL 以外の値になると**「最後まで到達」と誤表示されます**。

具体的に守るべき点:

| 対象 | 要件 |
|---|---|
| `src/ai_chat_logs/functions/aggregate.py:159-170` | `ensure_column_exists(chunk, "abandoned", None)` と **デフォルト値を `None`** にする（`0` にしない）。`account_id` / `product_id` が `0` を使っているため誤って踏襲しやすい |
| `src/ai_logs/functions/aggregate.py:174-194` | ヒント側には `where(pd.notna(df), None)` 相当の正規化がないため、**`abandoned` に対する `fillna` を追加してはいけない**。`reindex` 後の NaN が TSV に `"nan"` として書かれないよう、チャット側と同様の `None` 正規化を入れる |
| CSV SQL | `ELSE` 節が「記録開始前」を担うため、`abandoned` が `0` / `1` 以外の値になり得ないことを前提にする |

リリース前データが「記録開始前」と正しく表示されることは、リリース直後に**必ず実データで確認**してください。

### 2-4. 付随して必要になる変更

| 対象 | 内容 | 必要性 |
|---|---|---|
| `Onboarding-AI-API/app/api/websocket/messaging/base.py` | 離脱検知後の送信・ログを抑止。現状は離脱1件あたり**平均55.8件**の無駄ログが出ている（実測 4,797 / 86件） | **必須**（意思決定⑥ = (a) 同時実施） |
| `Onboarding-AI-API/app/api/websocket/messaging/base.py:38` | 離脱ログを `logger.exception`（ERROR）→ **`logger.warning`** に変更（⑭ 決定） | **必須** |
| `Onboarding-AI-API/app/logging_config/app_logging_prod.yaml` | **`:10`（console ハンドラ）と `:15`（`app` ロガー）を ERROR → WARNING** に変更。`:20`（root）は **ERROR のまま**にしてサードパーティの WARNING 流入を防ぐ。dev（INFO）・local（DEBUG）は変更不要 | **必須**（⑭ 決定に伴う。未対応だと prod で離脱ログが出ない） |
| `Onboarding-AI-Server/src/layers/custom-libs/python/ai.py` | 同じ抑止をヒントにも入れる。入れないと**改修によって新たに同じログノイズが発生する** | **必須**（同上） |
| `Onboarding-AI-Server/src/layers/custom-libs/python/slack_utils.py`（`create_alert_blocks`） | **`mention_channel: bool = True` の引数化**。現状は**エラー文字列マッチで @channel を抑制**しており（`gone_exception_message not in error_message`）、離脱通知の文面を変えた瞬間に判定が外れて**月400件規模の @channel が発火する** | **必須**（⑧ = @channelメンションなし） |
| `Onboarding-AI-API/app/services/notifications/ai_chat.py:71-111`（`create_alert_blocks`） | 同上（同一実装が両リポジトリにある） | **必須** |
| `Onboarding-AI-Server/src/functions/aiHint/main.py` | 離脱専用の通知関数 `notify_abandonment()` を新設（`notify_error`（`:262-277`）とは別）。タイトルは現在の `":warning: AIヒントサーバーでエラーが発生しました。"` では離脱に不適切なため変更。`mention_channel=False` で呼ぶ | **必須**（⑧） |
| `Onboarding-AI-API/app/services/notifications/ai_chat.py` | 離脱専用の `notify_ai_chat_abandonment()` を新設。呼び出しは `ai_chat_openai.py` / `ai_chat_dify.py` の `save_chat_log` 後、離脱フラグが立っている場合。`mention_channel=False` | **必須**（⑧ = チャットにも追加） |
| `Onboarding-AI-API/app/services/notifications/ai_chat.py:84` | API Gateway 時代の `GoneException` 判定残骸。AI-API は `post_to_connection` を使わないため一致しない。`mention_channel` 引数化と同時に撤去 | **必須**（引数化により不要になる） |

> **`handle_error` は使えない**
> 離脱通知を実装する場合、`handle_error` 経由にはできません。
> `handle_error` はクライアントへの error 送信とエラー戻り値も行うため、
> チャットでは `app/api/websocket/actions/ai_chat_openai.py:59-60` の早期 return でログ保存がスキップされ、
> ヒントでも `save_log` に到達しなくなり、離脱を記録する目的と矛盾します。
> **離脱専用の通知関数を新設**する必要があります。


### 2-5. 旧チャットの撤去（決定⑨）

#### 撤去して安全と確認できた根拠（調査記録 2026-08-13）

**1. `aiChatDify` ルートの実処理は稼働していない**

30日間（2026-07-14〜08-13）の Lambda メトリクス:

| 関数 | Invocations | Errors | Duration 平均 / 最大 |
|---|---|---|---|
| `aiServerAiChatOpenai-prod` | **0** | — | — |
| `aiServerAiChatDify-prod` | 12,223 | 0 | **27ms / 218ms** |
| `aiServerAiChatEvaluation-prod` | 75 | 0 | 1,307ms |
| `aiServerAiHint-prod` | 7,768 | 504 | 15,108ms |

Dify API を呼べば秒単位になるため、**最大218ms は AI処理が一度も実行されていないこと**を意味します。

**2. 12,223回の実体は AIヒントの接続ライフサイクル**

`ai-websocket-prod`（API ID `8hb23gp5n5`）の実際のルート統合:

| ルート | 統合先 |
|---|---|
| **`$connect`** | **aiServerAiChatDify-prod** |
| **`$disconnect`** | **aiServerAiChatDify-prod** |
| **`$default`** | **aiServerAiChatDify-prod** |
| `aiHint` | aiServerAiHint-prod |
| `aiChatOpenai` | aiServerAiChatOpenai-prod |
| `aiChatDify` | aiServerAiChatDify-prod |

`src/serverless.yml:31-34` は単一の WebSocket API（`websocketsApiName: ai-websocket-${stage}`）に4関数を載せており、
そのうち3つ（aiHint / aiChat-openai / aiChat-dify）が**全員 `$connect`・`$disconnect`・`$default` を宣言**しています。
1ルートに紐付く統合は1つのみなので、**定義順で最後の `aiChat/dify` が予約ルートを取得**していました。
`aiChat/dify/handler.py:26-28` が予約ルートを即座に返すため27msで終わります。

リクエスト経路:

```
onboarding-web  src/domain/hint/AiHintStrategy.ts:687   new WebSocket(this.websocketURL)
  └ :672  websocketURL = env.PATH.AI
      └ env/viewer_general_prod.js:16   AI: 'wss://ai.onboarding-app.io/'
          └ カスタムドメイン → API 8hb23gp5n5 (ai-websocket-prod)
              └ $connect / $disconnect → aiServerAiChatDify-prod   ★ ここ
```

件数も整合します。`aiHint` 7,768回/月に対し dify 12,223回/月。
1セッション = `$connect` + `$disconnect` の2回とすると約6,100セッションで、ヒント約1.27リクエスト/セッションとなり妥当な比率です。

**3. 現行チャットは別エンドポイントのため影響を受けない**

`Onboarding-AI-Chat/src/lib/constants/index.ts:63-64` に `aiChatOpenai` / `aiChatDify` というアクション名がありますが、接続先が異なります。

| | 接続先 | 実体 |
|---|---|---|
| 現行チャット（AI-Chat ライブラリ） | `wss://v2ai.onboarding-app.io`<br>（`constants/index.ts:82`） | `prod-onboarding-ai-api-alb-....elb.amazonaws.com`<br>＝ **AI-API（ECS/ALB）** |
| AIヒント（onboarding-web） | `wss://ai.onboarding-app.io` | API Gateway `8hb23gp5n5`<br>＝ **AI-Server** |

**アクション名は同じでも送信先が別システム**のため、AI-Server 側の `aiChat` 撤去は現行チャットに影響しません。

**4. `aiHint` が予約ルートを引き継げる**

`src/functions/aiHint/function.yml:16,18,20` で `$connect` / `$disconnect` / `$default` を宣言済みです。
`aiChat` の2行を削除すれば宣言するのは `aiHint` のみになり、自動的に引き継がれます。

#### 撤去作業

| # | 対象 | 内容 | 必須/任意 |
|---|---|---|---|
| 1 | `src/serverless.yml:32-33` | `aiChat/openai` と `aiChat/dify` の2行を削除 | **必須** |
| 2 | `src/functions/aiChat/` | ディレクトリごと削除（`openai/` `dify/` 各 `handler.py` `main.py` `function.yml`） | **必須** |
| 3 | `src/layers/custom-libs/python/validation.py:133` `:165` `:208-213` | 旧チャット用スキーマ（`AI_CHAT_OPENAI_SCHEMA` / `AI_CHAT_DIFY_SCHEMA`）と `validate_ai_chat_openai()` / `validate_ai_chat_dify()` | 任意（未使用コードになるだけで動作影響なし） |
| 4 | `src/layers/custom-libs/python/slack_utils.py:80` 付近 | 旧チャット由来の `GoneException` メンション抑制ロジック。`mention_channel` 引数化（§2-4）と同時に整理 | **必須**（§2-4 と同一作業） |
| 5 | 削除される Lambda | `aiServerAiChatOpenai-*` / `aiServerAiChatDify-*`。**ロググループは残る**ため必要なら手動削除 | 任意 |

#### 撤去による利点

`ai.send_openai_request` / `ai.send_dify_request` の呼び出し元が **`aiHint` のみ**になるため、
§2-2 で予定していた戻り値の dict / dataclass 化が**旧チャット2ファイルの同時修正なしで実施できます**。
⑨で「先に撤去」を選んだことで、後続の実装がむしろ簡単になります。

#### 撤去時のリスク

**`$connect` / `$disconnect` / `$default` の統合先が `aiChatDify` → `aiHint` に切り替わります。**
CloudFormation がルート更新と Lambda 削除を行う順序に依存するため、
切り替えの瞬間に新規接続が失敗する可能性があります。**必ず dev で先に実施し、接続確立を確認してください。**

確認コマンド:

```bash
API_ID=8hb23gp5n5   # prod。dev は ehcx3t1dvd
aws apigatewayv2 get-routes --profile onboarding --api-id $API_ID \
  --query 'Items[].{Route:RouteKey,Target:Target}' --output text | while read route target; do
  uri=$(aws apigatewayv2 get-integration --profile onboarding --api-id $API_ID \
    --integration-id "${target#integrations/}" --query 'IntegrationUri' --output text)
  printf "%-16s → %s\n" "$route" "$(basename ${uri%%/invocations})"
done
```

#### 今回スコープ外の残存物

別の WebSocket API が serverless.yml に定義なく残存しています。

| API 名 | ID | 作成日 | ルート |
|---|---|---|---|
| `chat-openai-websocket-prod` | `2sa5gc22j8` | 2024-05-16 | `aiChat` / `$connect` / `$disconnect` / `$default` |

`ai-websocket-prod` とは別物で、`Onboarding-AI-Server` にも該当する定義がありません。併せて棚卸しの対象になります。

---

## 3. 意思決定が必要な事項

### 3-1. 決定済み

| # | 論点 | 決定 |
|---|---|---|
| **①** | 定義文と実装のズレを許容するか。400/403/404 は加算されない | ✅ **2026-08-13 決定**：許容し、定義文を「プロダクトと設定が特定でき、上限内であることを確認した時点」に精緻化する。**実装変更なし**。確定文は §0-①、根拠は §2-1 |
| **②** | 離脱の記録形式（案A: `options` JSON / 案B: 独立カラム） | ✅ **2026-08-13 決定：案B（独立カラム）**。顧客が分析するための追加であるため。下流（batch / Athena / manage-api）の変更が必須になる。詳細と必須要件は §2-3 |
| **③** | 記録内容（カラム本数） | ✅ **2026-08-13 決定：(a) 離脱有無のみ（1列）**。送達チャンク数・総チャンク数は記録しない |
| **④** | CSVヘッダー名と値の表現 | ✅ **2026-08-13 決定（案3）：ヘッダー名「回答の到達状況」／値は3値「途中離脱」「最後まで到達」「記録開始前」**。データ層は `abandoned int`（1 / 0 / NULL）で確定 → §2-3 |
| **⑤** | CSVレコード数増加（ヒント側で約2.3%）の顧客への事前アナウンス | ✅ **2026-08-13 決定：(b) アナウンスしない** |
| **⑥** | 無駄送信の抑止を同時に入れるか | ✅ **2026-08-13 決定：(a) 同時に入れる**。チャット・ヒント両方に実装（§2-4） |
| **⑦** | `GoneException` 再発による Lambda 未処理例外の扱い | ✅ **2026-08-13 決定：(a) `raise_on_gone=False` で抑止。ただしログ出力は残す**（要件4）。対象は `send_end_of_message`（`main.py:107`）と **`send_error_message`（`response.py:51-64`／現在の主因）** の両方。`handler.py:36` に `GoneException` 限定の安全網も併設。詳細は §3-4 |
| **⑧** | Slack通知のスコープ | ✅ **2026-08-13 決定：離脱通知を継続 ＋ チャットにも追加 ＋ 既存チャンネルを継続（@channel メンションなし）**。チャンネル分離は行わない。`create_alert_blocks` の `mention_channel` 引数化が必須（§2-4）。留意点は §3-6 |
| **⑨** | 旧チャット（`aiChat/openai`・`aiChat/dify`）の扱い | ✅ **2026-08-13 決定：(b) 先に撤去する**。撤去により `ai.py` の戻り値変更が制約なく行えるようになり、後続実装が簡単になる。作業内容は §2-5、デプロイはフェーズ0（§5） |
| **⑩** | 「離脱」の判定境界（保存後の離脱は記録されない） | ✅ **2026-08-13 決定：(a) 許容**。本質はストリーミング中の離脱であり、保存位置の移動は行わない |
| **⑪** | バッファの扱い | ✅ **2026-08-13 決定：バッファ不要（廃止）**。改修により離脱起因の乖離が解消されるため。**ただし適用は改修リリース後**（§3-7） |
| **⑫** | デプロイ順序 | ✅ **2026-08-13 決定：別途 §5「デプロイ手順」に記載** |
| **⑬** | リリース前データが「離脱なし」と区別できない問題 | ✅ **2026-08-13 決定：④の案3採用により解消**。3値目の「記録開始前」で明示するため、空欄そのものが発生しない。顧客向けドキュメントへの適用開始日記載（旧 (c)）は**任意**。詳細は §3-3 |
| **⑭** | 離脱ログのレベル | ✅ **2026-08-13 決定：WARNING**（チャット・ヒント共通）。ヒントは `response.py:118` を `logger.info` → `logger.warning`。チャットは `base.py:38` を `logger.exception` → `logger.warning` にし、**`app_logging_prod.yaml` の `:10` / `:15` を ERROR → WARNING** に変更（`:20` root は ERROR 維持）。判断根拠は §3-5 |

### 3-2. 未決定

**番号付きの意思決定事項（①〜⑭）はすべて確定しました。** 以下は実装時に判断すればよい補助的な推奨事項です。

| 項目 | 内容 | 状況 |
|---|---|---|
| 構造化キー | 離脱ログに `product_id` / `hint_id` を付与するか（プロダクト別集計の可否に直結） | 未決定・推奨（§3-5） |
| アラーム | 改修後に Lambda Errors のアラームを新設するか | 未決定・推奨（§3-4） |
| 旧チャット用スキーマ | `validation.py` に残る旧チャット用スキーマ・関数を削除するか（動作影響なし） | 未決定・推奨（§2-5） |
| チャット400系の通知抑制 | ボットによる不正リクエスト由来の Slack 通知 126件/月 を止めるか | 未決定・推奨（§3-6） |
| 旧WebSocket API の棚卸し | `chat-openai-websocket-prod`（`2sa5gc22j8`・2024-05-16作成）が serverless.yml に定義なく残存 | 未決定・今回スコープ外（§2-5） |

### 3-3. ⑬ の背景：なぜ3値目「記録開始前」が必要か

④を「値2種＋空欄」（旧案）とした場合、空欄が2つの異なる意味を持つ問題がありました。

| 空欄の意味 | 発生する期間 |
|---|---|
| 離脱しなかった | リリース後 |
| **記録開始前（離脱かどうか不明）** | リリース前 |

**この影響はチャットとヒントで異なります。**

| | リリース前データに「実は離脱だった行」が含まれるか | 空欄＝離脱なし と読んで良いか |
|---|---|---|
| **ヒント** | **含まれない**。離脱時は `save_log` に到達せずレコード自体が存在しないため | 問題なし（ただしリリース前後で総レコード数が不連続になる＝⑤） |
| **チャット** | **含まれる**。離脱しても保存に到達するため、離脱行が空欄で混在する。実測 **2.38%** | **誤り**。期間をまたぐ離脱率分析で、リリース前が離脱0%に見える |

つまり**チャット側で、リリース日をまたぐ期間のCSVを顧客が分析すると離脱率を誤って算出**します。
⑤で事前アナウンスをしない決定のため、顧客は適用開始日を知る手段がありません。

**④で案3（3値）を採用したことで、この問題は解消されました。**
「記録開始前」という値がリリース境界をCSV上で明示するため、顧客は追加説明なしに対象期間を判断できます。
実装は CSV SQL 2ファイルの `CASE` のみで、バッチ・Athena テーブル定義には影響しません（SQL は §2-3）。

### 3-4. ⑦ の詳細：Lambda Errors は既に発生している

**当初「改修後に月190件立つ」と記載していましたが、実測すると改修前の現在すでに発生しています。**

| 指標（30日: 2026-07-14〜08-13・`aiServerAiHint-prod`） | 値 |
|---|---|
| Invocations | 7,768 |
| **Errors** | **504（エラー率 6.5%）** |
| 離脱（`handle_error` + `GoneException`） | 347 |

原因は現在の離脱フローです。`handle_error`（`main.py:252-259`）が `send_error_message`（`:257`）を呼び、
**離脱済みの接続に送信して `GoneException` が再発し raise される**ため、既に未処理例外になっています。
日別では離脱と概ね連動しますが 1:1 ではなく、離脱以外の要因も混在します（正確な内訳は追加調査が必要）。

**改修で変わるのはエラーの発生箇所だけです。**

| | 未処理例外の発生箇所 |
|---|---|
| 現在 | ストリーミングの `GoneException` → `handle_error` → **`send_error_message` で再発** |
| 改修後（抑止しない場合） | ストリーミングは握りつぶす → `save_log` 到達 → **`send_end_of_message` で再発** |

したがって⑦は「改修で新たに発生する問題の回避」ではなく、**既存のエラーノイズを解消する機会**です。
両方を抑止すれば Errors は真のエラー水準（月16件程度）まで下がります。

#### 安全性の確認（2点）

1. **Lambda のリトライは発生しません。** `src/functions/aiHint/function.yml` の通り API Gateway WebSocket 統合（`events: websocket: route: aiHint`）で同期呼び出し（RequestResponse）です。非同期呼び出しと異なりリトライされないため、**カウンタの二重加算やCSVの重複記録は起きません**。
2. **改修後もCSVレコードは失われません。** `send_end_of_message`（`main.py:107`）は `save_log`（`:104`）の**後**なので、ここで例外が出ても保存は完了しています。

#### アラームは存在しません（当初記載の訂正）

「既存のエラーアラート閾値の見直し要否を確認」と記載していましたが、**このLambdaにアラームは設定されていません**。

```
MetricAlarms 総数: 50 ／ ヒント関連アラーム: 0
AWS/Lambda 名前空間のアラーム: 1 → "Athena Partition Load Error"（別関数）
```

つまり504件/月のエラーは現状誰も気づいていない状態です。閾値見直しは不要で、
代わりに**改修後にアラームを新設するか**が検討事項になります（改修で真のエラーだけが残るため、低い閾値のアラームが実用的になります）。

### 3-5. ⑭ の判断根拠：離脱ログのレベルを WARNING にした理由

| 観点 | INFO | **WARNING（採用）** |
|---|---|---|
| 意味の妥当性 | 離脱はユーザーの正常な行動なので INFO が素直 | 「正常系ではないが異常でもない」＝カウンタは加算済み・トークンは消費済みなのに価値が届いていない、という劣化した結果を表せる |
| 抽出しやすさ | ヒントの30日ログは約40,000イベントで大半が INFO（`matched_hint: {...}` 等）。文字列検索が必須 | `filter level = "WARNING"` でほぼ純粋に離脱だけ取れる |
| 耐久性 | Powertools は `LOG_LEVEL` 環境変数で運用中に引き上げ可能。**上げられると消える** | 引き上げ耐性がある |
| 両プロダクトの統一 | チャットは prod が ERROR-only なので設定を INFO まで下げる必要がある（INFO 31箇所が全て出るようになる） | チャットは WARNING まで下げれば済む（増えるのは `http_client.py` のリトライ警告等、WARNING は14箇所のみ） |
| 運用への影響 | — | WARNING を「要対応」と運用している場合は月約350件がノイズと解釈される恐れ。ただし**現状 Lambda のアラームは存在しない**ため実害はない（§3-4） |

**決め手は耐久性。** 要件4が「記録したい」である以上、運用でレベルを引き上げられたら消える INFO は要件に対して脆いと判断しました。
またチャット・ヒントを同一レベルに揃えることで、両プロダクトで同じクエリ（`filter level = "WARNING"`）が使えます。

#### レベルより重要: 構造化キーの追加（未決定・推奨）

現在の離脱ログは `connection_id` しか持たず、**どのプロダクトの離脱かを特定できません**（handoff §9 の課題）。
レベルの選択より、こちらの方が効果が大きいです。

```python
# ヒント: aiHint/handler.py または main.py の入口で
logger.append_keys(product_id=payload.get("productId"), hint_id=payload.get("hintId"))
```

これにより `stats count() by product_id` でプロダクト別の離脱数が直接集計でき、
CSVを顧客ごとにダウンロードせずに社内で傾向を把握できます。
チャット側（`app/utils/logger.py` は素の `logging`）は Powertools 相当の仕組みがないため、
ログメッセージに `chat_setting_id` を含める形が現実的です。

### 3-6. ⑧ の留意点：既存チャンネル継続を選んだことによる影響

チャンネル分離をしない決定のため、既存のエラーチャンネルには以下が流れます。

| 内容 | 月間件数 |
|---|---|
| ヒントの離脱通知 | 約190〜350 |
| **チャットの離脱通知（新規追加）** | **約215** |
| チャットの400系（ボット等の不正リクエスト・既存） | 約126 |
| **ヒント・チャットの実エラー（対応が必要なもの）** | **約16〜20** |
| 合計 | **約550〜700（約18〜23件/日）** |

**対応が必要な通知は全体の約3%になります。** @channel メンションを外すことで割り込みは避けられますが、
「見るべき通知を見つける」運用は難しくなります。以下のいずれかで補うことを推奨します。

- 通知タイトルで判別できるようにする（離脱通知と実エラー通知でタイトル文言・絵文字を明確に分ける）
- Slack のキーワード通知やフィルタを各自で設定する
- 将来的にチャンネル分離を再検討する

なお、チャットの400系126件/月はボットによる不正リクエストで対応不要のため、
**この通知自体を抑制する**（`action_handler.py:36-73` の400系で `notify` を呼ばない）だけでも
ノイズが2割減ります。⑧とは独立して検討可能です。

### 3-7. ⑪ の留意点：バッファ廃止の適用タイミング

**バッファ廃止は改修リリース後に適用してください。** 改修前に廃止すると、現在の乖離（ヒント2.49%）がそのまま露出します。

改修後も**乖離はゼロにはなりません**。残るのは実エラー起因のみで、実測ベースでは以下の水準です。

| | 改修後に残る乖離（実エラーのみ） |
|---|---|
| ヒント | 0.19%（16件/月） |
| チャット | 0.05%（2件/13日） |

バッファなしの場合、この月16件程度は「カウンタは加算されたがCSVに残っていない」件数として残ります。
顧客から指摘された際は許容誤差としてではなく**個別に調査・説明する**運用になる点をご認識ください。
0.2%程度であれば個別対応で足りるという判断は妥当です。

**リリース後の確認手順**は §5 のフェーズ4に記載しています。

### 残作業の状況

**番号付きの意思決定事項（①〜⑭）はすべて確定しました。全リポジトリの実装に着手できます。**

未確定なのは §3-2 の補助的な推奨事項（構造化キー・アラーム新設・旧スキーマ削除・400系通知抑制・旧API棚卸し）のみで、
いずれも実装をブロックしません。

進め方は §5「デプロイ手順」のフェーズ0〜4に従ってください。
**フェーズ0（旧チャット撤去）が最大のリスク**で、AIヒントの WebSocket 接続の予約ルート統合先が切り替わるため、
必ず dev で先に検証してください。

---

## 4. 補足

### 4-1. 改修後は計測方法が変わる

改修後、離脱は `handle_error` を通らなくなるため **CloudWatch では現行の方法で計測できなくなります**。
CSV／Athena の離脱フラグが唯一の集計元になります。

参考：改修前の計測クエリ（ベースライン取得用）

```
# チャット（ロググループ: /ecs/prod-onboarding-ai-api）
filter @message like /WebSocket message send failed/
| fields (@message like /Cannot call/) as is_subseq
| stats sum(1 - is_subseq) as abandoned, sum(is_subseq) as wasted_chunks, count() as total by bin(1d)

# ヒント（ロググループ: /aws/lambda/aiServerAiHint-prod）
filter @message like /Failed to send request to/ and @message like /GoneException/
| stats count() as abandoned
```

チャットは Starlette が送信時の `OSError`（内部は `ConnectionClosedOK` 等）を
`WebSocketDisconnect(code=1006)` に包み `application_state` を DISCONNECTED にするため、
**1離脱 = 初回検知1件（メッセージ空）＋ 後続 `RuntimeError` N件** という構造になります。
初回検知の件数が離脱リクエスト数です（時間クラスタリングでも一致を確認済み）。

### 4-2. 検知精度について

チャットは uvicorn/Starlette がクローズ後の送信を捨てる経路があり得るため検知漏れを懸念していましたが、
実測でヒント（2.30%）とほぼ同率（2.38%）だったため、**検知漏れは実質なく、両者を同一精度の指標として扱ってよい**と判断できます。

### 4-3. 改修による副次効果

| 項目 | 効果 |
|---|---|
| カウンタ↔CSV 乖離 | ヒント乖離206件のうち190件が解消し、**実エラーのみの水準（0.19%）へ収束** |
| バッファ | 5% → **1%未満**で足りる見込み |
| Slack通知 | ヒントの離脱通知（月190件）がエラー扱いから外れる |
| ログ量 | 無駄送信の抑止（意思決定⑥）により、離脱関連ログが 1/56 に減少 |
| AI課金 | 離脱後もストリームは読み切るため、completion トークンの課金は現状と変わらない（打ち切れば削減できるが `ai_response` が途切れトークン使用量も取得できなくなるため採用しない） |

**トレードオフ（⑥(a) と ③(a) の組み合わせ）**
離脱検知後に送信を止め（⑥(a)）、かつチャンク数を記録しない（③(a)）ため、
**リリース後は「回答のどこで離脱したか」を知る手段がなくなります**（現状はログ行数から推定できる）。
離脱の有無のみを分析対象とする方針であれば問題ありません。将来必要になった場合はカラム追加で対応します。

### 4-4. 意思決定①の調査で判明した付随事項

| 事項 | 内容 | 関連 |
|---|---|---|
| チャット400系のSlack通知 | `action` 欠落53件＋スキーマ不正6件（14日）＝**約126件/月**が `handle_error` 経由でプロダクトID=Unknown のSlack通知として飛んでいる。ボット等の不正リクエストで対応不要 | 意思決定 ⑧（チャンネル設計・通知抑制） |
| ヒント離脱件数の増加傾向 | 2026-07-14〜08-13（30日）の離脱は**347件**で、前回測定の190件（07-07〜08-06）から増加。分母（Lambda Invocations）未取得のため率は未確定 | バッファ提案（5%）の前提。**改修リリース後の再測定時に併せて確認** |

### 4-5. 今回スコープ外の残課題（handoff §5 より）

- `get_dify_hints` がDBエラー時に `False` を返し後続 `TypeError`（ヒント・加算後のため乖離要因）
- S3保存失敗の握りつぶし（チャット・ヒント）＝200正常終了でエラーに見えない
- 月次リセットのTZ境界（AI-API・`last_reset_at` UTC保存 vs JST比較で1日ズレの恐れ）
- 上限到達時の手動再送による二重加算（冪等キー導入 or 許容）
- `custom_query_list is None` 344件/13日＝CSVのユーザー属性が空になる品質課題
- ヒント集計バッチの README 記載時刻ズレ（実際は JST 02:00、README は 3:00）

---

## 5. デプロイ手順（意思決定⑫）

**この順序は必須です。** 逆順で進めると復旧不可能なデータ欠損、または顧客のCSVダウンロード障害が発生します。

| フェーズ | 対象 | 前フェーズより先に実施できない理由 |
|---|---|---|
| **0** | **Onboarding-AI-Server の旧チャット撤去** | フェーズ2で `ai.py` の戻り値を変更するため、**先に撤去しておかないと旧チャット2ファイルの同時修正が必要になる**（決定⑨） |
| 1 | onboarding-batch ＋ Athena | アプリを先に出すと、batch の `reindex` が未知の列を落とし、**その期間の離脱情報は復旧できない** |
| 2 | Onboarding-AI-API / Onboarding-AI-Server | — |
| 3 | onboarding-manage-api | 列が存在しない状態で CSV SQL が `abandoned` を参照すると Athena がエラーになり、**顧客のCSVダウンロードが失敗する** |
| 4 | 事後確認・バッファ廃止 | 実データが揃わないと確認できない |

フェーズ0と1は互いに独立しているため**並行して進められます**（対象リポジトリが異なる）。

### フェーズ0: 旧チャットの撤去（AI-Server）

作業内容と根拠は §2-5 を参照。

1. `src/serverless.yml:32-33` の2行を削除
2. `src/functions/aiChat/` をディレクトリごと削除
3. **dev に先にデプロイ**し、以下を確認
   - `$connect` / `$disconnect` / `$default` の統合先が `aiServerAiHint-dev` に切り替わっていること（確認コマンドは §2-5）
   - `onboarding-web` から AIヒントの **WebSocket 接続が確立でき、回答が返ること**
4. dev で問題なければ prod にデプロイし、同じ確認を実施

> **⚠️ 最大のリスクはここです。** 予約ルートの統合先が `aiChatDify` → `aiHint` に切り替わるため、
> CloudFormation の処理順によっては切り替えの瞬間に新規接続が失敗し得ます。
> **アクセスの少ない時間帯に実施**し、直後に接続確認を行ってください。

### フェーズ1: onboarding-batch ＋ Athena（先行必須）

1. `src/ai_chat_logs/functions/aggregate.py` を修正
   - `:173-182` `expected_columns` の**末尾**（`options` の後）に `abandoned` を追加
   - `:159-170` `ensure_column_exists(chunk, "abandoned", None)` を追加（**デフォルトは `None`。`0` にしない**）
   - `:383` `CREATE EXTERNAL TABLE` の末尾に `abandoned int` を追加
2. `src/ai_logs/functions/aggregate.py` を修正
   - `:122-129` `expected_columns` の末尾に `abandoned` を追加
   - `:174-194` 付近に `abandoned` の `None` 正規化を追加（**`fillna(0)` にしない**。未対応だと文字列 `"nan"` が入る）
   - `:287` `CREATE EXTERNAL TABLE` の末尾に `abandoned int` を追加
3. デプロイ
4. **手動で `ALTER TABLE` を全環境の両テーブルに実行**（`CREATE TABLE IF NOT EXISTS` は既存テーブルに効かないため）

```sql
-- {env} は dev / prod など利用中の全環境。計4テーブル以上が対象
ALTER TABLE {env}_onboarding_ai_chat_logs_db.ai_chat_logs ADD COLUMNS (abandoned int);
ALTER TABLE {env}_onboarding_ai_logs_db.ai_logs ADD COLUMNS (abandoned int);
```

5. 確認: 翌日のバッチ実行後、Athena で `abandoned` が参照でき**全行 NULL** になっていること

> この時点ではアプリが値を書かず、CSV SQL も未変更のため**顧客への影響はありません**。

### フェーズ2: アプリ（AI-API / AI-Server）

**Onboarding-AI-Server**（変更内容は §2-2）

1. `src/layers/custom-libs/python/response.py` — `raise_on_gone` 引数追加、`:118` を `logger.warning` に、`send_message` の戻り値化
2. `src/layers/custom-libs/python/ai.py` — ストリーミングループで送信結果を拾い離脱情報を返す。**離脱検知後は送信をスキップし、ストリームは読み切る**（要件2）。フェーズ0完了後は呼び出し元が `aiHint` のみになるため、戻り値の dict / dataclass 化を制約なく実施できる
3. `src/functions/aiHint/main.py` — 離脱を `except` で捕まえない／`generate_log_data`（`:197`）に `abandoned` 追加／`send_end_of_message`（`:107`）を `raise_on_gone=False`／離脱専用の `notify_abandonment()` 新設
4. `src/functions/aiHint/handler.py:36` — `GoneException` 限定の安全網
5. `src/layers/custom-libs/python/slack_utils.py` — `create_alert_blocks` に `mention_channel: bool = True`

**Onboarding-AI-API**（変更内容は §2-3・§2-4）

1. `app/api/websocket/messaging/base.py` — `send_failed` フラグ追加、離脱後の送信・ログを抑止、`:38` を `logger.warning` に
2. `app/logging_config/app_logging_prod.yaml` — `:10` `:15` を ERROR → WARNING（`:20` root は ERROR 維持）
3. `app/services/analytics/chat_logs.py:122` — ログエントリに `abandoned` 追加
4. `app/api/websocket/actions/ai_chat_openai.py` / `ai_chat_dify.py` — `create_chat_log_entry` に離脱情報を渡す／離脱通知の呼び出し追加
5. `app/services/notifications/ai_chat.py` — `notify_ai_chat_abandonment()` 新設、`create_alert_blocks` に `mention_channel` 追加、`:84` の残骸撤去

**前提**: フェーズ0で旧チャットを撤去済みであること。撤去後は `response.py` / `ai.py` の呼び出し元が
`aiHint`（および `aiChatEvaluation`。ただし `send_*` は未使用）のみになるため、**共有レイヤーの変更に制約はありません**。
なお `raise_on_gone` のデフォルトは `True`（＝従来挙動）にしておくのが安全です。

**確認（デプロイ翌日）**

- Athena で `abandoned` が `0` / `1` で入っていること（NULL のままでないこと）
- CloudWatch で離脱ログが WARNING レベルで**1リクエスト1件**出ていること
- Lambda Errors が減少していること（改修前 504件/30日 → 真のエラー水準へ）
- Slack に離脱通知が届き、**@channel メンションが付いていない**こと

### フェーズ3: onboarding-manage-api（最後）

1. `api/rest/functions/mng-v1-report/athena-queries/ai_chat_message_sent_user.sql` の末尾（`options AS "その他"` の後）に追加

```sql
, CASE WHEN abandoned = 1 THEN '途中離脱'
       WHEN abandoned = 0 THEN '最後まで到達'
       ELSE '記録開始前' END AS "回答の到達状況"
```

2. `ai_hint_message_sent_user.sql` にも同様に追加
3. デプロイ

**⚠️ 検証時のキャッシュ注意**: `mng-v1-report/method_get.py:85-99` は「期間＋終了時刻」が同一のファイルが S3 にあると再クエリせずキャッシュを返します。
**リリース後も既存期間は旧CSVが返る**ため、検証時は期間をずらすか S3 のキャッシュファイルを削除してください。

**確認**

- リリース日以降の期間で「途中離脱」「最後まで到達」が出ること
- リリース日より前の期間で「**記録開始前**」が出ること（空欄や `nan` になっていないこと）

### フェーズ4: 事後確認とバッファ廃止

1. リリース後1か月程度の実データで再測定
   - 離脱率（CSVの `abandoned` 列から算出。CloudWatch では計測不可になっている）
   - 乖離率（カウンタ ↔ CSV。実エラーのみの水準に収束しているか）
2. 上記で乖離が想定水準（0.2%程度）に収まっていることを確認後、**バッファを廃止**（→ 意思決定 ⑪・§3-7）
3. Lambda Errors のアラーム新設を検討（真のエラーだけが残るため低い閾値が実用的になる・§3-4）

### ロールバック方針

| フェーズ | 切り戻し可否 |
|---|---|
| 1 | 列を追加しただけなので影響なし。切り戻し不要（`ALTER TABLE ... DROP COLUMN` も不要） |
| 2 | アプリのみ切り戻せば元の挙動に戻る。既に書かれた `abandoned` は残るが害はない |
| 3 | CSV SQL を戻せば列が消えるだけ。データは残る |

**フェーズ2を切り戻した期間は `abandoned` が NULL になり、CSV上は「記録開始前」と表示されます。**
長期間の切り戻しは顧客の分析に影響するため、その場合は表示方針の再検討が必要です。
