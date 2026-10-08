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

| 順 | リポジトリ | PR（feature → release） | 状態 |
| --- | --- | --- | --- |
| 1 | `Onboarding-AI-Chat` | [#88](https://github.com/stands/Onboarding-AI-Chat/pull/88) | ✅ **リリース済み（`1.35.0`）** |
| 2 | `Onboarding-API-Next` | [#102](https://github.com/stands/Onboarding-API-Next/pull/102) | ✅ **リリース済み（`1.33.0` / 2026-10-08）** |
| 3 | `onboarding-manage-api` | [#880](https://github.com/stands/Onboarding-Manage-API/pull/880) | ✅ **リリース済み（`5.109.0` / 2026-10-08）** |
| 4 | `onboarding-manage-web` | [#1224](https://github.com/stands/Onboarding-Manage-Web/pull/1224) | ✅ レビュー通過（指摘1件・見送り）・開いたまま |
| 5 | `onboarding-web` | [#1459](https://github.com/stands/Onboarding-Web/pull/1459) | ✅ レビュー通過（指摘なし）・開いたまま |

### 1 のリリース実績（2026-10-07）

| 工程 | 結果 |
| --- | --- |
| #88 → `release`（squash） | `a70c931` |
| [#89](https://github.com/stands/Onboarding-AI-Chat/pull/89) `release` → `main`（マージコミット） | `e570a02` |
| タグ・リリースノート | [1.35.0](https://github.com/stands/Onboarding-AI-Chat/releases/tag/1.35.0) |
| npm 公開 | `onboarding-ai-chat@1.35.0` |

CodeRabbit の指摘は2件（どちらも safe-area）で対応済み。
あわせて、つまみ（ハンドルバー）をボタンごと共通化するリファクタを入れている。

### 2〜5 のレビュー結果（2026-10-07 完了）

**4リポジトリとも通過済み。** 残るは `release` へのマージ以降だけ。

| リポジトリ | 指摘 | 対応 |
| --- | --- | --- |
| `Onboarding-API-Next` | なし | — |
| `onboarding-manage-api` | なし | — |
| `onboarding-manage-web` | 1件（Minor） | **見送り**（下記） |
| `onboarding-web` | なし | — |

#### 見送った指摘（manage-web）

> PATCH 失敗時に選択値を復元してください。

同ページの既存の設定項目すべてが同じ挙動（`changeShape` / `changeIsHidden` も値を書いてから
保存し、失敗しても戻さない）。今回の項目だけ復元を入れると**同じ画面で片方だけ値が戻る**ことになり、
かえって分かりにくい。全項目に入れるのは既存の保存フロー全体を変える話で本チケットのスコープを超える。

**保存フロー全体の見直しは別途検討する**という判断。PR にその旨を返信済み。

### テスト整備の監査（2026-10-08）

`onboarding-manage-web` の `/migrate-audit` を実行した（`origin/master...HEAD` 対象）。

| 項目 | 結果 |
| --- | --- |
| unit gap（spec なし） | **0 件** |
| story gap（story なし） | **0 件** |
| リグレッション項目 ❌ 未記述 | **0 件** |

`coverage-map` の再生成でも差分なし。コマンド本体は作業ブランチと最新 master で同一のため、
rebase せずに実行している。

**監査では拾えない観点が1つある。** ランチャーページ（`/ai/chats/{id}/trigger`）の設定項目には
元々リグレッション項目が1つも無い（タブの存在と遷移までしか項目化されていない）。
`coverage-map` は「既存項目のうち spec に未記述のもの」を見るため、項目が無いケースは 0 件で通る。

今回の「スマートフォンでの表示形式」も項目化していない。**既存の設定項目（デザイン・カラー・
表示位置等）に倣い、追加しない判断**（2026-10-08）。ページ全体の項目整備は別途検討する。

### 2・3 の先行リリース（2026-10-08）

**バックエンド2本（`Onboarding-API-Next` / `onboarding-manage-api`）を先行してリリースした。**
デプロイに時間がかかるため、管理画面・配信JSより前に出しておく判断。

#### 先行してよいかの事前確認

どちらも**エンドユーザー・管理画面の挙動を変えない no-op リリース**であることを実コードで確認した。
後続（4・5）が何日空いても害はない。

| 確認項目 | 結果 |
| --- | --- |
| prod 配信JSが抱える AIチャットlib | `package-lock.json` で **1.34.0** に固定 |
| 旧lib が未知キーを弾くか | **弾かない**。`z.object()` のみで `.strict()` なし（1.30.0 / 1.32.0 / 1.34.0 とも0件）→ zod が黙って捨てる |
| `onboarding-web` 側の扱い | `getMountData()` は `trigger` を分割代入でそのまま渡すだけ。キー列挙も検証もしない |
| 配信データのキャッシュ | `cruds/chats.py` にキャッシュなし（Redis に載るのは product_info / targets / S3のJSON）→ 古い形との混在が起きない |
| 既存データの値 | `mobile_ui_type` を持たないため全件 `launcher` にフォールバック。見た目の変化ゼロ |
| 旧管理画面からの PATCH | `validate_patch_trigger.json` の追加は `required: false`。今までどおり通る |
| 既存値を保持する防御コード | `data` に `mobile_ui_type` がある場合だけ発火。prod はまだ誰も設定していないので動かない（4 のリリース後に効く） |
| 補完の位置 | バリデーション後・DB書き込み直前。検証には影響しない（`shortcuts` / ONBS-1689 と同じ形） |

2 と 3 の間に順序依存はない。どちらを先に出してもよい。

#### 実績

| 工程 | `Onboarding-API-Next` | `onboarding-manage-api` |
| --- | --- | --- |
| feature → `release`（squash） | [#102](https://github.com/stands/Onboarding-API-Next/pull/102) → `2be8259` | [#880](https://github.com/stands/Onboarding-Manage-API/pull/880) → `f03b28b2` |
| `release` → `main`（マージコミット） | [#103](https://github.com/stands/Onboarding-API-Next/pull/103) `20261008 Release` → `3ba9600` | [#883](https://github.com/stands/Onboarding-Manage-API/pull/883) `20261008 Release_01` → `ea2319a8` |
| タグ | [1.33.0](https://github.com/stands/Onboarding-API-Next/releases/tag/1.33.0) | [5.109.0](https://github.com/stands/Onboarding-Manage-API/releases/tag/5.109.0) |
| デプロイ経路 | AWS CodePipeline（GitHub Actions には出ない） | GitHub Actions `Build and Deploy (production)` |

#### prod 確認（2026-10-08）

```bash
node docs/testing/scripts/onbs-2069-prod-check.mjs --bust {毎回変える文字列}
```

| # | 確認内容 | 結果 |
| --- | --- | --- |
| 3 | 配信レスポンスに `mobile_ui_type` が載る | ✅ `"チャットで相談" = "launcher"` |
| 4 | 旧UIのチャットが従来どおり動く（デグレ確認） | ✅ マウント・ランチャー表示・押下で開くまで確認 |

**#3 の確認では Cloudflare のキャッシュに注意する。** デモサイトをそのまま開くと
`cf-cache-status: HIT` の古い内容が返り（確認時は `age: 98025` ≒ 27時間前）、
**API を直しても反映されていないように見える**。配信APIのリクエストにだけ一意なクエリを
足してキャッシュを外すこと（上記スクリプトはそれを行う）。

キャッシュは管理画面からの保存で `pcode:{product_code}` タグのパージが走る
（manage-api の `invalidate_product_cache`）。**API のデプロイだけでは飛ばない**ため、
既存のキャッシュは失効するまで旧い形のままになる。今回は挙動を変えない変更なので実害はない。

prod の検証用プロダクトのうち **`pid=391`（リファクタ前）には AI チャットが1件も無い**ため、
確認は `pid=392` のみで行った。

**`onboarding-manage-api` の直前タグは手順書作成時の `5.108.4` から `5.108.5` に動いていた**
（同日 [#882](https://github.com/stands/Onboarding-Manage-API/pull/882) / ONBS-2079 のリリース）。
`feature/` を含むためマイナー +1 で `5.109.0` のまま変わらず。同日2回目のため
リリースPRのタイトルは `20261008 Release_01` とした。ONBS-2079 は `mng-v1-chats-chat-id/` に
触れていないため衝突なし。

### 4・5 のリリース（2026-10-08）

| 工程 | `onboarding-manage-web` | `onboarding-web` |
| --- | --- | --- |
| feature → `release`（squash） | [#1224](https://github.com/stands/Onboarding-Manage-Web/pull/1224) → `d548bc424` | [#1459](https://github.com/stands/Onboarding-Web/pull/1459) → `28cf1677` |
| `release` → `master`（マージコミット） | [#1227](https://github.com/stands/Onboarding-Manage-Web/pull/1227) `20261008 Release_01` → `850632b33` | [#1460](https://github.com/stands/Onboarding-Web/pull/1460) `20261008 Release` → `7202ae4d` |
| タグ | **[7.105.0](https://github.com/stands/Onboarding-Manage-Web/releases/tag/7.105.0)** | [6.11.0](https://github.com/stands/Onboarding-Web/releases/tag/6.11.0) |
| デプロイ | Actions `Build and Deploy` | Actions `Preview自動申請（本番）` / `Viewer自動申請（本番）` とも success |

**`onboarding-manage-web` のタグは手順書の `7.104.0` ではなく `7.105.0` になった。**
`7.104.0` は同日 [#1225](https://github.com/stands/Onboarding-Manage-Web/pull/1225)（別件・イベント別集計）
で発行済みだったため。`feature/` を含むためマイナー +1 で `7.105.0`。同日2回目なので
リリースPRのタイトルは `20261008 Release_01` とした。

拡張の manifest は prod も採番済みで、**ストアの現行版（preview 6.8.4 / viewer 3.8.5）より
上であることを申請前に確認した**（`bump-version.mjs --dry-run`）。

| manifest | 変更 |
| --- | --- |
| `preview_prod.json` | 6.8.4 → 6.9.0 |
| `viewer_general_prod.json` | 3.8.5 → 3.9.0 |

### 残りの作業

1. **prod 配信JSを S3 へアップロード（実施者）**。ビルドは完了している

   | ファイル | アップロード先 |
   | --- | --- |
   | `build/prod/s3/onboarding-init.js` | (S3) `assets.onboarding-app.io/js/` |
   | `build/prod/s3/onboarding-init-next.js` | 同上 |

   **2ファイルとも上げること。** 顧客は `use_refactored_onboarding_init` フラグで
   新旧どちらかを読むため、片方だけだと一部にしか届かない。
   **アップロード後は CDN キャッシュの削除も行う**（ONBS-1991 の prod 検証と同じ）。

   ```bash
   # リリース済み master から作り直す場合
   git -C onboarding-web worktree add --detach $WT origin/master
   ln -sf {リポジトリ}/.npmrc $WT/.npmrc   # GitHub Packages の認証に要る
   cd $WT && npm ci && npx webpack --config webpack.prod.js
   ```

   `npm ci` は本体の `node_modules` を借りずに独立で行う。**借りると古い
   `@stands/onboarding-ai-chat`（1.34.0）が混ざり、新UIの入っていないJSができる。**
   出力に `floating__chip` / `is-bottom-sheet` / `mobile_ui_type` が含まれること、
   `v2api.onboarding-app.io` を向いていることを確認した。

2. prod での確認（「3. リリース後の確認」の #1・#2・#5）

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

**#3 と #4 はバックエンド先行リリースの時点で確認済み**（2026-10-08・上記「prod 確認」）。
残るは #1・#2・#5 で、`onboarding-manage-web` と `onboarding-web` のリリース後に行う。

```bash
# 配信とデグレの確認（読み取りのみ・Cloudflare のキャッシュを外す）
node docs/testing/scripts/onbs-2069-prod-check.mjs --bust {毎回変える文字列}
```

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
