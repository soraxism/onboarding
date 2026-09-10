/**
 * ONBS-1991 §9-2 旧側（legacy / src/js/）での確認。
 *
 * §3・§4 の主要ケースが旧 JS でも成立することを、legacy 用の検証ツアーで確認する。
 * 旧側はローカルビルドを差し込む経路が無いため、S3 に配備済みの JS がそのまま対象になる。
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, launchBrowser, loginToManage, blockSelfGuides, openGuideList, shoot } from '../lib/manage.mjs'
import { openTourEdit, openIntroStyles, selectTiming, saveStyles, publishTour } from './lib.mjs'
import {
  LEGACY_TOUR, clearTourStorage, readTourStorage, openDemo, openIntro,
  readGoalCheck, startGoal, clickNext, closeStep,
} from './lib-demo.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s9-legacy')
console.log('成果物:', dir, '\n')
const { tourId, goal3, goal1, manageTourId } = LEGACY_TOUR

async function setTimingAndPublish(timing) {
  const { browser, context } = await launchBrowser({ credentials: c.manage, headless: true })
  await blockSelfGuides(context)
  const page = await context.newPage()
  await loginToManage(page, c.manage)
  await openGuideList(page, PRODUCTS.legacy, c.manage)
  await openTourEdit(page, c.manage, manageTourId)
  await openIntroStyles(page)
  await selectTiming(page, timing)
  await saveStyles(page)
  await page.waitForTimeout(1000)
  await publishTour(page)
  await browser.close()
  console.log(`  （設定を ${timing} にして公開）`)
}

const demo = await launchBrowser({ credentials: c.demo, headless: true })
const page = await demo.context.newPage()

async function reloadDemo(expectTiming) {
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => window.STANDSUnit?.opt, { timeout: 30000 })
  await page.waitForTimeout(2000)
  const t = await page.evaluate(() => window.STANDSUnit.opt.styles?.intro?.checkmarkTiming)
  if (t !== expectTiming) throw new Error(`配信設定が ${t}（期待 ${expectTiming}）`)
}

await openDemo(page, PRODUCTS.legacy.demoUrl)
// 旧側であること（新側のスクリプト名でない）を確認
const src = await page.evaluate(() => document.getElementById('stands_onbd_point')?.src ?? '')
console.log('配信スクリプト:', src.split('?')[0])
await clearTourStorage(page, tourId)

// ===== 設定=goal_started（§3 相当） =====
await reloadDemo('goal_started')
await openIntro(page)
rec('9-2a 未着手はチェックなし', (await readGoalCheck(page, goal3)) === 'nocheck', '')
await startGoal(page, goal3)
await closeStep(page)
await page.waitForTimeout(1000)
const ls1 = await readTourStorage(page, tourId)
await openIntro(page)
rec('9-2b 1ステップ表示でチェック（既定）', ls1.display?.includes(goal3) && (await readGoalCheck(page, goal3)) === 'check',
  `display=${JSON.stringify(ls1.display)}`)
await shoot(page, dir, '01_default-check')

// 最終まで進めて lastStep 常時記録（3-6 相当）
await startGoal(page, goal3)
const restart = page.locator('.g-modal-pos').getByText(/最初から/).first()
if (await restart.isVisible().catch(() => false)) { await restart.click({ force: true }); await page.waitForTimeout(1000) }
for (let i = 0; i < 3; i++) {
  const ls = await readTourStorage(page, tourId)
  if (ls.lastStep?.includes(goal3)) break
  await clickNext(page)
  await page.waitForTimeout(800)
}
const ls2 = await readTourStorage(page, tourId)
rec('9-2c 既定設定でも lastStep を常時記録', ls2.lastStep?.includes(goal3), `lastStep=${JSON.stringify(ls2.lastStep)}`)
await closeStep(page).catch(() => {})

// ===== 設定=last_step_displayed（§4 相当） =====
await clearTourStorage(page, tourId)
await setTimingAndPublish('last_step_displayed')
await reloadDemo('last_step_displayed')
await openIntro(page)
rec('9-2d 未着手はチェックなし', (await readGoalCheck(page, goal3)) === 'nocheck', '')

await startGoal(page, goal3)
await closeStep(page)
await page.waitForTimeout(1000)
await openIntro(page)
rec('9-2e 1ステップ表示ではチェックが付かない', (await readGoalCheck(page, goal3)) === 'nocheck',
  `display=${JSON.stringify((await readTourStorage(page, tourId)).display)}`)

await startGoal(page, goal3)
const restart2 = page.locator('.g-modal-pos').getByText(/最初から/).first()
if (await restart2.isVisible().catch(() => false)) { await restart2.click({ force: true }); await page.waitForTimeout(1000) }
for (let i = 0; i < 3; i++) {
  const ls = await readTourStorage(page, tourId)
  if (ls.lastStep?.includes(goal3)) break
  await clickNext(page)
  await page.waitForTimeout(800)
}
const ls3 = await readTourStorage(page, tourId)
await closeStep(page).catch(() => {})
await openIntro(page)
rec('9-2f 最終ステップ表示でチェック', ls3.lastStep?.includes(goal3) && (await readGoalCheck(page, goal3)) === 'check',
  `lastStep=${JSON.stringify(ls3.lastStep)}`)
await shoot(page, dir, '02_last-step-check')

// 1 ステップゴール（4-9 相当）
await startGoal(page, goal1)
await page.waitForTimeout(1000)
const ls4 = await readTourStorage(page, tourId)
await closeStep(page).catch(() => {})
await openIntro(page)
rec('9-2g 1ステップゴールは表示時点でチェック', ls4.lastStep?.includes(goal1) && (await readGoalCheck(page, goal1)) === 'check', '')
await shoot(page, dir, '03_one-step')

// 後始末: 設定を既定へ戻す
await setTimingAndPublish('goal_started')

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await demo.browser.close()
process.exit(ng.length ? 1 : 0)
