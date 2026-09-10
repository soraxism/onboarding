# onboarding

Onboarding プロダクト群の作業ディレクトリ。

このリポジトリ自体が管理するのは **`docs/` と `CLAUDE.md` だけ**。
配下の `onboarding-web/` `onboarding-manage-web/` などは**それぞれ独立した git リポジトリ**で、
このリポジトリの管理対象ではない（`.gitignore` で除外している）。

複数リポジトリにまたがる調査・設計・テストの記録をここへ集約する。

## 初期設定（クローン直後に一度だけ）

dev 環境で動作確認を行うための認証情報ファイルを作る。

```bash
cd /Users/soraxism/Dev/stands/onboarding
cp docs/testing/credentials.sample.md docs/testing/credentials.local.md
```

作ったファイルの `<>` の箇所（BASIC認証・ログイン情報）を埋める。**値は環境の管理者に確認する。**
URL やプロダクトIDは雛形に記入済みなので触らなくてよい。

`credentials.local.md` は `.gitignore` 済みでリモートには載らない。**値を他のファイルへ転記しないこと。**

続けて疎通確認する。`5/5 件 OK` が出れば準備完了。

```bash
node docs/testing/scripts/check-access.mjs
```

依存は `onboarding-e2e-test` の `node_modules` を借りる。未インストールならそちらで `npm ci` を実行する。

## 構成

| パス | 内容 |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | ブランチ運用・リリース手順・ドキュメントの残し方。**作業前に読む** |
| [docs/testing/](./docs/testing/) | dev 環境での動作確認（環境情報・手順書・スクリプト） |
| [docs/features/](./docs/features/) | チケットごとの調査・設計・テスト項目書（`features/{Jiraチケット番号}/`） |
| `{プロダクト名}/` | 各プロダクトのリポジトリ（このリポジトリの管理対象外） |

## docs/features/ に置くもの

ファイル名は `{YYYY-MM-DD}_{内容を表すkebab-case}.md`。日付は作成日で、更新時も変えない。

| 種類 | ファイル名 | 内容 |
|---|---|---|
| Jira 起票用 | `{日付}_jira-summary.md`（固定名） | そのまま貼れる粒度。問題点 / 対応方針 / 影響範囲 |
| 調査 | `{日付}_*-survey.md` 等 | 現状の挙動と根拠（コードの位置まで） |
| 設計 | `{日付}_*-design.md` 等 | 選択肢と決定、決めた理由 |
| テスト項目書 | `{日付}_test-checklist.md` | 手動で確認する項目。[docs/testing/](./docs/testing/) の手順で実施する |
| リリース手順 | `{日付}_release-runbook.md` | 複数リポジトリの順序を伴うリリース |

単一リポジトリで完結する内容はここに置かず、そのリポジトリのドキュメントルールに従う。

## 動作確認を依頼するとき

Claude Code に dev 環境での動作確認を任せられる。手順とできること・できないことは
[docs/testing/README.md](./docs/testing/README.md) にまとめてある。

拡張機能（エディタ・プレビュー・ビューワー）が絡む確認も任せられる。
ローカルのビルド成果物を読み込んで起動するので、**確認したい変更をビルドしてあること**が前提。
