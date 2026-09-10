/**
 * ONBS-1991 §4（ゴールの完了）・§6（設定切替時の引き継ぎ）
 *
 * デモ側のブラウザは開いたまま（LocalStorage を保持したまま）、
 * 管理画面側の別ブラウザで設定を切り替えて公開し、デモをリロードして確認する。
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, launchBrowser, loginToManage, blockSelfGuides, openGuideList, shoot } from '../lib/manage.mjs'
import { openTourEdit, openIntroStyles, selectTiming, saveStyles, publishTour } from './lib.mjs'
import {
  NEXT_TOUR, LS_KEYS, clearTourStorage, readTourStorage, openDemo, openIntro, intro,
  readGoalCheck, startGoal, clickNext, closeStep,
} from './lib-demo.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s4s6')
console.log('成果物:', dir, '\n')
const { tourId, goal3, goal1 } = NEXT_TOUR

/** 管理画面でタイミングを変えて公開する */
async function setTimingAndPublish(timing) {
  const { browser, context } = await launchBrowser({ credentials: c.manage, headless: true })
  await blockSelfGuides(context)
  const page = await context.newPage()
  await loginToManage(page, c.manage)
  await openGuideList(page, PRODUCTS.next, c.manage)
  await openTourEdit(page, c.manage, NEXT_TOUR.manageTourId)
  await openIntroStyles(page)
  await selectTiming(page, timing)
  await saveStyles(page)
  await page.waitForTimeout(1000)
  await publishTour(page)
  await browser.close()
  console.log(`  （設定を ${timing} にして公開）`)
}

// ===== デモ側ブラウザ（通しで LS を保持する） =====
const demo = await launchBrowser({ credentials: c.demo, headless: true })
const page = await demo.context.newPage()

/** リロードして設定値を確認する */
async function reloadDemo(expectTiming) {
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => window.STANDSUnit?.opt, { timeout: 30000 })
  await page.waitForTimeout(2000)
  const t = await page.evaluate(() => window.STANDSUnit.opt.styles?.intro?.checkmarkTiming)
  if (t !== expectTiming) throw new Error(`配信設定が ${t}（期待 ${expectTiming}）`)
}

await openDemo(page, PRODUCTS.next.demoUrl)
await clearTourStorage(page, tourId)

// ===== Phase A: 設定=goal_started のうちに 6-3 の事前状態を作る =====
// goal3 を 1 ステップ目だけ表示して閉じる（display のみ）
await reloadDemo('goal_started')
await openIntro(page)
await startGoal(page, goal3)
await closeStep(page)
await page.waitForTimeout(1000)
const lsA = await readTourStorage(page, tourId)
console.log(`Phase A: display=${JSON.stringify(lsA.display)} lastStep=${JSON.stringify(lsA.lastStep)}`)

// ===== 設定を「ゴールの完了」に切り替えて公開 =====
await setTimingAndPublish('last_step_displayed')
await reloadDemo('last_step_displayed')

// ===== 6-3: display のみのゴールはチェックが外れる =====
await openIntro(page)
rec('6-3', (await readGoalCheck(page, goal3)) === 'nocheck',
  `1ステップ目のみ表示済みの goal3 = ${await readGoalCheck(page, goal3)}（設定切替でチェックが外れる）`)
await shoot(page, dir, '01_after-switch')

// ===== 4-1〜4-3 =====
rec('4-1', (await readGoalCheck(page, goal1)) === 'nocheck', `未着手 goal1 = ${await readGoalCheck(page, goal1)}`)

// 4-2: goal3 は 1 ステップ目表示済み（display に入っている）がチェックは付かない → 6-3 と同じ根拠
const ls42 = await readTourStorage(page, tourId)
rec('4-2', ls42.display?.includes(goal3) && (await readGoalCheck(page, goal3)) === 'nocheck',
  `display に入っているが判定に使われない`)

// 4-3: 途中のステップ（2つ目）まで進めて閉じる → チェックなし
await startGoal(page, goal3)
await clickNext(page)  // → step2
await closeStep(page)
await page.waitForTimeout(1000)
await openIntro(page)
rec('4-3', (await readGoalCheck(page, goal3)) === 'nocheck', `途中まで進めて閉じた goal3 = ${await readGoalCheck(page, goal3)}`)

// ===== 4-4〜4-6: 最終ステップまで進める（終了は押さない） =====
await startGoal(page, goal3)   // 続きから or 最初から
await shoot(page, dir, '02_restart')
// 進行ダイアログが出たら「最初から」を選ぶ
const restartBtn = page.locator('.g-modal-pos').getByText(/最初から/).first()
if (await restartBtn.isVisible().catch(() => false)) { await restartBtn.click({ force: true }); await page.waitForTimeout(1000) }
// いま何ステップ目かに関わらず最終（3）まで next を押す
for (let i = 0; i < 2; i++) {
  const ls = await readTourStorage(page, tourId)
  if (ls.lastStep?.includes(goal3)) break
  await clickNext(page)
  await page.waitForTimeout(800)
}
const ls44 = await readTourStorage(page, tourId)
rec('4-4', ls44.lastStep?.includes(goal3), `onb_last_step_displayed_goals=${JSON.stringify(ls44.lastStep)}（終了は未押下）`)
await shoot(page, dir, '03_last-step')

