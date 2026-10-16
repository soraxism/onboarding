# S3 `assets.onboarding-app.io/guides/` の改ざん有無チェック

- 親エピック: ONBS-2109 不正アクセス関連の対応
- 調査日: 2026-10-16
- 対象: `s3://assets.onboarding-app.io/guides/`
- 調査範囲: 攻撃観測時刻 **2026-10-13 15:56 JST**（ONBS-2097）〜 調査時点 **2026-10-16 16:00 JST**

## 結論

**改ざんは検出されなかった。**

対象期間のオブジェクト書き込みはすべて、管理画面（エディタ）からの
通常の保存・公開操作として説明がつく。第三者による書き換え・削除の痕跡はない。

---

## 1. 調査が成立する前提

| 項目 | 状態 | 意味 |
| --- | --- | --- |
| バケットのバージョニング | **Enabled** | 上書き・削除がすべて履歴として残る。遡及的な改ざんは隠せない |
| 削除マーカー | guides 配下に 2 件のみ（2026-03-19 / 2026-05-14） | 期間内の削除はゼロ |

バージョニングが有効なため、「上書きされたこと自体を消す」ことはできない。
よって **全バージョンの一覧＝期間内の全変更** として扱える。

取得した全バージョン数: **425,622**（`list-object-versions`、truncation なし）

---

## 2. 期間内の変更一覧

| 区分 | 件数 |
| --- | --- |
| 書き込まれたバージョン | 762 |
| 対象ユニークキー | 89 |
| うち新規作成 | 25 |
| うち既存更新 | 64 |
| 削除マーカー | 0 |

### 時刻分布（JST）

```
10-13 16時 136   10-14 02時   3
10-13 17時 205   10-14 09時  27
10-13 18時  50   10-14 10時 100
10-13 19時  32   10-14 11時  27
10-13 20時  27   10-14 12時 155
```

**10-14 12:58 を最後に、以降の書き込みはゼロ**（理由は「5. 書き込み停止」）。

### 深夜帯（10-14 02:26 JST）の 3 件

`guides/hints/5150/` の `hint_preview.json` / `makeup_preview.css` / `makeup_preview.js`。
**3 ファイルとも v1（同一秒）** で、中身はヒント新規作成時の既定テンプレート
（「ヒントを作成しましょう」の文面、空の makeup）。改ざんではなく新規作成。

---

## 3. 改ざんでないと判断した根拠

### 3-1. 書き込みパターンが管理画面の挙動と一致

- 公開操作は必ず **`steps.json` / `hint.json` ＋ `makeup.css` ＋ `makeup.js` の3点セットが同一秒**で書かれる。
  期間内の 60 件すべてがこの形。`makeup.js` だけが単独で書き換わったケースはゼロ
- 新規作成キー 25 件は、ツアー ID `9246`〜`9251` と `hints/5150` の**連番**。いずれも 3 点セットが揃っている
- 書き込みはほぼ営業時間内に収まり、週末（10-03/04、10-10/11）と祝日（10-12 スポーツの日）は
  過去にわたり一貫して書き込みがほぼゼロ。**人の操作に追随した分布**

### 3-2. 配信される JS / CSS は一切変わっていない

本番配信対象（`_preview` でないファイル）60 件を直前バージョンと比較。

| 結果 | 件数 |
| --- | --- |
| ETag 一致（内容不変） | 51 |
| 内容差分あり | 6 |
| 期間内に新規作成 | 3 |

**`makeup.js` / `makeup.css` は全件 ETag 一致で内容不変。**
差分があったのは `steps.json` / `hint.json` のみで、内容は以下のとおり通常の編集。

| キー | 差分 |
| --- | --- |
| `hints/4810/hint.json` | 「9月号」→「10月号」の文面更新、幅 300→320 |
| `hints/4814,4983,4994,5092/hint.json` | ANA キャンペーン文面の微修正 |
| `tours/1233/steps.json` | ステップ群「請求について」を追加 |
| `tours/1523,5546/steps.json` | 配信期間 `start_date` / `end_date` の更新 |
| `tours/9217/steps.json` | URL 判定を `match`→`regex` に変更 |
| `tours/5957/steps.json` | JSON の整形（1行→インデント）。意味的な差分なし |

### 3-3. スクリプト注入のスキャン

期間内に書き込まれた全 89 ファイルの現行版を取得し、
`<script` / `javascript:` / `onerror=` / `onload=` / `eval(` / `document.cookie` /
`atob(` / `fromCharCode` / `new Function` / `XMLHttpRequest` / `localStorage` /
`.innerHTML =` を検索。

ヒットした 4 ファイルはいずれも**攻撃前から存在する顧客自身のコンテンツ**で、
攻撃前バージョンと出現数が完全一致していることを確認済み。

| ファイル | 内容 | 判定 |
| --- | --- | --- |
| `tours/1233/steps.json`（と preview） | `javascript:void(0)` ＋ `onclick="STANDSMotion.mountAiChat(...)"` | 自社 AI チャット起動ボタン |
| `tours/9004,9007/steps_preview.json` | `<script>window._satellite.track(...)</script>` | 顧客の Adobe Launch 計測タグ |

外部ドメイン参照も全件を棚卸しし、`cdnjs.cloudflare.com`（FontAwesome CSS）、
`storage.googleapis.com`（STUDIO の画像）、`i.postimg.cc`（顧客の画像ホスティング）
のみ。いずれも攻撃前から存在。`hints/3214` は参照数が 7→10 に増えたが、
**URL の集合は不変**で、既存画像が新規ヒントに複製されただけだった。

