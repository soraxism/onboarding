/**
 * ONBS-1991 §4-11 — 途中のステップを表示している状態でイントロにチェックが付かないこと
 *
 * CodeRabbit のレビューで発覚した不具合の回帰確認。
 * `recordLastStepDisplayedGoal()` は最終ステップ以外で早期 return するのに
 * `markIntroGoalChecked()` を無条件に呼んでいたため、「ゴールの完了」設定でも
 * 途中のステップでチェックが付いていた。
 *
 * イントロのモーダル DOM は tourInit() で一度構築された後、閉じても DOM に残る。
 * readGoalCheck() はその DOM を直接読むので、イントロを開かなくても状態を見られる。
 *
 * 配信JS（dev-api が返すエンジン本体）は S3 の手動アップロードが要るため、
 * dev へ反映する前でも確認できるよう、ローカルビルドをルート差し替えで流し込む。
 * ビルド元は build/dev/s3/onboarding-init-next.js（新TS系統）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, launchBrowser, loginToManage, blockSelfGuides, openGuideList, shoot } from '../lib/manage.mjs'
import { openTourEdit, openIntroStyles, selectTiming, saveStyles, publishTour } from './lib.mjs'
import {
  NEXT_TOUR, clearTourStorage, readTourStorage, openDemo, openIntro,
  readGoalCheck, startGoal, clickNext, closeStep,
} from './lib-demo.mjs'

// ONB_BUNDLE を渡すとローカルビルドへ差し替える（S3 アップロード前に確認したいとき用）。
// 省略すれば dev の配信JSをそのまま使う。
const BUNDLE = process.env.ONB_BUNDLE || null
if (BUNDLE && !fs.existsSync(BUNDLE)) throw new Error(`ONB_BUNDLE が見つかりません: ${BUNDLE}`)

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s4-11')
console.log('成果物:', dir)
console.log('配信JS:', BUNDLE ? `ローカルビルドへ差し替え (${path.basename(BUNDLE)})` : 'dev の配信をそのまま使用', '\n')
const { tourId, goal3 } = NEXT_TOUR

// ONB_VIA_ADMIN=1 なら管理画面で設定して公開する（配信経路ごと確認したいとき）
const VIA_ADMIN = process.env.ONB_VIA_ADMIN === '1'
if (VIA_ADMIN) {
  const { browser, context } = await launchBrowser({ credentials: c.manage, headless: true })
  await blockSelfGuides(context)
  const p = await context.newPage()
  await loginToManage(p, c.manage)
  await openGuideList(p, PRODUCTS.next, c.manage)
  await openTourEdit(p, c.manage, NEXT_TOUR.manageTourId)
  await openIntroStyles(p)
  await selectTiming(p, 'last_step_displayed')
  await saveStyles(p)
  await p.waitForTimeout(1000)
  await publishTour(p)
  await browser.close()
  console.log('  （管理画面で last_step_displayed に設定して公開）')
}

const demo = await launchBrowser({ credentials: c.demo, headless: true })
const page = await demo.context.newPage()

// 配信JS をローカルビルドへ差し替える。dev-api はエンジン本体をそのまま返す
let served = 0
if (BUNDLE) {
  const bundle = fs.readFileSync(BUNDLE, 'utf-8')
  await page.route('**/dev-api.onboarding-app.io/v1/onboarding-init*', async (route) => {
    served += 1
    await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: bundle })
  })
}

// タイミング設定を配信レスポンスに注入する。
//
// 本来は管理画面で設定 → 公開するが、dev の管理画面には ONBS-1991 のUIがまだ無い
// （develop が release から作り直され、以前のマージが残っていない）。
// ここで確認したいのはエンジン側の挙動なので、配信データの
// styles.intro.checkmarkTiming を差し替えて同じコードパスを通す。
// 管理画面→配信の経路自体は §1 / §2 / §8 で確認済み。
let patched = 0
if (!VIA_ADMIN) {
  await page.route('**/dev-v2api.onboarding-app.io/onboarding-init*', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    const intro = body?.res_data?.opt?.styles?.intro
    if (intro) { intro.checkmarkTiming = 'last_step_displayed'; patched += 1 }
    await route.fulfill({ response: res, body: JSON.stringify(body), contentType: 'application/json' })
  })
}

