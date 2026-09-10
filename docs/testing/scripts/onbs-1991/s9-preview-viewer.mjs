/**
 * ONBS-1991 §9-3（プレビュー拡張）・§9-4（ビューワー拡張）
 *
 * どちらもローカルビルドの拡張機能を読み込み、対象サイト上でツアーを実行して
 * タイミング設定に応じた挙動になることを確認する。
 *
 * プレビューは onboarding-e2e-test と同じ postMessage 経路で起動する
 * （管理画面の「プレビュー」ボタンが送るのと同じ data-params を渡す）。
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, loginToManage, blockSelfGuides, applyBasicAuthByHost, openGuideList, shoot } from '../lib/manage.mjs'
import { launchWithExtensions, waitForExtensionWorker } from '../lib/extensions.mjs'
import { openTourEdit, openIntroStyles, selectTiming, saveStyles, publishTour } from './lib.mjs'
import {
  NEXT_TOUR, clearTourStorage, readTourStorage, openIntro, readGoalCheck, startGoal, closeStep,
} from './lib-demo.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s9-ext')
console.log('成果物:', dir, '\n')
const { tourId, goal1, manageTourId } = NEXT_TOUR

// ===== 準備: タイミングを「ゴールの完了」にして公開 =====
{
  const { context } = await launchWithExtensions({ credentials: c.manage, keys: ['preview'] })
  await applyBasicAuthByHost(context, c)
  await blockSelfGuides(context)
  const page = context.pages()[0] ?? (await context.newPage())
  await loginToManage(page, c.manage)
  await openGuideList(page, PRODUCTS.next, c.manage)
  await openTourEdit(page, c.manage, manageTourId)
  await openIntroStyles(page)
  await selectTiming(page, 'last_step_displayed')
  await saveStyles(page)
  await page.waitForTimeout(1000)
  await publishTour(page)
  console.log('  （タイミング=ゴールの完了 で公開）')
  await context.close()
}

// ===== 9-3: プレビュー拡張 =====
{
  const { context } = await launchWithExtensions({ credentials: c.demo, keys: ['preview'] })
  await applyBasicAuthByHost(context, c)
  const { id, version } = await waitForExtensionWorker(context)
  console.log(`  プレビュー拡張 id=${id} version=${version}`)
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(PRODUCTS.next.demoUrl, { waitUntil: 'load' })
  await page.waitForTimeout(3000)

  // 管理画面の「プレビュー」が送るのと同じメッセージで起動する
  const params = {
    'data-params': {
      aid: 146,
      pid: PRODUCTS.next.productId,
      user_id: 1,
      operation_token: '',
      allowed_domains: ['onboarding.co.jp', 'dev.onboarding.co.jp'],
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
            resolve(true)
          }
        }
        window.addEventListener('message', handler, false)
        window.postMessage({ type: 'message-from-e2e', action: 'launch-preview', params: json }, '*')
        setTimeout(() => resolve(false), 20000)
      }),
    params
  )
  rec('9-3a プレビューが起動する', sent, sent ? '' : 'postMessage への応答なし')
  await page.waitForTimeout(4000)
  await shoot(page, dir, '01_preview-launched')

  const timing = await page.evaluate(() => window.STANDSUnit?.opt?.styles?.intro?.checkmarkTiming ?? '(なし)')
  rec('9-3b 設定が届いている', timing === 'last_step_displayed', `checkmarkTiming=${timing}`)

  if (timing === 'last_step_displayed') {
    await clearTourStorage(page, tourId)
    await openIntro(page).catch(() => {})
    await startGoal(page, goal1).catch(() => {})
    await page.waitForTimeout(1500)
    const ls = await readTourStorage(page, tourId)
    await closeStep(page).catch(() => {})
    await openIntro(page).catch(() => {})
    rec('9-3c 最終ステップ表示でチェック', ls.lastStep?.includes(goal1) && (await readGoalCheck(page, goal1)) === 'check',
      `lastStep=${JSON.stringify(ls.lastStep)} check=${await readGoalCheck(page, goal1)}`)
    await shoot(page, dir, '02_preview-check')
  }
  await context.close()
}

// ===== 9-4: ビューワー拡張 =====
{
  const { context } = await launchWithExtensions({ credentials: c.demo, keys: ['viewer'] })
  await applyBasicAuthByHost(context, c)
  const { id, version } = await waitForExtensionWorker(context)
  console.log(`  ビューワー拡張 id=${id} version=${version}`)
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(PRODUCTS.next.demoUrl, { waitUntil: 'load' })
  // ビューワーは自動認証のあとガイドを配信する
  const ready = await page
    .waitForFunction(() => window.STANDSUnit?.opt?.tourID, { timeout: 60000 })
    .then(() => true)
    .catch(() => false)
  rec('9-4a ビューワーでガイドが配信される', ready, '')
  await shoot(page, dir, '03_viewer')
  if (ready) {
    const timing = await page.evaluate(() => window.STANDSUnit.opt.styles?.intro?.checkmarkTiming ?? '(なし)')
    rec('9-4b 設定が届いている', timing === 'last_step_displayed', `checkmarkTiming=${timing}`)
    if (timing === 'last_step_displayed') {
      await clearTourStorage(page, tourId)
      await openIntro(page).catch(() => {})
      await startGoal(page, goal1).catch(() => {})
      await page.waitForTimeout(1500)
      const ls = await readTourStorage(page, tourId)
      await closeStep(page).catch(() => {})
      await openIntro(page).catch(() => {})
      rec('9-4c 最終ステップ表示でチェック', ls.lastStep?.includes(goal1) && (await readGoalCheck(page, goal1)) === 'check',
        `lastStep=${JSON.stringify(ls.lastStep)} check=${await readGoalCheck(page, goal1)}`)
      await shoot(page, dir, '04_viewer-check')
    }
  }
  await context.close()
}

// ===== 後始末: 既定へ戻して公開 =====
{
  const { context } = await launchWithExtensions({ credentials: c.manage, keys: ['preview'] })
  await applyBasicAuthByHost(context, c)
  await blockSelfGuides(context)
  const page = context.pages()[0] ?? (await context.newPage())
  await loginToManage(page, c.manage)
  await openGuideList(page, PRODUCTS.next, c.manage)
  await openTourEdit(page, c.manage, manageTourId)
  await openIntroStyles(page)
  await selectTiming(page, 'goal_started')
  await saveStyles(page)
  await page.waitForTimeout(1000)
  await publishTour(page)
  console.log('  （後始末: 既定設定で公開）')
  await context.close()
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
process.exit(ng.length ? 1 : 0)
