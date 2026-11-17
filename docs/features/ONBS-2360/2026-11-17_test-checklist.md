# ONBS-2360 テスト項目書

概要は [2026-11-17_jira-summary.md](2026-11-17_jira-summary.md)。

**正規の応答を1件も通さないままリリースしない。** 推論あり・なし・既存モデルのそれぞれで、AI チャットの応答が実際に返ることを dev で確かめる。

## ローカル（実施済み）

| # | 項目 | 結果 |
| --- | --- | --- |
| L1 | マイグレーション: 旧スキーマ＋旧データ（MySQL 8.0）に流すと、主キーが3列になり、gpt-6.1-terra の2行が priority 1・2 に入り、既存のモデルが 3〜5 に元の順で繰り下がる。既定は gpt-6.1-terra（none）だけ | OK |
| L2 | マイグレーション: 2回流しても結果が変わらない | OK |
| L3 | `mysql/init/onb-db.sql` の定義と投入データで作成できる | OK |
| L4 | AI-API: `reasoning_effort` があれば OpenAI へ渡り、無い・空なら送らない（pytest。全 244 件成功） | OK |
| L5 | 管理画面: 推論あり・なしが区別して表示され、選んだほうの `model` と `reasoning_effort` が保存される（E2E。AI チャット関連 188 件成功） | OK |
| L6 | 管理画面: 型チェック・vitest（11395 件）が通る。Dify 連携オフ時に既定モデルの `reasoning_effort` も保存する | OK |
| L7 | Manage-API: 新規作成時、既定が gpt-6.1-terra（none）なら `{"model": "gpt-6.1-terra", "reasoning_effort": "none"}`、既定が gpt-5.1 なら `{"model": "gpt-5.1"}` が保存される（偽の DB で関数を実行） | OK |

## dev

前提: [リリース手順](2026-11-17_release-runbook.md) の順で dev へ反映していること（AI-API → DB → Manage-API → 管理画面）。

2026-11-17 に `docs/testing/scripts/onbs-2360-llm.mjs`（一般ユーザー・検証用プロダクト pid=248）で実施した。
保存内容はチャット詳細 API の `data.llm`、OpenAI へ渡した値は AI-API（`/ecs/dev-onboarding-ai-api`）の `Retrieved reasoning effort` で照合した。
検証用チャットは確認後に下書きへ戻して削除済み。

**dev の `llm_models` は gpt-4.1 / gpt-4o / gpt-5 が利用不可（`is_available = 0`）。** gpt-4.1 と gpt-5 は近々廃止予定のため、2026-11-17 に dev で無効にした。 選択肢に出るのは gpt-6.1-terra（推論なし／あり）と gpt-5.1 の 3 つで、
推論に対応しないモデル（D8）は dev では選べない。本番の行の状態はリリース前に確かめる。
本番でも gpt-4.1・gpt-5 を無効にする（手順はリリース手順の「gpt-4.1・gpt-5 の無効化（本番）」）。

| # | 項目 | 確かめ方 | 結果 |
| --- | --- | --- | --- |
| D1 | AI モデルの選択肢が、利用可能なモデルの priority 順に「gpt-6.1-terra（推論なし）」「gpt-6.1-terra（推論あり）」、続いて既存のモデルの順に並ぶ | AI チャット編集 > 詳細設定 > AIモデル | OK（dev は 推論なし / 推論あり / gpt-5.1） |
| D2 | 既存のチャット（gpt-5.1 等）を開くと、選択中のモデルが今までどおり表示される | 既存チャットを開く | OK（`{"model": "gpt-5.1"}` の設定を開いて「gpt-5.1」と表示） |
| D3 | 「推論あり」を選ぶと保存され、再読み込み後も「推論あり」が選ばれている | 選択 → 再読み込み | OK |
| D4 | D3 の設定が `settings.llm = {"model": "gpt-6.1-terra", "reasoning_effort": "medium"}` で保存されている | チャット詳細 API の `data.llm` | OK |
| D5 | **推論あり**でプレビューから質問し、応答が返る | プレビュー。AI-API のログに `Retrieved reasoning effort: medium` | OK（「日本の首都は東京です。」・ログ medium） |
| D6 | **推論なし**に変えてプレビューから質問し、応答が返る | AI-API のログに `Retrieved reasoning effort: none` | OK（「日本の首都は東京都です。」・ログ none） |
| D7 | **gpt-5.1（既存モデル）**に戻してプレビューから質問し、応答が返る（`reasoning_effort` を送らない） | AI-API のログに `Retrieved reasoning effort: None` | OK（「日本の首都は東京です。」・ログ None） |
| D8 | gpt-4.1 に変えてプレビューから質問し、応答が返る（推論に対応しないモデルに送っていない） | 同上 | 対象外（dev では gpt-4.1 が利用不可。送らない条件は D7 の gpt-5.1 と同じ経路で確認済み） |
| D9 | 推論ありで公開し、公開側（`userEnv: prod` 相当の経路）でも応答が返る | 表示条件を `user_id=onbs2360` に絞って公開し、デモサイト（新 TS）から質問 | OK（「日本の首都は東京です。」・ログ `env=prod` で medium） |
| D10 | Dify 連携をオン → オフにすると、「gpt-6.1-terra（推論なし）」に戻り、`settings.llm` に `reasoning_effort: none` が入る | 外部連携（Dify はダミーの API キーで保存。Dify へは質問しない） | OK |
| D11 | AI チャットを新規作成すると、AI モデルが「gpt-6.1-terra（推論なし）」になり、`settings.llm` に `reasoning_effort: none` が入る。そのままプレビューで応答が返る | 新規作成 | OK（応答は D6 と同じ設定で確認） |

## prod（リリース後）

| # | 項目 | 結果 |
| --- | --- | --- |
| P1 | 選択肢が D1 のとおり並び、新規作成したチャットが「gpt-6.1-terra（推論なし）」になる | |
| P2 | 既存のチャットの応答が今までどおり返る（AI-API のエラー通知が増えていない） | |
| P3 | 検証用のチャットで推論あり・なしを選び、それぞれ応答が返る | |
