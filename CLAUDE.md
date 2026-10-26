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

## 実装に入る前の確認（要件を満たす最小の手段か）

**実装・提案の前に、「その手段は要件を満たす最小のものか」を必ず確認する。**
要件を満たす手段が1つあるのに、多層防御や念のための対策として別の手段を重ねない。

### 確認すること

| 問い | 落とし穴 |
| --- | --- |
| 解決すべき要件は何か。1文で言えるか | 言えないなら要件が複数混ざっている。分けてから考える |
| その要件を満たす手段は何か。**最小で足りるのはどれか** | 「あると良さそう」で足した手段は、要件に対して効いていないことが多い |
| 足した手段は、要件のどの部分を担うのか | 答えられないなら不要 |
| その手段の副作用を確認したか | **同じリソースを共有する別の経路を壊していないか** |

### なぜこれを置くか

2026-10-22、ONBS-2100 で**本番のAIヒント応答が配信できなくなった**。

- 要件は「Lambda の同時実行枠を食い潰して他システムへ波及させない」こと
- これを満たす手段は `reservedConcurrency` のみで足りた（同時実行の問題であって流量の問題ではない）
- そこへ「多層防御」としてステージのスロットリングを重ねた
- その副作用（応答配信に使う `@connections` が同じステージ設定を共有する）を確認しないままリリースした

**余計な手段を足したことが根本原因で、副作用の見落としも検証漏れもその帰結だった。**
手段を絞っていれば、後続の2つの失敗は起きていない。

### 検証について

**「設定が入ったこと」の確認は動作確認ではない。**
上記では dev で接続と異常系だけを確認し、**正規の応答を1件も通さないままリリースした**。

- 利用者が実際に通る経路を、最低1件は通して確認する
- テスト項目書に書いた項目を未実施のままリリースしない
- 環境の都合（DBの停止など）で確認できない項目があるなら、**それが済むまでリリースしない**

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

# リモートを最新化（本体のブランチは切り替えない）
git -C {リポジトリ} fetch origin main   # または master

# 最新の main からワークツリーごとブランチを作る（「5. ワークツリーで作業する」を参照）
git -C {リポジトリ} worktree add -b feature/ABC-123 $WT origin/main
```

`git checkout -b` で本体のブランチを切り替える方法は、**本体で他の案件が動いていないと
分かっている場合のみ**にする。

### 5. ワークツリーで作業する（既定）

**同じリポジトリで複数の案件が並行することが増えたため、実装は git worktree で行う。**
本体のチェックアウトは触らない。

本体で `git switch` すると、別案件を進めている作業を巻き込む。ブランチが変わったことに
気づかないままビルド・テストすると、**別ブランチのコードを対象に確認して誤った結論を出す**。

```bash
# scratchpad など、リポジトリの外に作る（リポジトリ内に作ると管理対象が汚れる）
WT=<作業用ディレクトリ>/{リポジトリ名}-{チケット番号}

git -C {リポジトリ} worktree add $WT feature/ABC-123          # 既存ブランチで作業する
git -C {リポジトリ} worktree add -b feature/ABC-123 $WT main  # 新規ブランチを切る
git -C {リポジトリ} worktree add --detach $WT origin/develop  # 読み取り・ビルドだけなら detached

