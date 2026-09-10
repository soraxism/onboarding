# docs/testing — dev 環境での動作確認

Claude Code に dev 環境での動作確認を任せるための、環境情報・手順・スクリプト置き場。

## 初期設定（クローン直後に一度だけ）

**`credentials.sample.md` をコピーして `credentials.local.md` を作る。** これが無いとスクリプトは動かない。

```bash
cd /Users/soraxism/Dev/stands/onboarding

# 1. 認証情報を用意する（git 追跡外のファイルが作られる）
cp docs/testing/credentials.sample.md docs/testing/credentials.local.md
#    → <> の箇所（BASIC認証・ログイン情報）を埋める。値は環境の管理者に確認する
#    → URL やプロダクトIDは雛形に記入済みなので触らなくてよい

# 2. 疎通確認
node docs/testing/scripts/check-access.mjs
```

`5/5 件 OK` が出れば準備完了。落ちた場合は [manual-test-runbook.md](./manual-test-runbook.md) の「環境」を確認する。

依存は `onboarding-e2e-test` の `node_modules` を借りる。未インストールならそちらで `npm ci` を実行する。

## ファイル

| パス | 内容 | git |
|---|---|---|
| [manual-test-runbook.md](./manual-test-runbook.md) | 実行手順書。**まずこれを読む** | 追跡 |
| [credentials.sample.md](./credentials.sample.md) | 認証情報の雛形 | 追跡 |
| `credentials.local.md` | 認証情報の実体 | **追跡外** |
| `scripts/lib/env.mjs` | playwright の解決・認証情報の読み込み・成果物ディレクトリ | 追跡 |
| `scripts/lib/manage.mjs` | プロダクト定義・ブラウザ起動・ログイン・プロダクト切替・エディタ起動 | 追跡 |
| `scripts/lib/extensions.mjs` | 拡張機能の読み込み・service worker の取得・宛先 ID の差し替え | 追跡 |
| `scripts/check-access.mjs` | 疎通確認（管理画面・デモサイト） | 追跡 |
| `scripts/check-extensions.mjs` | 疎通確認（拡張機能） | 追跡 |
| `artifacts/` | スクリーンショット等の実行成果物 | **追跡外** |

## 検証用プロダクト

新旧の JS 配信を切り分けるため、プロダクトが 2 つある。エンドユーザー側の挙動を変える改修では**両方で確認する**。

| | 旧 JS（legacy） | 新 TS（next） |
|---|---|---|
| プロダクト | リファクタ前（`product_id=247`） | リファクタ後（`product_id=248`） |
| デモサイト | `.../demo/onb-web-refactor/` | `.../demo/onb-web-refactor/?type=new` |

## 守ること

- **認証情報を追跡対象のファイル・コミットメッセージ・会話ログへ書かない**
- 検証で作ったツアーは `[自動検証] ` で始まる名前にし、**確認が終わったら削除する**（dev 環境は他の人も使う）
- 操作してよいのは検証用プロダクト（247 / 248）の中だけ

## 拡張機能

エディタ・プレビュー・ビューワーの 3 拡張とも Playwright で読み込んで確認できる。
**ソースではなくビルド成果物を読み込む**ので、確認前にビルドしておくこと。

| 拡張機能 | ビルド | 成果物 |
|---|---|---|
| プレビュー | `onboarding-web` で `npm run build_preview:dev` | `build/dev/ext-preview` |
| ビューワー | `onboarding-web` で `npm run build_viewer:dev` | `build/dev/ext-viewer-general` |
| エディタ | `Onboarding-Editor-Extension` で `npm run build:ext_dev` | `package/` |

```bash
node docs/testing/scripts/check-extensions.mjs
```

`8/8 件 OK` が出れば、管理画面「サイト上で編集」からエディタが起動するところまで通っている。
詳細は [manual-test-runbook.md](./manual-test-runbook.md) の「拡張機能の確認」を読む。

## できないこと

- **ブラウザの対話的な操作**。すべてスクリプト経由になる
- **Chrome ウェブストア版の拡張機能での確認**。ローカルビルドを unpacked で読み込むため、
  ストア配布物そのものの確認（インストール導線・自動更新）は人が実施する
