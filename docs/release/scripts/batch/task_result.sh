#!/bin/bash
# 使い方: task_result.sh <cluster> <task_arn>
# タスクの状態・終了コードと、ログの行数・ERROR の件数・最後の3行（先頭120文字）を出す
set -uo pipefail
export AWS_REGION=ap-northeast-1
c=$1; arn=$2; id=${arn##*/}
read st code td cname < <(aws ecs describe-tasks --cluster "$c" --tasks "$arn" --query 'tasks[0].[lastStatus,containers[0].exitCode,taskDefinitionArn,containers[0].name]' --output text)
echo "${td##*/} status=$st exit=$code"
[ "$st" = STOPPED ] || exit 0
g=$(aws ecs describe-task-definition --task-definition "$td" --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-group"' --output text)
ev=$(aws logs get-log-events --log-group-name "$g" --log-stream-name "ecs/$cname/$id" --start-from-head --output json)
echo "$ev" | jq -r '"lines=\(.events|length) error=\([.events[].message|select(test("ERROR|Traceback|Exception"))]|length)"'
echo "$ev" | jq -r '.events[-3:][].message[0:120]'
