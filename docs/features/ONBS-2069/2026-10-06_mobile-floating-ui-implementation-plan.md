# ONBS-2069 AIチャット モバイル新UI（下部フローティング）実装計画

参考動画: `~/Desktop/スクショ/CleanShot 2026-10-06 at 15.45.28.mp4`（一休.com のスマホ表示で新UIを再現したもの）

## 1. 何を作るか

スマートフォン向けに、AIチャットの表示形式を **2種類** 持てるようにする。

| 表示形式 | 内容 | 既定 |
| --- | --- | --- |
| ランチャー（旧UI） | 画面端に縦書きテキスト or 丸アイコンのランチャーを出す。現行の挙動 | ○ |
| フローティング（新UI） | 画面下部に初回選択肢を並べたバーを出す。バーを押すとチャットが開く | |

**既存顧客への影響を避けるため、設定が無いデータはすべて旧UIとして動く。**

## 2. 用語

本ドキュメントでの呼び方を揃える。コード上の実体も併記する。

| 呼び方 | 実体 |
| --- | --- |
| 初回選択肢 | `base.window.shortcuts`（`enabled` / `color` / `items[]`）。`WindowBody.svelte` に「初回選択肢（shortcuts）」とコメントあり |
| 最初のメッセージ | `base.window.first_message` |
| ランチャー | `base.trigger`。管理画面の「チャット編集 - ランチャー」ページで設定する |
| フローティング | 新UIで画面下部に出すバー。本チケットで新設 |
| チャットウィンドウ | チャットを開いたときの本体（`Window.svelte`） |

## 3. 確定した要件

### 3.1 管理画面

- 旧UIは残す。新旧の選択肢を追加し、選択によってエンドユーザー側の表示形式が変わる

### 3.2 エンドユーザー（AIチャットライブラリ含む）

- フローティング部分には初回選択肢の内容が表示される
- 初回選択肢が未設定の場合は最初のメッセージが1行表示される（はみ出し部分は `...` で表記）
- ページトップから **100px** スクロールした時にページ下段に表示される（z-index は一番上）
- ページ最下段（残り **100px** 以下）に達した場合は、サイト上の下部コンテンツが操作できるように表示を消す
- フローティング部分のグレーのバーを押すとチャットが開かれる
- フローティング部分の初回選択肢がクリックされた場合はメッセージが送信される & チャットが開かれる
- チャットが開かれた場合はサイトとチャット間にオーバーレイを追加する
- `trigger.is_hidden` が有効な場合、フローティング部分は非表示

### 3.3 ヒアリングで決めたこと

| 論点 | 決定 |
| --- | --- |
| 適用デバイス | **SPのみ**（`isSP()`）。タブレット・PCは常に旧UI |
| チャットウィンドウ本体 | **動画どおりボトムシート化**（上に余白・角丸・上部にグレーのハンドルバー）。新UI選択時のみ |
| 旧配信API（`onboarding-api` の `v2/onboarding-init`）対応 | **不要**（現在この経路の顧客がいないため） |
| フローティング表示開始 | ページトップから **100px** |
| 最下段判定 | 残り **100px** 以下 |
| 初回選択肢が複数のとき | **横スクロールと1行**（動画どおり。最大8件を横1列に並べ、横スワイプで閲覧） |
| チップの配色 | **`shortcuts.color` から自動生成**（背景はその色を薄くしたもの、文字色はその色そのまま）。管理画面に設定項目は増やさない |

## 4. 現状の構造（調査結果）

### 4.1 設定の流れ

```
管理画面(onboarding-manage-web)
  └ PATCH /v1/chats/{chat_id}/trigger  (onboarding-manage-api)
       └ chat_setting_histories.settings の base.trigger へ JSON 保存
            └ 配信API(Onboarding-API-Next /app/cruds/chats.py) が ai_chats[] として返す
                 └ onboarding-web(src/js/utils/aiChat.js) が trigger/window をそのまま mount に渡す
                      └ AIチャットライブラリ(Onboarding-AI-Chat) が描画
```

