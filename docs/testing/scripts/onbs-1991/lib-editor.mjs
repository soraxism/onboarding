/**
 * エディタ拡張の操作。
 *
 * エディタ UI は `onboarding-editor-extension` 要素の shadow DOM に描画される。
 * Playwright の click はパネル位置の関係で「ビューポート外」と判定されて通らないため、
 * shadow DOM 内で直接 click() を呼ぶ。
 */

/** shadow root を持つホスト要素のセレクタ */
export const EDITOR_HOST = 'onboarding-editor-extension'

/** エディタの UI が出るまで待つ */
export async function waitForEditor(page, timeoutMs = 30000) {
  await page.waitForFunction(
    (host) => !!document.querySelector(host)?.shadowRoot?.querySelector('.treePanel'),
    EDITOR_HOST,
    { timeout: timeoutMs }
  )
  await page.waitForTimeout(1500)
}

/** 畳まれているツリーパネルを展開する */
export async function expandTreePanel(page) {
  await page.evaluate((host) => {
    document.querySelector(host).shadowRoot.querySelector('.treePanelControl__expandBtn')?.click()
  }, EDITOR_HOST)
  await page.waitForTimeout(1500)
}

/** shadow DOM 内で、自身のテキストノードが text に一致する要素をクリックする */
export async function clickByText(page, text, { closest } = {}) {
  const r = await page.evaluate(({ host, text, closest }) => {
    const sr = document.querySelector(host).shadowRoot
    const els = [...sr.querySelectorAll('*')].filter((el) => {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim()
      return own === text
    })
    const el = els[els.length - 1]
    if (!el) return false
    ;(closest ? (el.closest(closest) ?? el) : el).click()
    return true
  }, { host: EDITOR_HOST, text, closest })
  if (!r) throw new Error(`エディタ内に「${text}」が見つかりません`)
  await page.waitForTimeout(800)
}

/** ツリーパネルからイントロの編集ビューを開く */
export async function openIntroInEditor(page) {
  await page.evaluate((host) => {
    const sr = document.querySelector(host).shadowRoot
    const el = [...sr.querySelectorAll('.treeContentDescription__title')].find((e) => e.textContent.trim() === 'イントロ')
    el?.click()
  }, EDITOR_HOST)
  await page.waitForTimeout(2500)
}

/** イントロのゴール一覧（タスクリスト）を選択してインラインメニューを出す */
export async function selectTaskList(page) {
  await page.evaluate((host) => {
    const sr = document.querySelector(host).shadowRoot
    sr.querySelector('.elementTaskList__main')?.click()
  }, EDITOR_HOST)
  await page.waitForTimeout(1500)
}

/** インラインメニューの表示状態と現在値を読む */
export async function readTaskListMenu(page) {
  return page.evaluate((host) => {
    const sr = document.querySelector(host).shadowRoot
    const menu = sr.querySelector('.taskListMenu')
    if (!menu) return { open: false }
    const rect = menu.getBoundingClientRect()
    const value = menu.querySelector('.checkmarkTimingBtn__value')?.textContent?.trim() ?? null
    const labels = [...menu.querySelectorAll('[class*="EditorBtn__label"]')].map((e) => e.textContent.trim())
    return { open: rect.width > 0 && rect.height > 0, value, labels }
  }, EDITOR_HOST)
}

/**
 * タイミングのプルダウンを開いて、見えている選択肢を返す。
 *
 * 2 段構え: 「チェックのタイミング」ボタン → パネルが開く →
 * その中の select 風の箱（現在値表示）→ 選択肢リストが開く。
 */
export async function openTimingPulldown(page) {
  // 1段目: メニューの「チェックのタイミング」ボタン
  await page.evaluate((host) => {
    const sr = document.querySelector(host).shadowRoot
    const value = sr.querySelector('.taskListMenu .checkmarkTimingBtn__value')
    value?.closest('[class*="EditorBtn"], button, [role="button"]')?.click()
  }, EDITOR_HOST)
  await page.waitForTimeout(1000)
  // 2段目: パネル内の select 風の箱（.pulldown__trigger）
  await page.evaluate((host) => {
    const sr = document.querySelector(host).shadowRoot
    const trigger = [...sr.querySelectorAll('.pulldown__trigger')].find((e) => e.getBoundingClientRect().width > 0)
    trigger?.click()
  }, EDITOR_HOST)
  await page.waitForTimeout(1000)
  // 選択肢は BaseListRow（.listRow）で描画される
  return page.evaluate((host) => {
    const sr = document.querySelector(host).shadowRoot
    return [...sr.querySelectorAll('.pulldown .listRow, .listRow')]
      .map((e) => ({ text: e.textContent.trim().replace(/\s+/g, ' '), visible: e.getBoundingClientRect().width > 0 }))
      .filter((x) => x.visible && x.text)
  }, EDITOR_HOST)
}

/** 開いている選択肢リストからタイミングを選ぶ */
export async function chooseTiming(page, label) {
  const ok = await page.evaluate(({ host, label }) => {
    const sr = document.querySelector(host).shadowRoot
    const els = [...sr.querySelectorAll('.listRow')].filter(
      (e) => e.getBoundingClientRect().width > 0 && e.textContent.trim().replace(/\s+/g, ' ') === label
    )
    const el = els[els.length - 1]
    if (!el) return false
    el.click()
    return true
  }, { host: EDITOR_HOST, label })
  if (!ok) throw new Error(`プルダウンに「${label}」が見つかりません`)
  await page.waitForTimeout(1500)
}

/** チェック色のパネルを開いて hex を入力する（vuetify の v-color-picker） */
export async function setCheckColor(page, hex) {
  // 「チェック色」ボタンを押してカラーピッカーを開く
  await page.evaluate((host) => {
    const sr = document.querySelector(host).shadowRoot
    const label = [...sr.querySelectorAll('.taskListMenu [class*="EditorBtn__label"]')].find(
      (e) => e.textContent.trim() === 'チェック色'
    )
    label?.closest('[class*="EditorBtn"], button, [role="button"]')?.click()
  }, EDITOR_HOST)
  await page.waitForTimeout(1200)

  const ok = await page.evaluate(({ host, hex }) => {
    const sr = document.querySelector(host).shadowRoot
    const input = [...sr.querySelectorAll('.v-color-picker-edit input, .v-color-picker input')].find(
      (e) => e.getBoundingClientRect().width > 0
    )
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, hex)
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }))
    input.blur()
    return true
  }, { host: EDITOR_HOST, hex })
  if (!ok) throw new Error('カラーピッカーの hex 入力が見つかりません')
  await page.waitForTimeout(1000)
  // ColorBtn は「ピッカーが閉じた時」に change:color を発火する（開いている間は未確定）。
  // 画面外をクリックして閉じ、変更を確定させる
  await page.mouse.click(20, 400)
  await page.waitForTimeout(1500)
}

/** インラインメニュー外をクリックしてパネルを閉じる */
export async function closePanels(page) {
  await page.mouse.click(20, 400)
  await page.waitForTimeout(800)
}
