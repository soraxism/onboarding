# 動作確認用の認証情報（雛形）

このファイルをコピーして `credentials.local.md` を作り、`<>` の箇所を埋める。

```bash
cp docs/testing/credentials.sample.md docs/testing/credentials.local.md
```

`credentials.local.md` は `.gitignore` 済みで追跡されない。**値を手順書やコミットへ転記しないこと。**

プロダクト ID・デモサイトのクエリといった**機密でない情報は
[manual-test-runbook.md](./manual-test-runbook.md) の「環境」に書く**。ここには認証だけを置く。

**表の行は全セクションで揃える。** その環境に無いものは `—` と書き、行ごと消さない
（消すと「無い」のか「まだ埋めていない」のか区別が付かなくなる）。

## 管理画面（dev）

| 項目 | 値 |
|---|---|
| URL | https://dev-manage.onboarding-app.io/ |
| BASIC認証 ID | `<BASIC認証のID>` |
| BASIC認証 PW | `<BASIC認証のPW>` |
| ログイン ID | `<ログイン用メールアドレス>` |
| ログイン PW | `<ログインパスワード>` |
| 2要素認証 | 無効（**2要素認証が有効なアカウントは自動ログインできない**。無効のアカウントを用意すること） |

## 管理画面（prod）

本番リリース後の確認で使う。**設定変更は検証用ツアーに限ること。**

動作確認専用ユーザーは**作成済み**（2要素認証なし。有効だと自動ログインできないため設定しない）。
**認証情報は「空 武彦」に確認すること。** 新しくユーザーを作る必要はない。

| 項目 | 値 |
|---|---|
| URL | https://manage.onboarding-app.io/login/ |
| BASIC認証 ID | — （BASIC認証なし） |
| BASIC認証 PW | — |
| ログイン ID | `<ログイン用メールアドレス>` |
| ログイン PW | `<ログインパスワード>` |
| 2要素認証 | 無効（動作確認専用ユーザーのため設定しない） |

## エンドユーザー側デモサイト（dev / prod 共通）

**dev も prod も同じホスト。** 読む配信（dev / prod・旧JS / 新TS）は
`env` と `type` のクエリで切り替わるだけなので、**認証は 4 通りとも共通**。

URL の一覧は [manual-test-runbook.md](./manual-test-runbook.md) の「環境」にある。
ここに一部だけ転記すると、載っていない組み合わせが無いように見えるため書かない。

| 項目 | 値 |
|---|---|
| URL | https://dev.onboarding.co.jp/（**このホスト全体に効く**） |
| BASIC認証 ID | `<BASIC認証のID>`（管理画面とは別の値） |
| BASIC認証 PW | `<BASIC認証のPW>` |
| ログイン ID | — （サイト側のログインは無い） |
| ログイン PW | — |
| 2要素認証 | — |