`onboarding-web` は `window` と `trigger` を無加工で渡しているため、**キーを1つ増やすだけならこのリポジトリのロジック変更は不要**（パッケージ更新と配信JSの再ビルドのみ）。

### 4.2 把握しておくべき既存実装

| 箇所 | 内容 |
| --- | --- |
| `Onboarding-AI-Chat/src/lib/ui/layout/Wrapper.svelte` | `position: fixed; z-index: 2147483647; pointer-events: none` のラッパー。`isOpen` で `Window` / `Trigger` を出し分ける |
| `同 Trigger.svelte` | 旧UIのランチャー。`{#if !$isHidden}` でガード済み |
| `同 Window.svelte` | SPでは `isSP()` のとき常に `expand()` され、**全画面（`height: 100%` / `border-radius: 0`）** になる |
| `同 WindowOverlay.svelte` | `!isPC()` のときだけ出る `rgba(0, 0, 0, 0.2)` のオーバーレイ。**既に実装済み**。ただし現状のSPはウィンドウが全画面なので見えていない |
| `同 utils/killScroll.ts` | チャットを開いている間 `document.body` を `position: fixed` にして背面スクロールを止める |
| `同 ui/common/Shortcuts.svelte` | チャット内の初回選択肢。白背景＋`shortcuts.color` の枠線・文字 |
| `onboarding-web/src/js/utils/aiChat.js` | `getFilteredChats()` で `trigger.is_hidden` のチャットを除外してから mount する。ただし **`mountWithId()` はこの除外を通らない** |
| `Onboarding-API-Next/app/cruds/chats.py` | 配信レスポンスの組み立て。`trigger` はキーを個別に列挙している（未知のキーは落ちる） |

### 4.3 注意すべき既存の制約

- **旧配信API（`onboarding-api` の `v2/onboarding-init`）は `window.shortcuts` を返していない。** 新UIは初回選択肢に依存するため、この経路では新UIが本来の形で動かない。今回は対象顧客がいないため対応しないが、将来この経路を復活させる場合は `shortcuts` と `mobile_ui_type` の両方を追加する必要がある
- `onboarding-web` の `mountWithId()`（STANDSMotion API からの明示マウント）は `is_hidden` を見ない。**`is_hidden` でフローティングを隠す判定はライブラリ側に持たせる**（配信側のフィルタだけに頼らない）
- ローカルの `Onboarding-AI-Chat` は `1.32.0` だが `onboarding-web` は `^1.34.0` を参照している。作業前に最新化すること

## 5. データモデル

`base.trigger` に1キー追加する。表示形式はランチャーの表示方法そのものなので `window` ではなく `trigger` 配下に置く。

```jsonc
{
  "base": {
    "trigger": {
      // 既存のキー ...
      "mobile_ui_type": "launcher"  // "launcher" | "floating"（未設定時は "launcher"）
    }
  }
}
```

**命名の意図**: 旧UIを `legacy` と呼ぶと、将来さらに新しいUIが出たときに名前が意味を失う。実体に即して「ランチャー」「フローティング」とする。管理画面でも既に「ランチャー」という語を使っている。

**後方互換**: キーが無いデータは `launcher` として扱う。全レイヤーでこのフォールバックを実装する。

## 6. 影響範囲と変更内容

| リポジトリ | 変更の有無 | 概要 |
| --- | --- | --- |
| `Onboarding-AI-Chat` | 大 | フローティングUI新規実装、ボトムシート化、スクロール検知 |
| `onboarding-manage-web` | 中 | 表示形式の選択UI、ストア、型、プレビュー |
| `onboarding-manage-api` | 小 | PATCH のバリデーションと欠落防御 |
| `Onboarding-API-Next` | 小 | 配信レスポンスに `mobile_ui_type` を追加 |
| `onboarding-web` | 小 | パッケージ更新と配信JSの再ビルド（ロジック変更なし） |
| `onboarding-api` | なし | 旧配信API。今回は対象外 |

---

### 6.1 Onboarding-AI-Chat（AIチャットライブラリ）

#### 追加・変更するファイル

