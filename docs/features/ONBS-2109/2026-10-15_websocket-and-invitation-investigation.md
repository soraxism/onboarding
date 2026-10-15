# 不正アクセス（ONBS-2109）追加調査 — WebSocket・招待メール・停止後の監査

- 調査日: 2026-10-15（7章は同日 10:35 時点）
- 既存資料: `08_影響まとめ.md`（2026-10-14 作成）
- 時刻はすべて JST。日付の無い時刻は 2026-10-14
- 本書は既存資料に **無い項目（WebSocket）** と、**訂正が必要な項目（招待メール・作成ユーザー数）** を扱う

## 0. 結論

1. **WebSocket 経由の情報流出・ガイド改ざんは無い。** 攻撃者は接続してガイド編集画面を10回開いたが、
   ガイド本文を返す API は呼んでおらず、書き換え系ルートは一度も実行していない（2章）
2. **招待メールは実際に送信された。** SES の送信統計で裏が取れた。
   既存資料の「宛先4種・11件」は送信試行ではなく**実送信**だった（3章）
3. **攻撃者が作成したユーザーは 3 件ではなく 12 件。** 全て `is_deleted=0` で現在も残っている（4章）
4. **残存リスクは ext-viewer 経由のトークン再取得。** 上記12ユーザーが残る限り、
   メール認証でトークンを取得し WebSocket でガイドを改ざんできる構造がある（5章）
5. 緊急対応は不要。現在 `api_token` / `refresh_token` とも 0 件で、接続経路は塞がっている（6章）
6. **管理画面停止後（10/14 12:46〜10/15 10:35）に不審なリクエストは無い。** manage-api は 13:00 以降の到達ゼロ、WebSocket の新規接続試行は全て Deny、ext-viewer でのトークン再取得も発生していない（7章）

## 1. 調べたログ

| 対象 | 場所 | 備考 |
|---|---|---|
| WebSocket の監査ログ | CloudWatch Logs `/aws/lambda/mngV1SyncGuide*-prod`（15グループ） | **既存資料では未調査** |
| 招待系 API の監査ログ | `/aws/lambda/mngV1{UsersInvite,UsersUserIdInvite,ProductUsersInvitation,...}-prod` | |
| SES 送信統計 | `aws ses get-send-statistics` | 実送信の裏取りに使用 |
| DynamoDB | `api_token` / `refresh_token` / `connections_prod` | 実スキャン |
| 本番 DB ダンプ | `onboarding.sql`（10/14 15:09 エクスポート、39GB） | users / user_products / products / accounts_users / roles |
| 停止後の全 API | CloudWatch メトリクス（Count / 4XXError / ConnectCount / MessageCount）＋各 Lambda の監査ログ | 7章 |

## 2. WebSocket（既存資料に記載なし）

### 2-1. 攻撃者は接続していた

ログイン（02:20:30）の約6分後から動いている。

| 時刻 | 操作 |
|---|---|
| 02:26:14 | `$connect`（ここから） |
| 02:26:16 | `guideEditScreenInit` |
| 02:44:20 / 02:44:29 / 02:44:39 / 02:44:49 / 02:44:58 / 02:45:07 | `$connect` を約9〜10秒間隔で6連続 |
| 02:45:16 | `$disconnect`（ここまで） |

合計: `$connect` 14、`$disconnect` 14、`guideEditScreenInit` 10、`keepAlive` 1。
authorizer の `$connect` 試行は15回で、Deny 1回（`No API token data in dynamodb`）、Allow 14回。

等間隔の6連続は人手の操作では出ない。自動化スクリプトによる攻撃面の列挙とみられる。

### 2-2. それでも流出も改ざんもしていない

**理由1: `guideEditScreenInit` はガイド本文を返さない**

`api/websocket/functions/mng-v1-sync-guide-screen-connection/route_guideEditScreenInit.py`

```python
response_data = {
    "type": "guide_edit_screen_init",
    "action": ACTION_NAME,
    "users": users_data_list,   # 同時編集者の id / name / profile_img_url / is_system_admin
    "locked": locked            # ロック中の block_id / goal_id / user_id
}
return common.broadcast_data(broardcast_user_items, response_data)
```

返すのは同時編集者のプレゼンス情報とロック状態のみ。`json_src`・steps・blocks は含まれない。
`broadcast_data` は同じガイドを開いている接続に配るもので、深夜2時台に同時編集者がいた可能性は低く、
実質は自分（`user_id=1`）の情報が返っただけとみられる。

