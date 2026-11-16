# onboarding-batch の本番反映

`onboarding-batch` は **main へのマージとタグ発行では本番に出ない。** 本番の ECS タスク定義は
日付タグ（例 `20261116.01`）のイメージを固定で参照しており、EventBridge ルールはタスク定義の
**リビジョン番号**を固定で参照している。イメージを push し、リビジョンを作り、ルールの参照先を
切り替えて初めて本番に出る。

2026-11-16（ONBS-2286、4.16.0）に13バッチをこの手順で反映した。元は空さんのメモ
（[Slack](https://stands-inc.slack.com/archives/C02SCVA8NTT/p1787048186339299)）。

## 流れ

```
1. タグのコミットから ECR へ push（latest ＋ 日付タグ）
2. タスク定義の新しいリビジョンを作る（イメージのタグだけ日付タグに差し替え）
3. 新しいリビジョンで手動実行し、ログ・Athena・DB で結果を確かめる
4. EventBridge ルールの参照先を新しいリビジョンへ切り替える
5. 切り替え後の定期実行を確かめる
```

スクリプトは [scripts/batch/](scripts/batch/) にある。AWS アカウント `091413534636`・`ap-northeast-1`。

## 0. 事前に確かめること

- **main には、本番に出ていない他者の変更が入っていることがある。** 本番のイメージが古いバッチを
  ビルドし直すと、共通部分（`src/common/`）の変更も一緒に出る。本番の各タスク定義のイメージの
  日付を確かめ、一緒に出る変更を担当者に確認してから進める
- リリースの告知（CLAUDE.md「2. release → main / master へのPR」）は、main へのマージ前に済ませておく

```bash
# 本番のタスク定義が参照しているイメージとリビジョン
aws ecs describe-task-definition --task-definition prod-report-event-summary-batch \
  --query 'taskDefinition.[revision,containerDefinitions[0].image]' --output text
```

## 1. ECR へ push

**本体のチェックアウトは使わず、タグから detached のワークツリーを切ってビルドする。**
本体の main は古いことがあり、そのままビルドすると別のコードが出る。

```bash
git -C onboarding-batch fetch origin --tags
WT=<scratchpad>/onboarding-batch-{タグ}
git -C onboarding-batch worktree add --detach $WT {タグ}

cd $WT
# push.sh は y/n を聞く。prod では latest と YYYYMMDD.01 の2つを push する
echo y | bash scripts/push.sh prod report-event-summary >| push-report-event-summary.log 2>&1
```

- **zsh では `>|` を使う。** `noclobber` のため、同名のログがあると `>` で開けずに何もせず失敗する
- `TLS handshake timeout` で途中失敗することがある。同じコマンドで再実行すれば足りる
- **`latest` を参照しているタスク定義は、push した時点で次の実行から新しいイメージに変わる。**
  手順 2 で日付タグに固定する
- 対象のバッチ名は `scripts/push.sh` の `AVAILABLE_BATCHES`

## 2. タスク定義の新しいリビジョン

```bash
docs/release/scripts/batch/register_td.sh prod-report-event-summary-batch 20261116.01 --dry-run
docs/release/scripts/batch/register_td.sh prod-report-event-summary-batch 20261116.01
# → prod-report-event-summary-batch: rev 10 ...:20250612.01 -> 11 ...:20261116.01
```

最新のリビジョンを複製し、イメージのタグだけを差し替える。環境変数・ロール・ログ設定はそのまま。

## 3. 手動実行して確かめる

```bash
# ルールのターゲットと同じクラスタ・ネットワークで1回実行する
docs/release/scripts/batch/rule_target.sh run every_twelve_hours prod-report-event-summary-batch prod-report-event-summary-batch:11
# 終わったら状態・終了コード・ログの末尾を見る
docs/release/scripts/batch/task_result.sh prod-report-event-summary-batch <task_arn>
```

**手動実行してよいかは、書き込み方で決まる。**

| バッチ | 書き込み方 | 手動実行 |
|---|---|---|
| report-*・custom-event-summary | DB をトランザクション内で消して入れ直す／UPDATE | してよい |
| ai-logs・ai-chat-logs・ai-chat-evaluation-logs | 日付（時間）ごとの Parquet を上書き | してよい |
| format-cf-logs | **出力ファイルへ追記する** | **しない**（二重になる）。切り替えて定期実行で確かめる |
| format-cf-error-logs | S3 PUT イベントで起動 | しない。切り替えて実際の起動で確かめる |

- **毎時のバッチは、定期実行と重ならない時刻に動かす。** 同じ時間帯のデータに同時に書き込まないように、
  定期実行が終わってから動かす（下の一覧の「スケジュール」）
- ログが JSON 形式のバッチ（ai-*・event-summary・site-access など）は、`message` を取り出して読む
- Athena で値を確かめるときは、出力先を指定する（primary ワークグループに既定の出力先がない）

```bash
aws athena start-query-execution \
  --query-string "SELECT count(*) FROM prod_onboarding_ai_logs_db.ai_logs WHERE year='2026' AND month='11' AND day='15'" \
  --result-configuration OutputLocation=s3://prod-onboarding-ai-logs/execute-athena-result/
```

## 4. ルールの参照先を切り替える

```bash
docs/release/scripts/batch/rule_target.sh switch every_twelve_hours prod-report-event-summary-batch prod-report-event-summary-batch:11 --dry-run
docs/release/scripts/batch/rule_target.sh switch every_twelve_hours prod-report-event-summary-batch prod-report-event-summary-batch:11
# → 0（FailedEntryCount）
```

- **ターゲットは ID で指定する。** 1つのルールに複数のバッチ（`every_twelve_hours` など）や、
  dev と prod の両方（`report-hint-displayed-batch`・`hourly_30`）が登録されているものがある
- 切り替わるのは指定したターゲットの `TaskDefinitionArn` だけ。他の設定はそのまま書き戻す
- **戻すときも同じコマンドで、旧リビジョンを指定する。** 旧リビジョンは登録解除しない

## 5. 切り替え後の定期実行を確かめる

```bash
# クラスタに残っている停止済みタスク（約1時間分）を、リビジョンで絞って数える
docs/release/scripts/batch/stopped_by_rev.sh prod-format-cf-logs-batch prod-format-cf-logs:51
# → runs=2 exit0=2 other=[] ...
```

頻度の高いもの（format-cf-logs は5分ごと）は、切り替えた直後の数回を必ず見る。

## 本番のバッチ一覧（2026-11-16 時点）

| バッチ（push.sh の名前） | ルール / ターゲット ID | タスク定義 | スケジュール（JST） |
|---|---|---|---|
| report-event-summary | `every_twelve_hours` / `prod-report-event-summary-batch` | `prod-report-event-summary-batch` | 01:35・13:35 |
| report-goal-details | `every_twelve_hours` / `prod-report-goal-details-batch` | `prod-report-goal-details-batch` | 01:35・13:35 |
| report-popup-displayed | `every_twelve_hours_2` / `prod-report-popup-displayed-batch` | `prod-report-popup-displayed-batch` | 01:45・13:45 |
| report-step-displayed | `every_twelve_hours_2` / `prod-report-step-displayed-batch` | `prod-report-step-displayed-batch` | 01:45・13:45 |
| report-hint-displayed | `report-hint-displayed-batch` / `prod-report-hint-displayed-batch` | `prod-report-hint-displayed-batch` | 毎時 08分 |
| report-guide-outcome | `prod-report-guide-outcome-batch-daily` / `prod-report-guide-outcome-batch` | `prod-report-guide-outcome-batch` | 04:30（45〜55分かかる） |
| report-site-access | `prod-report-site-access-batch` / `prod-report-site-access-batch` | `prod-report-site-access-batch` | 05:00 |
| custom-event-summary | `prod-custom-event-summary-batch` / 同名 | `prod-custom-event-summary-batch` | 毎時 10分 |
| ai-logs | `prod-ai-log-batch` / 同名 | `prod-ai-log-batch` | 02:00 |
| ai-chat-logs | `prod-ai-chat-logs-batch` / 同名 | `prod-ai-chat-logs-batch` | 毎時 00分 |
| ai-chat-evaluation-logs | `prod-ai-chat-evaluation-logs-batch` / 同名 | `prod-ai-chat-evaluation-logs-batch` | 毎時 00分 |
| format-cf-logs | `prod-format-cf-logs-batch` / 同名 | `prod-format-cf-logs` | 5分ごと |
| format-cf-error-logs | `prod-format-cf-error-logs-s3-put` / `ecs-runtask` | `prod-format-cf-error-logs-batch` | S3 PUT |

今の参照先は次で確かめる。

```bash
for r in $(aws events list-rules --query 'Rules[].Name' --output text); do
  aws events list-targets-by-rule --rule $r \
    --query 'Targets[?EcsParameters].[Id,EcsParameters.TaskDefinitionArn]' --output text |
    while read id td; do echo "$r	$id	${td##*/}"; done
done | grep prod
```

## 既知の事象（本番反映とは無関係）

- ai-chat-evaluation-logs の `ERROR No files found in S3 bucket ...` は、本番で AI チャットの評価が
  まだ使われていないため。以前から出ている
