# ONBS-2069 リリース手順書

スマートフォン向け AI チャット新UI（下部フローティング）の本番リリース手順。

**5リポジトリにまたがり、順序に依存関係がある。** 下記の順でしか出せない。

対象の確認結果は [2026-10-07_dev-test-result.md](./2026-10-07_dev-test-result.md)、
設計は [2026-10-06_mobile-floating-ui-implementation-plan.md](./2026-10-06_mobile-floating-ui-implementation-plan.md)。

## 0. 作成時点の状態（2026-10-07）

| リポジトリ | 作業ブランチ | デフォルト | 直前タグ | 今回のタグ |
| --- | --- | --- | --- | --- |
| `Onboarding-AI-Chat` | `feature/ONBS-2069` | `main` | `1.34.0` | **`1.35.0`** |
| `Onboarding-API-Next` | `feature/ONBS-2069` | `main` | `1.32.4` | **`1.33.0`** |
| `onboarding-manage-api` | `feature/ONBS-2069` | `main` | `5.108.4` | **`5.109.0`** |
| `onboarding-manage-web` | `feature/ONBS-2069` | `master` | `7.103.0` | **`7.104.0`** |
| `onboarding-web` | `feature/ONBS-2069` | `master` | `6.10.5` | **`6.11.0`** |

すべて **`feature/` を含むためマイナー +1・パッチ 0**（CLAUDE.md の規約）。

**`release` ブランチは全リポジトリともクリーン**（他者のリリース待ちなし）を確認済み。
ただし **PR 作成の直前に必ず取り直すこと**。他の人の分が入っていたら、一緒に出してよいか確認する。

```bash
git fetch origin
git log --format='%h %an %s' origin/main..origin/release   # または origin/master..origin/release
```

## 1. リリース順序と理由

```
1. Onboarding-AI-Chat      ← npm に 1.35.0 を公開する。これが無いと 5 が進まない
2. Onboarding-API-Next     ← 配信レスポンスに mobile_ui_type を載せる
3. onboarding-manage-api   ← PATCH /trigger で mobile_ui_type を受け付ける
4. onboarding-manage-web   ← 設定UIを出す
5. onboarding-web          ← パッケージを 1.35.0 へ差し替え、配信JSを S3 へ
```

| 順 | なぜこの位置か |
| --- | --- |
| 1 | `onboarding-web` が参照する npm パッケージ。main マージで GitHub Actions が `1.35.0` を公開する |
| 2 | 設定を保存できても配信に載らなければエンドユーザーに届かない。管理画面より先に出す |
| 3 | 管理画面が先だと保存が 400 になる。**4 より前に出すこと** |
| 4 | 設定UI。3 が出ていれば保存できる |
| 5 | 1 の正式公開が前提。配信JSのアップロードまで終えて初めてエンドユーザーに届く |

**1 と 5 の間が空いても実害はない。** その間は「設定できるが新UIは出ない」状態で、
既存顧客は旧UIのまま影響を受けない（設定を持たないデータは `launcher` にフォールバックする）。

## 1-2. 実際の進め方（2026-10-07 時点）

**`Onboarding-AI-Chat` だけ先行してリリースする。** `onboarding-web` が参照する npm パッケージであり、
これが正式公開されないと 5 が進まないため。

| リポジトリ | feature → release の PR | release へのマージ | release → main/master | タグ |
| --- | --- | --- | --- | --- |
| `Onboarding-AI-Chat` | 作成する | **する** | **する** | **`1.35.0` を発行** |
| 他4リポジトリ | 作成する | **しない（PR を開いたまま）** | しない | しない |

他4つはレビューを通すところまで進め、**マージ可能になっても開いたままにする**。
リリースは翌日以降にまとめて行う。

