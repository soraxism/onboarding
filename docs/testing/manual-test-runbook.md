# 動作確認 実行手順書

Claude Code（以下「エージェント」）が dev 環境で動作確認を行うための手順書。
人が読んでも同じ操作を辿れるように書いてあるが、**主たる読者はエージェント**。

- 認証情報: [credentials.local.md](./credentials.local.md)（git 追跡外。無ければ [credentials.sample.md](./credentials.sample.md) から作る）
- チケットごとの確認項目: `docs/features/{Jiraチケット番号}/{日付}_test-checklist.md`

## エージェントにできること・できないこと

| | 可否 | 補足 |
|---|---|---|
| 管理画面の操作（ログイン・設定変更・保存・公開） | ○ | Playwright スクリプトで自動操作する |
| エンドユーザー側デモサイトでのツアー実行 | ○ | 同上。LocalStorage の読み書きも `page.evaluate` で行える |
| 画面の見た目の確認 | ○ | スクリーンショットを撮って画像として読む |
| エディタ・プレビュー・ビューワー拡張の確認 | ○ | ローカルビルドを読み込んで起動する。「拡張機能の確認」を参照 |
| **ブラウザの対話的な操作** | **×** | ブラウザを直接操作する手段（Playwright MCP 等）は持たない。**すべてスクリプト経由**になる |
| **ストア配布版の拡張機能での確認** | **×** | 読み込むのはローカルビルド。インストール導線と自動更新は人が実施する |

## テスト開始時にやること

**確認したい実装が dev 環境に載っていなければ、何を確認しても意味がない。**
どこを見ているかは対象ごとに違う。

| 対象 | 何が動いているか | 反映のさせ方 |
|---|---|---|
| 管理画面 | dev にデプロイ済みのアプリ | `develop` へマージして push（自動デプロイ） |
| 管理 API | 同上 | 同上 |
| エンドユーザー側（デモサイト） | S3 の配信 JS | **ビルドして人が S3 へアップロード**（CI では配信されない） |
| 拡張機能 | ローカルのビルド成果物 | ローカルでビルドするだけ |

手順は [CLAUDE.md](../../CLAUDE.md) の「dev 環境へのデプロイ」に従う。要点は 4 つ。

1. 作業ブランチを **`origin/develop`** へマージして push する（ローカルの `develop` は使わない）
2. 拡張機能のあるリポジトリは、push の**前**に `ext-version-bump` スキルで manifest を採番する。
   バージョンを手で決めない
3. `onboarding-web` の配信 JS は `npx webpack --config webpack.dev.js` でビルドし、
   `build/dev/s3/` の **2 ファイルとも** S3 へ上げてもらう。**アップロードは人が行う**ので、
   ビルドまで済ませて依頼する
4. 確認に使う拡張機能は「拡張機能の確認」のとおりローカルでビルドする。
   ストアに上がったものではなくローカルビルドを読み込む

反映されたかは、確認を始める前に実物で確かめる。

```bash
# 配信JSに変更が入っているか（例: ONBS-1991 で追加したキー）
curl -s https://dev-assets.onboarding-app.io/js/onboarding-init.js | grep -c onb_last_step_displayed_goals_
curl -s https://dev-assets.onboarding-app.io/js/onboarding-init-next.js | grep -c onb_last_step_displayed_goals_
```

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
- **プロダクトは URL では切り替わらない**。`/guides?product_id=248` はクエリごと落ちる。
  ヘッダーの切替（`switchToProduct`）を使う
- **管理画面自身のガイドを止める**。dev の管理画面には本番の埋め込みタグが入っていて、
  ツアーが再生されるとオーバーレイ（`.g-shape`）がクリックを遮る。`blockSelfGuides` を呼ぶ
- **メニュー項目はテキストの完全一致で拾えない**。Material アイコンのリガチャ文字が
  同じ要素に入るため（`edit_squareサイト上で編集`）。`.listRow` を `hasText` で絞る

スクリーンショットは `docs/testing/artifacts/{実行日時}_{名前}/` に出る（git 追跡外）。

