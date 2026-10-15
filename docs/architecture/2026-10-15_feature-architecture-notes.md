# Onboarding 機能構成図（クライアント提出用）— 作成メモ

- 図: [2026-10-15_onboarding-feature-architecture.drawio](./2026-10-15_onboarding-feature-architecture.drawio)
- 作成日: 2026-10-15
- 用途: クライアントへの機能構成の説明
- 対象クライアント: **埋め込みタグ方式（`/embed`・`/decision`）＋ カスタムレイヤー**を利用している顧客

## 1. 図の方針

| 項目 | 決めたこと |
| --- | --- |
| 粒度 | **機能構成**（機能ブロックとデータの流れ）。AWS のサービス名・インスタンス・IP は載せない |
| 範囲 | 製品全体（新方式・AI・管理画面も含む）を描き、**当該クライアントの経路のみ橙で強調** |
| 未使用機能 | 箱は残し「※ 貴社では未使用」と明記。提供範囲の広さを示しつつ誤解を防ぐ |
| 社名 | 入れていない（「貴社」表記）。提出先ごとに差し替えず使い回せる |

橙で強調しているのは次の 5 本。図の右上に同じ番号の説明を置いてある。

1. 埋め込みタグ → `/embed`（初期化スクリプトの取得）
2. 初期化スクリプト → `/decision`（表示するガイドの問い合わせ）
3. ブラウザ → 配信アセット CDN（ガイド本体 JS / CSS）
4. カスタムレイヤータグ → カスタムレイヤー CDN
5. ガイドの表示・操作ログ → 計測ビーコン

## 2. 図に描いた内容の根拠

社外向けに表現を噛み砕いているため、元になった実装を残しておく。

### `/embed`（`onboarding-api/src/functions/embed/handler.py`）

GET。`aid`（アカウント ID）/ `pid`（プロダクト ID）必須。やっていることは次の 4 つ。

1. アカウント・プロダクト設定の取得（Redis キャッシュ → 無ければ RDS の `accounts` / `products` / `methods`）
2. **Referer のドメインが `products.allowed_domains` に含まれるか検証**（不一致は 403）
3. **`products.blacklist_path` によるパス除外**（該当は 403）
4. 上記を埋め込んだ**初期化 JavaScript を生成して返却**（`Content-Type: application/javascript`）

返却される JS は、ブラウザ上で jQuery を読み込んだあと `/decision` を呼び、
その結果をもとに `stands.onbd_base.js` / `stands.onbd.js` / テーマ / カスタム CSS・JS を CDN から読み込む。
図の ① → ② → ③ はこの順序に対応する。

### `/decision`（`onboarding-api/src/functions/decision/handler.py`）

GET。`aid` / `pid` / `acode` 必須。初期化スクリプトから呼ばれる。

1. `units_{acode}` / `units_detail_{acode}` から訪問者の属性値を取得（Redis キャッシュあり）
2. `segments` の `conditions` を評価し、**優先度順に最初にマッチしたセグメントを採用**（UA でスマホ / PC も振り分け）
3. 採用セグメントの定義ファイルを **S3（`assets.onboarding-app.io`）の `segments/{segment_id}/` から読む**
   （`base.json` / `steps.json` / `hint.json` / `monitor_elements.json` / `makeup.css` / `makeup.js`）
4. まとめて JSON で返却

図の「ガイドデータ」＝ S3 上のこの JSON 群、「設定データベース」＝ RDS、「配信キャッシュ」＝ Redis に対応する。

### カスタムレイヤー（`Onboarding-Custom-Layer`）

- 配信元: `https://custom-layer.onboarding-app.io/{カスタムID}.js`（dev は `dev-custom-layer.…`）
- クライアント名 → カスタム ID の対応は `client-ids.json`
- GitHub Actions（`build_deploy.yml`）で S3 へアップロードし、Cloudflare のキャッシュをパージする
- UI は `mountComponent` 経由で **Shadow DOM** に描画するため、顧客サイトの CSS と干渉しない
  → 図の「既存サイトと影響し合わないよう分離して動作」はこれを指す

**Onboarding 本体とは別タグ・別配信**である点が重要。図でも別の箱・別の矢印にしてある。

### 計測ビーコン

`TRACKING_URL`（`beacon.onboarding-app.io/log.gif`）への GET で記録する方式。
`/v1/logger` の Lambda は残っているが、ハンドラ冒頭に「現在は log.gif 方式のため未使用」とコメントがある。
集計は `onboarding-batch` の `format-cf-logs` 系・`report-*` 系が担う（CloudFront ログを集計してレポート化）。

## 3. 更新のしかた

draw.io（デスクトップ版・Web 版）でそのまま開ける。プレーン XML で保存してあるため diff も読める。

画像で確認・書き出しする場合:

```bash
drawio --export --format png --scale 1.4 --border 10 \
  --output arch.png docs/architecture/2026-10-15_onboarding-feature-architecture.drawio
```

PDF にする場合は `--format pdf` を指定する。ページサイズは 1600 × 1200 で 1 ページに収まるようにしてある。

## 4. 提出前に確認すること

- [ ] 強調（橙）の範囲が提出先の契約内容と合っているか。**別のクライアントへ出すときは強調箇所を付け替える**
- [ ] 「※ 貴社では未使用」の記載が実態と合っているか（AI 機能・新方式・Chrome 拡張）
- [ ] 社名・固有名を入れる必要があるか（現状は「貴社」表記のまま）
