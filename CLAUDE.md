# onboarding プロジェクト共通ルール

このファイルは `/Users/soraxism/Dev/stands/onboarding` 配下のすべてのリポジトリに適用される。

## リポジトリの構成

`onboarding/` は2階層になっている。**どちらで作業しているかでルールが変わる**。

| 階層 | 内容 | 適用ルール |
| --- | --- | --- |
| `onboarding/` 直下 | `docs/` と `CLAUDE.md` のみを管理するドキュメントリポジトリ | 下記「ドキュメントリポジトリの運用」 |
| `onboarding/{プロダクト}/` | `onboarding-web` 等の各プロダクト（個別のgitリポジトリ） | 下記「ブランチ運用」 |

## ドキュメントリポジトリの運用（`onboarding/` 直下）

ドキュメントのみでコードを含まないため、通常のブランチ運用は適用しない。

- **`main` ブランチでの直接作業・コミット・pushを許可する**（グローバル設定の「mainへの直接コミット禁止」「push前に確認」の例外）
- feature / hotfixes ブランチやPRは不要
- 配下のプロダクトリポジトリはこの例外の対象外。必ず「ブランチ運用」に従うこと

## ブランチ運用（各プロダクトリポジトリ）

作業を開始する前に、必ず以下の手順を踏むこと。

### 1. ブランチ名の規約

| 作業種別 | ブランチ名 |
| --- | --- |
| 機能実装 | `feature/{Jiraチケット番号}` |
| バグ修正 | `hotfixes/{Jiraチケット番号}` |

例: `feature/ABC-123`、`hotfixes/ABC-456`

既存リポジトリには `hotfix/` `fix/` といった表記揺れが存在するが、**新規作成時は必ず `hotfixes/` を使う**。
既存ブランチの表記揺れはそのまま許容し、いずれもバグ修正系として扱う（バージョンの上げ方は「PR・リリース運用」を参照）。

### 2. Jiraチケット番号が不明な場合

- **推測してブランチを作成してはならない**
- ユーザーにJiraチケット番号を質問し、回答を得てから作業を開始する

### 3. ブランチの作成元

- 必ず `main` または `master` ブランチから作成する（リポジトリに存在する側を使う）
- 他のfeature/hotfixesブランチから派生させない

### 4. 作成前に最新化する

`main` / `master` がリモートより古い場合は、最新化してからブランチを作成する。

```bash
# デフォルトブランチ名を確認
git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'

# 最新化 → ブランチ作成
git checkout main   # または master
git pull origin main
git checkout -b feature/ABC-123
```

## PR・リリース運用（各プロダクトリポジトリ）

タグ運用のあるプロダクトリポジトリが対象。LP・E2Eテスト・APIドキュメント等、タグを発行していないリポジトリは対象外。

### 0. 全体の流れ

```
feature / hotfixes ブランチ
  └─ PR（squash merge）→ release
       └─ PR（merge commit）→ main / master   ← このマージが実質のリリース
            └─ タグ発行 ＋ GitHubリリースノート作成（1コマンドで同時に行う）
```

`release` は、他者のリリース分を含めて main / master へ一時的に統合するためのブランチ。
`release` が存在しないリポジトリは、作業ブランチから直接 main / master へPRを作成してリリースする（squash merge）。

### 1. 作業ブランチ → release へのPR

- PR先は必ず `release`（`release` がないリポジトリのみ main / master）
- マージ方式は **squash merge**

### 2. release → main / master へのPR（リリース）

- PRタイトルは `{YYYYMMDD} Release`（例: `20260826 Release`）
- 同日2回目以降は連番を付ける（`20260826 Release_01`、`20260826 Release_02` …）
- マージ方式は **マージコミット**。squash するとタグを付ける位置とリリース履歴が壊れるため禁止
- マージ先は main / master のうちリポジトリに存在する側
- **CodeRabbit のレビューは待たずにマージしてよい**。差分は作業ブランチ → `release` のPRで
  すでにレビュー・対応済みであり、同じ内容への重複レビューになる。
  ここで待つと修正が本番へ届くのが遅れるだけなので、`pending` のままマージして差し支えない
  （`release` 向けPRでは自動レビューが無効化されるが、main / master 向けPRでは走ることがある）

### 3. 他者の実装が混じっていないかの確認（必須）