await openDemo(page, PRODUCTS.next.demoUrl)
rec('前提: 配信JSの用意', BUNDLE ? served > 0 : true, BUNDLE ? `差し替え ${served} 回` : 'dev の配信をそのまま使用')
rec('前提: タイミングの設定経路', VIA_ADMIN ? true : patched > 0,
  VIA_ADMIN ? '管理画面で設定して公開' : `配信レスポンスへ注入 ${patched} 回`)

// 差し替えたビルドであることを実行時にも確かめる（新キーのファクトリが効いているか）
const hasNewKey = await page.evaluate(() => {
  try {
    localStorage.setItem('onb_probe_marker', '1')
    return Object.keys(localStorage).some((k) => k.startsWith('onb_'))
  } catch { return false }
})
rec('前提: エンジンが動作している', hasNewKey === true)

await clearTourStorage(page, tourId)
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.STANDSUnit?.opt && window.STANDSUnit?.steps, { timeout: 30000 })
await page.waitForTimeout(1500)

const timing = await page.evaluate(() => window.STANDSUnit?.opt?.styles?.intro?.checkmarkTiming)
rec('前提: 配信データのタイミングが last_step_displayed', timing === 'last_step_displayed', `実際=${timing}`)

await openIntro(page)
rec('前提: 開始時は未チェック', (await readGoalCheck(page, goal3)) === 'nocheck')

// ゴール（3ステップ）を開始 → 1 ステップ目
await startGoal(page, goal3)
await shoot(page, dir, '01-step1')
const s1 = await readGoalCheck(page, goal3)
rec('4-11 ステップ1/3 表示中はチェックが付かない', s1 === 'nocheck', `実際=${s1}`)

// 2 ステップ目（まだ最終ではない）
await clickNext(page)
await shoot(page, dir, '02-step2')
const s2 = await readGoalCheck(page, goal3)
rec('4-11 ステップ2/3 表示中はチェックが付かない', s2 === 'nocheck', `実際=${s2}`)

const lsMid = await readTourStorage(page, tourId)
rec('4-11 途中では lastStep に記録されない', !(lsMid.lastStep ?? []).includes(goal3),
  `lastStep=${JSON.stringify(lsMid.lastStep)}`)

// 3 ステップ目（最終）→ ここで初めて付く（4-5 の再確認＝陽性対照）
await clickNext(page)
await page.waitForTimeout(1200)
await shoot(page, dir, '03-step3-last')
const s3 = await readGoalCheck(page, goal3)
rec('4-5 最終ステップ表示でチェックが付く（陽性対照）', s3 === 'check', `実際=${s3}`)

const lsLast = await readTourStorage(page, tourId)
rec('4-5 lastStep に記録される', (lsLast.lastStep ?? []).includes(goal3),
  `lastStep=${JSON.stringify(lsLast.lastStep)}`)
rec('4-11 終了未押下なので complete には入らない', !(lsLast.complete ?? []).includes(goal3),
  `complete=${JSON.stringify(lsLast.complete)}`)

await closeStep(page)
await openIntro(page)
await shoot(page, dir, '04-intro-after')
const after = await readGoalCheck(page, goal3)
rec('4-6 閉じてイントロを開くとチェックが付いている', after === 'check', `実際=${after}`)

await demo.browser.close()

if (VIA_ADMIN) {
  const { browser, context } = await launchBrowser({ credentials: c.manage, headless: true })
  await blockSelfGuides(context)
  const p = await context.newPage()
  await loginToManage(p, c.manage)
  await openGuideList(p, PRODUCTS.next, c.manage)
  await openTourEdit(p, c.manage, NEXT_TOUR.manageTourId)
  await openIntroStyles(p)
  await selectTiming(p, 'goal_started')
  await saveStyles(p)
  await p.waitForTimeout(1000)
  await publishTour(p)
  await browser.close()
  console.log('  （後始末: goal_started に戻して公開）')
}

const ng = results.filter((r) => !r.ok)
console.log(`\n${results.length - ng.length}/${results.length} 件 OK`)
if (ng.length) { console.log('NG: ' + ng.map((r) => r.id).join(', ')); process.exit(1) }
