# ツアー表示スタイル設定の不具合（ランチャーのアイコン色が反映されない / 表示位置の 0 が保持されない）

作業ブランチ: `hotfixes/1958`（onboarding-web / onboarding-manage-web / onboarding-e2e-test の3リポジトリ）

---

## 概要

管理画面「表示スタイル設定 > ランチャー」で **アイコン色**を変更しても、エンドユーザー側の
ランチャーアイコンに反映されず常に `#333`（黒）で描画される。管理画面のプレビューでは
設定色が正しく反映されるため、**「プレビューでは設定色なのに本番は黒」**という食い違いが
発生していた。

調査の過程で、同じ表示スタイル設定に **表示位置のオフセットに 0 を指定すると次回 30 に
戻る**不具合も判明した。あわせて修正する。

---

## 問題点

### 1. ランチャーのアイコン色がエンドユーザー側に反映されない（本報告の主題）

ランチャーの Svelte コンポーネント（`onboarding-web` の `Launcher.svelte`）の scoped CSS が、
アイコンの `svg` 要素自身に `fill` を宣言していた。

```css
.iguider-btn-icon {
    color: #333;
}
.iguider-btn-icon :global(svg) {
    fill: currentColor;   /* ← 原因 */
}
```

`applyCustomStyles()` は `launcherBtn.icon.color` を **span（`.iguider-btn-icon`）のインライン
`fill`** としてセットし、`fill` が継承プロパティであることを利用して内側の `svg` / `path` まで
色を届ける設計になっている。

ところが `svg` 要素自身に `fill` が宣言されていると、**要素自身のカスケード値が継承値に勝つ**
ため、span のインライン `fill` は無視される。さらに `currentColor` は `svg` の `color` に解決され、
それは `.iguider-btn-icon { color: #333 }` から継承されるので、アイコンは常に `#333` に固定される。

- **リグレッション**。ONBS-1520 の Svelte 移行で `fill: currentColor` が導入された
  （`git log -S "fill: currentColor"` の該当コミットは 1 件のみ）
- 旧 jQuery 実装も同じく span に `fill` を当てていたが、旧 SCSS に `svg { fill }` の宣言が
  なかったため継承が機能し、正常に動作していた

**影響範囲**: 新配信 JS **`onboarding-init-next.js` のみ**。配信の切り替えは `onboarding-api` の
フィーチャーフラグ `use_refactored_onboarding_init`（または Referer の `?onbd_init_ver=next`）で
決まるため、**フラグ ON のアカウント / プロダクトでのみ発生**する。legacy 配信は正常。

背景色・文字色・テキスト・表示位置・ボタン表示なしは正常に反映されており、**アイコン色のみ**が
反映されない。

### 2. ランチャー表示位置に 0 を指定すると次回 30 に戻る

管理画面（`onboarding-manage-web` の `UiGuideEditStylesSettingTour.vue`）の `data()` 初期化で、
保存値を `formatPositionValue(...) || デフォルト値` としてフォールバックしていた。

バリデーションは `min_value:0` なので **0 は保存できる**が、0 が falsy 判定でデフォルトの 30 に
差し替わるため、モーダルを開き直すと 30 が表示される。そのまま保存すると設定値が 30 に
書き換わる。上下左右の 4 フィールドすべてが該当。

### 3. ランチャーの最小化アニメーションの移動量にも同じ falsy-zero 問題がある

`Launcher.svelte` の `applyCustomStyles()` が `margin` を `parseInt(...) || 30` で算出しており、
表示位置のオフセットに 0 を設定すると `margin` が 30 になる。`margin` は最小化 / ホバー時の
移動量（`moveLauncher()`）に使われるため、**オフセット 0 のランチャーで最小化アニメーションが
30px ずれる**。問題 2 と同じ「設定値のフォールバックに `||` を使うと 0 が落ちる」罠。

### 4. styles のキー欠損で表示スタイル設定モーダルが開かない

`UiGuideEditStylesSettingTour.vue` / `UiGuideEditStylesSettingPopup.vue` の `data()` 初期化で
optional chaining が途中で切れており、保存済み `styles` に以下のいずれかのキーが欠けていると
TypeError になる。

