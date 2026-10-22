# ONBS-2100 / ONBS-2101 AIヒントの流量制限と痕跡の記録

対象リポジトリ: `Onboarding-AI-Server`
関連: ONBS-2097（AIチャット側。1.6.0 / 1.6.1 でリリース済み）

実装日: 2026-10-13 ／ **動作確認は 2026-10-14 に実施予定**（dev環境のDBが夜間停止のため翌日へ）

## 背景

2026-10-13 にAIチャット（`v2ai.onboarding-app.io`）を探索していた相手が、
その直後 **16:09〜16:11 にAIヒント（`ai.onboarding-app.io`）にも来ていた**。

Lambda の起動回数が平常の1〜5件/分から **14件/分・20件/分** に跳ね上がっている。

```
16:07    3 ###
16:08    1 #
16:09   14 ##############     ← ここから
16:10   20 ####################
16:11    3 ###                ← 2分で終了
```

残っていたのは `JSONDecodeError` が3件のみ。**Slack には何も通知されていなかった。**
AIヒントのプロトコルは解析されておらず（`Validation Error` が7日間で0件）、浅い探索で終わっている。

## ONBS-2101: JSONパース失敗でLambdaが落ち痕跡が残らない問題

### 原因

`handler()` に try/except が無く、`main_init()` の `json.loads` が最初の処理だった。
エラー処理（`handle_error` → `notify_error` → Slack）に到達する前に Lambda ごと落ちていた。

### 対応

`src/layers/custom-libs/python/common.py` で `JSONDecodeError` を捕まえ、読めなかった本文を記録する。

```python
except json.JSONDecodeError:
    body = event.get("body") or ""
    logger.warning(f"Invalid JSON body (len={len(body)}): {body[:200]!r}")
    payload = {}
```

`payload = {}` で足りる理由: ルート選択式 `$request.body.action` を評価できないメッセージは
API Gateway が `$default` ルートへ振るため、呼び出し元が予約ルートとして早期 return する。

あわせて **WebSocketのアクセスログを有効化**し、送信元IPを記録する。
Serverless の既定フォーマットに `$context.identity.sourceIp` が含まれる。

### 落とし穴: `fullExecutionData` の既定は `true`

```yaml
provider:
  logs:
    websocket:
      fullExecutionData: false   # ← 明示が必要
```

**既定の `true` のままだと `DataTraceEnabled` が有効になり、
リクエスト/レスポンスのボディ = 顧客のチャット内容まで CloudWatch に残る。**
調査目的には過剰で費用も嵩むため、必ず `false` にしておくこと。

アクセスログの保持期間（90日）は、既存のLambdaロググループへ波及しないよう
`provider.logRetentionInDays` ではなく `resources.extensions` で対象のロググループだけに設定した。

## ONBS-2100: 流量制限とLambda同時実行の上限

### 設定値と根拠（実測）

| 指標 | 実測値 | 設定値 | 余裕 |
| --- | --- | --- | --- |
| 正規トラフィックのピーク（14日） | 11件/分 = 0.18件/秒 | `ThrottlingRateLimit: 10`（件/秒） | 約54倍 |
| 同時実行数の最大（14日） | 4 | `reservedConcurrency: 20` | 5倍 |

中央値は2件/分。14日間の最大20件/分は**攻撃時のスパイク**なので除外して考える。

### なぜ予約同時実行が要るか

Lambda のタイムアウトは **120秒**（ONBS-2046 で延長、2026-09-29 から本番稼働）。
スロットリング10件/秒だけでは、理屈上 **1,200並列**まで伸びうる。

予約同時実行が無いと、アカウント全体の枠（無予約957 / 関数50本）を食い潰し、
管理画面APIなど**他システムまで巻き込める**。ECS で動く `Onboarding-AI-API` には無い、Lambda 特有のリスク。

### なぜ AI-API 移行を待たないか

- **設定のみのため移行しても捨てにならない**（作るコストがほぼゼロ）
- 移行までの期間、他システムへ波及しうる状態が続く

一方で **Slack通知のスロットリングと接続/IP単位のレート制限は移行時に行う**。
Lambda ではプロセス内カウンタが起動ごとにリセットされ、`Onboarding-AI-API` 側で実装済みの方式
（`app/api/websocket/rate_limit.py` / `app/utils/notification_throttle.py`）がそのまま使えないため。
今 Lambda 向けに作ると移行時に捨てることになる。

## 落とし穴: `resources.extensions` は浅いマージ

