/**
 * ONBS-1991 §9-3 プレビュー拡張
 *
 * プレビューは公開前の steps_preview.json を配信する。そこで
 * **公開せずに設定だけ変更**して、プレビューにだけ新しい値が届くことを確認する
 * （公開済みの steps.json は既定のまま＝埋め込みタグ経由と区別できる）。
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, loginToManage, blockSelfGuides, applyBasicAuthByHost, openGuideList, shoot } from '../lib/manage.mjs'
import { launchWithExtensions, waitForExtensionWorker, clearExtensionStorage } from '../lib/extensions.mjs'
import { openTourEdit, openIntroStyles, selectTiming, saveStyles } from './lib.mjs'
import { NEXT_TOUR, clearTourStorage, readTourStorage, openIntro, readGoalCheck, startGoal, closeStep } from './lib-demo.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s9-preview')
console.log('成果物:', dir, '\n')
const { tourId, goal1, manageTourId } = NEXT_TOUR

const { context } = await launchWithExtensions({ credentials: c.demo, keys: ['preview'] })
await applyBasicAuthByHost(context, c)
await blockSelfGuides(context)
const { worker } = await waitForExtensionWorker(context)
await clearExtensionStorage(worker)

// ===== 管理画面タブ: 公開せずに設定だけ「ゴールの完了」へ変更し、operation_token を取る =====
const mpage = context.pages()[0] ?? (await context.newPage())
await loginToManage(mpage, c.manage)
await openGuideList(mpage, PRODUCTS.next, c.manage)
await openTourEdit(mpage, c.manage, manageTourId)
await openIntroStyles(mpage)
await selectTiming(mpage, 'last_step_displayed')
await saveStyles(mpage)
console.log('  （保存のみ・公開しない → プレビューにだけ届く状態）')
const auth = await mpage.evaluate(async (pid) => {
  const res = await fetch('https://dev-manage-api.onboarding-app.io/v1/operation-token', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Onboarding-API-Token': localStorage.getItem('api_token') ?? '' },
    body: JSON.stringify({ product_id: pid, operation_token: '' }),
  })
  const json = await res.json()
  const user = await (await fetch(`https://dev-manage-api.onboarding-app.io/v1/user?product_id=${pid}`, {
    headers: { 'X-Onboarding-API-Token': localStorage.getItem('api_token') ?? '' },
  })).json()
  return { operation_token: json.operation_token, user_id: user.id ?? user.user_id, account_id: user.account_id }
}, PRODUCTS.next.productId)
if (!auth.operation_token) throw new Error('operation_token が取れない')
console.log(`  operation_token: 取得できた / aid=${auth.account_id} user=${auth.user_id}`)

// ===== デモタブ: プレビューを起動 =====
const page = await context.newPage()
await page.goto(PRODUCTS.next.demoUrl, { waitUntil: 'load' })
await page.waitForTimeout(3000)
await clearTourStorage(page, tourId)

const params = {
  'data-params': {
    aid: auth.account_id,
    pid: PRODUCTS.next.productId,
    user_id: auth.user_id,
    operation_token: auth.operation_token,
    allowed_domains: ['dev.onboarding.co.jp', 'onboarding.co.jp'],
    view_types: ['tag', 'extension'],
    action: 'preview',
    guide_id: manageTourId,
    target_id: '',
    start_url: PRODUCTS.next.demoUrl,
    type: 'TOUR',
  },
}
const sent = await page.evaluate(
  (json) =>
    new Promise((resolve) => {
      const handler = (e) => {
        if (e.data?.type === 'message-from-preview' && e.data?.action === 'complete-setup-e2e') {
          window.removeEventListener('message', handler)
          resolve(e.data.response)
        }
      }
      window.addEventListener('message', handler, false)
      window.postMessage({ type: 'message-from-e2e', action: 'launch-preview', params: json }, '*')
      setTimeout(() => resolve(null), 30000)
    }),
  params
)
rec('9-3a プレビューが起動する', sent === true, `応答=${JSON.stringify(sent)}`)
await page.waitForTimeout(6000)
await shoot(page, dir, '01_preview')

const state = await page.evaluate(() => ({
  isExtensionPreview: window.STANDSUnit?.isExtensionPreview,
  timing: window.STANDSUnit?.opt?.styles?.intro?.checkmarkTiming ?? '(なし)',
  tourID: window.STANDSUnit?.opt?.tourID,
}))
console.log('  プレビューの状態:', JSON.stringify(state))
rec('9-3b プレビュー経由であること', state.isExtensionPreview === true, `isExtensionPreview=${state.isExtensionPreview}`)
rec('9-3c 未公開の設定がプレビューに届く', state.timing === 'last_step_displayed',
  `checkmarkTiming=${state.timing}（公開済みの steps.json は goal_started のまま）`)

if (state.timing === 'last_step_displayed') {
  await openIntro(page).catch(() => {})
  await startGoal(page, goal1).catch((e) => console.log('  startGoal:', e.message.split('\n')[0]))
  await page.waitForTimeout(1500)
  const ls = await readTourStorage(page, tourId)
  await closeStep(page).catch(() => {})
  await openIntro(page).catch(() => {})
  rec('9-3d 最終ステップ表示でチェック', ls.lastStep?.includes(goal1) && (await readGoalCheck(page, goal1)) === 'check',
    `lastStep=${JSON.stringify(ls.lastStep)} check=${await readGoalCheck(page, goal1)}`)
  await shoot(page, dir, '02_preview-check')
}

// ===== 後始末: 設定を既定へ戻す（公開はしていないので保存のみ） =====
await openTourEdit(mpage, c.manage, manageTourId)
await openIntroStyles(mpage)
await selectTiming(mpage, 'goal_started')
await saveStyles(mpage)
console.log('  （後始末: 設定を既定へ戻した）')

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await context.close()
process.exit(ng.length ? 1 : 0)
