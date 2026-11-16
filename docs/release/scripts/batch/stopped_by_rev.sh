#!/bin/bash
# 使い方: stopped_by_rev.sh <cluster> <family:revision>
# クラスタの停止済みタスク（ECS が保持している約1時間分）のうち、指定リビジョンのものの終了コードを数える
export AWS_REGION=ap-northeast-1
c=$1; td=$2
arns=$(aws ecs list-tasks --cluster $c --desired-status STOPPED --query 'taskArns' --output text)
[ -z "$arns" ] && { echo "$td: none"; exit 0; }
aws ecs describe-tasks --cluster $c --tasks $arns --output json | jq -r --arg td "$td" '[.tasks[]|select(.taskDefinitionArn|endswith("/"+$td))] | "\($td): runs=\(length) exit0=\([.[]|select(.containers[0].exitCode==0)]|length) other=\([.[]|select(.containers[0].exitCode!=0)|.containers[0].exitCode]) first=\([.[].startedAt]|min) last=\([.[].stoppedAt]|max)"'