## 拡張機能の確認

### ビルドしてから確認する

読み込むのは**ソースではなくビルド成果物**。確認したい変更がビルドに入っていないと、
古い挙動を見て「直っていない」と誤判定する。

| 拡張機能 | ビルド | 成果物 |
|---|---|---|
| プレビュー | `onboarding-web` で `npm run build_preview:dev` | `build/dev/ext-preview` |
| ビューワー | `onboarding-web` で `npm run build_viewer:dev` | `build/dev/ext-viewer-general` |
| エディタ | `Onboarding-Editor-Extension` で `npm run build:ext_dev` | `package/` |

`npm run ...` は先頭で `npm ci` を回す。依存を入れ直したくないときは webpack / vite を直接叩く。

```bash
# プレビュー / ビューワー（onboarding-web）
npx webpack --config webpack.dev.js
npx webpack --config webpack.dev.js --env product=general

# エディタ（Onboarding-Editor-Extension）
NODE_ENV=dev npx vite build --mode dev
```

ビルドしたら疎通確認する。

```bash
node docs/testing/scripts/check-extensions.mjs
```

### 仕組みと注意

- **新ヘッドレスで起動する**。Manifest V3 の拡張機能は旧ヘッドレスでは読み込まれない
  （service worker が登録されない）。`headless: false` のまま `--headless=new` を渡している。
  画面にウィンドウは出ないので、通常はそのままでよい
- **service worker は暖機してから使う**。登録直後は `sw.evaluate` の中で `chrome` が
  未定義になることがある。`waitForExtensionWorker` が使えるまで待つ
- **拡張機能 ID は毎回変わる**。unpacked で読み込むためストア版の固定 ID にならない。
  管理画面は固定 ID 宛にメッセージを送るので、`routeManageMessagesTo` で
  `chrome.runtime.sendMessage` の宛先だけを差し替える。パラメータの組み立て
  （operation_token の取得など）は本来の経路のまま通る
- **バージョンが古いと管理画面が止める**。[version.json](https://onboarding-chrome-extension.s3.ap-northeast-1.amazonaws.com/version.json)
  の `dev` を下回るビルドは更新を要求されて起動しない。`check-extensions.mjs` が判定する
- **BASIC 認証は host ごとに付ける**。管理画面とデモサイトで ID/PW が違い、
  `httpCredentials` はコンテキストに 1 組しか持てない。`applyBasicAuthByHost` を使う
- **ツールバーのアイコンは押せない**。Playwright から拡張機能のアイコンはクリックできないので、
  同じメッセージを service worker から送る（`openEditorFromToolbar`）

### 拡張機能ごとの到達点

| 拡張機能 | 読み込み | 起動して操作 |
|---|---|---|
| エディタ | ○ | ○（管理画面の「サイト上で編集」から。`openEditorOnSite`） |
| プレビュー | ○ | **×** |
| ビューワー | ○ | **×** |

プレビューは content script が `chrome.storage` / background に到達できず
（`Could not establish connection. Receiving end does not exist.`）、起動要求の postMessage に
応答が返らない。永続プロファイル・service worker の暖機・実 operation_token の付与を試しても変わらない。
ビューワーはガイドが配信されるものの、同じページの埋め込みタグ経由と切り分けられず
ランチャーも出ない。**この 2 つでのツアー実行は人が実施する**前提で計画すること
（ONBS-1991 でも実施者の手動確認で対応した）。

判定を誤らないよう、プレビューでは `STANDSUnit.isExtensionPreview` が `true` であることを
必ず確認する。これを見ないと、埋め込みタグ経由で動いているものをプレビューだと誤認する。

### エディタを起動する

管理画面のガイド一覧でカードを右クリック →「サイト上で編集」で、対象サイト上にエディタが開く。
`openEditorOnSite(page, context)` がこの操作をして、エディタのタブを返す。
起動できたかは画面下部の編集バー（「公開設定をする」）で判定する。

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

1. チェックリスト（`docs/features/{チケット番号}/{日付}_test-checklist.md`）の「結果」欄を埋める
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