| ファイル | 変更内容 |
| --- | --- |
| `src/lib/constants/index.ts` | `MOBILE_UI_TYPE` と `FLOATING_CONSTANT` を追加。`TRIGGER_CONSTANT.DEFAULT_MOBILE_UI_TYPE = 'launcher'` |
| `src/lib/core/schemas/receiveDataSchema.ts` | `trigger.mobile_ui_type: z.enum(['launcher', 'floating', '']).optional()` |
| `src/lib/stores/triggerStyleStore.ts` | `mobileUiType` を追加 |
| `src/lib/stores/floatingStateStore.ts` | **新規**。フローティングの表示状態（`isVisible`）を保持 |
| `src/lib/utils/pageScrollWatcher.ts` | **新規**。ページのスクロール位置を監視し、表示/非表示を判定する |
| `src/lib/ui/layout/Floating.svelte` | **新規**。フローティング本体 |
| `src/lib/ui/layout/WindowHandle.svelte` | **新規**。ボトムシート上部のグレーのハンドルバー |
| `src/lib/ui/layout/Wrapper.svelte` | 新UI時の分岐とラッパーのレイアウト調整 |
| `src/lib/ui/layout/Window.svelte` | 新UI時のボトムシート化（SPのみ） |
| `src/index.ts` | `triggerStyleStore.setMobileUiType()` の呼び出しを `init()` に追加 |
| `src/lib/utils/index.ts` | 新ユーティリティの re-export |

#### 定数（提案値）

```ts
export const MOBILE_UI_TYPE = {
  LAUNCHER: 'launcher',
  FLOATING: 'floating',
}

export const FLOATING_CONSTANT = {
  // ページトップからこのpx数を超えてスクロールしたら表示する
  SHOW_SCROLL_OFFSET: 100,
  // ページ末尾までの残りがこのpx数以下になったら隠す（サイト下部のコンテンツを操作できるようにするため）
  HIDE_BOTTOM_OFFSET: 100,
  // ハンドルバー
  HANDLE_WIDTH: 36,
  HANDLE_HEIGHT: 4,
  HANDLE_COLOR: '#d9d9d9',
  // チップ背景に使う、shortcuts.color の不透明度
  CHIP_BG_ALPHA: 0.12,
}
```

#### 表示条件

フローティングを表示する条件は次の論理積。

```
isSP()
  && mobileUiType === 'floating'
  && !trigger.is_hidden
  && !windowStateStore.isOpen
  && userEnv !== 'preview'（管理画面プレビューは別扱い。6.2 を参照）
  && scrollY > 100
  && (scrollHeight - (scrollY + innerHeight)) > 100
```

#### スクロール検知の実装方針

```ts
// pageScrollWatcher.ts の責務
// - scroll / resize / orientationchange を passive で購読
// - requestAnimationFrame でスロットルする（スクロール中の連続発火を1フレーム1回に抑える）
// - scrollHeight は毎回取り直す（画像の遅延読込や無限スクロールで変動するため）
// - destroy() で全リスナーを解除する
```

**チャットを閉じた直後に必ず再評価する。** `killScroll()` がチャット表示中に `document.body` を `position: fixed` にするため、その間 `scroll` イベントは発火しない。閉じると `window.scrollTo()` でスクロール位置が復元されるが、イベント発火のタイミングに依存せず、`isOpen` の変化を `$effect` で監視して明示的に再判定する。

**iOS Safari のアドレスバー伸縮に注意。** 伸縮で `innerHeight` が変わり最下段判定がぶれる。`resize` でも再評価し、閾値は 100px と余裕を持たせる（1px などの極小値にしない理由でもある）。

#### Floating.svelte の構造

```
<div class="floating">            ← 白背景・上側だけ角丸・上向きの影・pointer-events: auto
  <button class="floating__handle">   ← グレーのバー。押すとチャットを開く
  <div class="floating__body">        ← 横スクロール領域（overflow-x: auto）
    初回選択肢あり → <button class="floating__chip"> を items 分
    初回選択肢なし → <p class="floating__message">  ← 1行・ellipsis
  </div>
</div>
```