| PR | 状態 |
| --- | --- |
| [Onboarding-AI-Chat#88](https://github.com/stands/Onboarding-AI-Chat/pull/88) | レビュー中 |

## 2. 各リポジトリの手順

### 2-1. 共通の流れ

```bash
# ① 作業ブランチ → release の PR（squash merge）
gh pr create --base release --head feature/ONBS-2069 --title "..." --body "..."
gh pr comment {PR番号} --body "@coderabbitai review"   # 自動レビューは走らないので明示する
# → 指摘に対応。push のたびに再度トリガーする（レート制限は 5 レビュー/時）

# ② release → main / master の PR（マージコミット。squash 禁止）
gh pr create --base main --head release --title "{YYYYMMDD} Release"
# → CodeRabbit は待たずにマージしてよい（①でレビュー済みのため）

# ③ タグ発行とリリースノート（1コマンドで同時に）
gh release create {タグ} --target main --title {タグ} --notes "ONBS-2069: ..."
```

**`git tag` との併用は禁止**（二重タグ・タグ漏れの原因）。

### 2-2. Onboarding-AI-Chat（1.35.0）

```bash
gh release create 1.35.0 --target main --title 1.35.0 \
  --notes "ONBS-2069: スマートフォン向けに下部フローティングUIを追加"
```

- `package.json` は既に `1.35.0`。タグと一致している
- **main マージで GitHub Actions が npm へ `1.35.0` を公開する。** 完了を確認してから 5 へ進む

```bash
gh run list --branch main --limit 3 --repo stands/Onboarding-AI-Chat
```

### 2-3. Onboarding-API-Next（1.33.0）

```bash
gh release create 1.33.0 --target main --title 1.33.0 \
  --notes "ONBS-2069: 配信レスポンスに trigger.mobile_ui_type を追加"
```

### 2-4. onboarding-manage-api（5.109.0）

```bash
gh release create 5.109.0 --target main --title 5.109.0 \
  --notes "ONBS-2069: PATCH /trigger で mobile_ui_type を受け付ける"
```

### 2-5. onboarding-manage-web（7.104.0）

```bash
gh release create 7.104.0 --target master --title 7.104.0 \
  --notes "ONBS-2069: スマートフォンでの表示形式を選べるようにする"
```

**`--target` は `master`**（このリポジトリに `main` は無い）。

### 2-6. onboarding-web（6.11.0）

**このリポジトリだけ、PR の前にやることがある。**

```bash
# ① パッケージを正式版へ差し替える（dev 版を参照したままにしない）
npm install @stands/onboarding-ai-chat@^1.35.0

# ② 拡張の manifest を採番し直す
#    Why: dev 確認時に採番した版が既にストアへ申請済み。同じ値では PKG_INVALID_VERSION_NUMBER になる
node .claude/skills/ext-version-bump/scripts/bump-version.mjs --dry-run
node .claude/skills/ext-version-bump/scripts/bump-version.mjs

# ③ 配信JSをビルド（prod）
npx webpack --config webpack.prod.js
```

その後 PR → マージ → タグ。

```bash
gh release create 6.11.0 --target master --title 6.11.0 \
  --notes "ONBS-2069: AIチャットライブラリを 1.35.0 へ更新"
```

**最後に配信JSを S3 へ手動アップロードする（人が行う）。**

| ファイル | アップロード先 |
| --- | --- |
| `build/prod/s3/onboarding-init.js` | `assets.onboarding-app.io/js/` |
| `build/prod/s3/onboarding-init-next.js` | 同上 |

**2ファイルとも上げること。** 顧客は `use_refactored_onboarding_init` フラグで新旧どちらかを読むため、
片方だけだと一部にしか届かない。

アップロード後、届いたかを実物で確かめる。**サイズと `last-modified` の両方を見る**
（dev では「上げたつもりで別の場所に上がっていた」ことがあった）。

```bash
T=$(date +%s)
for f in onboarding-init.js onboarding-init-next.js; do
  curl -sI "https://assets.onboarding-app.io/js/$f?cb=$T" | grep -iE "content-length|last-modified"
  curl -s "https://assets.onboarding-app.io/js/$f?cb=$T" | grep -c "floating__handle"
done
```

## 3. リリース後の確認（prod）

prod の検証用プロダクトは `aid=312` / `pid=391`（legacy）・`392`（next）。
手順は [docs/testing/manual-test-runbook.md](../../testing/manual-test-runbook.md)。

```bash
node docs/testing/scripts/check-access.mjs --env prod
```

**prod は本番。** 検証用プロダクトの中だけを触り、作ったものは消す。

| # | 確認内容 |
| --- | --- |
| 1 | 既存チャットの設定が「ランチャー」で表示される（設定を持たないデータのフォールバック） |
| 2 | 表示形式を切り替えて保存・公開できる |
| 3 | 配信レスポンスに `mobile_ui_type` が載る |
| 4 | **旧UIのチャットが従来どおり動く**（デグレ確認・最優先） |
| 5 | 新UIを設定したチャットでフローティングが出る（スマートフォン） |

## 4. 切り戻し

| 問題 | 対応 |
| --- | --- |
| 新UIの表示が壊れている | 管理画面で該当チャットを**ランチャーに戻す**。デプロイのやり直しは不要 |
| 旧UIにデグレが出た | `onboarding-web` の配信JSを前版へ戻す（S3 を手動で差し替え） |
| 管理画面が壊れた | `onboarding-manage-web` を前タグへ戻してデプロイ |

**新UIは設定で切り替えられるため、切り戻しの第一手は「設定を戻す」で足りる。**
配信JSの差し戻しは、旧UIまで巻き込んだ場合に限る。

## 5. 注意点

- **`release` → main / master のマージは squash しない。** タグを付ける位置とリリース履歴が壊れる
- **CodeRabbit のレビューは base が `release` の PR では自動で走らない。** `@coderabbitai review` で明示する
- **レート制限は 5 レビュー/時。** 5リポジトリを同時に出すと初回で枠を使い切る。
  指摘の修正はリポジトリごとに小分けせず、1リポジトリ1コミットにまとめてから再レビューを打つ
- **`release` → main / master の PR では CodeRabbit を待たずマージしてよい**（①でレビュー済み）
- 差分の確認は PR 作成の直前に取り直す。他者のリリース分が入っていたら一緒に出してよいか確認する
