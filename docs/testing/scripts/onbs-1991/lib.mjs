/** ONBS-1991 の確認で使う共通操作 */
import { shoot } from '../lib/manage.mjs'

/** 検証に使うツアー */
export const TOURS = {
  next: { id: 1441, name: '空テスト', product: 'next' },
  legacy: { id: 1440, name: '空テスト', product: 'legacy' },
}

export const TIMING_LABEL = {
  goal_started: 'ゴールの表示（いずれかのステップが表示）',
  last_step_displayed: 'ゴールの完了（最後のステップが表示）',
}

/** ツアー編集画面を開く */
export async function openTourEdit(page, manage, tourId) {
  await page.goto(new URL(`/tours/${tourId}`, manage.url).href, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.getByText('表示スタイル設定').first().waitFor({ state: 'visible', timeout: 30000 })
  await page.waitForTimeout(1000)
}

/** 「表示スタイル設定」→ イントロタブ を開く */
export async function openIntroStyles(page) {
  await page.getByText('表示スタイル設定').first().click()
  // タブは label 要素（中の radio が状態を持つ）
  const tab = page.locator('.c-tabList__label').filter({ hasText: 'イントロ' }).first()
  await tab.waitFor({ state: 'visible', timeout: 20000 })
  await tab.click()
  await page.locator('input[name="introCheckmarkTiming"]').first().waitFor({ state: 'attached', timeout: 20000 })
  await page.waitForTimeout(800)
}

/** いま選ばれているタイミングの value を返す */
export async function readTiming(page) {
  return page.evaluate(() => {
    const r = [...document.querySelectorAll('input[name="introCheckmarkTiming"]')].find((x) => x.checked)
    return r?.value ?? null
  })
}

/** 「チェックマーク」セクション（背景色とタイミングの両方を含む）を返す */
export function checkmarkSection(page) {
  return page
    .locator('.c-guideEditStylesSetting__section')
    .filter({ has: page.locator('input[name="introCheckmarkTiming"]') })
    .first()
}

/** チェックマークの背景色の入力値 */
export async function readCheckmarkColor(page) {
  return checkmarkSection(page).locator('.c-colorPicker__inputText').first().inputValue()
}

/** チェックマークの背景色を入力する */
export async function setCheckmarkColor(page, hex) {
  const input = checkmarkSection(page).locator('.c-colorPicker__inputText').first()
  await input.fill(hex)
  await input.dispatchEvent('change')
  await page.waitForTimeout(400)
}

/**
 * タイミングを選ぶ。
 *
 * radio 自体は非表示（カード型 UI）なので、包んでいる label を押す。
 */
export async function selectTiming(page, value) {
  await page
    .locator('label.c-radioCard')
    .filter({ has: page.locator(`input[name="introCheckmarkTiming"][value="${value}"]`) })
    .first()
    .click()
  await page.waitForTimeout(400)
}

/** チェックマークセクションの「デフォルトに戻す」を押す */
export async function clickCheckmarkDefault(page) {
  await checkmarkSection(page).getByText('デフォルトに戻す').first().click()
  await page.waitForTimeout(800)
}

/** モーダルの保存ボタンを押す */
export async function saveStyles(page) {
  await page.getByRole('button', { name: /保存|更新/ }).first().click()
  await page.waitForTimeout(3000)
}

export { shoot }