- **ハンドル押下**: `tracking.sendEvent(CHAT_EVENT.WINDOW_OPENED)` → `windowStateStore.open()`
- **チップ押下**: `windowStateStore.open()` → `chat.sendMessage(resolveShortcutText(item.message, item.name))` → `tracking.sendEvent(CHAT_EVENT.MESSAGE_SENT)`
  - 送信ロジックは既存の `Shortcuts.svelte` と同じく `resolveShortcutText()` を使い、`message` が空なら `name` を送る
  - `chatStore.enableSendMessage` が false のときは送信しない（既存実装と揃える）
- **トラッキングイベントは既存のものを流用する。** `CHAT_EVENT` は `chatEventSchema.ts` の `z.enum` で固定されており、新イベントを足すと集計側の受け入れ対応も必要になるため、本チケットでは増やさない

#### 「初回選択肢が未設定」の定義

次のいずれかに当てはまる場合は未設定とし、最初のメッセージの1行表示にフォールバックする。

- `shortcuts` キーが存在しない
- `shortcuts.enabled === false`
- `shortcuts.items.length === 0`

#### 最初のメッセージの1行表示

`first_message` は改行とマークダウンを含みうる（既定値も複数行）。

1. 改行で分割し、空でない最初の行を取る
2. 見出し記号・強調記号などの簡易マークダウン記法を落とす
3. CSS（`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`）ではみ出しを `...` にする

`first_message` も空の場合は `WINDOW_CONSTANT.DEFAULT_FIRST_MESSAGE` の1行目を使う。

#### Wrapper.svelte の分岐

```svelte
{#if isManage || $isOpen}
  <WindowOverlay />
  <Window />
{:else if useFloating}
  <Floating />
{:else}
  <Trigger />
{/if}
```

`.wrapper` は現在 `align-items` と `right/left: 0` だけで位置を決めており、幅の指定がない。フローティングは画面全幅が必要なため、新UI時は `left: 0; right: 0; align-items: flex-end` を当てるようスタイル生成（`wrapperStyle`）を分岐させる。`pointer-events: none` は維持し、`Floating` 側で `pointer-events: auto` に戻す（サイト側の操作を妨げないため。既存のランチャーと同じ考え方）。

#### チャットウィンドウのボトムシート化

新UI かつ SP のときだけ、現在の全画面表示をボトムシートに変える。

| 項目 | 旧UI（現状維持） | 新UI |
| --- | --- | --- |
| 高さ | `100%`（`--onb-chat-window-max-height-ratio`） | 上部に余白を残す（既定 `calc(100% - 56px)` 程度を想定。実装時に動画と見比べて調整） |
| 角丸 | `0` | `16px 16px 0 0` |
| ハンドルバー | なし | ヘッダー上部に表示 |

- `Window.svelte` の `:global(.sp) .window.is-open` に新UI用のクラスを足して出し分ける
- ハンドルバーは見た目のみ（ドラッグ操作は本チケットのスコープ外。「9. スコープ外」を参照）
- 既存の `--onb-chat-window-max-height-ratio`（ソフトウェアキーボード表示時の高さ調整）は引き続き効かせる。キーボードが出たときに上部余白分だけ入力欄が隠れないか、実機で確認する

#### オーバーレイ

既存の `WindowOverlay.svelte`（`!isPC()` で表示、`rgba(0, 0, 0, 0.2)`）をそのまま使う。**現状はウィンドウが全画面のため見えていないだけで、ボトムシート化によって上部余白に現れる。** 新規実装は不要。

濃度 `0.2` が薄いと判断された場合は定数化して調整する（要確認事項）。

---

### 6.2 onboarding-manage-web（管理画面）

