# ONBS-2378 ヘルプページを管理画面のログインユーザーだけが見られるようにする（暫定）

詳細: [2026-11-19_help-gating-design.md](2026-11-19_help-gating-design.md)
後続: ONBS-2379（ヘルプを管理画面のリポジトリへ移管し、認証付きで配信する）

## 問題点

- ヘルプページ `help.onboarding-app.io` は Notion で管理し Super でホスティングしており、誰でも閲覧できる
- トライアル期間（競合とのコンペ中）に、顧客から競合へヘルプの URL が渡されるケースが多い
- 目的は競合から守ること

## 対応方針（暫定）

1. manage-api: ログイン時・トークン更新時に署名付き Cookie を発行し、ログアウト時に消す
2. manage-web: Cookie を受け取る設定と、Cookie を再発行して元のヘルプへ戻す中継ページ
3. Cloudflare: `help.onboarding-app.io` を Cloudflare 経由にし、Worker で Cookie を検証する
4. Route53: `help` の CNAME を Cloudflare へ切り替える（検証用サブドメインで確認してから）

既知の制約: Notion 側は Web 公開のままなので、URL の Notion ページ ID を付け替えると読める。本移行で解消する。

## 影響範囲

| リポジトリ・設定 | 内容 |
| --- | --- |
| `onboarding-manage-api` | Cookie の発行・削除、CORS |
| `onboarding-manage-web` | credentials の付与、中継ページ |
| Cloudflare（`onboarding-app.io`） | DNS レコード、Worker |
| Route53（`onboarding-app.io`） | `help` の CNAME の切り替え |
