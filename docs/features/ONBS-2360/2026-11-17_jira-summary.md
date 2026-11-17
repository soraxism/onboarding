# ONBS-2360 AIチャットのLLMに gpt-6.1-terra（推論あり／なし）を追加する

- テスト項目書: [2026-11-17_test-checklist.md](2026-11-17_test-checklist.md)
- リリース手順: [2026-11-17_release-runbook.md](2026-11-17_release-runbook.md)

## 問題点

- 管理画面の AI チャット設定で選べる LLM は gpt-5.1 / gpt-5 / gpt-4.1 だけ。gpt-6.1-terra を選べるようにしたい
- 同じモデルで「推論あり／なし」を選び分けたいが、`llm_models` の主キーが `(provider_code, model)` なので同じモデルを2行登録できない。チャット設定（`settings.llm`）も `model` しか持たず、AI-API から OpenAI へ推論の度合い（`reasoning_effort`）を渡す手段がない

## 対応方針

1. `llm_models` に `reasoning_effort`（`VARCHAR(20) NOT NULL DEFAULT ''`。空文字は指定なし）を足し、主キーを `(provider_code, model, reasoning_effort)` に広げる。主キーに NULL は入れられないため、指定なしは空文字で表す
2. 次の2行を足す。既存のモデルは空文字のまま（AI-API は送らないので今の動きは変わらない）。既定は gpt-5.1 のまま

| priority | model | reasoning_effort | 表示 |
| --- | --- | --- | --- |
| 1 | gpt-6.1-terra | none | gpt-6.1-terra（推論なし） |
| 2 | gpt-6.1-terra | medium | gpt-6.1-terra（推論あり） |
| 3 | gpt-5.1（既定） | 空 | gpt-5.1 |
| 4 | gpt-5 | 空 | gpt-5 |
| 5 | gpt-4.1 | 空 | gpt-4.1 |

3. Manage-API: LLM 一覧で `reasoning_effort` を返す。チャット設定の更新（openai）で `options.reasoning_effort` を受け付ける（受け付けないと知らないキーとして 400 になる）
4. 管理画面: 選択肢をモデル名と `reasoning_effort` の組で区別し、「（推論あり）」「（推論なし）」を添える。保存時に `settings.llm.reasoning_effort` を送る（空のモデルは今までどおり `model` だけ）
5. AI-API: `settings.llm.reasoning_effort` があれば OpenAI の `chat.completions.create` に渡す。無い・空なら送らない（gpt-4.1 など推論に対応しないモデルは送ると 400 になる）

## 影響範囲

| リポジトリ | 変更 |
| --- | --- |
| `onboarding-manage-api` | マイグレーション `mysql/migrations/20261117_add_reasoning_effort_to_llm_models.sql`・`mysql/init/onb-db.sql`・LLM 一覧（`mng-v1-chats-chat-id/method_get.py`）・更新のバリデーション（`validate_patch_provider_code_openai.json`） |
| `onboarding-manage-web` | AI チャット編集の AI モデル選択（`app/pages/ai/chats/[id]/index.vue`・型・E2E） |
| `Onboarding-AI-API` | 推論の度合いの取得（`app/data/chat_settings.py`）と OpenAI への受け渡し（`app/services/ai/clients.py`・`ai_chat_openai.py`） |
| DB | `llm_models` のスキーマ変更・2行追加（dev / prod） |

対象外:

- `Onboarding-AI-Server`: `get_model_name` は残っているが呼び出し元が無い
- Dify 連携: OpenAI を使わないため関係しない
- 新規作成・Dify から戻したときの初期値: 既定モデルの `model` だけを保存する。既定は gpt-5.1（推論の度合いなし）のままなので影響しない。推論の度合いを持つモデルを既定にするときは別途直す