ln -s {リポジトリ}/node_modules $WT/node_modules              # 依存は本体を借りる
```

- **ブランチで作業するなら `--detach` を付けない。** detached だとコミットしてもブランチが進まない
- **読むだけ・ビルドするだけなら `--detach`。** ブランチを占有しない
- `node_modules` は symlink で足りる。`npm ci` をやり直す必要はない

#### 終わったら必ず片付ける

```bash
rm -f $WT/node_modules $WT/.env*        # symlink を先に外す
git -C {リポジトリ} worktree remove --force $WT
git -C {リポジトリ} worktree prune
```

**ブランチをチェックアウトしたワークツリーを残すと、本体で同じブランチに切り替えられなくなる。**
残骸がないかは `git worktree list` で確認する。

#### リポジトリごとの注意

| リポジトリ | ワークツリーで追加に必要なもの |
|---|---|
| `onboarding-manage-web` | テスト前に `npx nuxi prepare`。`.nuxt/tsconfig.json` が無いと vitest が起動しない |
| `onboarding-web` | `ext-version-bump` を使うなら `.env.webstore` の symlink（git 管理外で本体にしかない） |

`docs/testing/credentials.local.md` のように **git 管理外で本体にしか無いファイル**は
ワークツリーへ来ない。必要なものは symlink するか、本体のパスを直接指す。

## Jira の運用

Atlassian の MCP コネクタ（`claude.ai Atlassian`）経由で起票・更新する。
未接続なら `/mcp` から `claude.ai Atlassian` を選んで認可する（認可はユーザー操作が必要）。

| 項目 | 値 |
| --- | --- |
| サイト | `https://onboarding-app.atlassian.net` |
| cloudId | `0674bc27-e326-4507-b634-97e31886259e` |
| プロジェクトキー | `ONBS` |

### 起票時の既定値

| 項目 | 設定 |
| --- | --- |
| 課題タイプ | **機能実装（`feature/`）は「タスク」、バグ修正（`hotfixes/`）は「バグ」** |
| スプリント | **すぐ対応するものは今スプリント、残課題はバックログ** |
| 担当者 | **Takehiko Sora**（`6225507a9c3cce00694d5727`） |
| 親 | **エピック「空タスク」（`ONBS-2099`）** |

- **親には必ず「空タスク」エピックを設定する。** 空欄にしない。
  このエピックは、特定の大きな施策に属さないチケットの置き場として使われている
- **既存チケットのサブタスクにはせず、新規チケットとして作成する**
- 採番は Jira 側で自動。発行された `ONBS-nnnn` をそのままブランチ名・コミット・ドキュメントの
  ディレクトリ名に使う（「ブランチ運用」「ドキュメントの残し方」を参照）

### 起票の内容

`docs/features/{チケット番号}/{YYYY-MM-DD}_jira-summary.md` と同じ粒度で書く。
問題点 / 対応方針 / 影響範囲（対象リポジトリ一覧）を含める。
詳細ドキュメントがある場合は、そのパスを本文から参照する。

### 不正アクセスインシデント関連の調査

不正アクセス（セキュリティインシデント）関連の調査・対応では、**情報が不足していると感じたら、結論を出す前に必ず次の2箇所を確認する**。断片的な記憶や単一チケットだけで判断しない。

| 情報源 | 場所 |
| --- | --- |
| Slack チャンネル | **#不正アクセス関連**（`C0C9VM48MQ8`）— 対応の本体。顧客通知・個人情報保護委員会への報告・意思決定の経緯が集約されている |
| Jira エピック | **ONBS-2109「不正アクセス関連の対応」配下の子チケット一式** — 調査・是正の記録。インシデント関連の新規調査チケットもこのエピック配下に作る（既定の「空タスク」ではない） |

- 各調査チケットのコメントに実施状況・確定値・証跡が時系列で残っている。結論を出す前に関連チケットのコメントまで読む。
- Slack は意思決定・対外対応の一次情報。Jira に無い確定事項が Slack 側にあること（その逆も）があるため、両方を突き合わせる。
- 横断的な調査サマリ（影響まとめ等）が存在する場合はそれを正本として優先し、各チケットはその裏付け・差分として扱う。

## セキュリティアラートの確認（#manage-api-security-alert-prod）

管理画面・拡張機能 API への攻撃のおそれを通知する本番アラートの監視・一次対応の手順。2026-10-14 の不正アクセスを受けて新設したもので、当面は日次で確認する。

- 通知先: Slack **#manage-api-security-alert-prod**（`C0C9KEU4GF9`）。CloudWatch Alarm（Amazon Q bot）が ALARM 時に投稿する。
- **対応手順の正本は同チャンネルの canvas**（通知種別ごとの「調べ方／判断と対応」）。必ず canvas を読んでから対応する。
- AWS: アカウント `091413534636` / リージョン `ap-northeast-1`。

### 確認の進め方（1通知ごと）

