/**
 * ONBS-1991 §7-1・§7-2 自動表示条件「ゴール利用状況」の回帰確認
 *
 * `GoalStatus` 条件は `onb_complete_goals_` / `onb_display_goals_` だけを見ており、
 * 本対応で追加した `onb_last_step_displayed_goals_` もタイミング設定も参照しない。
 *
 * 肝は「最終ステップまで到達しただけ（終了ボタン未押下）の状態で判定が変わらないこと」。
 * ここが変わると、タイミング設定が自動表示条件へ漏れていることになる。
 *
 * 状態は **実操作で作る**。LS に値を書いてリロードしても、初期化時の
 * overwriteLocalStorage() が sync 側の写しで上書きするため反映されない。
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, launchBrowser, loginToManage, blockSelfGuides, openGuideList, shoot } from '../lib/manage.mjs'
import { openTourEdit, publishTour } from './lib.mjs'
import {
  NEXT_TOUR, clearTourStorage, readTourStorage, openDemo, openIntro, closeIntro,
  startGoal, clickNext, closeStep,
} from './lib-demo.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s7-goalstatus')
console.log('成果物:', dir, '\n')
const { tourId, goal3, goal1, manageTourId } = NEXT_TOUR

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
  if (o.s >= 400) throw new Error(`${m} ${p} 失敗(${o.s}): ${o.t.slice(0, 200)}`)
  try { return JSON.parse(o.t) } catch { return o.t }
}

/** goal1 に GoalStatus 条件（goal3 を参照）を設定して公開する。null で解除 */
async function setCondition(comparisonOption) {
  await api('PUT', `/goals/${goal1}/auto-display-setting`, {
    tour_id: manageTourId,
    goal_id: goal1,
    auto_display_settings: {
      before: [],
      after: comparisonOption
        ? [{
            id: '',
            operator: 'and',
            reset_interval: { has_period: false },
            // infinite: true で回数制限なし（履歴に阻まれず毎回判定される）
            times: { infinite: true, value: 1 },
            conditions: [{
              type: 'GoalStatus',
              operator: 'or',
              items: [{ comparison_option: comparisonOption, value: goal3 }],
            }],
          }]
        : [],
    },
  })
  await apage.waitForTimeout(15000)
  await openTourEdit(apage, c.manage, manageTourId)
  await publishTour(apage)
  console.log(`  （条件 ${comparisonOption ?? '解除'} で公開）`)
}

const demo = await launchBrowser({ credentials: c.demo, headless: true })
const page = await demo.context.newPage()
await openDemo(page, PRODUCTS.next.demoUrl)

/**
 * リロードして goal1 が自動表示されたかを返す。
 *
 * 判定は「現在のゴールが goal1 になり、ツアー進行中クラスが付く」こと。
 * `.g-modal-pos` 自体はサイズ 0 なので可視判定に使えない（中の `.g-modal-size` が実体）。
 */
async function measure() {
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => window.STANDSUnit?.opt, { timeout: 30000 })
  return page
    .waitForFunction(
      (gid) =>
        window.STANDSMotion?.getGoalData?.()?.id === gid &&
        document.body.classList.contains('onb-inprogress-tour'),
      goal1,
      { timeout: 15000 }
    )
    .then(() => true)
    .catch(() => false)
}

/** 進行中のツアー・イントロを閉じきる（自動表示は進行中だと出ないため） */
async function closeAll() {
  for (let i = 0; i < 5; i++) {
    const busy = await page.evaluate(() => ({
      intro: [...document.querySelectorAll('#stands_gGoals')].some((e) => e.getBoundingClientRect().width > 0),
      modal: [...document.querySelectorAll('.g-modal-pos > .g-modal-size')].some((e) => e.getBoundingClientRect().width > 0),
      inprogress: document.body.classList.contains('onb-inprogress-tour'),
    }))
    if (!busy.intro && !busy.modal && !busy.inprogress) return
    await closeStep(page).catch(() => {})
    await closeIntro(page).catch(() => {})
    await page.waitForTimeout(700)
  }
}

/** goal3 を指定の段階まで実操作で進める */
async function advanceGoal3(stage) {
  await closeAll()
  await openIntro(page)
  await startGoal(page, goal3)
  if (stage === 'display') return closeStep(page)
  for (let i = 0; i < 3; i++) {
    if ((await readTourStorage(page, tourId)).lastStep?.includes(goal3)) break
    await clickNext(page)
    await page.waitForTimeout(600)
  }
  if (stage === 'lastStep') return closeStep(page)
  for (let i = 0; i < 3; i++) {
    if ((await readTourStorage(page, tourId)).complete?.includes(goal3)) break
    await clickNext(page)
    await page.waitForTimeout(600)
  }
}

async function runOption(option, expected) {
  await setCondition(option)
  const got = {}

  await closeAll()
  await clearTourStorage(page, tourId)
  got.fresh = await measure()

  await advanceGoal3('display')
  const lsD = await readTourStorage(page, tourId)
  await closeAll()
  got.display = await measure()

  await advanceGoal3('lastStep')
  const lsL = await readTourStorage(page, tourId)
  await closeAll()
  got.lastStep = await measure()

  await advanceGoal3('complete')
  const lsC = await readTourStorage(page, tourId)
  await closeAll()
  got.complete = await measure()

  console.log(`  （LS）display段階=${JSON.stringify(lsD.display)} / lastStep段階: lastStep=${JSON.stringify(lsL.lastStep)} complete=${JSON.stringify(lsL.complete)} / complete段階=${JSON.stringify(lsC.complete)}`)
  const pre =
    lsD.display?.includes(goal3) &&
    lsL.lastStep?.includes(goal3) &&
    !lsL.complete?.includes(goal3) &&
    lsC.complete?.includes(goal3)
  rec(`${option}: 前提の状態が実操作で作れている`, Boolean(pre), pre ? '' : '意図した LS 状態にならなかった')

  for (const [stage, want] of Object.entries(expected)) {
    rec(`${option}/${stage}`, got[stage] === want, `期待=${want ? '表示' : '非表示'} 実際=${got[stage] ? '表示' : '非表示'}`)
    if (got[stage] !== want) await shoot(page, dir, `ng_${option}_${stage}`)
  }
}

// 7-1: 完了済み / 未完了 は onb_complete_goals_ だけを見る
await runOption('completed', { fresh: false, display: false, lastStep: false, complete: true })
await runOption('not_completed', { fresh: true, display: true, lastStep: true, complete: false })
// 7-2: 表示済み / 未表示 は onb_display_goals_ だけを見る
await runOption('displayed', { fresh: false, display: true, lastStep: true, complete: true })
await runOption('not_displayed', { fresh: true, display: false, lastStep: false, complete: false })

await setCondition(null)

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await admin.browser.close()
await demo.browser.close()
process.exit(ng.length ? 1 : 0)