**理由2: 書き換え系ルートが全て0件**

攻撃時間帯（02:00〜07:00）のロググループ別イベント数。

| ロググループ | 件数 |
|---|---|
| `mngV1SyncGuideAuthorizer-prod` | 48 |
| `mngV1SyncGuideScreenConnection-prod` | 165 |
| Json / Block / Step / Goal / Intro / Target / Tour / Category / Hint / HintWidget / OnbFloat / OnbFloatGroup / PublishSetting | **すべて 0** |

`jsonSave`・`blockSave`・`stepOptionsSave`・`introContentBlockSave`・`publishSettingPublish` は
一度も呼ばれていない。XSS 埋め込みの痕跡は無い。

### 2-3. 設計上の問題（今回の被害とは別）

| 項目 | 状態 |
|---|---|
| 認証が効くのは `$connect` の authorizer のみ | 接続後は素通り |
| `check_authentication` を呼ぶルート | 48 ルート中 **9** のみ |
| `check_authentication` の中身 | `"token" in dict` の存在確認だけ。期限・権限・所有者を見ない |
| ガイドのアカウント境界チェック | `exist_guide_info_from_rds` は id と type のみで検索。**無い** |
| トークンの発行元区別 | 無し。manage / ext-editor / ext-viewer が同一 `api_token` テーブルを共有 |

接続さえできれば `guide_id` を変えるだけで他アカウントのガイドも開けて書き換えられる構造。
別チケットで対応が必要。

## 3. 招待メール（既存資料 11 章の精緻化）

### 3-1. 実際に送信された

SES の送信統計が監査ログと一致した。**送信試行ではなく実送信**である。

| UTC | JST | 送信数 | バウンス |
|---|---|---|---|
| 10/13 18:50 | **03:50** | 2 | 1 |
| 10/13 19:05 | **04:05** | **12** | 0 |

`mngV1ProductUsersInvitation-prod` は `LOG_LEVEL=ERROR` のため `mail.send()` 成功時の
`logger.info(response)` が CloudWatch に出ない。ログだけでは送信有無を判定できないため
SES 統計で裏を取った。

### 3-2. 宛先と対象ユーザー

| 時刻 | 経路 | 宛先（マスク） | 対象ユーザー |
|---|---|---|---|
| 03:50:16 | `POST /v1/product/users/invitation` | `i8***@gmail.com` | **3077 `Ob Pr`**（新規作成） |
| 03:54:39 | `POST /v1/users/3077/invite` | 3077 のアドレス | **3077 `Ob Pr`** |
| 04:05:52 | `POST /v1/product/users/invitation` | `i8***@example.com` | **3078 `6 R`** |
| 04:05:53 | 〃 | `i8***@example.com` | **3079 `7 R`** |
| 04:05:55 | 〃 | `i8***@example.com` | **3080 `8 R`** |
| 04:08:59 | `POST /v1/users/6/invite` | 6 のアドレス | **6 `omori`**（既存・account 2） |
| 04:09:34 | `POST /v1/product/users/invitation` | `i8***@example.com` | **3082 `Y S`** |
| 04:09:35 | 〃 | `i8***@example.com` | **3083 `Y S`** |
| 04:09:37 | 〃 | `i8***@example.com` | **3084 `Y S`** |
| 04:09:38 | 〃 | `i8***@example.com` | **3085 `Y S`** |
| 04:09:39 | 〃 | `i8***@example.com` | **3086 `Y S`** |
| 04:11:54 | 〃 | `t.***@stands.ai` | 既存ユーザー（**64 `検証ユーザー2`** とみられる） |
| 04:11:55 | 〃 | `m.***@gmail.com` | 既存ユーザー（未特定） |

- `@example.com` は予約ドメインで到達しない。実害は `i8***@gmail.com`、`t.***@stands.ai`、`m.***@gmail.com` の3アドレス
- `user 6 omori` には SES（管理画面招待）と SQS（拡張機能向け）の両方が送られた
- 04:11 の2件は `get_user_by_email` で既存ユーザーに紐づいたため、users への新規作成は無い
- `m.***@gmail.com` の user_id は `encrypted_email` が決定的暗号化のため、鍵なしでは特定できない

### 3-3. 空振りだったもの

`POST /v1/users-invite`（account 一括送信）は 03:54:36 と 04:09:03 に **200** を返しているが、
**メールは1通も送られていない**。

