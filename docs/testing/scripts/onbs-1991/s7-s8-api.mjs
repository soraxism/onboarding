/** ONBS-1991 §7-3〜7-5（公開API）・§8-1（LS 不正値）。next 側デモで実施 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, launchBrowser, shoot } from '../lib/manage.mjs'
import { NEXT_TOUR, LS_KEYS, clearTourStorage, readTourStorage, openDemo, openIntro, closeIntro, readGoalCheck, startGoal, closeStep } from './lib-demo.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s7s8')
console.log('成果物:', dir, '\n')
const { tourId, goal3, goal1 } = NEXT_TOUR
const { browser, context } = await launchBrowser({ credentials: c.demo, headless: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)))

await openDemo(page, PRODUCTS.next.demoUrl)
await clearTourStorage(page, tourId)
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.STANDSUnit?.opt, { timeout: 30000 })
await page.waitForTimeout(2000)

// ===== 8-1: 不正な文字列を入れてもエラーで止まらず作り直される =====
await page.evaluate((keys) => localStorage.setItem(keys.lastStep, 'not-json'), LS_KEYS(tourId))
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.STANDSUnit?.opt, { timeout: 30000 })
await page.waitForTimeout(2000)
// ランチャーが出る（ブリックしない）こと
const launcherOk = await page.locator('.iguider-btn').isVisible()
// ゴールを最後まで進めて値が作り直されることを確認する
await openIntro(page)
await startGoal(page, goal1)  // 1 ステップゴール（表示即 lastStep 記録）
await page.waitForTimeout(1500)
const ls81 = await readTourStorage(page, tourId)
await closeStep(page).catch(() => {})
rec('8-1', launcherOk && Array.isArray(ls81.lastStep) && ls81.lastStep.includes(goal1),
  `ランチャー表示=${launcherOk} lastStep=${JSON.stringify(ls81.lastStep)}（not-json から作り直し）`)
rec('8-1b ページエラーなし', errors.length === 0, errors.join(' / ') || 'エラーなし')

// ===== 7-3: getIncompleteGoalIds は complete 基準（従来どおり） =====
// いま goal1 は lastStep のみ（complete なし）→ 未完了扱いのまま
const incomplete = await page.evaluate(() => window.STANDSMotion.getIncompleteGoalIds())
rec('7-3', incomplete.includes(goal1) && incomplete.includes(goal3),
  `getIncompleteGoalIds=${JSON.stringify(incomplete)}（lastStep 到達でも complete までは未完了扱い）`)

// ===== 7-4: setCheckedGoalIds はタイミング設定より優先 =====
await page.evaluate((id) => window.STANDSMotion.setCheckedGoalIds([id]), goal3)
await closeIntro(page)
await openIntro(page)
const c74a = await readGoalCheck(page, goal3)
const c74b = await readGoalCheck(page, goal1)
rec('7-4', c74a === 'check' && c74b === 'nocheck',
  `指定した goal3=${c74a} / 表示済み（lastStep 記録あり）の goal1=${c74b}（指定のみが優先）`)
await shoot(page, dir, '01_setCheckedGoalIds')

// ===== 7-5: clearCheckedGoalIds で設定に応じた判定へ戻る =====
await page.evaluate(() => window.STANDSMotion.clearCheckedGoalIds())
// チェック表示はイントロを開くときに組み立てられるため、開き直して反映させる
await closeIntro(page)
await openIntro(page)
const c75a = await readGoalCheck(page, goal3)
const c75b = await readGoalCheck(page, goal1)
// 現在の設定は goal_started。goal1 は display 済み → check、goal3 は未表示 → nocheck
rec('7-5', c75b === 'check' && c75a === 'nocheck', `goal1=${c75b} goal3=${c75a}（設定に応じた判定に復帰）`)
await shoot(page, dir, '02_clearCheckedGoalIds')

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await browser.close()
process.exit(ng.length ? 1 : 0)