`merge-custom-provider-resources.js` が `Object.assign(Properties, value)` で処理するため、
**`DefaultRouteSettings` を指定すると Serverless が `provider.logs.websocket` から生成した
同名プロパティを丸ごと置き換える。**

そのため ONBS-2100 側で `DataTraceEnabled` / `LoggingLevel` も明示している。

```yaml
WebsocketsDeploymentStage:
  Properties:
    DefaultRouteSettings:
      ThrottlingRateLimit: ${self:custom.websocketThrottle.rateLimit}
      ThrottlingBurstLimit: ${self:custom.websocketThrottle.burstLimit}
      DataTraceEnabled: false    # ← 消すと顧客のチャット内容が記録される
      LoggingLevel: ERROR
```

**2ブランチを develop へマージすると `resources:` ブロックで必ず衝突する。**
別リソース（`WebsocketsLogGroup` と `WebsocketsDeploymentStage`）なので、
両方を残す形で解消してよい。解消後に `serverless package` で最終形を検証済み。

## 調査中に判明したこと

- **`origin/main` では旧AIチャット（`aiChatOpenai` / `aiChatDify`）が既に撤去済み**
  （`100a729f` ONBS-1938）。`main_init` を使うのは `aiHint` のみ
- 旧AIチャット関数の14日間の起動回数は **0**
- API Gateway のアカウントレベル CloudWatch ロールは設定済み（`API-Log-CloudWatch-Role`）。
  アクセスログ有効化で追加の IAM 作成は発生しない

## dev への反映結果（2026-10-13 22:06 成功）

| 設定 | 変更前 | 変更後 |
| --- | --- | --- |
| ThrottlingRateLimit | `null`（実質無制限） | 10 件/秒 |
| ThrottlingBurstLimit | `null` | 20 |
| DataTraceEnabled | false | false（維持） |
| LoggingLevel | INFO | ERROR |
| アクセスログ | なし | `/aws/websocket/onboarding-ai-server-dev`（保持90日） |
| Lambda 予約同時実行 | 未設定 | 20 |

## 明日の動作確認

検証スクリプト: `scratchpad/onbs2100-2101-dev-check.py`

```bash
ONBS_WS_URL="wss://dev-ai.onboarding-app.io" python onbs2100-2101-dev-check.py
```

| # | 確認内容 | 期待 |
| --- | --- | --- |
| 1 | JSONとして読めない本文を3種類送る | 接続が維持され、Lambdaがクラッシュしない |
| 2 | `/aws/lambda/aiServerAiHint-dev` | `Invalid JSON body` が3件。`JSONDecodeError` のトレースバックが出ないこと |
| 3 | `/aws/websocket/onboarding-ai-server-dev` | 送信元IPが記録されていること |
| 4 | 正常系のヒント生成 | **DBが必要**。これだけは夜間不可 |

**1〜3はDBに到達しない**（`json.loads` 失敗時点で `$default` として早期 return するため）。

---

# dev 動作確認の結果（2026-10-22 実施）

10/13 に dev環境のDB停止で保留していた確認を実施した。あわせて追加対応を1件取り込んでいる。

## 追加対応: API Gateway の CloudWatch ロールを Serverless に管理させない

`provider.logs.websocket` を有効にした**副作用**として、Serverless v3 は API Gateway の
アカウント設定を確認するカスタムリソース `CustomApiGatewayAccountCloudWatchRole` を自動で追加し、
その実装 Lambda が **nodejs18.x（EOL）固定**で作られていた（ONBS-2220 の棚卸しで発覚）。

```yaml
provider:
  logs:
    restApi:
      roleManagedExternally: true   # Serverless に管理させない
```

### 安全性の確認

| 確認項目 | 結果 |
| --- | --- |
| アカウントの CloudWatch ロール | `API-Log-CloudWatch-Role` → **`serverlessApiGatewayCloudWatchRole` に変わっていた** |
| 2つのロールのポリシー | 同一（`AmazonAPIGatewayPushToCloudWatchLogs`）。機能差なし |
| ロールは CFN 管理か | **管理外**（カスタムリソースの Lambda が実行時に作成）。スタックから消えても残る |
| カスタムリソースの `remove()` | **no-op**。アカウント設定もロールも触らない |

**10/13 の dev デプロイで、アカウント全体の API Gateway CloudWatch ロール設定が書き換わっていた。**
当時「アカウントに設定済みなので追加の IAM 作成は発生しない」と判断したのは誤りで、
Serverless は既存設定があっても自前のロールを作って差し替える。ポリシーが同一だったため実害は無かった。

