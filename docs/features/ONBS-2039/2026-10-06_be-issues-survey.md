# 管理 API（onboarding-manage-api）で見つかった問題の調査

ONBS-2039（管理画面のログイン・パスワード系とお知らせ系のリファクタ、onboarding-manage-web PR #1222）をレビューする中で、FE が前提にしている BE の挙動をコードで突き合わせた。
その過程で見つかった**管理 API 側の問題**をここにまとめる。ONBS-2039 の範囲外で、別チケットで扱う想定。

起票用の概要は [2026-10-06_jira-summary.md](./2026-10-06_jira-summary.md)。

## 調査の前提

- 対象: `onboarding-manage-api` origin/main `29b9fd2b`（本番相当）。パスは `api/rest/` からの相対
- 方法: **コードを読んだだけ**。実 API へのリクエストや、試しての再現はしていない。WAF・API Gateway の設定と DB の実データは見ていない
- 例外: DynamoDB の TTL 設定だけは AWS に読み取りで照会した。dev・本番の `api_token` / `refresh_token` テーブルとも ENABLED

## 一覧

| # | 区分 | 概要 | 確度 |
|---|---|---|---|
| [BE-1](#be-1) | セキュリティ・優先 | カスタムイベントの作成・更新で、本文のキーがそのまま SQL の列名に入る | コードで確認。試してはいない |
| [BE-2](#be-2) | セキュリティ | `/user/tfa/confirm` で一時トークンの期限が効いていない | コードで確認 |
| [BE-3](#be-3) | セキュリティ | 認証コードの確認 API に試行回数の制限がなく、使ったコードも消さない | コードで確認。WAF 等は未確認 |
| [BE-4](#be-4) | セキュリティ・低 | `/pw/reminder` の応答で、メールアドレスの登録有無が分かる | コードで確認 |
| [BE-5](#be-5) | 不具合 | `/pw/invited` で、招待トークンを commit 前に消している | コードで確認。発生頻度は推測 |
| [BE-6](#be-6) | 不具合 | カスタムイベント作成の応答が、作ったイベントとは限らない | コードで確認。発生条件は推測 |
| [BE-7](#be-7) | 不具合 | `GET /v1/report` の権限なしが 500 になる | コードで確認 |
| [BE-8](#be-8) | 軽微 | `'joinied'` の綴り違い、招待の再送で使われないトークンが残る | コードで確認 |

---

## BE-1

**カスタムイベントの作成・更新で、本文のキーがそのまま SQL の列名に入る**

### 現状

- 入力の検証（`layers/python/lib/validation.py:1662-1708` の `custom_events`）は、必須キーがそろっているかしか見ない。
  - 必須キーは `title` / `event_type` / `element` / `url` / `url_comparison_option` / `is_public` の 6 つで、PUT は `change_is_public` を足した 7 つ。
  - `if not params.keys() >= required_keys`（L1674）でそろっているかを見たあと、検証する文書を `document = {key: params[key] for key in required_keys}`（L1706）と**必須キーだけで組む**。
  - そのため、**余分なキーは検証されずに通る**。
- 作成（POST）は、本文の全キーを列名にして INSERT を組む。
  - `functions/mng-v1-products/product_id/custom-events/method_post.py:39-55` の `_generate_insert_params` が、`request_params` のすべてのキーを辞書に詰める。
  - `:58-67` で `INSERT INTO custom_events ({columns_query}) VALUES (...)` を f-string で組む。
  - 値はプレースホルダ（`%s`）だが、**列名は無防備**。
- 更新（PUT）も同じ形。
  - `method_put.py:97-119` の `_generate_update_params` が本文の全キーを詰める。
  - `layers/python/lib/db_query.py:22` が `f"{key} = %s"` で SET 句を組む。
  - WHERE は URL の `product_id` / `custom_event_id` で絞る（`method_put.py:122-125`）。

### 影響

プロダクトにアクセスできるログイン済みの利用者なら、次のことを試せる形になっている（**推測。試してはいない**）。

- 本来は API で変えられない列（`is_deleted` など）を書き換える
- PUT の本文に `product_id` を入れて、イベントを別のプロダクトへ移す
  - サーバーが上書きするのは `updated_by` / `updated_at` / `published_at` / `privated_at` だけで、`product_id` は上書きしない
- キー名の部分に SQL を書いて注入する

管理画面（FE）は 6〜7 キーちょうどを送っているので、通常の利用では起きない。

### 推奨

- 管理 API で列の許可リストを持ち、検証したキーだけで INSERT / UPDATE を組む。
- 同じ `db_query.generate_update_query_and_values` を使う API は、ほかに `functions/mng-v1-ai-hint-widgets/method_put.py:208` だけ。こちらは列を固定の 5 つで組んでいる（`:149-164`）ので、同じ問題は無い。ほかの API で、本文の辞書をそのまま SQL の列名にしている箇所が無いかは、まだ網羅的に調べていない。
- （任意・FE）管理画面の `buildCustomEventSavePayload`（onboarding-manage-web `app/services/customEventService.ts:105-108`）は `...form` を展開して本文を組んでいる。送るキーを明示して組むと、FE 側の取り違えが BE に届かない。

---

## BE-2

**`/user/tfa/confirm` で一時トークンの期限が効いていない**

### 現状

- `layers/python/lib/common.py:179-219` の `get_tfa_token_data` は、ログイン中（API トークンが有効）でユーザーが一致すると、その時点で `res_token_data` に一時トークンを入れる（L200-201）。
  - そのあと期限を比べて期限切れなら `error_type` を `expired` にするが（L205-210）、**入れた `res_token_data` は消さない**。
- `layers/python/lib/handler.py:9-10` の `check_tfa_authentication` は、`token` が None でないかしか見ない。
- このため、2要素認証を有効にする確認（`POST /v1/user/tfa/confirm`）では、**期限（発行から 1 時間）を過ぎた一時トークンでも通る**。
  - 実際に使えなくなるのは、DynamoDB の TTL で項目が物理削除されたとき。TTL の削除には遅れがある。
- ログイン時の確認（`/auth/tfa/confirm`）は API トークンを付けないので、L200-201 を通らず、期限は効いている。

### 推奨

期限切れを検出したら `res_token_data` を空に戻す（ユーザー不一致のときと同じ扱いにする）。

---

## BE-3

**認証コードの確認 API に試行回数の制限がなく、使ったコードも消さない**

### 現状

- 次の 3 つの確認 API には、Lambda のコード上で試行回数の制限が無い。コードは 6 桁（90 万通り）。
  - ログイン時の確認 `POST /v1/auth/tfa/confirm`（`functions/mng-v1-auth/tfa/confirm/method_post.py:11-22`）
  - 2要素認証を有効にする確認 `POST /v1/user/tfa/confirm`（`functions/mng-v1-user/tfa/confirm/method_post.py:12-16`）
  - パスワード再設定 `POST /v1/pw/reset`（`functions/mng-v1-pw-reset/method_post.py:32-53`）
- コードの生成
  - 2要素認証: `layers/python/lib/common.py:295` の `random.randint(100000, 999999)`
  - パスワード再設定: `functions/mng-v1-pw-reminder/method_post.py:41-42` の `random.randrange(10**5, 10**6)`
- 使ったコード・トークンを消していない。
  - `/pw/reset` は、成功しても使ったコードを消さない（`method_post.py:49` のあとに削除処理が無い）。期限（10 分）までは同じコードで何度でも再設定できる。
  - `/auth/tfa/confirm` は、成功しても一時トークンを消さない。期限（1 時間）までは同じコードで何度でもトークンの組を取り直せる。
- パスワード再設定のコードは、DynamoDB の `pw_reset_code` テーブルに**コード自体をキーにして**保存している（`mng-v1-pw-reset/method_post.py:31-32`）。
  - 再送しても前のコードは消えず、期限内ならどちらのコードでも通る。
  - 別のユーザーと同じコードが出ると、あとから保存した方で上書きされる（頻度は低い）。

### 推奨

- WAF・API Gateway 側に試行回数の制限があるかを確認する。無ければ、一定回数の失敗で一時トークン・コードを無効にする。
- 使ったコード・一時トークンは、成功時に消す。

---

## BE-4

**`/pw/reminder` の応答で、メールアドレスの登録有無が分かる**

### 現状

`POST /v1/pw/reminder` は、未登録・削除済みのメールアドレスに 404 を返し、登録済みなら 200 を返す（`functions/mng-v1-pw-reminder/method_post.py:22-25`、`layers/python/lib/common.py:623-653`）。

管理画面は 404 も成功として扱い、画面の文言をそろえている。ただし API を直接呼べば、ステータスで登録の有無が分かる。

### 推奨

未登録でも 200 を返す。

---

## BE-5

**`/pw/invited` で、招待トークンを commit 前に消している**

### 現状

`POST /v1/pw/invited`（招待されたユーザーのパスワード設定、`functions/mng-v1-pw-invited/method_post.py`）は、次の順に処理する。

1. パスワードを更新する（L70）
2. 招待トークンを DynamoDB から消す（L72）
3. `db.commit()`（L74）
4. try を抜けたあと、応答用にユーザーとプロダクトを取得する（L83-84）

### 影響

- commit が失敗した場合: DB は rollback されるが、トークンは消えたままになる。パスワードは未設定のまま 500 になり、押し直すと 404 で先へ進めない。
- 4 の取得で例外が出た場合: パスワードは確定し、トークンも使用済みのまま 5xx になる。
  - main の `get_product_with_id` は、該当が無いと IndexError を出す（`layers/python/lib/common.py:934`）。
  - 管理画面には「設定できませんでした」と出て、押し直すと 404 になる。
  - 直前にプロダクトの存在を確かめているので、起きるのは競合したときだけ（推測）。

### 推奨

トークンの削除を commit のあとへ移し、応答用の取得を try の中へ入れる。

---

## BE-6

**カスタムイベント作成の応答が、作ったイベントとは限らない**

### 現状

`POST /v1/products/{product_id}/custom_events/` の応答は、同じプロダクトで `ORDER BY custom_event_id DESC LIMIT 1` の 1 件（`functions/mng-v1-products/product_id/custom-events/method_post.py:96-100`）。

### 影響

同じプロダクトで同時に作成が走ると、別の人が作ったイベントを返しうる（分離レベル次第の推測）。

管理画面は、この応答を一覧に足す。施策成果の画面からイベントを作った場合は、返ってきたイベントを紐づけ先にする。

### 推奨

INSERT した行の ID（`cursor.lastrowid` など）で引き直す。

---

## BE-7

**`GET /v1/report` の権限なしが 500 になる**

### 現状

プロダクトの権限が無いときに `common.response_401()` を引数なしで呼んでいる（`functions/mng-v1-report/method_get.py:63-66, 104-106`）。`response_401` は引数が必須（`layers/python/lib/common.py:1789`）なので TypeError になり、`except` に拾われて 500 になる。

### 推奨

引数を渡す。あわせて、401 と 403 のどちらが妥当かを決める。

---

## BE-8

**`'joinied'` の綴り違い、招待の再送で使われないトークンが残る**

### 現状

- `functions/mng-v1-pw-invited/method_post.py:131` の `up.status != 'joinied'` は綴りが違い、条件として常に真になる。
  - 使える招待トークンを持っていれば、参加済みのユーザーでもパスワードを上書きできる。
  - トークンはメールの宛先しか持っていないので、影響は小さい。
- 招待の再送（`functions/mng-v1-product-users-invitation/method_put.py:29-37`）は、`invite_token.search(user_id, product_id)` で既存のトークンを探す。
  - 実際にメールに載るトークンは、すべて `generate(user_id, "", product_ids)` で作られ、`product_id` が空（`layers/python/lib/mail.py:93-95`）。そのため検索は一致しない。
  - 再送のたびに、メールに載らない（使われない）トークンを作って DynamoDB に残す。TTL で消える。

### 推奨

- 綴りを `'joined'` に直す。
- 再送は `product_ids` で探すか、単一形式のトークンを作らないようにする。

---

## 参考（問題とまでは言えないが、読んでいて分かったこと）

- **古いリフレッシュトークンの猶予**
  - 再発行（`PUT /v1/auth/refresh`）は、古いリフレッシュトークンの `ttl` を 60 秒後に上書きするだけで、`expire` は変えない（`functions/mng-v1-auth-refresh/method_put.py:24-31`）。
  - 読み取りは `expire` しか見ない（`layers/python/lib/common.py:166-172`）。そのため、古いリフレッシュトークンは DynamoDB が物理削除するまで使える。
  - 猶予は「60 秒」ではなく「最短 60 秒」。同時の再発行には安全側に働くが、使い回しの検知にはなっていない。
- **書き込みの例外の扱い**: `dynamodb.insert` は書き込みの例外を握りつぶす（`layers/python/lib/dynamodb.py:64-72`）。そのため、保存されていないトークンを 200 で返しうる。
- **例外が 401 になる**: DynamoDB や DB の一時的な例外が 401 として返る（`layers/python/lib/common.py:173-175`、POST /auth は `:800-850`）。FE からは、本当にトークンが無効な場合と区別できない。
- **パスワード確認欄の一致**: `/pw/invited` と `/pw/reset` は、パスワードと確認用パスワードが一致するかを検証していない。一致は管理画面の入力チェックだけが担保している。
- **ログアウトは常に 200**: `DELETE /v1/auth` は認証を確かめずに常に 200 を返す。有効期限内のトークンだけを、それぞれ独立に消す（`functions/mng-v1-auth/method_delete.py:6-28`）。不具合ではなく、管理画面はこの挙動を前提にしている。