// 4-5: ツアーを進めたまま（最終ステップ表示中に）イントロを開く
await openIntro(page).catch(() => {})
const check45 = await readGoalCheck(page, goal3)
rec('4-5', check45 === 'check', `進行中にイントロを開く → ${check45}`)
await shoot(page, dir, '04_intro-during-tour')

// 4-6: × で閉じてからイントロ → 付いている
await closeStep(page).catch(() => {})
await page.waitForTimeout(800)
await openIntro(page)
rec('4-6', (await readGoalCheck(page, goal3)) === 'check', '')

// 4-10: チェックの背景色が配信の設定色と一致する
const color = await page.evaluate((id) => {
  const icon = document.querySelector(`.stands-step-item[data-goalid="${id}"] .stands-step-item-inner-box div`)
  return icon ? getComputedStyle(icon).backgroundColor : null
}, goal3)
const optColor = await page.evaluate(() => window.STANDSUnit.opt.styles?.intro?.checkmark?.['background-color'])
const toRgb = (hex) => { const h = hex.replace('#',''); return `rgb(${parseInt(h.slice(0,2),16)}, ${parseInt(h.slice(2,4),16)}, ${parseInt(h.slice(4,6),16)})` }
rec('4-10', color === toRgb(optColor), `チェック色=${color} 設定=${optColor}`)

// 4-7: 終了まで押す → complete に入り、チェック維持
await startGoal(page, goal3)
const restart2 = page.locator('.g-modal-pos').getByText(/最初から/).first()
if (await restart2.isVisible().catch(() => false)) { await restart2.click({ force: true }); await page.waitForTimeout(1000) }
for (let i = 0; i < 4; i++) {
  const done = await page.evaluate((tid) => (JSON.parse(localStorage.getItem(`onb_complete_goals_${tid}`) ?? '[]')).length > 0, tourId)
  if (done) break
  await clickNext(page)
  await page.waitForTimeout(800)
}
await page.waitForTimeout(1000)
const ls47 = await readTourStorage(page, tourId)
await openIntro(page)
rec('4-7', ls47.complete?.includes(goal3) && (await readGoalCheck(page, goal3)) === 'check',
  `onb_complete_goals=${JSON.stringify(ls47.complete)}`)

// ===== 4-9: 1 ステップだけのゴールは表示した時点でチェック =====
rec('4-9前提', (await readGoalCheck(page, goal1)) === 'nocheck', `goal1 未着手 = ${await readGoalCheck(page, goal1)}`)
await startGoal(page, goal1)
await page.waitForTimeout(1000)
const ls49 = await readTourStorage(page, tourId)
await closeStep(page).catch(() => {})
await openIntro(page)
rec('4-9', ls49.lastStep?.includes(goal1) && (await readGoalCheck(page, goal1)) === 'check',
  `表示のみで lastStep=${JSON.stringify(ls49.lastStep)} check=${await readGoalCheck(page, goal1)}`)
await shoot(page, dir, '05_one-step-goal')

// ===== 6-1: complete のみ残っている状態（リリース前からのユーザー相当）で維持される =====
await page.evaluate((keys) => {
  // complete は残し、lastStep から goal を除去して「終了ボタンは押したが lastStep 記録が無い」状態を作る
  localStorage.setItem(keys.lastStep, JSON.stringify([]))
}, LS_KEYS(tourId))
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.STANDSUnit?.opt, { timeout: 30000 })
await page.waitForTimeout(2000)
await openIntro(page)
rec('6-1', (await readGoalCheck(page, goal3)) === 'check',
  `complete のみ（lastStep なし）の goal3 = ${await readGoalCheck(page, goal3)}（維持される）`)

// ===== 6-2: lastStep 記録済み（終了未押下）のゴールが維持される =====
rec('6-2', (await readGoalCheck(page, goal1)) === 'check',
  `lastStep のみ（complete なし）の goal1 = ${await readGoalCheck(page, goal1)}`)

// ===== 6-4: display のみへ戻し、設定を goal_started へ戻すと再度チェックが付く =====
await page.evaluate((keys) => {
  localStorage.setItem(keys.lastStep, JSON.stringify([]))
  localStorage.setItem(keys.complete, JSON.stringify([]))
}, LS_KEYS(tourId))
await setTimingAndPublish('goal_started')
await reloadDemo('goal_started')
await openIntro(page)
rec('6-4', (await readGoalCheck(page, goal3)) === 'check' && (await readGoalCheck(page, goal1)) === 'check',
  `display のみで設定を戻す → goal3=${await readGoalCheck(page, goal3)} goal1=${await readGoalCheck(page, goal1)}`)
await shoot(page, dir, '06_back-to-default')

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await demo.browser.close()
process.exit(ng.length ? 1 : 0)
