/**
 * ONBS-1991 本番リリース後の確認 P-1〜P-8。
 *
 * 手順は docs/features/ONBS-1991/2026-09-15_prod-verification-plan.md。
 * 管理画面（P-1・P-2）→ 公開 → エンドユーザー側（P-3〜P-8）を 1 本で通す。
 *
 * 使い方:
 *   node docs/testing/scripts/onbs-1991/prod-p1-p8.mjs --product=next  --tour=9036
 *   node docs/testing/scripts/onbs-1991/prod-p1-p8.mjs --product=legacy --tour=9037
 *
 * **未着手状態は新しいブラウザコンテキストで作る。** prod 配信には
 * `STANDSTest.flushSyncStorage()` が無く、LS を消しても ONBS-1969 の
 * 写しから復元されるため、消すのではなく「まだ何も書かれていない」状態を使う。
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { getEnv, launchBrowser, loginToManage, blockSelfGuides, shoot } from '../lib/manage.mjs'
import {
  openTourEdit, openIntroStyles, readTiming, selectTiming, saveStyles,
  readCheckmarkColor, setCheckmarkColor, publishTour, checkmarkSection,
} from './lib.mjs'
import {
  openDemo, openIntro, readGoalCheck, startGoal, clickNext, closeStep, readTourStorage,
} from './lib-demo.mjs'

// 値に `=` を含む引数（URL）があるため、最初の `=` の後ろを丸ごと取る。
// split('=')[1] だと `?env=prod&type=new` が `?env` で切れて別環境を見に行く
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? def : hit.slice(`--${name}=`.length)
}
const ENV = getEnv('prod')
const productKey = arg('product', 'next')
const product = ENV.products[productKey]
const manageTourId = Number(arg('tour'))
// 配信されるツアーの tourID（ハッシュ）。指定すると取り違えを検出できる
const expectTourHash = arg('expect-tour', null)
// 既定のまま公開する工程を飛ばす（既に公開済みのツアーを使うとき）
const skipFirstPublish = process.argv.includes('--skip-first-publish')
if (!product || !manageTourId) throw new Error('--product と --tour は必須')

/** ステップが 2 つ以上のゴール（多いものを優先） */
const pickMulti = (info) =>
  [...info.goals].filter((g) => g.steps >= 2).sort((a, b) => b.steps - a.steps)[0]?.id
/** ステップが 1 つだけのゴール（無ければ undefined） */
const pickOne = (info) => info.goals.find((g) => g.steps === 1)?.id

const results = []
const rec = (id, ok, detail = '') => {
  results.push({ id, ok, detail })
  console.log(`  ${ok ? 'OK ' : 'NG '} ${id}${detail ? ` — ${detail}` : ''}`)
}

const c = loadCredentials('prod')
const dir = prepareArtifactDir(`onbs1991-prod-${productKey}`)
console.log(`環境: prod / ${product.label}（pid=${product.productId}）/ tour ${manageTourId}`)
console.log('成果物:', dir, '\n')

// ---------- 管理画面 ----------
const { browser, context } = await launchBrowser({ credentials: c.manage, headless: true })
await blockSelfGuides(context, 'prod')
const page = await context.newPage()
await loginToManage(page, c.manage)

console.log('[P-1] 設定 UI')
await openTourEdit(page, c.manage, manageTourId)
await openIntroStyles(page)
const options = await page.evaluate(() =>
  [...document.querySelectorAll('input[name="introCheckmarkTiming"]')].map((r) => r.value)
)
rec('P-1 選択肢', options.length === 2 && options.includes('goal_started') && options.includes('last_step_displayed'),
  options.join(' / '))
const sectionHasColor = await checkmarkSection(page).locator('.c-colorPicker__inputText').count()
rec('P-1 同一セクション', sectionHasColor > 0, '背景色とタイミングが同じセクションにある')
const initialTiming = await readTiming(page)
if (process.argv.includes('--fresh')) rec('P-1 既定値', initialTiming === 'goal_started', `現在=${initialTiming}`)
else console.log(`  -   P-1 既定値 — 現在=${initialTiming}（編集済みのツアーのため判定しない）`)
await shoot(page, dir, '01_intro-styles')

