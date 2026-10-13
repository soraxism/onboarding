# ONBS-2097 dev 動作確認の結果

実施日: 2026-10-13
対象: アプリ側の変更のみ（`feature/ONBS-2097`）。terraform は未適用。

## 確認環境

| 項目 | 値 |
| --- | --- |
| 接続先 | `wss://dev-v2ai.onboarding-app.io` |
| デプロイ | CodePipeline `onboarding-ai-api-pipeline-dev` |
| イメージタグ | `aa92c57`（develop の `Merge branch 'feature/ONBS-2097' into develop`） |
| タスク定義 | `dev-onboarding-ai-api-task:90` |

**ECS のタスクセットが PRIMARY / STEADY_STATE / scale 100 になった時点で検証した。**
CodeDeploy の blue/green は `deploymentReadyOption.waitTimeInMinutes = 0`（即時切替）かつ
`terminationWaitTimeInMinutes = 5` のため、**CodeDeploy が `InProgress` のままでも
トラフィックは既に新バージョンへ切り替わっている**。パイプラインの完了を待つ必要はない。

検証スクリプト: `scratchpad/onbs2097-dev-check.py`（セッション用の使い捨て）

## 結果

いずれも期待どおり。

### テスト1: プロトコル不一致は通知されない

`action` 欠落 / `{"action":"ping"}` / スキーマ不正 を混ぜて5回送信。

| 回 | 送信内容 | 応答 |
| --- | --- | --- |
| 1 | `{}` | `Bad Request` |
| 2 | `{"action":"ping"}` | `Bad Request` |
| 3 | `{"action":"aiChatOpenai","chatId":"too-short"}` | `Bad Request` |
| 4 | `{}` | `Bad Request` |
| 5 | `{}` | `Bad Request` → 直後に切断 |

切断: `code=1008, reason='不正なメッセージが連続しました'`

**Slack 通知: 切断通知の1件のみ。** 5件のエラー自体は1件も通知されなかった。

5回目は「エラー応答を返してから切断」される点に注意。応答を受けた直後にもう一度受信して
切断を確認する必要がある。

### テスト2: スキーマ通過後のエラーは最初の1件だけ通知

スキーマを完全に通過する `aiChatOpenai`（存在しない `chatId`）を6連投。
6回とも `Not Found` が返り、**Slack 通知は1件のみ**。

### テスト3: 接続単位の流量制限

同一接続で31件を連投。30件目までは `Not Found` が返り、
**31件目で `code=1008, reason='メッセージ流量の上限を超えました'` で切断**。

流量超過のチェックは JSON のパースより前に走るため、31件目にはエラー応答が返らず
いきなり切断される（テスト1の挙動との違い）。

## ログによる裏取り

`/ecs/dev-onboarding-ai-api` に `Slack notification throttled` が **35件**出力されていた。

- テスト2の6件 → 1件通知 + **5件抑制**
- テスト3の30件 → 同一キーのため **30件抑制**

合計42リクエストに対し、Slack 通知は **3件**（切断2件＋`Chat setting not found` 1件）。
対応前なら 42件すべてが `@channel` 付きで飛んでいた。

## 副次的に判明したこと

`/aws/elasticloadbalancing/{env}-onboarding-ai-api/access` という CloudWatch ロググループが
dev / prod とも作成されているが、**中身は空**だった。

ALB のアクセスログは **S3 にしか配信できず、CloudWatch Logs は配信先に指定できない**ため。
「ロググループがあるからアクセスログは取れている」という誤解を生むので、
`terraform/modules/cloudwatch/main.tf` にコメントを残した（`feature/ONBS-2097-infra`）。

## 未確認の項目

| 項目 | 理由 |
| --- | --- |
| IP 単位の流量制限（60秒300件） | 接続単位（30件）で先に切れるため、単体では到達しない。ユニットテストで担保 |
| 抑制件数の本文への付記 | クールダウン10分の経過が必要。ユニットテストで担保 |
| 正常系のチャット疎通 | フロントエンド側で実施 |
| ALBアクセスログ / WAF | terraform 未適用のため未確認 |
