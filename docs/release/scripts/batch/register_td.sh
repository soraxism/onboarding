#!/bin/bash
# 使い方: register_td.sh <family> <new_tag> [--dry-run]
# 最新リビジョンを複製し、1つ目のコンテナのイメージのタグだけを差し替えて登録する
set -euo pipefail
export AWS_REGION=ap-northeast-1
fam=$1; tag=$2; dry=${3:-}
src=$(aws ecs describe-task-definition --task-definition "$fam" --include TAGS --output json)
json=$(echo "$src" | jq --arg tag "$tag" '
  .tags as $t
  | .taskDefinition
  | .containerDefinitions[0].image |= (sub(":[^:/]+$"; "") + ":" + $tag)
  | del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy,.deregisteredAt)
  | if ($t|length)>0 then .tags=$t else . end')
old=$(echo "$src" | jq -r '"\(.taskDefinition.revision) \(.taskDefinition.containerDefinitions[0].image|split("/")[1])"')
new=$(echo "$json" | jq -r '.containerDefinitions[0].image|split("/")[1]')
if [ "$dry" = "--dry-run" ]; then echo "$fam: rev $old -> $new"; exit 0; fi
rev=$(aws ecs register-task-definition --cli-input-json "$json" --query 'taskDefinition.revision' --output text)
echo "$fam: rev $old -> $rev $new"
