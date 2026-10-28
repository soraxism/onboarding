# ONBS-2255 C: python3.11 の Lambda の移行計画

python3.11 は 2027-06-30 にサポートが終わる（作成は 2027-07-29、更新は 2027-08-31 から不可）。
対象の全数と管理元を洗い出し、移行の進め方を決める。調査日は 2026-10-28。

## 対象

python3.11 は **414 関数**。**すべて CloudFormation（serverless）の管理下**で、コンソールで作った関数は無い。
「未使用」は CloudWatch の保持上限である直近 455 日の実行が 0 件のもの。

| サービス（スタック） | リポジトリ / 設定ファイル | 関数数（dev+prod） | うち未使用 |
| --- | --- | --- | --- |
| onboarding-manage-api | onboarding-manage-api `api/rest/serverless.yml`（関数ごとのネストスタック） | 245 | 18 |
| onboarding-ext-editor-api | onboarding-manage-api `api/rest-ext-editor/serverless.yml` | 70 | 4 |
| manage-sync-guide | onboarding-manage-api `api/websocket/serverless.yml` | 30 | 0 |
| onboarding-manage-batch | onboarding-manage-api `api/batch/serverless.yml` | 26 | 11 |
| onboarding-api | onboarding-api `src/serverless.yml` | 22 | 6 |
| onboarding-ext-viewer-api | onboarding-manage-api `api/rest-ext-viewer/serverless.yml` | 10 | 0 |
| onboarding-ai-server | Onboarding-AI-Server `src/serverless.yml` | 4 | 0 |
| split-stacks-test（dev のみ） | 不明（2024-11 の検証用） | 4 | 4 |
| rss-summarization-lambda（prod のみ） | 未確認 | 1 | 0 |
| onboarding-openai-server（prod のみ） | 未確認（`aiChatApi-prod`。最終実行 2025-10-05） | 1 | 0 |
| onboarding-manage-batch-detect-csv（prod のみ） | onboarding-manage-api の batch を別ステージで配備したものとみられる（最終実行 2026-06-29） | 1 | 0 |

**ランタイムは各 `serverless.yml` の `provider.runtime: python3.11` で一括指定**されている。
コンソールで個別に変えると次のデプロイで戻るため、**移行はリポジトリの変更＋デプロイで行う**（ONBS-2255 B の3関数とは扱いが違う）。

## 移行先

**python3.13**（サポート終了 2029-06-30）。B の3関数と揃える。
python3.12 は 2028-10-31 に終わるため、移行の手間が同じなら 3.13 のほうが長く持つ。

## 移行で引っかかる点

### 1. レイヤーの作り直し

各サービスのレイヤーは python3.11 向け（`CompatibleRuntimes: python3.11`）。

- mngV1Layer / mngV1CsvLayer / mngV1SyncGuideLayer / mngV1LayerDetect / v1BatchLayer / batchCustomLayer
- v1OnbApiLayer
- aiServerExternalLibs / aiServerCustomLibs

C 拡張を含むパッケージ（pandas・numpy・cryptography・pydantic-core 等）は、Python のバージョンごとにビルドが要る。
**レイヤーを python3.13 で作り直さないと、関数の import で落ちる。**
onboarding-manage-api の `api/batch/layers/` には python3.12 でビルドしたものが入っているので、まずどの Python で作られているかを確かめる。

### 2. Serverless Framework v3 のスキーマ

v3（3.39.0 / 3.40.0）のスキーマにある Python は python3.7〜3.11 まで。python3.12 / 3.13 は無い。

- `configValidationMode` が既定（warn）のサービスは、警告が出るだけでそのまま配備される
- **onboarding-api は `configValidationMode: error`** なので弾かれる。nodejs24.x と同じく `resources.extensions` で `Runtime` を上書きする（メモリ「Serverless v3 は nodejs24.x をスキーマで弾く」と同じ手順）

### 3. コードの互換性

3.11 → 3.13 で影響しうるもの。

- 3.12: `distutils` の削除、`datetime.utcnow()` の非推奨化（警告のみ）
- 3.13: `cgi`・`imghdr` など古い標準ライブラリ（PEP 594）の削除
- ライブラリ側: 古い版の pandas / numpy は 3.13 用のビルドが無い。依存の更新が要ることがある

## 進め方

1. **未使用の関数を先に整理する**（計 43 件）
   - split-stacks-test（4件・検証用）はスタックごと削除する
   - それ以外の未使用 39 件は、リポジトリの定義から外すか残すかを各担当と決める（dev だけ未使用のものも多い）
2. **サービスごとに移行する**。1サービス＝1チケットにする
   - レイヤーを 3.13 で作り直す → `provider.runtime` を `python3.13` にする → dev へ配備
   - dev で主要な経路を実際に通す（API は代表的な画面操作、バッチは1回実行、WebSocket は編集の同期）
   - リリース → prod でも実行ログに `python:3.13` と、エラーが無いことを確かめる
3. **順番**: 小さいものから始めて、手順を固めてから大きいものへ
   1. onboarding-ai-server（4）
   2. onboarding-api（22）
   3. onboarding-ext-viewer-api（10）
   4. onboarding-manage-batch（26）
   5. manage-sync-guide（30）
   6. onboarding-ext-editor-api（70）
   7. onboarding-manage-api（245）
   - リポジトリが未確認の3件（rss-summarization / openai-server / detect-csv）は、管理元を確かめてから個別に扱う
4. **期限**: 2027-03 末までに prod の移行を終える（サポート終了の 3か月前。問題が出たときに戻す余裕を残す）

## 決めること

- 移行先を python3.13 にするか（3.12 にするか）
- 未使用 39 件の扱い（定義から外すか残すか）
- サービスごとのチケットの起票時期と担当
