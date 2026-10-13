# ONBS-2097 不審アクセスの調査結果と対応設計

Slack 通知チャンネル（`incoming-webhook`）に AI チャットのサーバーエラーが
連続投稿された件の調査記録と、実施した対策の設計。

調査日: 2026-10-13（通知の発生時刻は同日 15:56 〜 16:08 以降）

---

## 1. 何が起きていたか

### 結論

**無差別な bot ではなく、配信中のクライアント JS を解析した上での意図的なプロトコル探索（ファジング）。**
総当たりでは到達できない地点まで到達している。

### 観測されたエラーと発生箇所

| Slack に出ていた文言 | 発生箇所 | 意味 |
| --- | --- | --- |
| `The 'action' field is required.` | `app/api/websocket/action_handler.py` | `action` 無しの最小ペイロード |
| `Action 'ping' is not supported.` | 同上 | WebSocket の疎通確認に使われる定番のプローブ |
| `Validation error` | 同上 | **`action` は正解。他フィールドが不正** |
| `Chat setting not found: chat_setting_id=aaa...` | `ai_chat_openai.py` → `get_model_name` | **`aiChatOpenai` でスキーマを全通過** |
| `Product not found` | `ai_chat_dify.py` → `validate_ai_chat_request` | **`aiChatDify` でスキーマを全通過** |

### 攻撃者がプロトコルを把握していると判断した根拠

1. `Validation error` 以降の文言は、`action` が `aiChatOpenai` / `aiChatDify` の
   **どちらかに完全一致**しないと到達しない（`action_handler.py` の `AI_CHAT_CONFIG` 参照）
2. `chatId` は `^[a-z0-9_]{32}$` 固定（`app/api/websocket/schemas/ai_chat.py`）。
   `Chat setting not found` まで到達している以上、送られた `aaaa...` は**ちょうど32文字**。
   `threadId` / `userEnv` / `conversations` / `url` もすべて通過している
3. `aiChatOpenai` は `get_model_name` が先、`aiChatDify` は `validate_ai_chat_request` が先に走るため、
   2種類のエラー文言が出ていることは**両方の action を撃ち分けている**ことを意味する

`aaaa` の繰り返しはファザーの定番の詰め物。`ping` は生存確認。
正規クライアント（`Onboarding-AI-Chat`）に `ping` を送る実装は存在しない。

エンドポイント `wss://v2ai.onboarding-app.io` は顧客サイトに配信される JS
（`Onboarding-AI-Chat/src/lib/constants/index.ts`）に平文で含まれており、誰でも発見できる。

### 突破はされていない

- Pydantic のスキーマ検証は機能しており、SQLi / XSS / traversal らしき文字列は通知に出ていない
- クライアントに返るのは `"Bad Request"` 等の汎用文言のみで、詳細は Slack 側にしか出ていない

---

## 2. 判明した構成上の問題

| # | 問題 | 確認方法 |
| --- | --- | --- |
| 1 | **WAF もレート制限も無い** | `terraform/` に `wafv2` リソースが存在しない |
| 2 | **Cloudflare を挟んでいない** | `dig v2ai.onboarding-app.io` が ALB への直 CNAME。NS は Route53 |
| 3 | **送信元 IP がどこにも残らない** | `alb_access_logs_enabled` が `default = false` で tfvars 未指定。アプリも IP を記録せず |
| 4 | **Slack 通知自体が増幅器** | 1エラー＝1 `@channel`（`create_alert_blocks`）。認証なしで誰でも鳴らせる |
| 5 | **実在 chatId を使われると AI 利用枠を焼ける** | `validators/ai_chat.py` が AI 実行前に `used_count` をインクリメント。認証なし |

本チケットでは 1〜4 に対応する。5 は影響範囲が `Onboarding-AI-API` と `onboarding-web` に
またがる設計変更のため、別チケットとする。

---

## 3. 実施した対策

対象リポジトリ: `Onboarding-AI-API` のみ（アプリと terraform の両方）

### 3-1. Slack 通知の抑制（問題 4）

`handle_error` に通知方針 `NotifyPolicy` を追加した。

| 方針 | 対象 | 挙動 |
| --- | --- | --- |
| `SILENT` | プロトコル不一致（`action` 欠落 / 未対応 action / `Validation error`） | 通知しない |
| `THROTTLED`（既定） | それ以外すべて | スロットリングを通して通知する |

**「毎回必ず通知する」区分は設けていない。** このエンドポイントは認証なしで公開されており、
ここで起きるエラーはすべて第三者が外部から誘発できるため、常時通知する区分を残すと
そこが増幅器として残ってしまう。

スロットリングは `app/utils/notification_throttle.py` で2段に分けた。

