# ONBS-2079 検証環境タグでガイドが表示されない（CORSエラーとして顕在化）

調査の詳細は [2026-10-08_investigation.md](2026-10-08_investigation.md) を参照。

## 問題点

クライアントが検証環境に検証用タグを設置したところ、ブラウザコンソールに CORS エラーが出て
ガイドが一切表示されない。

```
Access to XMLHttpRequest at 'https://v2api.onboarding-app.io/onboarding-init?...'
from origin 'https://bench.sumasate.jp' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

CORS 設定の不備ではなく、**配信API が 500 を返していた**。FastAPI の CORSMiddleware より
外側で未処理例外のレスポンスが生成されるため CORS ヘッダーが落ち、ブラウザ上は
CORS エラーとして見えていた。

## 原因

`onboarding_db.onb_float_histories_sumasate` が存在せず、MySQL error 1146 で落ちていた。

検証環境タグ（`display_mode=preview`）経路だけが `onb_floats_crud.get_list_on_test_tag` を通り、
プロダクトごとの履歴テーブル `onb_float_histories_{product_code}` を参照する。本番タグ経路の
`get_list` は共通テーブル `guide_public_status_histories` を見るため影響を受けない。

履歴テーブルが無かったのは、**アカウント発行ツール経由で作成したプロダクトでは
ランチャー(β版)の履歴テーブルが作られていなかった**ため。ツアー・ヒントは作成されるが、
ランチャーを足したときにこの経路だけ漏れていた。

管理画面経由（`onboarding-manage-api` の `mng-v1-products` POST）は
`0d4a3c58`（2026-10-02 / 5.108.3）で対応済み。

ランチャー機能はフィーチャーフラグ管理で、発行ツールの `insert_features_for_new_product` は
このフラグを入れない。そのため作成直後は壊れず、**後からフラグを有効化した時点で顕在化する**。

## 対応方針

1. **本番復旧（対応済み / 2026-10-08）** — `onb_float_histories_sumasate` を本番DBに作成。
   検証タグ経路が 200 に復旧したことを確認済み
2. **恒久対応（本チケット）** — `onboarding-api` のアカウント発行ツールにランチャー履歴テーブルの
   作成・事前チェック・ロールバック・解約時の削除を追加

新規アカウント発行と既存アカウントへのプロダクト追加は同じ `create()` の共通経路を通るため、
どちらの経路でも作成されるようになる。

## 影響範囲

| リポジトリ | 変更 |
| --- | --- |
| `onboarding-api` | あり（`src/functions/tools/accounts/handler.py`、`src/functions/tools/products/handler.py`） |
| `onboarding-account-manager` | なし（APIを呼ぶだけで、テーブル作成はバック側の責務） |
| `onboarding-manage-api` | なし（対応済み） |
| `Onboarding-API-Next` | なし（下記の残課題で別途検討） |

## 残課題（本チケット外）

1. **既存プロダクトのバックフィル** — 本対応は新規作成分のみ。ランチャー機能が有効かつ
   2026-10-02 以前に作成されたプロダクトは、フラグを有効化した時点で同じ事象になる
2. **配信API のフォールバック** — ランチャー取得の失敗でガイド配信全体が 500 になる構造。
   1機能の不具合で配信が全停止するのは影響が大きい
3. **未処理例外時の CORS ヘッダー** — 原因が「CORS設定ミス」に見えて切り分けが遠回りになる