### 反映後

カスタムリソースと nodejs18.x Lambda はスタックから消え、
アカウント設定とロールは想定どおり残った（アクセスログは動作継続）。

## 注意: develop は 10/20 のリリースで作り直されていた

`Sync Branches from Release` が PR #120（10/20 16:18）のマージで動き、
**10/13 に develop へ入れた ONBS-2100 / ONBS-2101 のマージが両方とも消えていた。**

AWS 側の設定は残っていたため気づきにくいが、**次の dev デプロイで消える状態**だった。
10/22 に両ブランチを develop へ入れ直している。

リリース前には必ず `git log origin/main..origin/develop` で確認すること。

## 確認結果

### ONBS-2101: JSONパース失敗でクラッシュしない

| 送信内容 | 結果 |
| --- | --- |
| `'not-json-at-all'` | 接続維持。`Invalid JSON body (len=15)` がログに記録 |
| `'{"action":'` | 接続維持。`Invalid JSON body (len=10)` がログに記録 |
| `''`（空文字列） | 接続維持。**ログ出力なし**（下記） |

**`JSONDecodeError` は0件、エラー系ログも0件。**

空文字列でログが出ないのは、API Gateway が空フレームでは `body` キー自体を event に含めないため。
`if "body" in event` が False となり、パースを試みない既存の経路を通る（クラッシュはしない）。

### アクセスログに送信元IPが記録される

```
<IP> - - [22/Oct/2026:05:56:14 +0000] "CONNECT $connect geTnnk_SEbGYKEhp6A==" FobL3F4HtjMEJFQ=
<IP> - - [22/Oct/2026:05:56:17 +0000] "MESSAGE $default geTnnk_SEbGYKEhp6A==" FobMXFAyNjMEOBw=
```

### ONBS-2100: 流量制限の実発火

40接続を同時に張って測定した（メッセージは送らず接続・切断のみ）。

| 指標 | 値 |
| --- | --- |
| 接続成功 | 23件 |
| 拒否（HTTP 500） | 17件 |
| アクセスログの CONNECT | 44件（40 + 先行テスト4） |
| **Lambda Throttles** | **19** |
| Lambda Errors | 0 |

**拒否したのは Lambda の予約同時実行（20）であり、ステージのスロットリングではない。**
40接続はすべて API Gateway に到達しており、ステージ側（10件/秒・バースト20）は発火していない。

これはチケットで述べた「タイムアウト120秒のため、スロットリングだけでは理屈上1,200並列まで
伸びうる。実効的な歯止めは予約同時実行」という想定どおりの挙動。

#### 当初の 20 は絞りすぎだった → 100 へ引き上げ

20 は実測ピーク（同時実行数 4）の5倍として機械的に決めた値だったが、
**40接続を同時に張っただけで 19 件が弾かれた**。

上限に達した接続は API Gateway が HTTP 500 を返して終わる。
**AIヒントのクライアント（`onboarding-web` の `AiHintStrategy`）には再接続処理が無い。**

```ts
this.instance.onerror = (error) => { this.onErrorCallback(error) }
this.instance.onclose = (event) => { this.instance = null; this.onCloseCallback(event) }
```

AIチャット（`Onboarding-AI-Chat` の `WebSocketClient`）が指数バックオフで自動再接続するのとは異なり、
**弾かれたユーザーはそのページ表示でヒントが出ないまま終わる**。

また `ConcurrentExecutions` は **1分粒度のサンプリング**のため、
秒単位の接続集中は「最大4」という実測値に現れない。

上限の目的は「アカウント全体の枠（無予約 957）を食い潰させない」ことだけで、絞り込む必要はない。
**100 なら枠の約1割に収まり目的を果たせる一方、正規利用を弾く余地はほぼ無くなる**ため 100 とした。

| | 予約同時実行 | 40接続テストの結果 |
| --- | --- | --- |
| 変更前（本番の現状） | 未設定（無予約枠 957 まで） | — |
| 当初の設定 | 20 | 23 成功 / **17 拒否**（Lambda Throttles 19） |
| 現在の設定 | **100** | **40 すべて成功** |

ステージのスロットリングは**設定の適用は確認済みだが、発火は未実測**。
40接続はすべて API Gateway に到達しており、ステージ側（10件/秒・バースト20）は発火しなかった。

---