```
SQS send_message_entries error [extension-guide-email-queue] batch: []
  error: cannot access local variable 'response' where it is not associated with a value
Query: UPDATE user_products SET status = 'joining' WHERE id IN ()
Execute Error: (1064, "You have an error in your SQL syntax ...")
```

対象が0件でも `send_messages_to_extension_guide_email_queue_batch` が例外を握りつぶし、
`update_status` も空リストで SQL エラーになるが、どちらも呼び出し元に伝播せず 200 が返る実装。
DB ダンプでも account 1 に `role_id=4`（Viewer拡張機能利用者）のレコードは 0 件だった。

> 付随する不具合: 対象0件で 200 を返し、かつ内部で例外が出る。別途修正が必要。

## 4. 攻撃者が作成したユーザー（既存資料の訂正）

既存資料 11 章は「02:48〜02:49 にユーザー作成 3 件」としているが、
DB ダンプを見ると **10/14 に作成されたユーザーは 12 件**ある（3081 は欠番）。

| id | name | created_at | account | is_deleted | user_products |
|---|---|---|---|---|---|
| 3074 | `Probe TestInject` | 02:48:10 | 1 | 0 | 0件 |
| 3075 | `Probe {{7*7}}${7*7}` | 02:48:14 | 1 | 0 | 0件 |
| 3076 | `y x' OR '1'='1` | 02:49:38 | 1 | 0 | 0件 |
| 3077 | `Ob Pr` | 03:50:16 | 1 | 0 | product 3 / role 3 / joining |
| 3078 | `6 R` | 04:05:52 | 1 | 0 | 0件 |
| 3079 | `7 R` | 04:05:53 | 1 | 0 | 0件 |
| 3080 | `8 R` | 04:05:55 | 1 | 0 | 0件 |
| 3082 | `Y S` | 04:09:34 | 1 | 0 | 0件 |
| 3083 | `Y S` | 04:09:35 | 1 | 0 | 0件 |
| 3084 | `Y S` | 04:09:37 | 1 | 0 | 0件 |
| 3085 | `Y S` | 04:09:38 | 1 | 0 | 0件 |
| 3086 | `Y S` | 04:09:39 | 1 | 0 | 0件 |

名前に `{{7*7}}${7*7}`、`x' OR '1'='1` というテンプレート注入・SQL 注入の試行文字列が入っている。
`user_products` が 0 件なのは 04:13 のロール削除によるもの。**users レコード自体は全て残っている。**

## 5. 残存リスク

唯一の再侵入経路は **ext-viewer のメール認証**。

```python
# api/rest-ext-viewer/functions/auth-code/method_post.py:97
api_token, api_token_expire = common.generate_api_token_and_get_expire(user_id)
refresh_token = common.generate_refresh_token(user_id)
```

- 4スタック（rest / rest-ext-editor / rest-ext-viewer / websocket）が同一の `api_token` テーブルを共有
- 発行されるレコードは `{token, expire, user_id, ttl}` のみで、発行元・ユーザー種別の区別が無い
- WebSocket の authorizer はトークンの存在と期限しか見ない
- 接続後のガイド編集に認可チェックが無い（2-3 参照）

4章の12ユーザーが `is_deleted=0` で残っており、`get_user_with_email` は
`users` テーブルを引くだけなので、攻撃者が `i8***@gmail.com` のメールボックスを
押さえていればトークンを再取得できる。**これらのユーザーの無効化が最優先。**

なお ext-viewer の `auth-code` はトークンクリア以降 **0 件**で、まだ試された形跡は無い。

## 6. 現時点の接続可否

| 項目 | 状態 |
|---|---|
| `api_token`（TTL **1時間**） | 実スキャン **0 件** |
| `refresh_token`（TTL **90日** = 2160時間） | 実スキャン **0 件** |
| manage-api `/v1/auth` | 403（ベースパスマッピング削除） |
| ext-viewer `auth-code` | 10/14 02:00 以降 **0 件** |
| ext-viewer `auth-refresh` | 23:27 に1件（テーブルが空のため失敗） |
| WebSocket 接続数 | 10/14 12:37台を最後にゼロ |
| `connections_prod` | 791 件残存。ただし `$disconnect` 漏れの残骸 |

API Gateway WebSocket は**最大接続時間2時間**のハードリミットがあるため、
最後の接続（12:37台）から十分な時間が経過しており実接続は全滅している。

**→ 現時点で WebSocket に接続できる者はいない。緊急対応は不要。**

## 7. 管理画面停止後のアクセス監査

対象期間: 10/14 12:46（dev マッピング削除）〜 10/15 10:35。

