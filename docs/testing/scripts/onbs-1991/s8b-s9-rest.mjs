/**
 * ONBS-1991 §8-2（削除ゴールIDの掃除）・§9-1（?onbd_init_ver=next の明示指定）
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, launchBrowser, loginToManage, blockSelfGuides, openGuideList, shoot } from '../lib/manage.mjs'
import { openTourEdit, publishTour } from './lib.mjs'
import {
  NEXT_TOUR, LS_KEYS, clearTourStorage, readTourStorage, openDemo, openIntro,
  readGoalCheck, startGoal, closeStep,
} from './lib-demo.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s8b-s9')
console.log('成果物:', dir, '\n')
const { tourId, goal3, goal1, manageTourId } = NEXT_TOUR

// ===== 9-1: ?onbd_init_ver=next を明示して §4 の核（最終ステップ表示でチェック）を確認 =====
{
  const demo = await launchBrowser({ credentials: c.demo, headless: true })
  const page = await demo.context.newPage()
  const url = `${PRODUCTS.next.demoUrl}&onbd_init_ver=next`
  await openDemo(page, url)
  const script = await page.evaluate(() => document.getElementById('stands_onbd_point')?.src ?? '')
  rec('9-1a next 側の配信で開ける', script.includes('dev-api.onboarding-app.io'), script.split('?')[0])
  await clearTourStorage(page, tourId)
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => window.STANDSUnit?.opt, { timeout: 30000 })
  await page.waitForTimeout(2000)
  await openIntro(page)
  await startGoal(page, goal1)   // 1 ステップゴール = 最終ステップ
  await page.waitForTimeout(1200)
  const ls = await readTourStorage(page, tourId)
  await closeStep(page).catch(() => {})
  await openIntro(page)
  rec('9-1b 記録とチェックが成立', ls.lastStep?.includes(goal1) && (await readGoalCheck(page, goal1)) === 'check',
    `lastStep=${JSON.stringify(ls.lastStep)}`)
  await shoot(page, dir, '01_init-ver-next')
  await demo.browser.close()
}

// ===== 8-2: 到達済みのゴールを削除して公開 → 端末側のキーから除去される =====
{
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
  const api = async (m, p, b) => {
    const o = await apage.evaluate(async ({ m, p, b, token }) => {
      const r = await fetch('https://dev-editor-api.onboarding-app.io' + p, {
        method: m,
        headers: { 'Content-Type': 'application/json', 'x-onboarding-operation-token': token },
        body: b ? JSON.stringify(b) : undefined,
      })
      return { s: r.status, t: await r.text() }
    }, { m, p, b, token })
    console.log(`  ${m} ${p} -> ${o.s}`)
    if (o.s >= 400) throw new Error(`${m} ${p} 失敗: ${o.t.slice(0, 200)}`)
    try { return JSON.parse(o.t) } catch { return o.t }
  }

  // 削除用のゴールを 1 つ足して公開
  const added = await api('POST', '/goals', { tour_id: manageTourId, insertion_index: 2 })
  const tmpGoal = added.id
  console.log(`  削除用ゴール: ${tmpGoal}`)
  await apage.waitForTimeout(15000)
  await openTourEdit(apage, c.manage, manageTourId)
  await publishTour(apage)

  // 端末側でそのゴールに到達させる（1 ステップなので表示で lastStep 記録）
  const demo = await launchBrowser({ credentials: c.demo, headless: true })
  const page = await demo.context.newPage()
  await openDemo(page, PRODUCTS.next.demoUrl)
  await clearTourStorage(page, tourId)
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => window.STANDSUnit?.opt, { timeout: 30000 })
  await page.waitForTimeout(2000)
  await openIntro(page)
  await startGoal(page, tmpGoal)
  await page.waitForTimeout(1200)
  await closeStep(page).catch(() => {})
  const before = await readTourStorage(page, tourId)
  rec('8-2 前提: 削除前に到達している', before.lastStep?.includes(tmpGoal), `lastStep=${JSON.stringify(before.lastStep)}`)

  // ゴールを削除して公開。削除APIは relation（削除後のイントロ並び）も要求する
  const cur = await api('GET', `/tours/${manageTourId}`)
  const relation = (cur.steps_json_src.relation ?? []).filter((r) => r.id !== tmpGoal)
  await api('POST', `/goals/${tmpGoal}/delete`, { tour_id: manageTourId, goal_id: tmpGoal, relation })
  await apage.waitForTimeout(15000)
  await openTourEdit(apage, c.manage, manageTourId)
  await publishTour(apage)

  // 端末側をリロード → 削除済みIDが除去される
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => window.STANDSUnit?.opt, { timeout: 30000 })
  await page.waitForTimeout(2500)
  const after = await readTourStorage(page, tourId)
  rec('8-2', Array.isArray(after.lastStep) && !after.lastStep.includes(tmpGoal),
    `削除後 lastStep=${JSON.stringify(after.lastStep)}（削除済みIDが除去される）`)
  await shoot(page, dir, '02_deleted-goal')
  await demo.browser.close()
  await admin.browser.close()
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
process.exit(ng.length ? 1 : 0)
