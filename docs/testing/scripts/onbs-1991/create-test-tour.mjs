/**
 * ONBS-1991 §3〜§6 用の検証ツアーを作る。
 *
 * 既存の「空テスト」はステップ1が iframe 内要素をターゲットにしており、
 * この環境では表示に失敗してツアーが即中断する（master ビルドでも同じ＝本対応とは無関係）。
 * そのため target を空（センターモーダル）にしたステップだけの検証ツアーを新規に作る。
 *
 * 構成:
 *   ゴール1（3ステップ）… §3・§4 の本命
 *   ゴール2（1ステップ）… §4-9 の境界確認
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, launchBrowser, loginToManage, blockSelfGuides, openGuideList, shoot } from '../lib/manage.mjs'
import { buildTourName } from '../lib/manage.mjs'

const EDITOR_API = 'https://dev-editor-api.onboarding-app.io'

const c = loadCredentials()
const dir = prepareArtifactDir('create-test-tour')
console.log('成果物:', dir)
const { browser, context } = await launchBrowser({ credentials: c.manage, headless: true })
await blockSelfGuides(context)
const page = await context.newPage()
await loginToManage(page, c.manage)
await openGuideList(page, PRODUCTS.next, c.manage)

const existingTourId = process.argv.find((a) => a.startsWith('--tour='))?.split('=')[1]
const name = buildTourName('ONBS-1991', 'チェックマーク')
console.log('ツアー名:', name)

let tourId
if (existingTourId) {
  tourId = Number(existingTourId)
  console.log('既存の tour id を使用:', tourId)
} else {
// ===== 1. 「作成」→ ツアー → 管理画面で作成 =====
await page.getByRole('button', { name: /作成/ }).first().click().catch(async () => {
  await page.getByText('作成', { exact: false }).first().click()
})
await page.waitForTimeout(800)
await shoot(page, dir, '01_create-menu')
// メニューの「ツアー」行にホバーしてサブメニューを開き、「管理画面で作成」を押す
const tourRow = page.locator('.listRow').filter({ hasText: 'ツアー' }).locator('visible=true').first()
await tourRow.waitFor({ state: 'visible', timeout: 5000 })
// サブメニューはホバーではなくクリックで開く
await tourRow.click()
await page.waitForTimeout(800)
const adminCreate = page
  .locator('.listRow')
  .filter({ hasText: '管理画面で作成' })
  .locator('visible=true')
  .first()
await adminCreate.waitFor({ state: 'visible', timeout: 5000 })
await adminCreate.click()
await page.waitForTimeout(1000)
await shoot(page, dir, '02_create-modal')

// ===== 2. フォーム入力 → 作成 =====
// ページ内に非表示の検索欄などがあるため、可視の input に絞る
const visibleInputs = page.locator('input:visible')
await visibleInputs.first().waitFor({ state: 'visible', timeout: 15000 })
await visibleInputs.nth(0).fill(name)
const urlInput = page.locator('input[placeholder*="https"]:visible').first()
await urlInput.fill(PRODUCTS.next.demoUrl)
await shoot(page, dir, '03_filled')

const createdRes = page.waitForResponse((r) => r.request().method() === 'POST' && /\/tours?(\?|$)/.test(r.url()), { timeout: 30000 })
await page.getByRole('button', { name: '作成', exact: true }).last().click()
const res = await createdRes
const created = await res.json()
console.log('作成レスポンス:', JSON.stringify(created).slice(0, 300))
tourId = created.id
if (!tourId) throw new Error('tour id が取れない')
await page.waitForTimeout(2000)
await shoot(page, dir, '04_after-create')
console.log('作成された tour id:', tourId, '/ 現在URL:', page.url())
}

// ===== 3. operation_token を取得（管理画面のセッションで PUT /operation-token） =====
// 管理画面は Cookie でなく localStorage の api_token を X-Onboarding-API-Token で送る
const token = await page.evaluate(async () => {
  const res = await fetch('https://dev-manage-api.onboarding-app.io/v1/operation-token', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Onboarding-API-Token': localStorage.getItem('api_token') ?? '',
    },
    // product_id が必須（このトークンで操作できるプロダクトが決まる）
    body: JSON.stringify({ product_id: 248, operation_token: '' }),
  })
  const json = await res.json()
  return json.operation_token
})
if (!token) throw new Error('operation_token が取れない')
console.log('operation_token: 取得できた（値は出さない）')

// ===== 4. editor-api でゴール構成を作る =====
const api = async (method, path, body) => {
  const out = await page.evaluate(async ({ base, method, path, body, token }) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-onboarding-operation-token': token },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    return { status: res.status, text }
  }, { base: EDITOR_API, method, path, body, token })
  console.log(`  ${method} ${path} -> ${out.status}`)
  if (out.status >= 400) throw new Error(`${method} ${path} 失敗: ${out.text.slice(0, 300)}`)
  try { return JSON.parse(out.text) } catch { return out.text }
}

// 現在の構成（テンプレートのゴール1つ・ステップ1つのはず）
const tour = await api('GET', `/tours/${tourId}`)
const goals = tour.steps_json_src?.goals ?? []
console.log('初期ゴール:', goals.map((g) => `${g.id}(steps=${g.steps?.length})`).join(', '))
const goal1 = goals[0].id

// ゴール1にステップを2つ足して3ステップに
await api('POST', '/steps', { tour_id: tourId, goal_id: goal1, step_index: 2 })
await api('POST', '/steps', { tour_id: tourId, goal_id: goal1, step_index: 3 })

// ゴール2（1ステップ）を追加
const g2 = await api('POST', '/goals', { tour_id: tourId, insertion_index: 1 })
console.log('ゴール2:', JSON.stringify(g2).slice(0, 200))

// 最終確認
const after = await api('GET', `/tours/${tourId}`)
const goalsAfter = after.steps_json_src?.goals ?? []
console.log('最終構成:', goalsAfter.map((g) => `${g.id}(steps=${g.steps?.length})`).join(', '))
console.log('intro styles:', JSON.stringify(after.steps_json_src?.settings?.styles?.intro))

console.log('\ntourId:', tourId)
await browser.close()
process.exit(0)
