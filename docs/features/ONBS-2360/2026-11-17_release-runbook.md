# ONBS-2360 リリース手順

概要は [2026-11-17_jira-summary.md](2026-11-17_jira-summary.md)。dev も同じ順で反映する。

## 順序

| 順 | 対象 | 理由 |
| --- | --- | --- |
| 1 | `Onboarding-AI-API` | 先に出ていないと「推論あり」を選んでも OpenAI に推論の度合いが渡らない。設定に `reasoning_effort` が無ければ今までどおり動くので、単独で先に出してよい |
| 2 | DB マイグレーション | 新しい Manage-API は `reasoning_effort` を SELECT するため、カラムが先に要る |
| 3 | `onboarding-manage-api` | 旧 Manage-API の更新のバリデーションは `options.reasoning_effort` を知らないキーとして 400 にする。管理画面より先に出す |
| 4 | `onboarding-manage-web` | |

**2 から 4 は間を空けずに続けて行う。** 2 から 3 までのあいだは次のことが起きる。

- 旧管理画面では gpt-6.1-terra が区別なく2つ並ぶ（どちらを選んでも推論の度合いは保存されない）
- 旧 Manage-API で新規作成したチャットは、既定の gpt-6.1-terra が推論の度合いなしで保存される（OpenAI 側の既定の度合いで動く）。この間に作られたチャットは、3 のあと AI モデルを選び直す

## DB マイグレーション

```bash
mysql ... < onboarding-manage-api/mysql/migrations/20261117_add_reasoning_effort_to_llm_models.sql
```

- 末尾の SELECT で、priority 1・2 に gpt-6.1-terra（none / medium）、3 以降に既存のモデルが元の順で並び、既定（`default_flag = 1`）が gpt-6.1-terra（none）だけに立っていることを確かめる
- 何度流しても結果は変わらない（カラムと gpt-6.1-terra の行が既にあれば何もしない）

### gpt-4.1・gpt-5 の無効化（本番）

dev と同じく、近々廃止予定の gpt-4.1・gpt-5 を本番でも選択肢から外す（2026-11-17 決定）。マイグレーションとは別に、人が流す。

```sql
UPDATE llm_models SET is_available = 0 WHERE provider_code = 'openai' AND model IN ('gpt-4.1', 'gpt-5');
```

- `is_available` を見ているのは管理画面の選択肢だけ。AI-API は見ないため、すでに gpt-4.1・gpt-5 を選んでいるチャットはそのまま応答する（管理画面では選択中のモデルとして無効の状態で表示される）
- 既定は gpt-6.1-terra（推論なし）に移るので、新規作成には影響しない
- 流したあとの P1 の選択肢は、gpt-6.1-terra（推論なし）・gpt-6.1-terra（推論あり）・gpt-5.1 に、本番で利用可能なほかのモデルが続く

### 戻すとき

コードを戻したあとに流す。gpt-6.1-terra を選んだチャット（適用後に新規作成したものは既定で gpt-6.1-terra になっている）があれば、先に別のモデルへ変えておく。

**適用前に、本番の既定（`SELECT model FROM llm_models WHERE default_flag = 1`）を控えておく。** 戻すときに使う。

```sql
DELETE FROM llm_models WHERE model = 'gpt-6.1-terra';
UPDATE llm_models SET priority = priority - 2 ORDER BY priority ASC;
-- 既定を元に戻す（適用前の既定。本番で適用前に確かめた値に合わせる）
UPDATE llm_models SET default_flag = 1 WHERE model = 'gpt-5.1';
ALTER TABLE llm_models DROP PRIMARY KEY, ADD PRIMARY KEY (provider_code, model), DROP COLUMN reasoning_effort;
```
