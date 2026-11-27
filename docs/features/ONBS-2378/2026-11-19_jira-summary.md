# ONBS-2378 ヘルプページを管理画面のログインユーザーだけが見られるようにする（暫定）

詳細: [2026-11-19_help-gating-design.md](2026-11-19_help-gating-design.md)
後続: ONBS-2379（ヘルプを管理画面のリポジトリへ移管し、認証付きで配信する）

## 問題点

- ヘルプページ `help.onboarding-app.io` は Notion で管理し Super でホスティングしており、誰でも閲覧できる
- トライアル期間（競合とのコンペ中）に、顧客から競合へヘルプの URL が渡されるケースが多い
- 目的は競合から守ること

## 対応方針（暫定）

1. manage-api: Cookie を発行する専用のエンドポイント `POST /v1/help-session`（署名付き・24 時間）
2. manage-web: Worker が送る中継ページ `/help-auth`。ログイン済みなら Cookie を発行して元のヘルプへ戻し、未ログインならログインのあとに戻す
3. Cloudflare: `help.onboarding-app.io` を Cloudflare 経由にし、Worker（manage-api の `cloudflare/help-gate`）で Cookie を検証する
4. Route53: `help` の CNAME を Cloudflare へ切り替える（検証用の `help-stg` で確認してから）

既知の制約: Notion 側は Web 公開のままなので、URL の Notion ページ ID を付け替えると読める。本移行で解消する。

## 影響範囲

| リポジトリ・設定 | 内容 |
| --- | --- |
| `onboarding-manage-api` | Cookie の発行、Worker のコード |
| `onboarding-manage-web` | 中継ページ、ログイン後の戻り先 |
| Cloudflare（`onboarding-app.io`） | DNS レコード、Worker |
| Route53（`onboarding-app.io`） | `help` の CNAME の切り替え |