- 同一内容（status_code / chat_setting_id / 文言の先頭120文字）は **10分に1回**
- キーを変えながら連投された場合に備え、**全体で 60秒あたり10件**を上限とする
- 抑制した件数は次に通る通知の末尾に付記するため、「何件潰したか分からない」状態にはならない
- 保持キー数に上限（1000）を設け、`chat_setting_id` を変えながらの連投でメモリが伸びないようにした

### 3-2. WebSocket の流量制限（問題 1 の実効部分）

**WAF だけでは今回の挙動は止まらない。** WAF が数えられるのは HTTP リクエスト単位、
つまり WebSocket では「接続を張る回数」までで、確立後に流れるフレームは WAF から見えない。
そのためアプリ側にも監視を置いた（`app/api/websocket/rate_limit.py`）。

| 単位 | 上限 | 目的 |
| --- | --- | --- |
| 1接続あたり | 60秒で30メッセージ | 1本の接続での連投を止める |
| 1接続あたり | プロトコル不一致が5回連続 | 正規クライアントでは1回も起きない |
| 1IPあたり | 60秒で300メッセージ | **接続の張り直しによる回避を塞ぐ** |

IP 単位の制限が必要な理由: クライアント（`Onboarding-AI-Chat/src/lib/api/clients/WebSocketClient.ts`）は
切断されると自動で再接続する（初期1秒、最大16秒のバックオフ）。接続単位の制限だけでは
「切られたら張り直して続ける」で上限を回避できてしまう。

IP の取得は `X-Forwarded-For` の**末尾**を採る。ALB は受け取ったヘッダーを置き換えずに
実クライアント IP を末尾へ追記するため、クライアントが偽装した値が前に並んでいても
ALB が観測した値は常に末尾にある。

上限値は正規利用の実態から決めた。正規クライアントは1チャットターンにつき1メッセージしか送らず、
応答を待つ間は次を送れない。ヘルスチェックもメッセージを送らない実装（`readyState` を見るだけ）。
IP 単位を接続単位よりかなり緩くしているのは、**企業の NAT 配下では多数の正規利用者が同一 IP に見える**ため。

切断時のみ、スロットリング付きで Slack に通知する（送信元 IP 付き）。
個々のエラーを通知しない方針にしたため、ここが不審アクセスに気づく手がかりになる。

### 3-3. ALB アクセスログの有効化（問題 3）

- `terraform/modules/s3` にログ保存用バケットを追加（SSE-S3 / パブリックアクセスブロック / 90日で失効）
- `alb_access_logs_enabled` の既定値を `false` → `true` に変更し、dev / prod の tfvars で明示
- バケットは terraform 管理になったため、`alb_access_logs_bucket` 変数は廃止

ap-northeast-1 のような古いリージョンでは、ALB はサービスプリンシパルではなく
リージョンごとの ELB アカウントからログを書き込むため、`aws_elb_service_account` を使って許可を出している。

### 3-4. WAF の導入（問題 1・2）

`terraform/modules/waf` を新設し、ALB に関連付けた。

| ルール | 優先度 | アクション | 内容 |
| --- | --- | --- | --- |
| `rate-limit-per-ip` | 1 | **BLOCK** | 1IPあたり5分間 2000 リクエスト（＝接続試行） |
| `aws-common-rule-set` | 2 | **COUNT** | AWSManagedRulesCommonRuleSet |
| `aws-known-bad-inputs` | 3 | **COUNT** | AWSManagedRulesKnownBadInputsRuleSet |

**マネージドルールはいずれも COUNT（計測のみ）で入れている。**
WebSocket の Upgrade リクエストを誤検知で落とすとチャットが全面的に止まるため、
まず実績を見てから BLOCK へ切り替える。

レート制限の 2000/5分 も、企業の NAT 配下を巻き込まないよう緩めに取っている。
機械的な接続の張り直しだけが引っかかることを狙った値で、`waf_rate_limit_per_5min` で調整できる。

WAF ログは CloudWatch Logs（`aws-waf-logs-{env}-onboarding-ai-api`）へ出す。
正常系まで記録すると量も費用も無駄に増えるため、`logging_filter` で **BLOCK と COUNT のみ**残している。

### Origin 検証を採用しなかった理由

AI チャットは顧客サイト上で動くため、`Origin` は任意の顧客ドメインになる。
固定の許可リストを作れないため、Origin 単体での検証は成立しない。
`url` フィールドと契約ドメインの突き合わせは問題 5 と同じ設計変更になるので別チケットとする。

---

## 4. 残課題（別チケット）

- **実在 chatId を使った AI 利用枠の消費**（上記の問題 5）。
  `Onboarding-AI-API` と `onboarding-web` にまたがるリクエスト元検証の設計が必要
- マネージドルールを COUNT → BLOCK へ切り替えるかの判断。
  WAF ログで数週間の実績を見てから決める
