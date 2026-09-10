/**
 * ONBS-1991 §5 ゴール連結・ステップ分岐（next 側の検証ツアーで実施）
 *
 * editor-api で連結（goal.connectionSetting）と分岐（step.branchSetting）を
 * 設定して公開し、エンドユーザー側の挙動を確認する。
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, launchBrowser, loginToManage, blockSelfGuides, openGuideList, shoot } from '../lib/manage.mjs'
import { openTourEdit, publishTour } from './lib.mjs'
import {
  NEXT_TOUR, clearTourStorage, readTourStorage, openDemo, openIntro, closeIntro,
  readGoalCheck, startGoal, clickNext, closeStep,
} from './lib-demo.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s5')
console.log('成果物:', dir, '\n')
const { tourId, goal3, goal1, manageTourId } = NEXT_TOUR

// ===== 管理画面ブラウザ（editor-api の実行と公開に使う） =====
const admin = await launchBrowser({ credentials: c.manage, headless: true })
const apage = await admin.context.newPage()
await blockSelfGuides(admin.context)
await loginToManage(apage, c.manage)
await openGuideList(apage, PRODUCTS.next, c.manage)
const token = await apage.evaluate(async (pid) => {
  const res = await fetch('https://dev-manage-api.onboarding-app.io/v1/operation-token', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Onboarding-API-Token': localStorage.getItem('api_token') ?? '' },
    body: JSON.stringify({ product_id: pid, operation_token: '' }),
  })
  return (await res.json()).operation_token
}, PRODUCTS.next.productId)

const api = async (method, path, body) => {
  const out = await apage.evaluate(async ({ method, path, body, token }) => {
    const res = await fetch('https://dev-editor-api.onboarding-app.io' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-onboarding-operation-token': token },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, text: await res.text() }
  }, { method, path, body, token })
  console.log(`  ${method} ${path} -> ${out.status}`)
  if (out.status >= 400) throw new Error(`${method} ${path} 失敗: ${out.text.slice(0, 200)}`)
  try { return JSON.parse(out.text) } catch { return out.text }
}

async function publish() {
  await apage.waitForTimeout(15000) // プレビューJSONの反映待ち
  await openTourEdit(apage, c.manage, manageTourId)
  await publishTour(apage)
  console.log('  （公開した）')
}

// ステップ ID を取得
const tour = await api('GET', `/tours/${manageTourId}`)
const goals = tour.steps_json_src.goals
const g3 = goals.find((g) => g.id === goal3)
const g1 = goals.find((g) => g.id === goal1)
const g1step1 = g1.steps[0].id
const g3step1 = g3.steps[0].id
console.log(`goal3 steps=${g3.steps.length} goal1 step1=${g1step1}\n`)

const phase = process.argv.includes('--branch-only') ? 'branch' : 'all'

// ===== 準備: タイミング=ゴールの完了 + goal3 に連結（→ goal1 の step1） =====
if (phase === 'all') {
await api('PUT', `/tours/${manageTourId}/intro-style`, {
  styles: { checkmark: { 'background-color': '#46a6ff' }, checkmarkTiming: 'last_step_displayed' },
})
await api('PUT', `/goals/${goal3}/option`, {
  tour_id: manageTourId, goal_id: goal3,
  goal_data: { connectionSetting: { goal_id: goal1, step_id: g1step1 } },
})
await publish()
}

// ===== デモ: 5-1 / 5-2 =====
const demo = await launchBrowser({ credentials: c.demo, headless: true })
const page = await demo.context.newPage()
await openDemo(page, PRODUCTS.next.demoUrl)
await clearTourStorage(page, tourId)
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.STANDSUnit?.opt, { timeout: 30000 })
await page.waitForTimeout(2000)
const timing = await page.evaluate(() => window.STANDSUnit.opt.styles?.intro?.checkmarkTiming)
if (timing !== 'last_step_displayed') throw new Error(`設定が ${timing}`)

if (phase === 'all') {
await openIntro(page)
await startGoal(page, goal3)
await clickNext(page) // → step2
await clickNext(page) // → step3（最終）
await page.waitForTimeout(800)
const ls51 = await readTourStorage(page, tourId)
rec('5-1', ls51.lastStep?.includes(goal3) && !ls51.lastStep?.includes(goal1),
  `連結ありゴールの最終ステップ表示で lastStep=${JSON.stringify(ls51.lastStep)}（連結先へ進む前に記録）`)
await shoot(page, dir, '01_before-finish')

// 終了 → 連結で goal1 の step1 が表示される
await clickNext(page)
await page.waitForTimeout(2000)
await shoot(page, dir, '02_connected')
const ls52 = await readTourStorage(page, tourId)
rec('5-2a 連結先の最終（唯一）ステップ表示で記録', ls52.lastStep?.includes(goal1),
  `lastStep=${JSON.stringify(ls52.lastStep)}`)
await closeStep(page).catch(() => {})
await openIntro(page)
rec('5-2b 両ゴールにチェック', (await readGoalCheck(page, goal3)) === 'check' && (await readGoalCheck(page, goal1)) === 'check',
  `goal3=${await readGoalCheck(page, goal3)} goal1=${await readGoalCheck(page, goal1)}`)
await shoot(page, dir, '03_both-checked')
}

// ===== 準備: 連結を解除し、goal3 の step1 に分岐（→ goal1 の step1、URL 条件は常に真） =====
await api('PUT', `/goals/${goal3}/option`, {
  tour_id: manageTourId, goal_id: goal3, goal_data: { connectionSetting: {} },
})
// step_data はリスト形式 [{ goal_id, option }]（dict 形式は branchSetting を受けない）
await api('PUT', `/steps/${g3step1}/option`, {
  tour_id: manageTourId, step_id: g3step1,
  step_data: [{
    goal_id: goal3,
    option: {
      branchSetting: {
        targetStep: { goal_id: goal1, step_id: g1step1 },
        operator: 'or',
        elementExistenceTimeout: 0,
        conditions: [
          { type: 'UrlRegex', operator: 'or', items: [{ comparison_option: 'contains', value: 'onb-web-refactor' }] },
        ],
      },
    },
  }],
})
await publish()

// ===== デモ: 5-3 =====
await clearTourStorage(page, tourId)
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.STANDSUnit?.opt, { timeout: 30000 })
await page.waitForTimeout(2000)
await openIntro(page)
await startGoal(page, goal3) // step1 表示
await clickNext(page)        // 分岐発火 → goal1 の step1 へ（goal3 の step2/3 は表示されない）
await page.waitForTimeout(2000)
await shoot(page, dir, '04_branched')
const ls53 = await readTourStorage(page, tourId)
await closeStep(page).catch(() => {})
await openIntro(page)
rec('5-3', !ls53.lastStep?.includes(goal3) && (await readGoalCheck(page, goal3)) === 'nocheck',
  `分岐で最終を通らない goal3: lastStep=${JSON.stringify(ls53.lastStep)} check=${await readGoalCheck(page, goal3)}`)
await shoot(page, dir, '05_branch-nocheck')

// ===== 後始末: 分岐解除・タイミングを既定へ戻す =====
await api('PUT', `/steps/${g3step1}/option`, {
  tour_id: manageTourId, step_id: g3step1,
  step_data: [{ goal_id: goal3, option: { branchSetting: {} } }],
})
await api('PUT', `/tours/${manageTourId}/intro-style`, {
  styles: { checkmark: { 'background-color': '#46a6ff' }, checkmarkTiming: 'goal_started' },
})
await publish()
console.log('  （後始末: 分岐解除・既定設定で公開）')

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await admin.browser.close()
await demo.browser.close()
process.exit(ng.length ? 1 : 0)
