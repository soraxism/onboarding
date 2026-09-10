# 動作確認用の認証情報（雛形）

このファイルをコピーして `credentials.local.md` を作り、`<>` の箇所を埋める。

```bash
cp docs/testing/credentials.sample.md docs/testing/credentials.local.md
```

`credentials.local.md` は `.gitignore` 済みで追跡されない。**値を手順書やコミットへ転記しないこと。**
URL やプロダクトIDのような機密でない情報は [manual-test-runbook.md](./manual-test-runbook.md) 側に書く。

## 管理画面（dev）

| 項目 | 値 |
|---|---|
| URL | https://dev-manage.onboarding-app.io/ |
| BASIC認証 ID | `<BASIC認証のID>` |
| BASIC認証 PW | `<BASIC認証のPW>` |
| ログイン ID | `<ログイン用メールアドレス>` |
| ログイン PW | `<ログインパスワード>` |
| 2要素認証 | 無効（**2要素認証が有効なアカウントは自動ログインできない**。無効のアカウントを用意すること） |

## エンドユーザー側デモサイト（dev）

| 項目 | 値 |
|---|---|
| BASIC認証 ID | `<BASIC認証のID>` |
| BASIC認証 PW | `<BASIC認証のPW>` |