1. **調査を始める前に、その通知に 👀（`eyes`）リアクションを付ける。** 他のエンジニアとの重複確認を防ぐため。
   - すでに他の人の 👀 や ✅ が付いている通知は、その人が確認中／確認済みなので手を付けない。
   - リアクションを付けられない場合は、スレッドに「確認中」と投稿して代える。
   - 👀 は確認後も外さず、そのまま ✅ を足す（下記 6）。
2. 通知の種別を canvas「1-2. 通知の一覧」で特定し、対応する節（2-x / 3-x）の手順に従う。
3. **調査（読み取りのみ）**:
   - アプリのログ: CloudWatch Logs Insights。ロググループ `/aws/lambda/mngV1*-prod`（例 `mngV1PwReset-prod`・`mngV1Auth-prod`）。監査ログ `[AUDIT][REQUEST]`/`[AUDIT][RESPONSE]`、`email` 等は伏せ字。
   - 送信元 IP・国: WAF ログ（`s3://aws-waf-logs-stands-onboarding/AWSLogs/091413534636/WAFLogs/ap-northeast-1/ag-onboarding-manage-api-prod/YYYY/MM/DD/HH/MM/`。**時刻は UTC**＝JST−9h、5分パーティション）。
   - **WAF ログの生行は Slack/Jira 等に貼らない**（ヘッダに `x-onboarding-api-token` が平文）。`clientIp`・`country`・`uri`・`action` だけを抽出し、**取得ファイルは処理後に必ず削除する**。
4. **判断**: canvas 各節の「判断と対応」に従う。不審点なし（国内 IP・ALLOW・総当たりなし・併発アラートなし 等）→ 正規利用。不審点あり（海外 IP・総当たり・直前のロック/上限通知・2026-10-14 と同じ形 等）→ 乗っ取りとして扱う。
5. **破壊的・対外的な対応（トークン失効・パスワード無効化・IP 遮断・本人連絡）は独断で実行しない。** 不審と判断した場合は実行前に空／文へエスカレーションする（canvas に手順はあるが、判断と実行は人が行う）。
6. **確認が済んだ通知には ✅（`white_check_mark`）リアクションを付ける。**
7. **問題なしと判断した場合は、その旨と根拠を同チャンネルに投稿する**（根拠＝件数・成功/失敗・送信元 IP/国・併発アラートの有無・対象アカウント種別）。

### 代表例: 「管理画面 パスワード再設定の成功」（PwResetSuccess / canvas 2-7）

2026-10-14 の侵入経路で、正規利用でも毎回発火する。確認観点:

- `mngV1PwReset-prod` の `[AUDIT]` で対象期間の **pw-reset 総リクエスト数**（総当たりなら数十万件規模／正規なら数件で全て初回成功 200・失敗 0）。
- 伏せ字アドレスのドメインが**正規パートナー**か、**業務時間帯**か。
- WAF ログで**送信元 IP・国**（国内 JP・ALLOW か。海外 IP・BLOCK なら要警戒）。
- 併発アラート（`2-6 照合回数上限`・`3-2 WAF レート制限`）の有無。
- 対象に**システム管理者アカウント**（`admin@onboarding-app.io` 等）が含まれないか（含まれ、かつ続けて `2-2 二要素認証コードのロック` が出たら攻撃者がパスワードを保持＝重大）。

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
- **CodeRabbit の自動レビューは走らない**（base が `release` のPRでは無効化されている）。
  レビューを受けたいときは明示的にトリガーする

```bash
gh pr comment {PR番号} --body "@coderabbitai review"
```

レビュー開始までは3〜4分程度かかる。監視と指摘対応は `stands-babysit-coderabbit` スキルに任せてよい。

#### push ごとにトリガーが必要

**指摘に対応して push しても再レビューは自動で走らない。** 新しいコミットの
commit status に `Review skipped: reviews are disabled for this base branch` が付く。
push のたびに `@coderabbitai review` を打つこと。

#### レート制限は 5 レビュー/時