- `launcherBtn` / `launcherBtn.wrapper` / `launcherBtn.shape` / `launcherBtn.icon`
- `intro.checkmark`
- `step.positiveBtn` / `step.negativeBtn`

呼び出し側（`guide.ts` の `stylesSettings.create()`）は catch して `console.error` するだけで
notice を出さないため、**モーダルが無言で開かなくなる**。現行テンプレート（`steps_preview.json`）は
全キーを持つため新規ガイドでは起きないが、キーを欠く旧データが残っていると詰む。

### 5. 既存テストが問題 1 の回帰を検知できていなかった

unit / E2E とも **span の `fill`** しか検証しておらず、実際に描画される `svg` / `path` を見ていない
ため、バグがあっても緑になっていた。

| 層 | 対象 | 検証内容 |
|---|---|---|
| unit（onboarding-web） | `tests/unit/components/Launcher.test.ts` | `.iguider-btn-icon` の style 属性に `fill: #xxx` が含まれるか |
| E2E（onboarding-e2e-test） | `tests/common/launcher/styles.js` | `.iguider-btn-icon` の CSS `fill` |

---

## 対応内容

| リポジトリ | 変更概要 |
|---|---|
| **onboarding-web** | 【問題1】`Launcher.svelte` の `.iguider-btn-icon :global(svg) { fill: currentColor }` を削除し、既定色を `.iguider-btn-icon { fill: #333 }` に移動（旧 jQuery 実装と同じ継承構造に戻す）／「コンポーネント CSS が `svg` / `path` に `fill` を宣言しないこと」の回帰ガードを unit に追加／【問題3】`margin` 算出を `Number.isFinite()` 判定に変更（0 は通し `'auto'` 等のみ既定値に倒す）／ナレッジ `docs/knowledge/2026-08-20_launcher-icon-color-fill-inheritance.md` を追加 |
| **onboarding-manage-web** | 【問題2】`UiGuideEditStylesSettingTour.vue` の表示位置フォールバックを `\|\|` → `??` に変更／`formatPositionValue()` が数値として読めない値でも `undefined` を返すようにして `??` の前提を満たす／【問題4】`UiGuideEditStylesSettingTour.vue` / `UiGuideEditStylesSettingPopup.vue` の optional chaining を全キーに通す／各 spec に 0 保持・不正値フォールバック・キー欠損のケースを追加（分岐対応表も更新） |
| **onboarding-e2e-test** | `tests/common/launcher/styles.js` の検証対象に、実際に塗られる旗の `path` を追加（span の fill だけを見る従来の assert では回帰を検知できなかった） |

### 実ブラウザでの検証結果

Chromium で修正前後の CSS を並べて計測した実測値。

| CSS | span `.iguider-btn-icon` | 内側の `svg` | 内側の `path` |
|---|---|---|---|
| 修正前（`svg { fill: currentColor }`）・アイコン色 `#ffffff` 設定あり | `#ffffff` | **`#333333`** | **`#333333`** |
| 修正後・アイコン色 `#ffffff` 設定あり | `#ffffff` | `#ffffff` | `#ffffff` |
| 修正前・設定なし（既定色） | — | `#333333` | `#333333` |
| 修正後・設定なし（既定色） | — | `#333333` | `#333333` |

- 修正前は span だけが設定色になり、実際に塗られる `svg` / `path` は `#333333` のまま
  → **span を見る従来の assert では修正前も通ってしまう**ことが実証された
- 設定なし（既定色）の描画色は修正前後で変化なし。既定の見た目にリグレッションはない

### unit テストで「描画色」を検証できない理由

回帰ガードの実装にあたり happy-dom の挙動を実測したところ、`fill` の継承が
`getComputedStyle` に反映されないことが判明した（`css: 'injected'` でコンポーネント CSS は
`<style>` として注入済み）。

| 対象 | `getComputedStyle(el).fill` |
|---|---|
| span `.iguider-btn-icon`（インライン `fill: #00ff00`） | `#00ff00` |
| 内側の `svg` | `''`（空文字） |
| 内側の `path` | `''`（空文字） |

そのため unit では「`svg` / `path` に `fill` 宣言が無いこと」を回帰ガードとして固定し、
実際の描画色検証は E2E 側の責務とした。ガードは意図的に回帰を再導入すると落ちることを確認済み。