# リリース結果（2026-10-22）

タグ **`1.40.0`** を発行し、本番へ反映済み。

| PR | 内容 |
| --- | --- |
| [#121](https://github.com/stands/Onboarding-AI-Server/pull/121) | ONBS-2101 |
| [#122](https://github.com/stands/Onboarding-AI-Server/pull/122) | ONBS-2100 |
| [#123](https://github.com/stands/Onboarding-AI-Server/pull/123) | `20261022 Release`（release → main） |

## 本番への反映確認

| 設定 | 変更前 | 変更後 |
| --- | --- | --- |
| ThrottlingRateLimit | `null`（アカウント既定 10,000 req/s） | 10 件/秒 |
| ThrottlingBurstLimit | `null` | 20 |
| DataTraceEnabled | — | false |
| LoggingLevel | — | ERROR |
| アクセスログ | なし | `/aws/websocket/onboarding-ai-server-prod`（保持90日） |
| Lambda 予約同時実行 | **未設定**（無予約枠 957 まで） | **100** |
| nodejs18.x カスタムリソース | — | なし |

本番WSへの接続、および直近の正規トラフィック（Invocations 10 / Throttles 0 / Errors 0）も確認済み。

## CodeRabbit の指摘と対応（2件とも妥当だった）

### 1. 不正なJSONの本文をログに残さない

`DataTraceEnabled: false` にしたのは顧客のチャット内容を CloudWatch に残さないためだが、
**Lambda のログに生の本文を書けば同じことが起きる**（Lambda のロググループはその設定の対象外）。

さらに「JSON として読めなかったものだけが対象だから顧客データの懸念は小さい」という当初の判断も誤りで、
**正規のペイロードが途中で切れた場合も JSON として読めない**ため `promptInput` やユーザー識別子が入りうる。

本文の記録をやめ、長さと SHA-256 の先頭16桁のみに変更した。

```python
digest = hashlib.sha256(body.encode("utf-8", "replace")).hexdigest()[:16]
logger.warning(f"Invalid JSON body (len={len(body)}, sha256={digest})")
```

「同じ本文が何度来たか」「種類がいくつあるか」は追えるため、探索の規模や継続性の判断には足りる。

### 2. `DefaultRouteSettings` はルート単位であって、ステージ全体の合計ではない

**「ステージ全体の合計」と書いていたのは誤り。**

ドキュメントでは断定できなかったため（WebSocket向けページが読めず、CloudFormation の
`RouteSettings` も `ThrottlingRateLimit` の粒度を明記していない）、dev で実測した。

4ルート（`aiHint` / `$connect` / `$disconnect` / `$default`）がそれぞれ 10件/秒 を持つため、
同じ Lambda に入る合計は理屈上 **40件/秒**まで伸びうる。
正規ピーク 0.18件/秒 に対して 200倍以上の余裕があり、最終的な歯止めは `reservedConcurrency` が担うため
**設定値は変えず、コメントで粒度を正しく書くに留めた**。

ステージ合計を縛る手段は API Gateway v2 の WebSocket API には見当たらない
（ドキュメント上、集計されるのはアカウント単位の上限のみ）。

## 両方の防御が発火することを実測した

120接続を 4.7 秒で集中させた結果。

| 結果 | 件数 | 原因 |
| --- | --- | --- |
| 成功 | 100 | — |
| **拒否 HTTP 429** | **10** | **ゲートウェイのスロットリング** |
| 拒否 HTTP 500 | 10 | 予約同時実行（同時実行数の最大 99 ＝ 上限 100 に到達） |

これまで「設定の適用は確認済みだが発火は未実測」としていたゲートウェイ側も、429 として確認できた。

## 作業上の注意

### pre-commit の black が他者のファイルを再整形する

`release` を取り込んだ際、pre-commit が `ai.py` / `test_outbound_guard.py`
（`fix/restrict-external-destinations` 由来）を再整形し、PR の差分に混入した。
import の折り返し・行幅という純粋な整形差分で、**black の解釈が環境間で揺れている可能性がある**。

他者のファイルに整形差分が出たら `git checkout origin/release -- <path>` で戻し、
確定は `--no-verify` で行う。

### `release` 取り込み時は `resources:` ブロックが必ず衝突する

ONBS-2100 と ONBS-2101 は別リソース（`WebsocketsDeploymentStage` と `WebsocketsLogGroup`）なので、
両方を残す形で解消してよい。解消後は `serverless package` で最終形を検証すること。
