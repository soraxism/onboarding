# ONBS-2069 本番確認の結果（2026-10-08）

スマートフォン向け AI チャット新UI（下部フローティング）を 5 リポジトリすべてリリースしたあとの、
prod での動作確認。手順は [2026-10-07_release-runbook.md](./2026-10-07_release-runbook.md) の
「3. リリース後の確認」。

対象は検証用プロダクト `aid=312` / `pid=392`（リファクタ後）。
`pid=391`（リファクタ前）には AI チャットが1件も無いため対象外。

## 結果

| # | 確認内容 | 結果 |
| --- | --- | --- |
| 1 | 既存チャットの設定が「ランチャー」で表示される（フォールバック） | ✅ `mobile_ui_type="launcher"` / フローティングは出ない |
| 2 | 表示形式を切り替えて保存・公開できる | ✅ 作成したチャットが配信で `"floating"` になる |
| 3 | 配信レスポンスに `mobile_ui_type` が載る | ✅ バックエンド先行リリース時点で確認済み |
| 4 | **旧UIのチャットが従来どおり動く**（デグレ確認） | ✅ マウント・ランチャー表示・押下で開く |
| 5 | 新UIを設定したチャットでフローティングが出る | ✅ 下記9項目すべて |

### #5 の内訳

| 確認内容 | 結果 |
| --- | --- |
| ページトップではフローティングが出ない | ✅ |
| スクロールすると出る | ✅ `top=592 h=72` |
| 初回選択肢が無い場合、最初のメッセージが1行で出る | ✅ 「こんにちは！お手伝いできることはありますか？」 |
| ページ最下段では消える | ✅ |
| 戻ると再表示される | ✅ |
| バー押下でボトムシートが開く | ✅ `top=56`（上端余白56px） |
| オーバーレイが入る | ✅ |
| バー押下で閉じてフローティングに戻る | ✅ |

初回選択肢（チップ）の表示は dev で確認済み。prod では選択肢の保存が自動操作で入らなかったため、
**選択肢なしの経路（最初のメッセージを1行表示）で確認**している。

## つまずいた点

### 配信JSのキャッシュパージ先を間違えた

**配信JS は `assets.onboarding-app.io/js/` から直接読まれていない。**
エンドユーザーのページが読むのは **`api.onboarding-app.io/v1/onboarding-init`** で、
このエンドポイントが JS（`Content-Type: application/javascript`）を返す。配信データ
（`v2api.onboarding-app.io/onboarding-init` の JSON）とは別のリクエスト。

S3 の静的パス（`assets.onboarding-app.io/js/*.js`）をパージしても、誰もそこを読んでいないため
**何も変わらない**。実際、パージ後もブラウザは `cf-cache-status: HIT` / `age: 2567` で
10/06 版の JS を受け取り続け、新UIが出なかった。

正しいパージ先は配信エンドポイントそのもの。`onboarding-web` の
`npm run purge_cache_prod` が purge している prefix がこれにあたる。

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"prefixes":["api.onboarding-app.io/v1/onboarding-init","v2api.onboarding-app.io/onboarding-init"]}'
```

**prefix で消すこと。** クエリ文字列ごとにキャッシュキーが分かれるため、URL 1 本を指定しても
他のクエリの組み合わせが残る。

パージ後は `last-modified` が当日に変わり、新UIが出た。

### 新規チャットは既存チャットに勝てないことがある

マウント対象は「表示条件に一致した最初の1件」。prod の検証用プロダクトには
表示条件なし（常に一致）のチャットが元からあるため、**後から作ったチャットが出ないことがある**。
今回は配信配列の先頭が新しい方だったため確認できたが、順序に依存する。

### 既存の「名称未設定」を消さないこと

prod の検証用プロダクトには、以前から「名称未設定」のチャットが 2 件（下書き・アクティブ）置かれている。
`onbs-2069-setup-chat.mjs --cleanup` は dev の残骸を拾うため「名称未設定」も対象にしていたので、
**prod では対象外にするガードを入れた**（`--include-unnamed` を付けたときだけ拾い、prod では使用不可）。

## 使ったもの

```bash
# 配信とデグレの確認（読み取りのみ・Cloudflare のキャッシュを外す）
node docs/testing/scripts/onbs-2069-prod-check.mjs --bust {毎回変える文字列}

# 検証用チャットの作成と後片付け
node docs/testing/scripts/onbs-2069-setup-chat.mjs --env prod --product next
node docs/testing/scripts/onbs-2069-setup-chat.mjs --env prod --cleanup
```

確認で作ったチャット `[自動検証] ONBS-2069_20261008_新UI` は削除済み。
配信も元の 1 件（`launcher`）に戻っていることを確認した。
