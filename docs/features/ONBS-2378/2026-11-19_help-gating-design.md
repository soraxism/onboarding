# ヘルプページの非公開化 方式の検討

Jira: [ONBS-2378](https://onboarding-app.atlassian.net/browse/ONBS-2378)（暫定対策）/ [ONBS-2379](https://onboarding-app.atlassian.net/browse/ONBS-2379)（本移行）

## 要件

**管理画面にログインしていない人が、ヘルプページの内容を読めないこと。**

目的は競合から守ること。新規獲得のトライアル期間は競合とのコンペ中で、
その間に顧客から競合へヘルプの URL が渡されるケースが多い。

## 現状（2026-11-19 確認）

| 項目 | 状態 |
| --- | --- |
| コンテンツ | Notion で管理。Notion 側は「Web で公開・閲覧可・ログイン不要」 |
| ホスティング | Super（実体は Vercel）。Route53 で `help` → `cname.super.so` の CNAME。Cloudflare は通っていない |
| 検索エンジン | `noindex, nofollow` と robots.txt の `Disallow: /` が設定済み |
| URL | 多くが Notion のページ ID そのまま（例 `/355d01c0231c4a9e94530267d7b7fecc`）。一部はスラッグ |
| `onboarding-app.io` | Cloudflare の CNAME セットアップ（`api`・`assets` が `*.cdn.cloudflare.net`） |
| manage-api | `manage-api.onboarding-app.io`（ヘルプと親ドメインが同じ） |
| 管理画面の認証 | トークンは localStorage。Cookie は発行していない。認証チェックはブラウザ側（`auth-check.global.ts`）のみ |
| 管理画面の配信 | SPA（`ssr: false`）を S3＋CloudFront から配信 |

ヘルプへのリンク元: 管理画面（`HelpMenu.vue`・`TheFooter.vue`・`UiCommonTag.vue`）、
エディタ拡張（`helpText.ts`）、通知メール（`v1-onb-batch-notice-mail`）、配信 JS の設定ガイド（`onboarding-web/src/get.ts`）。

## 抜け道（暫定対策では塞げない）

Super は公開状態の Notion ページを読みにいく仕組みのため、Notion 側の公開を止められない。
ヘルプの URL に入っている 32 桁の ID を `notion.so/{ID}` に付け替えると、
`help.onboarding-app.io` を閉じても読める。公開ページから親子のページへも移動できる。

ID を振り直す対策（Notion のページを複製して旧ページの公開をやめ、URL をスラッグにする）は、
Super の設定とリンクの張り替えが大きく、本移行で捨てることになるため**見送った**。

## 検討した方式

| 案 | 判断 | 理由 |
| --- | --- | --- |
| A. Cloudflare Worker＋署名付き Cookie | **暫定対策として採用** | 渡されたリンクをそのまま開くケースを止められる。数日で入る |
| B. Super 標準のパスワード保護 | 不採用 | 共有パスワードで「ログインユーザー限定」にならない。後から足したサブページが公開のまま残る不具合の報告もある |
| C. Super のメンバー機能 | 不採用 | 利用者を Super にも登録する二重管理になる |
| D. Cloudflare Access | 不採用 | 顧客は社外で IdP に載っていない。ワンタイム PIN はメールの許可リストを別に管理することになる |
| E1. 管理画面に取り込み、画面の出し分けだけ認証で行う | 不採用 | バンドルに入った中身は `/_nuxt/*.js` から誰でも取得できる |
| E2. 管理画面に取り込み、中身は manage-api の認証を通して返す | **本移行として採用** | ログインユーザーにしか中身が渡らない。時期は未定 |

Cookie が「あるかどうか」だけを見る方式は、Cookie を自作すれば通れるため要件を満たさない。
Worker から manage-api へ毎回問い合わせる方式は、ヘルプの可用性が manage-api に依存するため採らない。

## A の設計

```
利用者 ──▶ help.onboarding-app.io（Cloudflare）
             └─ Worker help-gate: Cookie の署名と有効期限を検証
                  ├─ 正しい → Super（cname.super.so）へ流す
                  └─ ない・期限切れ・不正 → 302 で manage.onboarding-app.io/help-auth?return={元のURL}
                       ├─ ログイン済み → POST /v1/help-session → Set-Cookie → 元のURLへ
                       └─ 未ログイン  → 戻り先を sessionStorage に預けて /login
                                        → ログイン → /help-auth → 同上
```

| 部品 | 置き場所 | 内容 |
| --- | --- | --- |
| Cookie の発行 | manage-api `api/rest/functions/mng-v1-help-session/` | `POST /v1/help-session`。API トークンで認証し、Cookie を発行する |
| Cookie の検証 | manage-api `cloudflare/help-gate/` | Cloudflare Worker。手順は同ディレクトリの README |
| 中継ページ | manage-web `app/pages/help-auth.vue` ほか | 設計は manage-web の `docs/feature/ONBS-2378/plan.md` |

### Cookie

- `Domain=.onboarding-app.io; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`
- 値は「有効期限（UNIX 秒）.署名」。署名は有効期限を HMAC-SHA256 で署名し base64url（パディングなし）にしたもの。
  manage-api と Worker の両方のテストに同じ値を置き、片方だけ形式を変えると落ちるようにしてある
- **有効期限は 24 時間。** 切れても、管理画面にログインしていれば中継ページで自動で発行し直す（利用者の操作は要らない）
- **ログイン・トークン更新・ログアウトの処理には手を入れない。** Cookie を出すのは専用のエンドポイント 1 本だけにした。
  そのぶん、ログアウトしてもそのブラウザでは最大 24 時間ヘルプが見える（トライアルが終わった利用者も同じ）。競合対策としては許容した

| 環境 | ホスト | Cookie 名 | 管理画面 | 署名の鍵（Secrets Manager） |
| --- | --- | --- | --- | --- |
| dev | `help-stg.onboarding-app.io` | `onb_help_dev` | `dev-manage.onboarding-app.io` | `dev/help-gate` |
| prod | `help.onboarding-app.io` | `onb_help` | `manage.onboarding-app.io` | `prod/help-gate` |

どちらも `.onboarding-app.io` に付くため、名前を分けないと dev と本番の Cookie が互いを上書きする。
鍵は Secrets Manager の `HELP_COOKIE_SIGNING_KEY` と、Worker の secret `SIGNING_KEY` に同じ値を入れる。

### CORS

管理画面（`manage.onboarding-app.io`）から manage-api（`manage-api.onboarding-app.io`）は別オリジンなので、
Cookie を受け取るには両側の指定が要る。

- 管理画面: `credentials: 'include'` を付けて送る（このエンドポイントだけ）
- manage-api: `function.yml` の `allowCredentials: true`（プリフライトの応答）と、Lambda の応答で
  `Access-Control-Allow-Origin` に管理画面のオリジンを明示し `Access-Control-Allow-Credentials: true` を返す。
  共通の応答は `Access-Control-Allow-Origin: *` だが、credentials 付きでは `*` は受け付けられない。
  **401 も同じ形で返す。** そうしないとブラウザが 401 を読めず、管理画面の API トークンの再発行が走らない

同一サイト（`onboarding-app.io`）なので、サードパーティ Cookie の制限は受けない。

### 戻り先

- 中継ページは `return` がヘルプのオリジンのときだけ受け付ける。検査しないと、ログイン後に任意のサイトへ
  飛ばせる（オープンリダイレクト）
- 戻り先は sessionStorage に預ける。タブを閉じれば消え、中継ページで取り出したときにも消す。
  ログイン後は `useAuth.completeLogin` が、戻り先を預けていれば中継ページへ送る（パスワード・二要素・パスキー共通）

### その他

- `/.well-known/acme-challenge` は Worker で検証しない（Vercel の証明書更新のため）
- Cloudflare の SSL は Full (strict)。Super の既知の問題として `ERR_TOO_MANY_REDIRECTS` があるが、検証では起きなかった
- Cloudflare の証明書はホスト名ごとに発行され、プロキシを有効にしてから約 10 分かかる。
  本番の切り替えではこの間 TLS が通らないため、手順で考慮する

### 利用者から見た挙動

- 管理画面にログインしたのと同じブラウザなら、Slack やメールのリンクからでも見られる
- 管理画面からヘルプを開くと、Cookie が無い・切れているときだけ中継ページを一瞬経由する
- 別のブラウザやスマホのアプリ内ブラウザでは、ログインを求められる。ログインすると元のヘルプのページが開く
- iframe での埋め込みは Cookie が送られず表示できない（該当はテスト用ページのみ）
- 未ログインの見込み客・営業資料からのリンクでは見られなくなる。Slack のリンクのプレビューもログイン画面になる

### 検証

2026-11-27、検証用の `help-stg.onboarding-app.io` で確かめた（経緯と結果は Jira のコメント）。

- Cloudflare を挟んでも Super のページは表示できる（スラッグ・ID 形式とも 200、リダイレクトのループなし）
- Super の既定ドメイン（`*.super.site`）は `help.onboarding-app.io` へ 308 でリダイレクトされ、抜け道にならない
- Notion を API で読む方式（非公開ページ）は、このサイトの管理画面では選べない

## 参考

- [Super: cloudflare proxy](https://docs.super.so/cloudflare-proxy)
- [Super: Configure your Super site's DNS with Cloudflare](https://super.so/guides/using-super-with-cloudflare)
- [Super: Password protect your Notion pages](https://super.so/features/password-protection)
- [Super: page password sub-pages](https://super.so/blog/page-password-sub-pages)
