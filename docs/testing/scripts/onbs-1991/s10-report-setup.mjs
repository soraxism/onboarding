/**
 * ONBS-1991 §10 — レポート整合の「仕込み」
 *
 * レポートの完了UUは、`event_step_displayed` のうち `step_index == total_steps` の
 * ログを distinct uuid で数える（onboarding-batch/src/report_goal_details/functions/aggregate.py:316,251）。
 * つまり **終了ボタンの押下ではなく最終ステップの表示**が基準で、
 * ONBS-1991 のタイミング設定はトラッキングに影響しない。
 *
 * これを実データで裏取りするため、今日のうちに次の 2 通りを作る。
 * 集計は日次バッチなので、確認は翌日以降。
 *
 *   10-1: 設定「ゴールの完了」で最終ステップまで到達（終了は押さない）
 *   10-2: 設定「ゴールの表示」で最終ステップまで到達（終了は押さない）
 *
 * どちらも完了UUに計上されれば「設定はレポートに影響しない」が示せる。
 * 区別できるよう **別ゴール・別 uuid（別コンテキスト）** で実施する。
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, launchBrowser, loginToManage, blockSelfGuides, openGuideList, shoot } from '../lib/manage.mjs'
import { openTourEdit, openIntroStyles, selectTiming, saveStyles, publishTour } from './lib.mjs'
import { NEXT_TOUR, clearTourStorage, readTourStorage, openDemo, openIntro, readGoalCheck, startGoal, clickNext } from './lib-demo.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s10-setup')
console.log('成果物:', dir, '\n')

/**
 * 2 ケースとも **同じゴール・同じ操作**にして、設定だけを変える。
 * uuid（ブラウザ）を分けるので、翌日そのゴールの完了UUが **ちょうど 2** になれば
 * 「設定はレポートに影響しない」が示せる。片方しか計上されなければ影響している。
 *
 * ゴールは **8d4386e4（1 ステップ）** を使う。他の検証で一度も開いていないゴールなので、
 * 今日の完了UUがこの 2 件だけになり、数で判定できる。
 * ff75ead2 は §4 / §7 / §4-11 の実行で何度も最終ステップへ到達しており、数が混ざる。
 *
 * 1 ステップのゴールでは「ステップ 1 の表示 = 最終ステップの表示」。
 * 終了ボタンを押さない点は変わらない。
 *
 * NOTE: このゴールは検証ツアーの後始末で削除予定だが、**§10 の確認が終わるまで消さないこと**。
 */
const CASES = [
  { id: '10-1', timing: 'last_step_displayed', goal: '8d4386e4c0c7ee3561503c68f64e8fa5', steps: 1 },
  { id: '10-2', timing: 'goal_started', goal: '8d4386e4c0c7ee3561503c68f64e8fa5', steps: 1 },
]

async function setTimingAndPublish(timing) {
  const { browser, context } = await launchBrowser({ credentials: c.manage, headless: true })
  await blockSelfGuides(context)
  const p = await context.newPage()
  await loginToManage(p, c.manage)
  await openGuideList(p, PRODUCTS.next, c.manage)
  await openTourEdit(p, c.manage, NEXT_TOUR.manageTourId)
  await openIntroStyles(p)
  await selectTiming(p, timing)
  await saveStyles(p)
  await p.waitForTimeout(1000)
  await publishTour(p)
  await browser.close()
}

const evidence = []

for (const t of CASES) {
  console.log(`── ${t.id}: 設定 ${t.timing} / ゴール ${t.goal.slice(0, 8)}（${t.steps} ステップ）`)
  await setTimingAndPublish(t.timing)

  // uuid を分けるため毎回新しいブラウザを起こす
  const demo = await launchBrowser({ credentials: c.demo, headless: true })
  const page = await demo.context.newPage()

  // 最終ステップの displayed ビーコンを捕まえる
  const beacons = []
  page.on('request', (r) => {
    const u = r.url()
    if (u.includes('dev-beacon.onboarding-app.io/log.gif')) beacons.push(u)
  })

  await openDemo(page, PRODUCTS.next.demoUrl)
  await clearTourStorage(page, NEXT_TOUR.tourId)
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => window.STANDSUnit?.opt && window.STANDSUnit?.steps, { timeout: 30000 })
  await page.waitForTimeout(1500)

  const delivered = await page.evaluate(() => window.STANDSUnit?.opt?.styles?.intro?.checkmarkTiming)
  rec(`${t.id} 前提: 配信データのタイミング`, delivered === t.timing, `実際=${delivered}`)

  const uuid = await page.evaluate(() => localStorage.getItem('onb_uuid'))
  rec(`${t.id} 前提: uuid を取得`, !!uuid, `uuid=${uuid}`)

  await openIntro(page)
  await startGoal(page, t.goal)
  // 最終ステップまで進める（終了は押さない）
  for (let i = 1; i < t.steps; i++) await clickNext(page)
  await page.waitForTimeout(1500)
  await shoot(page, dir, `${t.id}-last-step`)

  const ls = await readTourStorage(page, NEXT_TOUR.tourId)
  rec(`${t.id} 最終ステップに到達（終了は押していない）`,
    !(ls.complete ?? []).includes(t.goal), `complete=${JSON.stringify(ls.complete)}`)

  // 最終ステップの displayed ビーコンが飛んだか
  // ビーコンのパラメータ名: ev=イベント / ty=種別 / gid=ゴールID / sindex=ステップ番号 / uu=UUID
  const lastStepBeacon = beacons.filter((u) => {
    const q = new URL(u).searchParams
    return q.get('ev') === 'displayed' && q.get('ty') === 'step' && q.get('gid') === t.goal &&
           q.get('sindex') === String(t.steps) && q.get('total_steps') === String(t.steps)
  })
  rec(`${t.id} 最終ステップの displayed ビーコンが送信された`, lastStepBeacon.length > 0,
    `該当 ${lastStepBeacon.length} 件 / 全ビーコン ${beacons.length} 件`)

  evidence.push({ case: t.id, timing: t.timing, goalId: t.goal, totalSteps: t.steps, uuid,
                  beaconCount: lastStepBeacon.length })
  await demo.browser.close()
}

// 設定を既定へ戻す
await setTimingAndPublish('goal_started')
console.log('  （後始末: goal_started に戻して公開）')

const stamp = new Date().toISOString()
fs.writeFileSync(path.join(dir, 'evidence.json'),
  JSON.stringify({ recordedAt: stamp, product: 'aid=146 / pid=248', tour: NEXT_TOUR.manageTourId, cases: evidence }, null, 2))
console.log('\n翌日の確認用データ:', path.join(dir, 'evidence.json'))
console.log(JSON.stringify(evidence, null, 2))

const ng = results.filter((r) => !r.ok)
console.log(`\n${results.length - ng.length}/${results.length} 件 OK`)
if (ng.length) { console.log('NG: ' + ng.map((r) => r.id).join(', ')); process.exit(1) }
