# ONBS-2360 リリース手順

概要は [2026-11-17_jira-summary.md](2026-11-17_jira-summary.md)。dev も同じ順で反映する。

## 順序

| 順 | 対象 | 理由 |
| --- | --- | --- |
| 1 | `Onboarding-AI-API` | 先に出ていないと「推論あり」を選んでも OpenAI に推論の度合いが渡らない。設定に `reasoning_effort` が無ければ今までどおり動くので、単独で先に出してよい |
| 2 | DB マイグレーション | 新しい Manage-API は `reasoning_effort` を SELECT するため、カラムが先に要る |
| 3 | `onboarding-manage-api` | 旧 Manage-API の更新のバリデーションは `options.reasoning_effort` を知らないキーとして 400 にする。管理画面より先に出す |
| 4 | `onboarding-manage-web` | |

**2 から 4 は間を空けずに続けて行う。** 2 のあと旧管理画面では、gpt-6.1-terra が区別なく2つ並ぶ（どちらを選んでも推論の度合いは保存されない）。

## DB マイグレーション

```bash
mysql ... < onboarding-manage-api/mysql/migrations/20261117_add_reasoning_effort_to_llm_models.sql
```

- 末尾の SELECT で、priority 1・2 に gpt-6.1-terra（none / medium）、3 以降に既存のモデルが元の順で並び、既定（`default_flag = 1`）が gpt-5.1 のままであることを確かめる
- 何度流しても結果は変わらない（カラムと gpt-6.1-terra の行が既にあれば何もしない）

### 戻すとき

コードを戻したあとに流す。gpt-6.1-terra を選んだチャットがあれば、先に別のモデルへ変えておく。

```sql
DELETE FROM llm_models WHERE model = 'gpt-6.1-terra';
UPDATE llm_models SET priority = priority - 2 ORDER BY priority ASC;
ALTER TABLE llm_models DROP PRIMARY KEY, ADD PRIMARY KEY (provider_code, model), DROP COLUMN reasoning_effort;
```
