# ONBS-2055 Airメイト タグロード失敗（script.onerror）初動調査

## 依頼内容（2026-10-05 受領）

Airメイトがタグ読み込みの `script` 要素に `onerror` ハンドラを追加して監視したところ、
`https://api.onboarding-app.io/v1/onboarding-init` のロード失敗が検知された。

- 1日あたり約20〜30件
- **毎日 AM10:00〜11:00 頃に約20件が集中**（9/25〜10/1 のグラフで毎日同時刻にスパイク。土日も同規模）
- 1週間より前から発生していると思われる
- 「御社でも何か検知されていないか」の確認依頼

※ 前回の「Script error.」調査（`onboarding-web/docs/knowledge/2026-09-08_airmate-script-error-investigation.md`）
を受けて先方が追加した計測。前回はランタイムエラー、**今回はタグ JS 自体のロード失敗**で別事象。

## 配信経路の確認

```
Airメイトのページ → script src=api.onboarding-app.io/v1/onboarding-init?aid=17&pid=32
  → Cloudflare（cache-control: no-cache, must-revalidate / cf-cache-status: MISS = 毎回オリジン直撃）
  → API Gateway（onboarding-api-prod）
  → Lambda（v1OnbApiOnboardingInit-prod）
```

- AWS WAF はタグ配信経路には**ない**（`ag-onboarding-manage-api-*` は管理画面 API のみ）
- 経路上の WAF は Cloudflare 側のみ

## 当社側の調査結果（2026-09-28〜10-05、1時間粒度）

### 1. オリジンは全期間クリーン

| 層 | 指標 | 結果 |
|---|---|---|
| Lambda | Errors | 週合計5件（各1件の散発。10時台は**ゼロ**） |
| Lambda | Throttles | **ゼロ** |
| API Gateway | 5XXError | 週合計5件（同上の散発。10時台は**ゼロ**） |
| API Gateway | Latency max | 通常 4秒弱、最大 15.7秒（10/1 14時。10時台との相関なし） |

10〜11時台は毎日 Lambda 8万invocation超（全顧客計）を処理しながら 5xx・スロットルともゼロ。
**当社オリジンの障害・定時イベントで20件/時のロード失敗が出る状況ではない。**

### 2. 10:00 JST の定時ジョブは prod に存在しない

EventBridge の全スケジュールルールを確認。01:00 UTC（=10:00 JST）付近の prod ジョブはなし
（`dev-report-guide-outcome-batch` が 10:00 JST だが dev 環境のみ）。
prod のバッチは早朝 4〜5時 JST 帯に集中しており、10時台のイベントはない。

### 3. スパイクの形は当社負荷パターンと不一致・先方利用パターンと一致

当社オリジンの時間別トラフィック（Lambda invocations）:

| | 平日(10/2) | 土(10/3) | 日(10/4) |
|---|---|---|---|
| ピーク時間帯 | **8〜9時・17時** | 9時 | 9時 |
| 10時台 | 8.3万 | 2.1万 | 1.3万 |
| 土日の規模 | — | 平日の約1/4 | 平日の約1/7 |

先方のスパイクは**毎日 10〜11時・土日も同規模**。当社インフラの負荷起因なら
平日 8-9時/17時に出て土日は激減するはずで、形が合わない。
一方、飲食店向けサービスの「店長が開店前の朝に数値確認する」利用パターン
（毎日・土日も同様）とは一致する。**失敗件数は先方自身のアクセス量に比例している**とみられる。

### 4. 発生規模は既知のネットワークノイズと整合

`script.onerror` は HTTP エラーだけでなく、**通信断・読み込み中のページ離脱・社内プロキシや
広告ブロッカーによる遮断**でも発火する。ONBS-2011 の調査では、タグロード成功後の
API 通信失敗（同じネットワークノイズ母集団）が Safari のみの計測で約6件/日だった。
今回の onerror は**全ブラウザ・全失敗種別**を拾うため 20〜30件/日という規模感は整合する。

## 現時点の結論

- **当社側（オリジン・バッチ・AWS WAF）に 10〜11時の異常・定時イベントは検知されない**
- スパイクは「Airメイトの朝のアクセスピーク × 日常的なロード失敗率」で説明がつく形
- 件数の絶対値だけでは判断できないため、**エラー率**（失敗数 ÷ 同時間帯の総ロード数）での評価が必要

## 残確認事項

### 当社側

- [ ] **Cloudflare エッジ層（52x エラー・CF WAF ブロック）が唯一未確認。**
      手元の API トークンは purge 専用で analytics read 権限がない。
      インフラ管理者に Zone Analytics 読み取りトークンの発行を依頼し、
      10〜11時 JST の edgeResponseStatus 分布と WAF ブロック数を確認する
- [ ] （エラー率算出用）Airメイトの時間帯別タグロード数を当社トラッキングから概算できるか検討

### 先方への確認事項（返信案の骨子）

1. 同時間帯（10〜11時）の**総ページビュー数**（エラー率を出すため。New Relic ですぐ確認可能なはず）
2. 失敗イベントが**特定のユーザー・店舗・回線に偏っていないか**（特定店舗のプロキシ/フィルタリングなら説明がつく）
3. 失敗時に HTTP レスポンスはあったか（可能であれば Resource Timing API の `responseStatus` / duration の分布）

## 関連

- 前回調査: `onboarding-web/docs/knowledge/2026-09-08_airmate-script-error-investigation.md`
- 同顧客の別事象（修正済み）: `onboarding-web/docs/knowledge/2026-09-14_onboarding-init-error-headers-unhandled-rejection.md`（ONBS-2011）
- 入手資料: `問い合わせ内容.txt` / `スクリーンショット.png`（本ディレクトリ）
