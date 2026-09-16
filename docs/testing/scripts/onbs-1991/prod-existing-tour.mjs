/**
 * ONBS-1991 P-3（既存ツアーの見え方が変わっていない）を、
 * **設定を一度も触っていない本番ツアー**で確認する。
 *
 * この機能より前に作られたツアーの配信データには `checkmarkTiming` が無い。
 * 顧客の大半がこの状態なので、「キーが無い＝既定（ゴールの表示）」として
 * 従来どおり動くことを、管理画面を一切触らずに確かめる。
 *
 *   node docs/testing/scripts/onbs-1991/prod-existing-tour.mjs --product=next
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { getEnv, launchBrowser, shoot } from '../lib/manage.mjs'
import { openDemo, openIntro, readGoalCheck, startGoal, closeStep, readTourStorage } from './lib-demo.mjs'

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? def : hit.slice(`--${name}=`.length)
}
const ENV = getEnv('prod')
const product = ENV.products[arg('product', 'next')]

const results = []
const rec = (id, ok, detail = '') => {
  results.push({ id, ok, detail })
  console.log(`  ${ok ? 'OK ' : 'NG '} ${id}${detail ? ` — ${detail}` : ''}`)
}

const c = loadCredentials('prod')
const dir = prepareArtifactDir(`onbs1991-prod-existing-${product.key}`)
console.log(`環境: prod / ${product.label}（pid=${product.productId}）— 配信されているツアーをそのまま確認`)
console.log('成果物:', dir, '\n')

const { browser, context } = await launchBrowser({ credentials: c.demo, headless: true })
const page = await context.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await openDemo(page, arg('demo-url', product.demoUrl))
const info = await page.evaluate(() => ({
  pid: Number(window.STANDSUnit.pid),
  tourId: window.STANDSUnit.opt.tourID,
  title: window.STANDSUnit.opt.tourTitle,
  hasTiming: 'checkmarkTiming' in (window.STANDSUnit.opt.styles?.intro ?? {}),
  timing: window.STANDSUnit.opt.styles?.intro?.checkmarkTiming ?? null,
  goals: (window.STANDSUnit.steps?.goals ?? []).map((g) => ({ id: g.id, steps: g.steps?.length })),
}))
console.log(`  配信: pid=${info.pid} tour=${info.tourId} goals=${info.goals.map((g) => `${g.id.slice(0, 8)}(${g.steps})`).join(',')}`)
if (info.pid !== product.productId) throw new Error(`配信プロダクトが違う（pid=${info.pid}）`)

rec('前提 この機能より前のツアー（checkmarkTiming が配信データに無い）', info.hasTiming === false,
  `checkmarkTiming=${JSON.stringify(info.timing)}`)

const goal = [...info.goals].sort((a, b) => b.steps - a.steps)[0]?.id

// 自動表示のツアーだとステップが開いた状態で始まる。**開いたままだと
// ランチャーが隠れてイントロを開けない**ので、先に閉じる
const stepOpen = await page.locator('.g-modal-pos .g-modal-next').first().isVisible().catch(() => false)
if (stepOpen) {
  console.log('  （自動表示でステップが開いていたので閉じる）')
  await closeStep(page)
}
await openIntro(page)
rec('P-3 未着手はチェックなし', (await readGoalCheck(page, goal)) === 'nocheck', await readGoalCheck(page, goal))
await shoot(page, dir, '01_intro-initial')

await startGoal(page, goal)
await closeStep(page)
await openIntro(page)
rec('P-3 1ステップ表示でチェックが付く（従来どおり）', (await readGoalCheck(page, goal)) === 'check', await readGoalCheck(page, goal))
const ls = await readTourStorage(page, info.tourId)
rec('P-3 LS（display に記録）', Array.isArray(ls.display) && ls.display.includes(goal), JSON.stringify(ls.display))
rec('P-3 lastStep にも記録される（設定を切り替えたときの引き継ぎ用）',
  Array.isArray(ls.lastStep) ? true : ls.lastStep === null,
  `lastStep=${JSON.stringify(ls.lastStep)}`)
await shoot(page, dir, '02_after-step1')

const real = errors.filter((e) => !/favicon|net::ERR_/.test(e))
rec('P-8 コンソールエラーなし', real.length === 0, real.slice(0, 3).join(' | ') || 'エラーなし')

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await browser.close()
process.exit(ng.length ? 1 : 0)