| ファイル | 変更内容 |
| --- | --- |
| `app/types/modules/aiChatEdit.ts` | `AiChatEditTriggerSchema` に `mobile_ui_type: z.enum(['launcher', 'floating']).optional()` |
| `app/constants/aiChat.ts` | `trigger.defaultMobileUiType: 'launcher'` と選択肢ラベルを追加 |
| `app/store/aiChatEdit.ts` | `updateTriggerMobileUiType` を追加 |
| `app/pages/ai/chats/[id]/trigger.vue` | 「モバイル表示形式」セクションを追加し、`localUpdateTrigger()` の送信値に含める |
| `app/components/domain/Ai/Chat/Edit/TriggerPreviewContent.vue` | 新UI選択時のプレビュー |
| `app/components/domain/Ai/Chat/Edit/MobileUiType/` | **新規**（選択パネル。既存の `TriggerShape/` と同じ作り） |

- 選択UIは既存の `TriggerShape`（デザイン選択パネル）と同じ見た目に揃える
- `is_hidden`（ランチャーの表示＝「しない」）のときは、既存の `is-locked` クラスで他の設定ごとグレーアウトされる。新設のセクションも同じブロック内に置き、同じ扱いにする
- 新UI選択時は「PC・タブレットでは従来のランチャーが表示されます」の注記を出す（SP限定であることが設定画面から分からないため）
- 新UI選択時に初回選択肢が未設定なら「初回選択肢が未設定のため、最初のメッセージが表示されます」と案内する。初回選択肢は別ページ（チャット編集の基本設定）にあるため、導線を併記する

#### プレビューの扱い

管理画面のプレビューは PC ブラウザ上で動いており、ライブラリ側は `userEnv === 'preview'` のとき `isPC()` 判定で常にPC向け描画になる。**新UIはSP限定のため、現状のプレビュー機構では再現されない。**

本チケットでは、管理画面側で静的なイメージ（`TriggerPreviewContent.vue` と同じ作りの、SVG/HTMLによる見本）を表示する方針とする。ライブラリのプレビューをSPモードで動かす改修は行わない（工数と影響範囲が大きいため）。

---

### 6.3 onboarding-manage-api

| ファイル | 変更内容 |
| --- | --- |
| `api/rest/functions/mng-v1-chats-chat-id/validate_patch_trigger.json` | `mobile_ui_type` を追加（`type: string` / `required: false` / `allowed: ["launcher", "floating"]`） |
| `api/rest/functions/mng-v1-chats-chat-id/method_patch.py` | 旧管理Webからの PATCH で既存値が消えないよう保持する |

`PATCH /trigger` は trigger 全体を置き換える。`shortcuts` のときと同じく、**`mobile_ui_type` を持たない旧バージョンの管理Webから PATCH が来ると設定が消える**。既存の `window` / `shortcuts` の防御（`method_patch.py:263-267`）と同じパターンで `trigger` にも入れる。

```python
if path_resource == "trigger" and "mobile_ui_type" not in request_params and "mobile_ui_type" in data:
    # Why: mobile_ui_type 未搭載の旧Webからの PATCH /trigger で既存設定が消えないよう保持する。
    # 全クライアントが対応版に更新された後に削除可能（関連: ONBS-2069）。
    request_params = {**request_params, "mobile_ui_type": data["mobile_ui_type"]}
```

既存の `window` 側の分岐と合わせて共通化できるかは実装時に判断する（`shortcuts` の分岐には「全クライアント更新後に削除可能」とあるため、安易に共通化すると片方だけ消しにくくなる点に注意）。

---

### 6.4 Onboarding-API-Next（配信API）

`app/cruds/chats.py` の trigger 組み立てに1行追加する。

```python
"trigger": {
    # 既存 ...
    "mobile_ui_type": trigger.get("mobile_ui_type", "launcher"),
},
```

trigger はキーを個別に列挙しているため、追加しないと配信レスポンスから落ちる。

---

### 6.5 onboarding-web（配信）

- `package.json` の `@stands/onboarding-ai-chat` を新バージョンに更新
- `window` / `trigger` は `getMountData()` でそのまま渡しているため、**ロジック変更は不要**
- 配信JS（`onboarding-init.js` / `onboarding-init-next.js`）は CI では配信されない。**2ファイルともビルドして S3 へ手動アップロードが必要**（CLAUDE.md「dev 環境へのデプロイ」を参照）

