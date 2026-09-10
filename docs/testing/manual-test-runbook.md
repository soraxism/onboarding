# 動作確認 実行手順書

Claude Code（以下「エージェント」）が dev 環境で動作確認を行うための手順書。
人が読んでも同じ操作を辿れるように書いてあるが、**主たる読者はエージェント**。

- 認証情報: [credentials.local.md](./credentials.local.md)（git 追跡外。無ければ [credentials.sample.md](./credentials.sample.md) から作る）
- チケットごとの確認項目: `docs/{Jiraチケット番号}/{日付}_test-checklist.md`

## エージェントにできること・できないこと

| | 可否 | 補足 |
|---|---|---|
| 管理画面の操作（ログイン・設定変更・保存・公開） | ○ | Playwright スクリプトで自動操作する |
| エンドユーザー側デモサイトでのツアー実行 | ○ | 同上。LocalStorage の読み書きも `page.evaluate` で行える |
| 画面の見た目の確認 | ○ | スクリーンショットを撮って画像として読む |
| **ブラウザの対話的な操作** | **×** | ブラウザを直接操作する手段（Playwright MCP 等）は持たない。**すべてスクリプト経由**になる |
| **エディター拡張機能の確認** | **×** | 拡張機能のインストールと複雑な起動手順が要る。人が実施する |
| **プレビュー拡張・ビューワー拡張の確認** | **×** | 同上 |

拡張機能が絡む項目は、チェックリスト側に「人が実施」と明記して切り分けること。

## 環境

### 管理画面

`https://dev-manage.onboarding-app.io/`（BASIC認証あり・ログイン情報は credentials.local.md）

アカウント: **エンドユーザーリファクタ移行期間用**

### 検証用プロダクトとデモサイト

**新旧の JS 配信を切り分けるためにプロダクトが 2 つある。**
`use_refactored_onboarding_init` フラグの有無で配信される JS が変わるため、
エンドユーザー側の挙動を変える改修では**必ず両方で確認する**。

| | 旧 JS（legacy） | 新 TS（next） |
|---|---|---|
| プロダクト名 | リファクタ前 | リファクタ後 |
| `product_id` | 247 | 248 |
| 配信される JS | `js/onboarding-init.js`（`src/js/` 由来） | `js/onboarding-init-next.js`（`src/` 由来） |
| デモサイト | https://dev.onboarding.co.jp/demo/onb-web-refactor/ | https://dev.onboarding.co.jp/demo/onb-web-refactor/?type=new |

- デモサイトは BASIC認証あり（ID/PW は credentials.local.md。管理画面とは別の値）
- 埋め込みタグは設置済み。ステップのターゲットにする要素はページ内のどれでもよい
- ガイド一覧を開く URL は `https://dev-manage.onboarding-app.io/guides?product_id={ID}`

## 実行の準備

依存は `onboarding-e2e-test` の `node_modules` を借りる（このリポジトリは `docs/` しか管理しないため）。
未インストールならそちらで `npm ci` を実行する。

```bash
cd /Users/soraxism/Dev/stands/onboarding

# 認証情報が未作成なら
cp docs/testing/credentials.sample.md docs/testing/credentials.local.md
# → credentials.local.md の <> を埋める

# 疎通確認（ここが通らなければ以降は実施しない）
node docs/testing/scripts/check-access.mjs
```

`check-access.mjs` は次を確認する。5/5 OK が出れば環境は使える。

1. 管理画面へログインできる
2. 両プロダクトのガイド一覧を開ける
3. 両デモサイトで `STANDSUnit` が生成される（`pid` が 247 / 248 になっている）

ブラウザを目視したいときは `--headed` を付ける。

## スクリプトの書き方

`docs/testing/scripts/` に置く。**`onboarding-e2e-test` には置かない**（CI で回る E2E に混ざるため）。

| ファイル | 役割 |
|---|---|
| `lib/env.mjs` | playwright の解決、認証情報の読み込み、成果物ディレクトリの用意 |
| `lib/manage.mjs` | プロダクト定義、ブラウザ起動、管理画面ログイン、ツアー名の生成 |
| `check-access.mjs` | 疎通確認 |

新しい確認を書くときは `check-access.mjs` を雛形にする。要点は 3 つ。

- **BASIC認証は `httpCredentials` で通す**。管理画面とデモサイトで ID/PW が違うので、`launchBrowser` にどちらを渡すか間違えないこと
- **デモサイトで `networkidle` を待たない**。ガイドの通信が続くためタイムアウトする。`waitUntil: 'load'` としたうえで、`STANDSUnit` の生成を `waitForFunction` で待つ
- **管理画面のログインフォームは `#email` / `#password`**。メール欄は `type="text"` なので `input[type="email"]` では拾えない。送信ボタンは入力検証が通るまで `disabled`

スクリーンショットは `docs/testing/artifacts/{実行日時}_{名前}/` に出る（git 追跡外）。

## 検証用ツアーの扱い

**dev 環境は他の人も使う。** 作ったものが自分のものだと分かるようにし、確認が終わったら消す。

### 命名規則

```
[自動検証] {Jiraチケット番号}_{YYYYMMDD}_{用途}
例: [自動検証] ONBS-1991_20260910_チェックマーク
```

`lib/manage.mjs` の `buildTourName(ticket, suffix)` が この形式で名前を作る。
後始末で対象を拾うときは `isGeneratedTourName()`（`[自動検証] ` で始まるか）で判定する。

### 許可されている操作

- ツアー・ゴール・ステップの**作成・編集・削除**（検証用プロダクト 247 / 248 の中でのみ）
- ツアーの**公開**（同上）。公開しないとエンドユーザー側へ配信されず、新旧 JS 経由の確認ができない

### 後始末

**確認が終わったら作成したツアーは削除する。** 途中で失敗した場合も、次の実行前に残骸を消してから始める。

## 結果の残し方

1. チェックリスト（`docs/{チケット番号}/{日付}_test-checklist.md`）の「結果」欄を埋める
2. 判断の根拠になるスクリーンショットは `artifacts/` に残る。**追跡外なので、報告に必要なものは会話へ添付する**
3. 想定と違った場合は、原因の切り分け（実装の問題か、環境・データの問題か）まで行ってから報告する

## レポート（集計）の確認

dev でも日次バッチが回るため、レポート画面での確認は可能。
ただし**その日のうちには反映されない**ので、確認が必要な項目は翌日以降に回す。
チェックリストにはその旨を書いておく。

## 注意

- **認証情報を追跡対象のファイル・コミットメッセージ・会話ログへ書かない。** 値は `credentials.local.md` にだけ置く
- 2要素認証が有効なアカウントでは自動ログインできない。無効なアカウントを使う
- 公開操作は検証用プロダクトの中だけで行う。他のプロダクトのツアーは触らない
