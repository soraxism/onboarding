#!/bin/bash
# 使い方: rule_target.sh run|switch <rule> <target_id> <family:revision> [--dry-run]
#   run    : ルールのターゲットと同じクラスタ・ネットワークで、指定リビジョンを1回実行する
#   switch : ルールのターゲットの参照先を、指定リビジョンへ切り替える（他の設定はそのまま）
set -euo pipefail
export AWS_REGION=ap-northeast-1
mode=$1; rule=$2; tid=$3; td=$4; dry=${5:-}
t=$(aws events list-targets-by-rule --rule "$rule" --output json | jq --arg id "$tid" '.Targets[]|select(.Id==$id)')
[ -n "$t" ] || { echo "target not found"; exit 1; }
cur=$(echo "$t" | jq -r '.EcsParameters.TaskDefinitionArn')
newarn="${cur%/*}/$td"
if [ "$mode" = run ]; then
  cluster=$(echo "$t" | jq -r '.Arn')
  net=$(echo "$t" | jq -c '.EcsParameters.NetworkConfiguration|{awsvpcConfiguration:{subnets:.awsvpcConfiguration.Subnets,securityGroups:.awsvpcConfiguration.SecurityGroups,assignPublicIp:.awsvpcConfiguration.AssignPublicIp}}')
  lt=$(echo "$t" | jq -r '.EcsParameters.LaunchType')
  echo "run: cluster=${cluster##*/} td=$td"
  [ "$dry" = "--dry-run" ] && exit 0
  aws ecs run-task --cluster "$cluster" --launch-type "$lt" --task-definition "$newarn" --network-configuration "$net" --query 'tasks[0].taskArn' --output text
elif [ "$mode" = switch ]; then
  nt=$(echo "$t" | jq --arg a "$newarn" '.EcsParameters.TaskDefinitionArn=$a')
  echo "switch: $rule/$tid ${cur##*/} -> $td"
  [ "$dry" = "--dry-run" ] && { diff <(echo "$t"|jq -S .) <(echo "$nt"|jq -S .) || true; exit 0; }
  aws events put-targets --rule "$rule" --targets "[$nt]" --query 'FailedEntryCount' --output text
fi