---

## 7. リリース順序

依存関係から次の順で出す。ライブラリは未知の値を `launcher` にフォールバックするため、どの時点でも既存顧客が壊れることはない。

| 順 | リポジトリ | 理由 |
| --- | --- | --- |
| 1 | `Onboarding-AI-Chat` | npm パッケージ公開。先に出さないと `onboarding-web` が参照できない |
| 2 | `Onboarding-API-Next` | 配信に `mobile_ui_type` を載せる。管理画面より先に出す |
| 3 | `onboarding-manage-api` | PATCH を受け付けられるようにする |
| 4 | `onboarding-manage-web` | 設定UIを出す。API が未対応だと保存が 400 になるため 3 の後 |
| 5 | `onboarding-web` | パッケージ更新 + 配信JSのS3アップロード |

リリース時は `docs/features/ONBS-2069/{日付}_release-runbook.md` に順序を残す（CLAUDE.md の規約）。

## 8. テスト観点

### 8.1 管理画面

- 新規チャットの既定が「ランチャー（旧UI）」になっている
- 新UI ↔ 旧UI の切り替えが保存され、再読み込み後も保持される
- `mobile_ui_type` を持たない既存チャットを開いても落ちず、旧UIとして表示される
- ランチャーの表示を「しない」にすると新設セクションもグレーアウトされる
- 初回選択肢が未設定のまま新UIを選ぶと案内が出る
- **旧バージョンの管理Webから `PATCH /trigger` を投げても `mobile_ui_type` が消えない**（6.3 の防御の確認）

### 8.2 エンドユーザー（SP実機で確認）

| 観点 | 期待 |
| --- | --- |
| 旧UI選択時 | 現状と完全に同じ（ランチャー表示・全画面チャット）。**デグレが無いことを最優先で確認する** |
| 新UI・ページトップ | フローティングが出ない |
| 新UI・100px超スクロール | フローティングが画面下部に出る |
| 新UI・最下段付近 | フローティングが消え、サイトのフッターが操作できる |
| 新UI・最下段から戻る | フローティングが再表示される |
| 初回選択肢あり | チップが横1列に並び、横スワイプで全件見える |
| 初回選択肢なし | 最初のメッセージが1行で出て、はみ出しが `...` になる |
| ハンドルバー押下 | チャットが開く |
| チップ押下 | チャットが開き、そのメッセージが送信済みの状態になる |
| チャット表示中 | サイトとチャットの間にオーバーレイが出る／背面がスクロールしない |
| チャットを閉じた直後 | スクロール位置が戻り、フローティングの表示状態が正しく再判定される |
| `is_hidden` 有効 | フローティングが出ない（`mountWithId()` で明示マウントした場合も含む） |
| タブレット・PC | 新UIを選んでも旧UIのまま |
| z-index | ツアー・ヒント・汎用モーダルより前面に出る |
| iOS Safari | アドレスバーの伸縮で最下段判定がぶれない |
| ソフトウェアキーボード | ボトムシート表示中に入力欄がキーボードに隠れない |

### 8.3 既存機能の回帰

- STANDSMotion API（`openWindow()` / `closeWindow()` / `mountWithId()`）が新旧どちらでも動く
- トラッキングイベント（`window_opened` / `message_sent`）がフローティング経由でも記録される
- ツアー・ヒントとの共存（`Wrapper.svelte` の body 末尾への移動処理）

## 9. スコープ外

明示的に今回やらないこと。

- ハンドルバーのドラッグ操作（スワイプで閉じる・高さ変更）。見た目のみ実装する
- 旧配信API（`onboarding-api` の `v2/onboarding-init`）への対応
- 管理画面プレビューをSPモードで動かす改修（静的な見本で代替する）
- PC・タブレット向けのフローティング表示
- トラッキングイベントの新設

## 10. 実装で決めたこと・計画から変えたこと

実装を進めるなかで確定した値と、計画と異なる判断をした点。