/**
 * 表示スタイル設定のモーダルを閉じる。
 *
 * **保存せずに公開へ進むときは必ず閉じること。** 開いたままだと
 * `.c-modalGroup.is-active` が公開ボタンのクリックを吸ってしまい、
 * Playwright が延々とリトライしてタイムアウトする。
 */
const closeStylesModal = async (p) => {
  // Escape や × では閉じない。モーダル内の「キャンセル」を押す
  await p.locator('.c-modalGroup.is-active').getByRole('button', { name: 'キャンセル' })
    .first().click({ force: true })
  await p.locator('.c-modalGroup.is-active').first()
    .waitFor({ state: 'detached', timeout: 15000 })
  await p.waitForTimeout(500)
}

// 既定のまま公開して、まず「従来どおり」を確認する
console.log('\n[公開] 既定（ゴールの表示）')
if (skipFirstPublish) {
  console.log('  （--skip-first-publish のため公開を省略）')
  await closeStylesModal(page)
} else {
  // 下書きに前回の変更が残っていることがあるため、明示的に goal_started を保存してから公開する
  if (initialTiming !== 'goal_started') await selectTiming(page, 'goal_started')
  await setCheckmarkColor(page, '46a6ff')
  await saveStyles(page)
  await publishTour(page)
}

// ---------- エンドユーザー: 既定 ----------
const runDemo = async (label, fn) => {
  const ctx = await browser.newContext({
    httpCredentials: { username: c.demo.basicId, password: c.demo.basicPw },
    viewport: { width: 1440, height: 900 },
    locale: 'ja-JP',
  })
  const p = await ctx.newPage()
  const consoleErrors = []
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  p.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  await openDemo(p, arg('demo-url', product.demoUrl))
  const info = await p.evaluate(() => ({
    pid: Number(window.STANDSUnit.pid),
    tourId: window.STANDSUnit.opt.tourID,
    // キー自体が無い＝この機能より前に作られたツアー。既定（goal_started）扱いになるはず
    timing: window.STANDSUnit.opt.styles?.intro?.checkmarkTiming ?? '(未設定)',
    goals: (window.STANDSUnit.steps?.goals ?? []).map((g) => ({ id: g.id, steps: g.steps?.length })),
  }))
  console.log(`  配信: pid=${info.pid} tourID=${info.tourId} timing=${info.timing} goals=${info.goals.map((g) => `${g.id.slice(0, 8)}(${g.steps})`).join(',')}`)
  // 環境やプロダクトの取り違えをここで止める（URL のクエリが欠けると dev を見にいく）
  if (info.pid !== product.productId) {
    throw new Error(`配信プロダクトが違う（pid=${info.pid} / 期待 ${product.productId}）。--demo-url のクエリが欠けていないか確認すること`)
  }
  if (expectTourHash && info.tourId !== expectTourHash) {
    throw new Error(`配信されたツアーが編集対象と違う（配信=${info.tourId}）。同じ URL に複数のツアーが公開されていないか確認すること`)
  }
  try {
    await fn(p, info, consoleErrors)
  } finally {
    await ctx.close()
  }
  return consoleErrors
}

console.log('\n[P-3/P-5] エンドユーザー側 — 既定（ゴールの表示）')
const errDefault = await runDemo('default', async (p, info) => {
  const goal3 = pickMulti(info)
  const goal1 = pickOne(info)
  rec('前提 timing=goal_started（未設定も既定として扱う）',
    info.timing === 'goal_started' || info.timing === '(未設定)', info.timing)
  await openIntro(p)
  rec('P-3 未着手はチェックなし', (await readGoalCheck(p, goal3)) === 'nocheck', await readGoalCheck(p, goal3))
  await shoot(p, dir, '02_default-intro-initial')
  await startGoal(p, goal3)
  await closeStep(p)
  await openIntro(p)
  rec('P-3 1ステップ表示でチェックが付く', (await readGoalCheck(p, goal3)) === 'check', await readGoalCheck(p, goal3))
  const ls = await readTourStorage(p, info.tourId)
  rec('P-3 LS（display に記録）', Array.isArray(ls.display) && ls.display.includes(goal3), JSON.stringify(ls.display))
  if (goal1) rec('P-3 1ステップのゴールは未着手', (await readGoalCheck(p, goal1)) === 'nocheck', await readGoalCheck(p, goal1))
  await shoot(p, dir, '03_default-after-step1')
})