### 7-1. 結果一覧

| API | 停止後の状況 | 判定 |
|---|---|---|
| manage-api `y8ozzf8hfb` | 12:55台の109件を最後に、**13:00 以降は到達ゼロ** | 完全遮断 |
| WebSocket `sl3su33zt4` | 既存接続の `keepAlive` 37件 + `$disconnect` 5件のみ（〜14:15:51）。新規接続試行3回は**全て Deny** | 遮断有効 |
| ext-editor `na34r1ebwb` | 12:46〜12:58 に顧客2名が編集。以降は 14:05 の GET 1件のみ | 正常 |
| ext-viewer `t2fu8aq041` | `auth-email` 1件 / `auth-refresh` 1件 / **`auth-code` 0件**。IP認証 342件 | トークン再取得なし |
| 配信API `4gg04tjv40` | 通常の日次パターン。スパイクなし | 正常 |
| ai-server `eob6cmb4v8` | AIヒントの通常動作（90件） | 正常 |
| ai-websocket `8hb23gp5n5` | 10/14 16:00 以降 激減（Connect 1〜3/h） | 異常なし |
| chat-openai-websocket `2sa5gc22j8` | 0件 | — |

### 7-2. WebSocket

停止後に残っていたのは 12:46 時点で既に確立済みだった 5 接続のみ。
5分間隔の規則的な `keepAlive` が続き、14:15:51 の `$disconnect` で終了している。
ガイド編集系 13 ロググループは**全て 0 件**。

新規接続は3回試行され、すべて拒否された。

```
10/14 15:00:52 / 15:00:55 / 15:00:57  $connect → Deny
  理由: No API token data in dynamodb （3件）
```

`ConnectCount = 0` と整合する。3秒間隔なのでクライアントのリトライとみられ、
業務時間帯であることからメンテナンス中と知らずに管理画面を開いた正規ユーザーの可能性が高い。
ただし送信元 IP は記録されないため断定はできない。

### 7-3. ext-editor で動いていた編集

管理画面停止中にガイド編集が走っていたが、操作者は顧客の正規ユーザーだった。

| user_id | 名前 | account | 件数 |
|---|---|---|---|
| 2295 | 内田 結偉 | 28（HRソリューションズ株式会社） | 56 |
| 622 | 府馬 健太郎 | 270 | 1 |

12:46:23 から連続的に編集（`PUT /blocks`、`PUT /steps/{id}/option`、`POST /file/upload`、
`POST /steps/{id}/delete`）し、**12:58:38 を最後に停止**している。
マッピング削除のタイミングと一致するため、通常業務が遮断で中断された形。

### 7-4. 配信API の 4XX について

停止後の 4XX 比率が 46.6% と高いため攻撃前と比較したが、恒常的な水準だった。

| 時間帯 | 10/12 | 10/13 | 10/14 | 10/15 |
|---|---|---|---|---|
| 09時 | 39.0% | 42.6% | — | 52.0% |
| 10時 | 45.7% | 49.2% | — | 57.5% |
| 15時 | 48.9% | 43.6% | 53.7% | — |
| 16時 | 51.7% | 42.6% | 51.6% | — |

同レンジであり、今回の件に起因する変化ではない。
ただし**平常時で4割超が 4XX** であること自体は別途確認に値する
（存在しないプロダクトIDへの配信リクエストが常時発生している等）。今回とは切り離して扱う。

### 7-5. この調査の限界

1. **manage-api への到達試行は追えない。** execute-api 無効化とベースパスマッピング削除により
   API Gateway のフロントで弾かれるため、CloudWatch に記録が残らない。
   アクセスログが無効（`accessLogSettings` なし）で WAF も未適用のため、
   「遮断されたリクエストが何件あったか」は原理的に確認できない
2. **15:00 の3回の Deny は正規・不審の断定ができない。** WebSocket の authorizer ログには
   送信元 IP も User-Agent も記録されない

## 8. 対応で優先すべきこと

1. **4章の12ユーザー（3074〜3086）の無効化** — 唯一の再侵入経路を塞ぐ
2. `t.***@stands.ai`・`m.***@gmail.com`・`i8***@gmail.com` へ招待メールが届いている事実の共有
   （社内アドレス宛が2件含まれる可能性）
3. `api_token` / `refresh_token` が 0 件のまま維持されていることの継続確認
4. 別チケット化: WebSocket の認可追加、トークン種別の分離、`/v1/users-invite` の空振り 200 修正