---

## 残作業

### E2E の実行（未実施）

3 リポジトリのコード修正は完了しているが、**E2E の実行は未実施**。実行には onboarding-web の
ビルド成果物と dev 環境が必要なため、リリース前に以下を回すこと。

```bash
# onboarding-web
npm run build_preview:e2e

# onboarding-e2e-test（新配信を対象にする）
ONBD_INIT_VER=next npm run test:embed:launcher
```

新配信（`onboarding-init-next.js`）が対象のため `ONBD_INIT_VER=next` が必要。
legacy 配信でも既定色・設定色ともに従来どおり通ることを併せて確認する。

なお onboarding-e2e-test の Playwright は `chromium-1124` を要求するため、
未取得の環境では `npx playwright install` が必要。

### 別チケット候補（今回は未修正）

| # | 内容 | 深刻度 |
|---|---|---|
| 1 | ヒントの表示スタイル設定（`UiGuideEditStylesSettingHint.vue`）は `this.styles.icon.css[...]` を optional chaining なしで読んでいる。呼び出し側の `guide.ts` が `styles.icon` を事前に正規化しているため構造が異なり、今回の修正対象からは外した。別途調査が必要 | 軽微（堅牢性） |
| 2 | 同ファイルの `pxToNumber(...) \|\| ...` にも falsy-zero 構造がある（アイコンサイズ / フォントサイズ）。0 が意味を持たない項目のため実害は無いが、同じ罠の残存箇所 | 軽微 |

---

## 問題なしを確認した箇所

同じ表示スタイル設定の他項目も併せて調査し、以下は正常と確認した。

- 背景色 / 文字色 / テキスト / 表示位置 / ボタン表示なし（`display: none`）
- イントロのチェックマーク色 — 旧実装と処理順・挙動が同一でリグレッションなし。
  `.stands-step-item-check` は顧客別 makeup スクリプトが生成する DOM のため、
  UI の注記「表示済みゴールのチェックマークにのみ適用されます」どおりの仕様
- ステップの「次へ / 終了」「前へ」ボタンの色・枠。「枠を付ける」OFF 時の `transparent` 往復も整合
- 「デフォルトに戻す」の既定値 — バックエンドテンプレート（`steps_preview.json`）と完全一致
- カラーピッカーの値正規化（`#` の付与）
- ヒント側に同種の `fill: currentColor` パターンは存在しない

---

## 確認手順（アイコン色）

1. 対象プロダクトが新配信（`use_refactored_onboarding_init` が ON）であることを確認する。
   フラグに依らず再現させる場合は、埋め込み先ページの URL に `?onbd_init_ver=next` を付ける
2. 管理画面のツアー編集 → 表示スタイル設定 → ランチャー → アイコン色を背景色と明確に
   区別できる色（例: 背景 `#FFBEBE` / アイコン `#FFFFFF`）に変更して保存
3. エンドユーザー側でランチャーの旗アイコンが設定色で描画されることを確認する
4. あわせて管理画面プレビューと実際の描画が一致することを確認する

## 確認手順（表示位置の 0）

1. 表示スタイル設定 → ランチャー → 表示位置のオフセット（上下左右いずれか）に `0` を入力して保存
2. モーダルを閉じて再度開き、`0` が保持されていることを確認する（修正前は `30` になる）
3. そのまま再保存し、エンドユーザー側の位置が 0 のままであることを確認する
4. エンドユーザー側でランチャーのトグルを押して最小化し、吸着位置がずれていないことを確認する
   （問題 3。修正前はオフセット 0 でも 30px 分ずれる）

## 確認手順（styles のキー欠損）

再現には、対象ガイドの `steps_json_src.settings.styles` からキーを意図的に落としたデータが必要。
本番データで再現させる必要はなく、unit テスト（`spec/components/ui/UiGuideEditStylesSettingTour.spec.ts`
/ `UiGuideEditStylesSettingPopup.spec.ts` の「styles のキー欠損」ケース）でカバーしている。

回帰確認としては、**通常データで表示スタイル設定モーダルが従来どおり開き、各値が正しく
表示されること**（ツアー / ポップアップ両方）を見れば足りる。
