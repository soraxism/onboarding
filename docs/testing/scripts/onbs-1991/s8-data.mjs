/**
 * ONBS-1991 §8 データ整合・異常系（8-2〜8-5）と §9-1（?onbd_init_ver=next）
 *
 * 8-5（この設定より前に作られた既存ツアー）は、配信レスポンスから
 * `checkmarkTiming` を落として「キーを持たないツアー」を再現して確認する。
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, launchBrowser, loginToManage, blockSelfGuides, openGuideList, shoot, buildTourName } from '../lib/manage.mjs'
import { openTourEdit, openIntroStyles, readTiming, publishTour } from './lib.mjs'
import {
  NEXT_TOUR, LS_KEYS, clearTourStorage, readTourStorage, openDemo, openIntro, closeIntro,
  readGoalCheck, startGoal, closeStep,
} from './lib-demo.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s8')
console.log('成果物:', dir, '\n')
const { tourId, goal3, goal1, manageTourId } = NEXT_TOUR

// ===== 管理画面ブラウザ =====
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

// ===== 8-4: 新規ツアーの既定値 =====
{
  const created = await apage.evaluate(async ({ token, name, url, pid }) => {
    const res = await fetch('https://dev-manage-api.onboarding-app.io/v1/tours', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Onboarding-API-Token': localStorage.getItem('api_token') ?? '' },
      // 必須: product_id / guide_title / device / start_url / memo / content_block_class_name / tour_type
      body: JSON.stringify({
        product_id: pid,
        guide_title: name,
        device: 'PC',
        start_url: url,
        memo: '',
        content_block_class_name: 'stands-content-block',
        tour_type: 'TOUR',
      }),
    })
    return { status: res.status, body: await res.text() }
  }, { token, name: buildTourName('ONBS-1991', '既定値確認'), url: PRODUCTS.next.demoUrl, pid: PRODUCTS.next.productId })
  const newTour = JSON.parse(created.body)
  console.log(`  新規ツアー作成 -> ${created.status} id=${newTour.id}`)
  const detail = await api('GET', `/tours/${newTour.id}`)
  const timing = detail.steps_json_src?.settings?.styles?.intro?.checkmarkTiming
  rec('8-4', timing === 'goal_started', `新規ツアーの配信データ checkmarkTiming=${timing}`)

  // 管理画面のUIでも既定が選択されていること
  await openTourEdit(apage, c.manage, newTour.id)
  await openIntroStyles(apage)
  const uiTiming = await readTiming(apage)
  rec('8-4b 管理画面UIでも既定', uiTiming === 'goal_started', `UI の選択=${uiTiming}`)
  await shoot(apage, dir, '01_new-tour-default')

  // 8-3: 複製に設定が引き継がれるか（複製前に last_step_displayed へ変更）
  await api('PUT', `/tours/${newTour.id}/intro-style`, {
    styles: { checkmark: { 'background-color': '#ff8800' }, checkmarkTiming: 'last_step_displayed' },
  })
  const copied = await apage.evaluate(async ({ id, pid }) => {
    const res = await fetch(`https://dev-manage-api.onboarding-app.io/v1/tours/${id}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Onboarding-API-Token': localStorage.getItem('api_token') ?? '' },
      // 複製も product_id / content_block_class_name が必須
      body: JSON.stringify({ product_id: pid, content_block_class_name: 'stands-content-block' }),
    })
    return { status: res.status, body: (await res.text()).slice(0, 400) }
  }, { id: newTour.id, pid: PRODUCTS.next.productId })
  console.log(`  複製 -> ${copied.status}`)
  if (copied.status < 400) {
    // 複製 API は { new_id } を返す
    const copyId = JSON.parse(copied.body).new_id
    if (!copyId) throw new Error('複製先の id がレスポンスに無い')
    const copyDetail = await api('GET', `/tours/${copyId}`)
    const ct = copyDetail.steps_json_src?.settings?.styles?.intro
    rec('8-3', ct?.checkmarkTiming === 'last_step_displayed' && ct?.checkmark?.['background-color'] === '#ff8800',
      `複製先の intro=${JSON.stringify(ct)}`)
    // 後始末: 複製を削除
    const del = await apage.evaluate(async (id) => {
      const res = await fetch(`https://dev-manage-api.onboarding-app.io/v1/tours/${id}`, {
        method: 'DELETE',
        headers: { 'X-Onboarding-API-Token': localStorage.getItem('api_token') ?? '' },
      })
      return res.status
    }, copyId)
    console.log(`  複製を削除 -> ${del}`)
  } else {
    rec('8-3', false, `複製APIが ${copied.status}: ${copied.body}`)
  }

  // 後始末: 8-4 用ツアーを削除
  const del2 = await apage.evaluate(async (id) => {
    const res = await fetch(`https://dev-manage-api.onboarding-app.io/v1/tours/${id}`, {
      method: 'DELETE',
      headers: { 'X-Onboarding-API-Token': localStorage.getItem('api_token') ?? '' },
    })
    return res.status
  }, newTour.id)
  console.log(`  8-4 用ツアーを削除 -> ${del2}`)
}

// ===== デモ側 =====
const demo = await launchBrowser({ credentials: c.demo, headless: true })
const page = await demo.context.newPage()

// ===== 8-5: checkmarkTiming を持たない配信データでの挙動 =====
// 配信データは onboarding-init のスクリプト本体に埋め込まれている。
// そこから checkmarkTiming を落として「この設定より前に作られたツアー」を再現する
// dev の配信は 2 経路（api のスクリプトと v2api の XHR）。両方から落とす必要がある
const stripRoute = (url) =>
  (url.hostname === 'dev-api.onboarding-app.io' || url.hostname === 'dev-v2api.onboarding-app.io') &&
  url.pathname.includes('onboarding-init')
/**
 * `"checkmarkTiming":"..."` をカンマごと落とす。
 * v2api の応答は JSON なので、キーだけ消すと末尾カンマが残って壊れる。
 */
const stripKey = (text) =>
  text
    .replace(/,\s*"checkmarkTiming"\s*:\s*"[^"]*"/g, '')
    .replace(/"checkmarkTiming"\s*:\s*"[^"]*"\s*,/g, '')
await demo.context.route(stripRoute, async (route) => {
  const res = await route.fetch()
  return route.fulfill({ response: res, body: stripKey(await res.text()) })
})
await openDemo(page, PRODUCTS.next.demoUrl)
const stripped = await page.evaluate(() => window.STANDSUnit.opt.styles?.intro?.checkmarkTiming ?? '(未設定)')
await clearTourStorage(page, tourId)
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => window.STANDSUnit?.opt, { timeout: 30000 })
await page.waitForTimeout(2000)
await openIntro(page)
await startGoal(page, goal3)
await closeStep(page)
await page.waitForTimeout(1000)
await openIntro(page)
const check85 = await readGoalCheck(page, goal3)
rec('8-5', stripped === '(未設定)' && check85 === 'check',
  `配信の checkmarkTiming=${stripped} → 1ステップ目表示でチェック=${check85}（従来どおり）`)
await shoot(page, dir, '02_no-key')
await demo.context.unroute(stripRoute).catch(() => {})

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await admin.browser.close()
await demo.browser.close()
process.exit(ng.length ? 1 : 0)
