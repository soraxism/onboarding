# ONBS-2079 リリース手順と実績

実施日: 2026-10-08

## 対象とリリース順序

2リポジトリにまたがるが、**両者に依存関係は無い**。

| 順 | リポジトリ | 変更の性質 |
| --- | --- | --- |
| 1 | `Onboarding-Manage-API` | プロダクト削除時に履歴テーブルが無くても通るようにする（防御） |
| 2 | `Onboarding-API` | アカウント発行ツールでフロート履歴テーブルを作るようにする（作成漏れの修正） |

manage-api は「削除が落ちる状態」を解消する防御であり、先に出しても後に出しても
もう一方の動作に影響しない。安全側として防御を先に出す順序とした。

## バージョン

| リポジトリ | 直前のタグ | 今回のタグ | 上げ方 |
| --- | --- | --- | --- |
| `Onboarding-Manage-API` | 5.108.4 | **5.108.5** | パッチ +1（`hotfixes/` のみ） |
| `Onboarding-API` | 2.53.2 | **2.53.3** | パッチ +1 |

`Onboarding-API` の作業ブランチは `feature/ONBS-2079` だが、作業種別はバグ修正。
規約どおりなら `feature/` を含むためマイナー +1 になるところを、実態に合わせて
パッチ +1 とした。**ブランチ名を `hotfixes/` にすべきだった**（次回の反省点）。

## 実施した手順

両リポジトリとも同じ流れ。

```bash
# 1. release に他者のリリース分が無いか確認（必須）
git fetch origin
git log --format='%h %an | %s' origin/main..origin/release
# → 両リポジトリとも空。他者の未リリース分なし

# 2. 作業ブランチ → release（squash merge）
gh pr merge {PR番号} --repo stands/{repo} --squash

# 3. release に入った内容を再確認
git fetch origin
git log --format='%h %an | %s' origin/main..origin/release
# → 自分のコミット1件のみであることを確認

# 4. release → main（マージコミット）
gh pr create --base main --head release --title "20261008 Release" --body "..."
gh pr merge {PR番号} --repo stands/{repo} --merge

# 5. タグ発行＋リリースノート（1コマンド）
gh release create {タグ} --repo stands/{repo} --target main --title {タグ} --notes "..."
```

## 実績

### Onboarding-Manage-API 5.108.5

| 項目 | 値 |
| --- | --- |
| 作業ブランチ | `hotfixes/ONBS-2079` |
| 作業PR | [#881](https://github.com/stands/Onboarding-Manage-API/pull/881)（squash merge） |
| リリースPR | [#882](https://github.com/stands/Onboarding-Manage-API/pull/882) `20261008 Release`（マージコミット） |
| main のマージコミット | `4a9adced` |
| タグ | [5.108.5](https://github.com/stands/Onboarding-Manage-API/releases/tag/5.108.5) |

リリースノート:

```
ONBS-2079: フロート履歴テーブルが無いプロダクトを管理画面から削除できない不具合を修正
```

### Onboarding-API 2.53.3

| 項目 | 値 |
| --- | --- |
| 作業ブランチ | `feature/ONBS-2079` |
| 作業PR | [#278](https://github.com/stands/Onboarding-API/pull/278)（squash merge） |
| リリースPR | [#279](https://github.com/stands/Onboarding-API/pull/279) `20261008 Release`（マージコミット） |
| main のマージコミット | `adbc1cd` |
| タグ | [2.53.3](https://github.com/stands/Onboarding-API/releases/tag/2.53.3) |

リリースノート:

```
ONBS-2079: アカウント発行ツールでフロート履歴テーブルが作成されない不具合を修正
```

## 確認

- タグは両リポジトリとも main の先頭（リリースPRのマージコミット）に付与されていることを確認
- `Sync Branches from Release`（develop への自動同期）が両リポジトリで動作
- `Build and Deploy (production)` の完了を確認

## 残課題

本リリースに含まれないもの。

1. **既存プロダクトへのバックフィル** — `onb_float_histories_<製品コード>` が無いプロダクトの解消。
   配信APIが 500 になる問題（今回の発端）の根治にあたる
2. **配信API のフォールバック** — フロート取得の失敗がガイド配信全体を 500 にしない構造にする
3. **未処理例外時の CORS ヘッダー** — 原因が「CORS設定ミス」に見えて切り分けが遠回りになる