### 3-4. オブジェクトの形状に異常なし

- 拡張子は `json` / `js` / `css` が 99.99%。それ以外（png/jpg/gif/README）は
  **すべて 2025-07-14 の一括移行時のもの**で期間外
- パス階層は `guides/{種別}/{ID}/{ファイル}` の 4 階層が 425,596 件。
  例外 26 件も上記の移行時のもの。**見慣れないパスへの設置はない**

### 3-5. バケット設定の改変なし

CloudTrail（証跡 `Members`、マルチリージョン・稼働中）の管理イベントを期間で確認。

- `assets.onboarding-app.io` に対する設定変更イベントは **0 件**
- 期間内の `PutBucketVersioning` 1 件・`PutBucketPublicAccessBlock` 4 件は
  **すべて別バケット**かつ社内 IAM ユーザーによるもの（内容は防御強化方向）
- IAM の認証情報・ポリシー変更（`CreateAccessKey` 等 10 種）は期間内 **0 件**

現在のバケット設定も意図どおり。

| 設定 | 値 |
| --- | --- |
| Bucket Policy | `s3:GetObject` のみ `Principal:*` に許可（配信用途。**書き込みは許可していない**） |
| Object Ownership | `BucketOwnerEnforced`（ACL 無効） |
| ACL | オーナーのみ FULL_CONTROL |
| CORS / Website / Lifecycle / Replication | 未設定 |

---

## 4. 本調査の限界（証跡の不足）

**オブジェクト単位の「誰が書いたか」は追えない。**

| 不足している証跡 | 現状 |
| --- | --- |
| S3 サーバーアクセスログ | **未設定** |
| CloudTrail の S3 データイベント | **未設定**（`DataResources: []`、管理イベントのみ） |

このため本調査は「**書き込まれた内容と、その書き込みパターンが正常か**」に基づく判定であり、
送信元 IP や実行プリンシパルによる裏取りはできていない。
ONBS-2097 で指摘された「送信元 IP がどこにも残らない」問題と同根。

---

## 5. 書き込み停止について（改ざんとは無関係）

調査中、**2026-10-14 12:58:41 JST を最後に guides 配下への書き込みが 2 営業日ゼロ**
という異常を検出した。平日は 300〜1,500 件/日の書き込みがあるため、分布として明確に外れている。

原因は特定済みで、**インシデント対応に伴う管理画面のメンテナンスモード**だった。

| 時刻（JST） | 事象 |
| --- | --- |
| 2026-10-14 12:46:00 | `dev-manage-api.onboarding-app.io` の API マッピング削除（tomohiro_suzuki） |
| 2026-10-14 12:54:06 | `onboarding-manage-api-prod` に `disableExecuteApiEndpoint=true`（takehiko_sora） |
| 2026-10-14 12:55:42 | prod ステージへデプロイ |
| **2026-10-14 12:58:07** | **`manage-api.onboarding-app.io` の API マッピング削除**（tomohiro_suzuki） |
| 2026-10-14 12:58:41 | **guides 配下への最後の書き込み** |
| 2026-10-14 13:09:23 | `prod-onboarding-manage-web` に Public Access Block 設定 |

現在 `https://manage.onboarding-app.io/` は**メンテナンス画面**を返しており、
`https://manage-api.onboarding-app.io/` はベースパスマッピングが空のため全パスで
`403 ForbiddenException`。`onboarding-manage-web` はこのホストを参照しているため、
管理画面からの保存・公開は停止している状態。**意図した停止であり、改ざんの痕跡ではない。**

メンテナンス解除時は、`manage-api.onboarding-app.io` のベースパスマッピング再作成が必要。

---

## 6. 推奨する対応

| # | 対応 | 理由 |
| --- | --- | --- |
| 1 | **CloudTrail の S3 データイベントを有効化**（最低限 `assets.onboarding-app.io` の書き込み系） | 次に同じ調査をするとき「誰が書いたか」を追えるようにする。今回は内容からの推定しかできなかった |
| 2 | **S3 サーバーアクセスログの有効化** | 上と同じ。参照系も含めて残る |
| 3 | **Public Access Block の設定** | 現在未設定。公開読み取りはバケットポリシーで意図的に許可しているが、`BlockPublicAcls` / `IgnorePublicAcls` だけでも入れておくと、将来の誤設定で書き込みが公開される事故を防げる |
| 4 | バージョニングの **MFA Delete** 検討 | 現在は未設定。証跡そのものの破壊を防ぐ |

1・2 は ONBS-2097 の「問題 3（送信元 IP が残らない）」の S3 版にあたる。

---

## 付録: 再現手順

```bash
# 全バージョンの取得（guides 配下、約 42 万件）
aws s3api list-object-versions --bucket assets.onboarding-app.io \
  --prefix guides/ --profile onboarding --output json > guides-versions.json

# 攻撃時刻以降に書き込まれたバージョンの抽出（15:56 JST = 06:56 UTC）
jq -r '(.Versions//[])[] | select(.LastModified >= "2026-10-13T06:56:00")
  | [.LastModified,.Key,.VersionId,(.Size|tostring)] | @tsv' guides-versions.json

# 削除マーカー
jq -r '(.DeleteMarkers//[])[] | [.LastModified,.Key] | @tsv' guides-versions.json

# 特定バージョンの取得（直前版との差分比較用）
aws s3api get-object --bucket assets.onboarding-app.io \
  --key <KEY> --version-id <VERSION_ID> --profile onboarding out.json
```
