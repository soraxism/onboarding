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