`release` には他者のリリース分が含まれている可能性がある。main / master へのPRを作成する**前に**必ず差分を確認する。

```bash
# デフォルトブランチ名を確認
git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'

# release に入っていて main / master に入っていないコミットを作者付きで列挙
git fetch origin
git log --format='%h %an %s' origin/main..origin/release   # または origin/master..origin/release
```

- 自分以外の作者のコミットが含まれる場合、**その一覧をユーザーに提示し、一緒にリリースしてよいか確認を取る**。回答を得るまでPRを作成・マージしない
- 自分のコミットのみの場合はそのまま進めてよい

### 4. タグの規約

- 形式は `X.Y.Z`。**`v` プレフィックスは付けない**（例: `6.5.3`）
- main / master 上のマージコミットに付与する
- バージョンは直前のタグを基準に上げる

| リリースに含まれるブランチ | 上げ方 | 例 |
| --- | --- | --- |
| `feature/` を1つでも含む | マイナー +1、パッチは 0 | `6.5.2` → `6.6.0` |
| バグ修正系（`hotfixes/` `hotfix/` `fix/`）のみ | パッチ +1 | `6.5.2` → `6.5.3` |

- `package.json` 等のバージョン記載とタグは**同期しない。タグを正とする**

```bash
# 直前のタグを確認
git fetch origin --tags
git tag --sort=-v:refname | head -5
```

### 5. タグ発行とリリースノート作成

main / master へのマージ後、**`gh release create` 1コマンドでタグとリリースノートを同時に作成する**。
`git tag` との併用は二重タグ・タグ漏れの原因になるため行わない。

```bash
gh release create 6.6.0 \
  --target main \
  --title 6.6.0 \
  --notes "ONBS-1968: リリースフローをルール化
ONBS-1958: ランチャーのアイコン色が反映されない不具合を修正"
```

- **Release title**: タグ番号そのまま
- **Release notes**: `{Jiraチケット番号}: {実装内容を簡潔にしたもの}` を1行1件で列挙する
- ブランチ名にJiraチケット番号が含まれない場合は、チケット番号を省いて実装内容のみを書く
- `--target` は main / master のうち存在する側

### 6. develop への同期

GitHub Actions で自動同期される。同期ワークフローがないリポジトリでは何もしない（手動同期は不要）。

### 7. 複数リポジトリの同時リリース

- 依存関係を踏まえたリリース順序を決め、**実装者に提示して確認を取ってから**リリースを開始する（例: API → Batch → Web）
- 決定した順序は `docs/{Jiraチケット番号}/{YYYY-MM-DD}_release-runbook.md` に残す

## ドキュメントの残し方

### 適用範囲の判定

| 作業の範囲 | ドキュメントの置き場所 |
| --- | --- |
| **複数リポジトリにまたがる** | `docs/{Jiraチケット番号}/` （このディレクトリ直下） |
| **単一リポジトリのみ** | そのリポジトリのドキュメントルールに従う（ここでは扱わない） |

複数リポジトリにまたがる作業では、変更が個々のリポジトリに散らばって全体像が追えなくなるため、
横断的な設計・仕様・テスト情報は必ず `docs/{Jiraチケット番号}/` に集約する。

### 残すドキュメント

1. **Jira起票用の概要** — `{YYYY-MM-DD}_jira-summary.md`（固定名）
   - Jiraチケットにそのまま貼れる粒度でまとめる
   - 問題点 / 対応方針 / 影響範囲（対象リポジトリ一覧）を含める
   - 詳細ドキュメントがある場合は冒頭で相対パス参照する
2. **実装詳細・テスト項目書・チェックリスト・その他有益な資料**
   - 仕様変更の詳細、テスト項目書、リリース手順（runbook）、調査メモなど
   - 有益と判断したものは積極的に残す

### ファイル命名規約

`{YYYY-MM-DD}_{内容を表すkebab-case}.md`

日付は**そのドキュメントを作成した日**。更新時は日付を変えず、内容を追記・修正する。

```
docs/ONBS-1938/
├── 2026-08-10_ai-abandonment-csv-logging-spec-changes.md  # 実装詳細
├── 2026-08-13_jira-summary.md                             # Jira起票用の概要
├── 2026-08-13_test-checklist.md                           # テスト項目書
└── 2026-08-18_release-runbook.md                          # リリース手順
```
