# ONBS-2079 調査メモ

## 事象

クライアント（sumasate / aid=320, pid=409）の検証環境 `https://bench.sumasate.jp` に
検証用タグを設置したところ、CORS エラーでガイドが表示されない。

## 切り分け

本番APIを直接叩いて、どの条件で落ちるかを確認した。

```bash
BASE='https://v2api.onboarding-app.io/onboarding-init'
COMMON='user_id=test&user_name=test&user_group_id=test&user_group_name=test&onb_device_type=pc'
curl -s -D - -o /dev/null -H 'Origin: https://bench.sumasate.jp' \
  "$BASE?aid=320&pid=409&display_mode=preview&$COMMON&location_href=https%3A%2F%2Fbench.sumasate.jp%2Fhome"
```

| 条件 | 結果 |
| --- | --- |
| `display_mode=preview` あり | **500** / CORSヘッダーなし |
| `display_mode` なし（本番タグ） | 200 / `ACAO: *` |
| `preview` + 許可外ドメイン | 403 / `ACAO: *` |
| 存在しない aid/pid | 404 / `ACAO: *` |

403 が返るということは許可ドメイン判定を通過している。つまり `bench.sumasate.jp` は
`allowed_domains` に登録済みで、設定不備ではない。また 403 / 404 では CORS ヘッダーが
返っているため、CORS の設定自体も正しい。

`Onboarding-API-Next` では `app/main.py` で `allow_origins=["*"]` を設定し、
`app/core/responses.py` の `error_response` / `generate_headers` でも `ACAO: *` を付けている。
**付かないのは未処理例外のときだけ**（Starlette の ServerErrorMiddleware が CORSMiddleware の
外側にあるため）。ここから 500 が本体だと判断した。

## 原因の特定

本番ECSのログから該当の例外を確認した。

```bash
aws logs filter-log-events --log-group-name /ecs/prod-onboarding-api \
  --start-time <epoch_ms> --filter-pattern Traceback --limit 3 --output text
```

```
sqlalchemy.exc.ProgrammingError: (pymysql.err.ProgrammingError)
(1146, "Table 'onboarding_db.onb_float_histories_sumasate' doesn't exist")
[SQL: SELECT id, name, auto_display_conditions, display_times, display_duration,
      (SELECT created_at FROM `onb_float_histories_sumasate` ...) AS created_at
      FROM onb_float_groups bg WHERE product_id = %s AND state != 'archive' AND is_deleted = 0]
[parameters: (409,)]
```

発生元は `Onboarding-API-Next` の `app/cruds/onb_floats.py` の `get_list_on_test_tag`。

| 経路 | 呼ばれる関数 | 参照先 |
| --- | --- | --- |
| 本番タグ | `get_list` | `guide_public_status_histories`（共通テーブル） |
| 検証環境タグ（`display_mode=preview`） | `get_list_on_test_tag` | `onb_float_histories_{code}`（プロダクト別） |
| 管理画面プレビュー（`ext_action` あり） | `get_on_preview` | `onb_float_histories_{code}`（プロダクト別） |

本番タグだけ 200 が返っていたのはこのため。

Logs Insights で直近2日の発生を集計したところ、該当エラーが出ているのは `sumasate` のみだった。
ただしこれは「他のプロダクトで検証タグが使われていない」だけの可能性がある。

## なぜテーブルが無かったか

プロダクト作成経路は2つある。

| 経路 | `tour_histories_*` | `hint_histories_*` | `onb_float_histories_*` |
| --- | --- | --- | --- |
| アカウント発行ツール（`onboarding-api` `tools/accounts` POST） | ○ | ○ | **×** |
| 管理画面（`onboarding-manage-api` `mng-v1-products` POST） | ○ | ○ | ○ |

`onboarding-api` には `onb_float` に関する実装が `main` / `develop` とも一切無かった。
管理画面側は `0d4a3c58`（2026-10-02 / 5.108.3）の
「新しいプロダクトでフロート(β版)の履歴テーブルが作られない」で対応済みだが、
発行ツール側は未対応のまま残っていた。

発行ツールの `create()` は `selected_account_id` の有無でアカウント作成部分だけを分岐し、
`create_product()` 以降は共通経路。したがって新規アカウント発行・既存アカウントへの
プロダクト追加のどちらも同じように漏れていた。

削除側も同様で、`tools/products/handler.py` の `drop_histories` はツアー・ヒントしか
DROP しないため、プロダクト解約時に `onb_float_histories_*` が残存する状態だった。

## 本番復旧（2026-10-08 実施）

管理API の `lib/onb_float_groups.py` の `create_history` と同一定義でテーブルを作成した。

```sql
CREATE TABLE `onb_float_histories_sumasate` (
`id` int(10) unsigned NOT NULL AUTO_INCREMENT,
`onb_float_group_id` int(10) DEFAULT NULL,
`onb_float_json_src` longtext,
`created_at` datetime DEFAULT NULL,
`created_by` int(10) unsigned DEFAULT NULL,
PRIMARY KEY (`id`),
INDEX `onb_float_group_id` (`onb_float_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

初期データの投入は不要。`onb_floats.py` の `_to_group` が `created_at is None` のときに
`version` / `latest_updated_at` を空文字へフォールバックするため、履歴0件でも落ちない。

### 復旧確認

- 検証タグ（PC / SP / 別パス）、本番タグとも 200、`access-control-allow-origin: *` を確認
- レスポンス本文にツアー1件・ヒント3件を確認。`res_data.onb_floats` は `"[]"`
  （ランチャーグループ未作成のため。想定どおり）
- 本番ログの 1146 エラーは 2026-10-08 02:50:18 UTC（11:50:18 JST）を最後に停止

## 恒久対応

`onboarding-api` に以下を追加した（ブランチ `feature/ONBS-2079`）。

- `tools/accounts/handler.py`
  - `create_onb_float_histories_table` / `drop_onb_float_histories_table` を追加
  - `create()` に作成処理を追加
  - `validation_check_for_create()` に事前の存在チェックを追加
  - `create()` の except に、作成失敗時の drop を追加
- `tools/products/handler.py`
  - `drop_histories()` に `onb_float_histories_*` の DROP を追加

カラム定義は管理API側と一致させ、ローカルDBで実際に両方のDDLを流して
`SHOW CREATE TABLE` を突き合わせ、COMMENT 以外が完全一致することを確認した。

## 補足：今回のスコープ外だが気づいた点

- アカウント発行ツールと管理API で、ツアー・ヒントの履歴テーブルの `created_by` の型が
  食い違っている（発行ツール: `varchar(10)` / 管理API: `int(10) unsigned`）。
  今回追加したランチャー分は管理API側に合わせた
- クライアントが設置したタグは、`ignition_url` が本番（`api.onboarding-app.io`）なのに
  custom-layer だけ dev（`dev-custom-layer.onboarding-app.io`）を指している。意図通りか要確認
