/**
 * ONBS-1991 P-9（本番のプレビュー拡張・ビューワー拡張）。
 *
 * ストア審査が通った prod 版（preview 6.6.0 / viewer 3.6.0）と同じコミットから
 * ビルドしたものを unpacked で読み込み、タイミング設定が届いて効くことを確認する。
 *
 *   node .../prod-p9-preview-viewer.mjs --part=preview --tour=9036 --ext=<build/prod/ext-preview>
 *   node .../prod-p9-preview-viewer.mjs --part=viewer  --tour=9036 --ext=<build/prod/ext-viewer-general>
 *
 * **ビューワーは配信の選択を通るため、同じ URL の他ツアーが公開されていると
 * そちらが配信される。** 事前に prod-toggle-publish.mjs で下書きへ落としておくこと。
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import {
  getEnv, applyBasicAuthByHost, loginToManage, blockSelfGuides, openGuideList,
  openPreviewOnSite, shoot,
} from '../lib/manage.mjs'
import { routeManageMessagesTo } from '../lib/extensions.mjs'
import { launchWithExtensions, waitForExtensionWorker } from '../lib/extensions.mjs'
import { openIntro, readGoalCheck, startGoal, closeStep, readTourStorage } from './lib-demo.mjs'

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? def : hit.slice(`--${name}=`.length)
}
const ENV = getEnv('prod')
const product = ENV.products[arg('product', 'next')]
const part = arg('part', 'preview')
const manageTourId = Number(arg('tour'))
const extPath = arg('ext')
const tourName = arg('name', '[自動検証] ONBS-1991_20260916_チェックマーク')
const expectTiming = arg('timing', 'last_step_displayed')
if (!manageTourId || !extPath) throw new Error('--tour と --ext は必須')

const results = []
const rec = (id, ok, detail = '') => {
  results.push({ id, ok, detail })
  console.log(`  ${ok ? 'OK ' : 'NG '} ${id}${detail ? ` — ${detail}` : ''}`)
}

const c = loadCredentials('prod')
const dir = prepareArtifactDir(`onbs1991-prod-p9-${part}`)
console.log(`環境: prod / ${product.label}（pid=${product.productId}）/ tour ${manageTourId} / ${part}`)
console.log('成果物:', dir, '\n')

const { context } = await launchWithExtensions({
  credentials: c.demo,
  keys: [part],
  pathOverrides: { [part]: extPath },
})
await applyBasicAuthByHost(context, c)
const { id: extId, version } = await waitForExtensionWorker(context)
console.log(`  ${part} 拡張: version=${version}`)
rec(`P-9 ${part} prod 版が読み込めている`, Boolean(version), `version=${version}`)

let page = context.pages()[0] ?? (await context.newPage())

if (part === 'preview') {
  // 管理画面の「プレビュー」から起動する（prod では e2e 用の postMessage は応答しない）
  await blockSelfGuides(context, 'prod')
  await routeManageMessagesTo(page, extId)
  await loginToManage(page, c.manage)
  await openGuideList(page, product, c.manage, ENV.accountName)
  const preview = await openPreviewOnSite(page, context, { name: tourName, type: 'ツアー' })
  page = preview
  const launched = await page
    .waitForFunction(() => window.STANDSUnit?.isExtensionPreview === true, { timeout: 60000 })
    .then(() => true)
    .catch(() => false)
  rec('P-9 プレビューが起動する', launched, launched ? '' : 'isExtensionPreview にならない')
  await page.waitForTimeout(3000)
} else {
  await page.goto(product.demoUrl, { waitUntil: 'load' })
  const ready = await page
    .waitForFunction(() => window.STANDSUnit?.opt?.tourID, { timeout: 60000 })
    .then(() => true)
    .catch(() => false)
  rec('P-9 ビューワーでガイドが配信される', ready)
}
await shoot(page, dir, '01_launched')

const info = await page.evaluate(() => ({
  tour: window.STANDSUnit?.opt?.tourID,
  title: window.STANDSUnit?.opt?.tourTitle,
  timing: window.STANDSUnit?.opt?.styles?.intro?.checkmarkTiming ?? '(未設定)',
  goals: (window.STANDSUnit?.steps?.goals ?? []).map((g) => ({ id: g.id, steps: g.steps?.length })),
}))
console.log(`  配信: tour=${info.tour} timing=${info.timing} goals=${info.goals.map((g) => `${g.id.slice(0, 8)}(${g.steps})`).join(',')}`)
rec('P-9 タイミング設定が届いている', info.timing === expectTiming, `checkmarkTiming=${info.timing}`)

if (info.timing === expectTiming) {
  const goal1 = info.goals.find((g) => g.steps === 1)?.id
  const goal3 = [...info.goals].filter((g) => g.steps >= 2).sort((a, b) => b.steps - a.steps)[0]?.id
  await openIntro(page)
  rec('P-9 未着手はチェックなし', (await readGoalCheck(page, goal3)) === 'nocheck', await readGoalCheck(page, goal3))
  // 1 ステップのゴール＝表示した時点が最終ステップ。ここでチェックが付く
  await startGoal(page, goal1)
  await page.waitForTimeout(1200)
  const ls = await readTourStorage(page, info.tour)
  await closeStep(page)
  await openIntro(page)
  rec('P-9 最終ステップ表示でチェックが付く',
    (ls.lastStep ?? []).includes(goal1) && (await readGoalCheck(page, goal1)) === 'check',
    `lastStep=${JSON.stringify(ls.lastStep)} check=${await readGoalCheck(page, goal1)}`)
  await shoot(page, dir, '02_after-goal')
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await context.close()
process.exit(ng.length ? 1 : 0)