| # | 内容 | 結果 |
| --- | --- | --- |
| 1 | ボトムシートの上部余白 | **56px**（`Window.svelte` の `$bottom-sheet-top-gap`） |
| 2 | オーバーレイの濃度 | 既存の `rgba(0, 0, 0, 0.2)` のまま |
| 3 | チップ背景の薄め方 | `shortcuts.color` を alpha **0.12** で重ねる |
| 4 | フローティングの高さ | 内容から自動。初回選択肢ありで **88px** |
| 5 | 管理画面の選択UI | **ラジオボタン**にした。計画では `TriggerShape` と同じパネル選択としていたが、パネルは選択肢を表す SVG イラストが要る。描き起こすと品質が安定しないため、同ページの「ランチャーの表示」と同じラジオボタンに揃えた |
| 6 | ハンドルバーの役割 | 計画では「見た目のみ」としていたが、**押すとチャットを閉じる**ようにした（レビュー指摘による） |
| 7 | 最初のメッセージの1行化 | 計画では「空でない最初の行」としていたが、**全文を1行に連結**し改行をスペースに置き換える方式へ変更（見出しで始まると数文字しか出ないため。レビュー指摘による） |
| 8 | 開閉アニメーション | 計画になかったが追加。ボトムシートが下端から迫り出し、オーバーレイがフェードする（250ms）。旧UI と「視差効果を減らす」設定では動かさない |
| 9 | 横スクロールの端のぼかし | 計画になかったが追加。送り先が残っている側の端だけを白くぼかす |

### 実装中に見つかった落とし穴

後続の作業で同じ問題を踏まないよう記録する。

| 箇所 | 内容 |
| --- | --- |
| `Wrapper.svelte` → `Window` / `WindowOverlay` | Svelte の transition は既定で local のため、**親ブロック（`{#if}`）経由のマウントでは intro が走らない**。`|global` を付けないとアニメーションしない（`animation: none` になる） |
| `Floating.svelte` の1行表示 | `ViewRoot.svelte` の `:global(button) { all: unset }` が **`box-sizing` を `content-box` に戻す**。`width: 100%` に左右 padding が外付けされ、親より 32px 大きくなって不要な横スクロールが生まれた。`box-sizing: border-box` の指定し直しが要る |
| フローティングの出現タイミング | ボトムシートの退場とフローティングの登場は、Svelte が `{:else if}` 分岐を退場後に作るため**重ならない**。遅延を入れる必要はなかった |
| e2e のデバイス指定 | `devices['iPhone 13']` をそのまま展開すると `defaultBrowserType` が webkit になり、chromium だけの既存プロジェクト設定と食い違う。判定に要る項目だけを渡す |

## 11. 積み残し

| 対象 | 内容 | 実施できる条件 |
| --- | --- | --- |
| `onboarding-web` | `@stands/onboarding-ai-chat` を **1.35.0** へ更新（`package.json` / `package-lock.json`） | ライブラリが main にマージされ、GitHub Actions で npm に公開された後 |
| `onboarding-web` | 配信JS（`onboarding-init.js` / `onboarding-init-next.js`）のビルドと S3 への手動アップロード | 上記のパッケージ更新後 |

`onboarding-web` のロジック変更は不要であることを確認済み。`getMountData()` が `trigger` を無加工で `mount()` に渡しているため、`mobile_ui_type` はそのまま届く。

### `onboarding-web` の develop は dev 版のまま（意図的）

dev 確認のため `1.35.0-dev.*` を参照しているが、**最新の dev 版（`20261007033807`）は
`develop` へ反映していない**（コミット `f6399576` は feature ブランチに留めてある）。

`develop` へ push すると Chrome ウェブストアへの自動申請が走り、`ext-version-bump` の
再採番が要る。中身が同じ拡張を別バージョンで再申請するだけになるため、
**本番リリース時に正式版 `1.35.0` へ差し替える際にまとめて対応する**（2026-10-07 判断）。

dev 環境のエンドユーザー側は S3 の配信JSで動いており、そちらは最新のため確認に支障はない。
ただし**この期間に他者が `develop` から `onboarding-web` をビルドすると古いライブラリが入る**。