トリガーが `⚠️ Action not completed / Review rate limited.` で拒否されることがある。
1時間あたり5レビューまでで、**複数リポジトリを同時にPRすると初回で枠を使い切る**
（5リポジトリ同時なら、その1時間は再レビューを1件も受けられない）。

- レビュー枠の消費時刻は bot のコメント時刻で追える。そこから1時間で復活する
- 拒否されたトリガーは枠を消費しない
- **成否は commit status の description で判定する。** `success` だけでは足りない。
  `Review completed` なら実施済み、`Review rate limited` / `Review skipped: ...` は未実施

```bash
gh api repos/stands/{repo}/commits/{sha}/status \
  --jq '.statuses[] | select(.context=="CodeRabbit") | "\(.state) :: \(.description)"'
```

複数リポジトリにまたがる対応では、**指摘の修正をリポジトリごとに小分けで push せず、
1リポジトリ1コミットにまとめてから再レビューを打つ**と枠を無駄にしない。

#### インラインに出ない指摘がある

差分の外を指す指摘は、レビュー本文の
`⚠️ Outside diff range comments` にしか出ず、**インラインコメントとして投稿されない**。
`stands-babysit-coderabbit` の `fetch_comments.sh` はインラインのスレッドだけを見るため
この分を取りこぼす。レビュー本文も必ず確認すること。

```bash
gh api repos/stands/{repo}/pulls/{PR番号}/reviews \
  --jq '.[] | select(.user.login=="coderabbitai[bot]") | .body' | grep -c 'Outside diff'
```

返信先のスレッドが無いため、この指摘への返信はPRコメントで行う。

### 2. release → main / master へのPR（リリース）

- PRタイトルは `{YYYYMMDD} Release`（例: `20260826 Release`）
- 同日2回目以降は連番を付ける（`20260826 Release_01`、`20260826 Release_02` …）
- マージ方式は **マージコミット**。squash するとタグを付ける位置とリリース履歴が壊れるため禁止
- マージ先は main / master のうちリポジトリに存在する側
- **CodeRabbit のレビューは待たずにマージしてよい**。差分は作業ブランチ → `release` のPRで
  すでにレビュー・対応済みであり、同じ内容への重複レビューになる。
  ここで待つと修正が本番へ届くのが遅れるだけなので、`pending` のままマージして差し支えない
  （base が `release` のPRでは自動レビューが無効化されているが、base が main / master のこのPRでは走ることがある）

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
- 決定した順序は `docs/features/{Jiraチケット番号}/{YYYY-MM-DD}_release-runbook.md` に残す

## dev 環境へのデプロイ（動作確認の前に行う）

**dev 環境は `develop` ブランチから作られる。** 作業ブランチに実装しただけでは
dev 環境に反映されないため、**動作確認を始める前に作業ブランチを `develop` へマージして push する**。

これはリリース経路（`release` → main / master）とは別の、確認用の経路。
`develop` へのマージはリリースではないので、PR は不要。

### 1. push で何が起きるか

| リポジトリ | `develop` への push で起きること |
| --- | --- |
| `onboarding-manage-web` | dev 環境へデプロイ |
| `onboarding-manage-api` | dev 環境へデプロイ |
| `Onboarding-Editor-Extension` | エディタ拡張（dev）を Chrome ウェブストアへ自動申請 |
| `onboarding-web` | プレビュー拡張・ビューワー拡張（dev）を Chrome ウェブストアへ自動申請 |
| `onboarding-e2e-test` | `develop` が無いため何もしない |

**`onboarding-web` の配信 JS（`onboarding-init.js` / `onboarding-init-next.js`）は
CI では配信されない。** dev / prod とも S3 への手動アップロードが必要。

```bash
# ビルド（build/dev/s3/ に 2 ファイル出力される）
cd onboarding-web && npx webpack --config webpack.dev.js
# → build/dev/s3/onboarding-init.js       を (S3) dev-assets.onboarding-app.io/js/ へ
# → build/dev/s3/onboarding-init-next.js  を 同上へ
```

**2 ファイルとも上げること。** 顧客は `use_refactored_onboarding_init` フラグで
新旧どちらかを読むため、片方だけだと一部にしか届かない。
アップロードは人が行う。エージェントはビルドまで済ませて依頼する。

