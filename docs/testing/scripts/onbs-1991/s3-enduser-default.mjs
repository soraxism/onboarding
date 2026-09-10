/** ONBS-1991 §3 エンドユーザー側 — 既定（ゴールの表示）。next 側デモで実施 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, launchBrowser, shoot } from '../lib/manage.mjs'
import {
  NEXT_TOUR, clearTourStorage, readTourStorage, openDemo, openIntro, intro,
  readGoalCheck, startGoal, clickNext, closeStep, readBadgeCount,
} from './lib-demo.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s3')
console.log('成果物:', dir, '\n')
const { browser, context } = await launchBrowser({ credentials: c.demo, headless: true })
const page = await context.newPage()
const { tourId, goal3 } = NEXT_TOUR

await openDemo(page, PRODUCTS.next.demoUrl)
// 設定が「ゴールの表示」で配信されていることを前提確認
const timing = await page.evaluate(() => window.STANDSUnit.opt.styles?.intro?.checkmarkTiming)
console.log(`前提: checkmarkTiming=${timing}\n`)
if (timing !== 'goal_started') { console.log('前提が違うため中断'); process.exit(1) }

await clearTourStorage(page, tourId)
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.STANDSUnit?.opt, { timeout: 30000 })
await page.waitForTimeout(2000)

// 3-1 未着手はチェックなし
const badgeBefore = await readBadgeCount(page)
await openIntro(page)
rec('3-1', (await readGoalCheck(page, goal3)) === 'nocheck', `check状態=${await readGoalCheck(page, goal3)}`)
await shoot(page, dir, '01_intro-initial')

// 3-2 ゴールを開いて1ステップ目表示 → × で閉じる
await startGoal(page, goal3)
await shoot(page, dir, '02_step1')
await closeStep(page)
await page.waitForTimeout(1000)
const ls32 = await readTourStorage(page, tourId)
rec('3-2', Array.isArray(ls32.display) && ls32.display.includes(goal3),
  `onb_display_goals=${JSON.stringify(ls32.display)}`)

// 3-3 イントロ再表示 → チェックが付く
await openIntro(page)
rec('3-3', (await readGoalCheck(page, goal3)) === 'check', `check状態=${await readGoalCheck(page, goal3)}`)
await shoot(page, dir, '03_after-step1')

// 3-5 バッジが1件減っている（3-2 の時点で）
const badgeAfterStep1 = await readBadgeCount(page)
rec('3-5', badgeBefore !== null && badgeAfterStep1 === badgeBefore - 1,
  `バッジ ${badgeBefore} → ${badgeAfterStep1}`)

// 3-4 最後まで進めて「終了」
await startGoal(page, goal3)   // ステップ1（続きから確認が出る場合がある）
// 進行ダイアログ（続きから/最初から）が出たら最初からを選ぶ
const contDialog = page.locator('.g-modal-pos', { hasText: /続き|最初から/ })
if (await contDialog.isVisible().catch(() => false)) await shoot(page, dir, '04a_continue-dialog')
await clickNext(page)          // → ステップ2
await clickNext(page)          // → ステップ3（最終）
const ls36 = await readTourStorage(page, tourId)
rec('3-6', Array.isArray(ls36.lastStep) && ls36.lastStep.includes(goal3),
  `onb_last_step_displayed_goals=${JSON.stringify(ls36.lastStep)}（設定=ゴールの表示でも記録される）`)
await shoot(page, dir, '05_last-step')
await clickNext(page)          // 終了
await page.waitForTimeout(1500)
const ls34 = await readTourStorage(page, tourId)
rec('3-4', Array.isArray(ls34.complete) && ls34.complete.includes(goal3),
  `onb_complete_goals=${JSON.stringify(ls34.complete)}`)
await openIntro(page)
rec('3-4b チェック維持', (await readGoalCheck(page, goal3)) === 'check', '')
await shoot(page, dir, '06_after-finish')

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await browser.close()
process.exit(ng.length ? 1 : 0)