// ---------- 管理画面: 設定変更 ----------
console.log('\n[P-2] 「ゴールの完了」へ切り替えて保存・再オープン')
await openTourEdit(page, c.manage, manageTourId)
await openIntroStyles(page)
await selectTiming(page, 'last_step_displayed')
await setCheckmarkColor(page, 'ff0000')
await saveStyles(page)
await openTourEdit(page, c.manage, manageTourId)
await openIntroStyles(page)
const timingAfter = await readTiming(page)
const colorAfter = await readCheckmarkColor(page)
rec('P-2 タイミングが保存される', timingAfter === 'last_step_displayed', timingAfter)
rec('P-2 背景色も同時に保存される', colorAfter.replace('#', '').toLowerCase() === 'ff0000', colorAfter)
await shoot(page, dir, '04_after-save')
console.log('\n[公開] ゴールの完了')
await closeStylesModal(page)
await publishTour(page)

// ---------- エンドユーザー: ゴールの完了 ----------
console.log('\n[P-4/P-6/P-7] エンドユーザー側 — ゴールの完了')
const errLast = await runDemo('last', async (p, info) => {
  const goal3 = pickMulti(info)
  const goal1 = pickOne(info)
  rec('前提 timing=last_step_displayed', info.timing === 'last_step_displayed', info.timing)
  await openIntro(p)
  rec('P-4 未着手はチェックなし', (await readGoalCheck(p, goal3)) === 'nocheck', await readGoalCheck(p, goal3))
  await startGoal(p, goal3)
  await closeStep(p)
  await openIntro(p)
  rec('P-4 1ステップ表示ではチェックが付かない', (await readGoalCheck(p, goal3)) === 'nocheck', await readGoalCheck(p, goal3))
  await shoot(p, dir, '05_last-after-step1')

  // P-7 途中ステップを表示したまま確認する。
  // **イントロは開き直さない。** ステップ表示中はランチャーが隠れて押せないうえ、
  // イントロの DOM は背後に残っているので readGoalCheck() だけで状態が読める
  const steps = info.goals.find((g) => g.id === goal3)?.steps ?? 3
  await startGoal(p, goal3)
  for (let i = 1; i < steps - 1; i++) {
    await clickNext(p)
    rec(`P-7 ステップ${i + 1}/${steps} 表示中はチェックが付かない`, (await readGoalCheck(p, goal3)) === 'nocheck', await readGoalCheck(p, goal3))
  }
  await shoot(p, dir, '06_last-midstep')

  // 最終ステップへ（終了は押さない）
  await clickNext(p)
  rec('P-4 最終ステップ表示でチェックが付く（進行中の即時反映）', (await readGoalCheck(p, goal3)) === 'check', await readGoalCheck(p, goal3))
  const ls = await readTourStorage(p, info.tourId)
  rec('P-4 LS（lastStep に記録・complete は空）',
    Array.isArray(ls.lastStep) && ls.lastStep.includes(goal3) && !(ls.complete ?? []).includes(goal3),
    `lastStep=${JSON.stringify(ls.lastStep)} complete=${JSON.stringify(ls.complete)}`)
  await shoot(p, dir, '07_last-laststep')

  // 閉じてイントロを開き直してもチェックが残る
  await closeStep(p)
  await openIntro(p)
  rec('P-4 閉じてイントロを開いてもチェックが残る', (await readGoalCheck(p, goal3)) === 'check', await readGoalCheck(p, goal3))

  // 1 ステップのゴールは表示した時点で付く（1ステップ目＝最終ステップ）
  if (goal1) {
    await startGoal(p, goal1)
    await closeStep(p)
    await openIntro(p)
    rec('P-4 1ステップのゴールは表示時点でチェック', (await readGoalCheck(p, goal1)) === 'check', await readGoalCheck(p, goal1))
    await shoot(p, dir, '08_last-onestep-goal')
  } else {
    console.log('  （1 ステップのゴールが無いツアーのため、この確認は省略）')
  }
})

const allErrors = [...errDefault, ...errLast].filter((e) => !/favicon|net::ERR_/.test(e))
rec('P-8 コンソールエラーなし', allErrors.length === 0, allErrors.slice(0, 3).join(' | ') || 'エラーなし')

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await browser.close()
process.exit(ng.length ? 1 : 0)