### 2. 手順

`develop` へのマージは **`origin/develop` から行う**。ローカルの `develop` は
他案件の未 push コミットを抱えていることがあり、そのまま push すると巻き込む。

**マージ用のワークツリーを切って行う**（「5. ワークツリーで作業する」を参照）。
本体のチェックアウトは別案件が使っていることがある。

```bash
WT=<作業用ディレクトリ>/{リポジトリ名}-develop
git -C {リポジトリ} fetch origin develop
git -C {リポジトリ} worktree add --detach $WT origin/develop

git -C $WT merge --no-ff feature/ABC-123 -m "Merge branch 'feature/ABC-123' into develop"
git -C $WT push origin HEAD:develop

git -C {リポジトリ} worktree remove --force $WT   # 片付け
```

**`develop` は release からの取り込みで作り直されることがある。** 以前マージしたはずの
コミットが消えていることがあるので、動作確認の前に反映されているかを確かめる。

```bash
git -C {リポジトリ} merge-base --is-ancestor {マージしたSHA} origin/develop && echo OK || echo 消えている
```

push の前に次の 2 つを済ませる。

1. **テストを流す**（`develop` 側の変更と衝突していないかの確認）
2. 拡張機能のあるリポジトリでは **`ext-version-bump` で採番する**（下記）

### 3. 拡張機能の manifest バージョン

**バージョンは手で決めない。** 各リポジトリの `ext-version-bump` スキルを使う。

| リポジトリ | 対象 manifest |
| --- | --- |
| `onboarding-web` | preview / viewer × dev / prod の 4 ファイル |
| `Onboarding-Editor-Extension` | dev / prod の 2 ファイル |

```bash
/ext-version-bump              # 対象を聞かれる
# 直接叩く場合
node .claude/skills/ext-version-bump/scripts/bump-version.mjs --dry-run
```

スキルは **Chrome ウェブストアの現行版（審査待ちドラフトを含む）を基準に**採番する。
ローカルやリポジトリの値からインクリメントしないため、`develop` 側で他者が採番していても
衝突せず、`PKG_INVALID_VERSION_NUMBER` での申請失敗も起きない。
採番種別はブランチ名から決まる（`feature/` → マイナー +1 / `hotfixes/` 等 → パッチ +1）。

実行するタイミングは 2 つある。**どちらも `develop` へ push する前**。

- 実装が一通り終わったとき
- `develop` へマージして manifest がコンフリクトしたとき（衝突は他者の採番と重なったということ。
  どちらかを選ぶのではなく、マージを解決してからスキルを実行して採番し直す）

**ストアへ上がった後に再実行しないこと。** スキルはストアの現行版を基準にするため、
申請が通った直後に実行すると、その値からさらに上がる。中身が同じものを
別バージョンで再申請するだけになる。次の変更に着手するときに実行すればよい。

### 4. 確認

```bash
gh run list --branch develop --limit 3
```

## ドキュメントの残し方

置き場所と命名の詳細は [README.md](README.md) にある。
dev 環境での動作確認を行うときは [docs/testing/README.md](docs/testing/README.md) を読むこと。

### 適用範囲の判定

| 作業の範囲 | ドキュメントの置き場所 |
| --- | --- |
| **複数リポジトリにまたがる** | `docs/features/{Jiraチケット番号}/` |
| **単一リポジトリのみ** | そのリポジトリのドキュメントルールに従う（ここでは扱わない） |

複数リポジトリにまたがる作業では、変更が個々のリポジトリに散らばって全体像が追えなくなるため、
横断的な設計・仕様・テスト情報は必ず `docs/features/{Jiraチケット番号}/` に集約する。

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
docs/features/ONBS-1938/
├── 2026-08-10_ai-abandonment-csv-logging-spec-changes.md  # 実装詳細
├── 2026-08-13_jira-summary.md                             # Jira起票用の概要
├── 2026-08-13_test-checklist.md                           # テスト項目書
└── 2026-08-18_release-runbook.md                          # リリース手順
```
