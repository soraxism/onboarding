# ONBS-2097 リリース時に踏んだ本番デプロイ障害の記録

発生日: 2026-10-13
影響: **顧客影響なし**（トラフィックは一度も新バージョンへ切り替わらず、旧バージョンが配信を継続）

## 何が起きたか

1.6.0（ONBS-2097）を main へマージしたところ、**本番の新タスクが起動時に落ち続けた**。

```
ImportError: The SQLAlchemy asyncio module requires that the Python 'greenlet' library is installed.
```

CodeDeploy は新タスクセットが健全にならないため `Install` 段階で止まり、
ALB は旧ターゲットグループ（`tg-a` / `prod-onboarding-ai-api-task:20`）を向いたままだった。
**このため本番の配信は一度も止まっていない。**

## 原因

ONBS-2097 の変更とは無関係の、**既存の地雷**だった。

| # | 要素 |
| --- | --- |
| 1 | 2026-09-24 公開の **SQLAlchemy 2.1.0 から greenlet が `[asyncio]` extra 指定時のみの依存**になった |
| 2 | `Dockerfile` は **`COPY uv.lock ./` がコメントアウトされている**。`RUN uv lock` で毎回ゼロから解決する |
| 3 | main の `pyproject.toml` は `sqlalchemy>=2.0.0` のままだった |

```dockerfile
COPY pyproject.toml ./
# COPY uv.lock ./        ← 無効化されている
RUN uv lock
RUN uv sync --frozen --no-dev
```

**コミット済みの `uv.lock` はビルドに一切使われていない。** `uv.lock` には sqlalchemy 2.0.44 と
greenlet 3.2.4 が正しく記録されていたが、参照されないため意味を持たなかった。

前回の本番デプロイは 2026-08-18 で SQLAlchemy 2.1.0 の公開より前。
**9/24 以降の本番デプロイは、誰がいつやっても失敗する状態だった。**

## なぜ dev では通ったのか

dev は `develop` から作られる。`develop` には achromeinc さんが 2026-09-25 に
dev で同じ障害（CodeDeploy `d-F180S1FIL`）を踏んで作成した修正が入っていた。

```
c9e90d9 fix: SQLAlchemy を asyncio extra 付き・2.0 系に固定し greenlet 欠落を防ぐ
-    "sqlalchemy>=2.0.0",
+    "sqlalchemy[asyncio]>=2.0.0,<2.1",
```

**この修正は ONBS-1902 の作業として `develop` に留まり、release 経路に乗っていなかった。**
dev で動くのに本番で落ちる、という形で顕在化した。

## 対応

1. 失敗した CodeDeploy（`d-8Z2B3DFUL`）を `stop-deployment --auto-rollback-enabled` で停止
2. `c9e90d9` を `hotfixes/ONBS-1902` へ cherry-pick（author は achromeinc さんのまま保持）
3. release → main を経て **1.6.1** を発行。1.6.0 の内容もあわせて本番へ反映

修正の効果は、`Dockerfile` と同じ再解決をローカルで再現して確認した。

| | 解決される sqlalchemy | greenlet |
| --- | --- | --- |
| 修正前（`sqlalchemy>=2.0.0`） | 2.1.x | **入らない** → 起動失敗 |
| 修正後（`sqlalchemy[asyncio]>=2.0.0,<2.1`） | 2.0.54 | 3.5.6 入る |

## 副次的に起きたこと: develop の巻き戻り

main への push で `Sync Branches from Release` が動き、
`develop` を `git reset --hard origin/main` して force push した。

**この結果、achromeinc さんの ONBS-1902 の21コミットが `develop` から消えた。**
コミット自体はブランチに残っているため復旧可能。

```
refs/heads/feature/ONBS-1902                         6e22b67
refs/heads/feature/ONBS-1902-fix-sqlalchemy-greenlet c9e90d9
```

またこのリポジトリの dev デプロイは **CodePipeline（CodeStar 接続）**で動くため、
GitHub Actions の `GITHUB_TOKEN` による push でもパイプラインが起動する。
同期 push によって dev も main と同じ内容で再デプロイされた。

## 教訓

- **`develop` にしか無い修正は、dev でしか効かない。** dev が通っても本番が通る保証にはならない
- **リリース前に `origin/main..origin/develop` を見て、release に乗っていない修正が無いか確認する**。
  特に依存やビルド周りの修正は、機能と違って「誰のリリースにも必要」なことがある
- CodeDeploy が `InProgress` で止まっている間は、**トラフィックは切り替わっていない**。
  慌てて切り戻す必要はなく、原因を特定してから対応してよい

## 残課題（別チケット推奨）

**`Dockerfile` の `# COPY uv.lock ./` を有効化する。**
ビルドのたびに依存が解決し直される状態が続く限り、sqlalchemy 以外でも同じ事故が起こりうる。
今回は緊急修正に構造変更を混ぜないため見送った。

有効化する場合は、コミット済みの `uv.lock` が alpine / Python 3.13 の環境で
`uv sync --frozen` を通ることを事前に確認すること。
