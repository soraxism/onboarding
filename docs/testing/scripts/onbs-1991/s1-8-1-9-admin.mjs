/**
 * ONBS-1991 §1-8 / §1-9 — 管理画面の追加確認項目
 *
 * 1-8: 「デフォルトに戻す」の直後に保存しても、選択していたタイミングが維持される
 *      （戻すのは背景色だけ、という決定事項の確認）
 * 1-9: タイミングのカードをキーボードだけで操作できる
 *      （カードの native radio を display:none で隠していた問題の確認）
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, launchBrowser, loginToManage, blockSelfGuides, openGuideList, shoot } from '../lib/manage.mjs'
import {
  openTourEdit, openIntroStyles, readTiming, selectTiming, saveStyles,
  readCheckmarkColor, setCheckmarkColor, clickCheckmarkDefault, checkmarkSection,
} from './lib.mjs'
import { NEXT_TOUR } from './lib-demo.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s1-8-1-9')
console.log('成果物:', dir, '\n')

const { browser, context } = await launchBrowser({ credentials: c.manage, headless: true })
await blockSelfGuides(context)
const page = await context.newPage()
await loginToManage(page, c.manage)
await openGuideList(page, PRODUCTS.next, c.manage)
await openTourEdit(page, c.manage, NEXT_TOUR.manageTourId)
await openIntroStyles(page)

// ---- 前提: タイミングを既定以外にし、色も既定から変えて保存しておく ----
await selectTiming(page, 'last_step_displayed')
await setCheckmarkColor(page, 'ff0000')
await saveStyles(page)
await openTourEdit(page, c.manage, NEXT_TOUR.manageTourId)
await openIntroStyles(page)
rec('前提: タイミング last_step_displayed / 色 ff0000 で保存できている',
  (await readTiming(page)) === 'last_step_displayed' && (await readCheckmarkColor(page)).replace('#', '') === 'ff0000',
  `timing=${await readTiming(page)} color=${await readCheckmarkColor(page)}`)

// ================= 1-8 =================
await clickCheckmarkDefault(page)
await shoot(page, dir, '01-after-default')

const colorAfter = (await readCheckmarkColor(page)).replace('#', '')
const timingAfter = await readTiming(page)
rec('1-8 デフォルトに戻すと背景色は既定値になる', colorAfter === '46a6ff', `色=${colorAfter}`)
rec('1-8 デフォルトに戻してもタイミングは変わらない', timingAfter === 'last_step_displayed', `timing=${timingAfter}`)

await saveStyles(page)
await openTourEdit(page, c.manage, NEXT_TOUR.manageTourId)
await openIntroStyles(page)
const colorSaved = (await readCheckmarkColor(page)).replace('#', '')
const timingSaved = await readTiming(page)
rec('1-8 保存 → 再度開いても色は既定値', colorSaved === '46a6ff', `色=${colorSaved}`)
rec('1-8 保存 → 再度開いてもタイミングは維持される', timingSaved === 'last_step_displayed', `timing=${timingSaved}`)

// ================= 1-9 =================
const section = checkmarkSection(page)
const radios = section.locator('input[name="introCheckmarkTiming"]')
rec('1-9 前提: radio が 2 つ描画されている', (await radios.count()) === 2, `count=${await radios.count()}`)

// display:none だとフォーカスできない。
//
// リングは :focus-visible なので script の .focus() では出ない（Chromium は直前の
// 操作がキーボードかで出し分ける）。実際に Tab を押して到達させる。
// native の radio グループは「選択中の項目」に入り、矢印キーは端で循環する。
// どちらも標準挙動なので、先頭固定ではなく到達した値を基準に確認する。
await section.locator('.c-colorPicker__inputText').first().focus()
let reached = false
for (let i = 0; i < 12; i++) {
  await page.keyboard.press('Tab')
  reached = await page.evaluate(() => document.activeElement?.getAttribute('name') === 'introCheckmarkTiming')
  if (reached) break
}
const entry = await page.evaluate(() => document.activeElement?.getAttribute('value') ?? null)
rec('1-9 Tab で radio に到達できる（display:none ではない）', reached === true, `到達時の値=${entry}`)

const OTHER = { goal_started: 'last_step_displayed', last_step_displayed: 'goal_started' }

/** いまフォーカスされている radio と、その相方の見た目を読む */
const focusState = () => page.evaluate(() => {
  const a = document.activeElement
  const sib = a?.nextElementSibling
  const s = a ? getComputedStyle(a) : null
  const r = a?.getBoundingClientRect()
  return {
    value: a?.getAttribute('value') ?? null,
    focusVisible: a?.matches(':focus-visible') ?? false,
    display: s?.display, opacity: s?.opacity, position: s?.position,
    boxW: r ? Math.round(r.width) : null, boxH: r ? Math.round(r.height) : null,
    outline: sib ? getComputedStyle(sib).outline : null,
    siblingClass: sib?.className ?? null,
  }
})

const st = await focusState()
rec('1-9 input は display:none ではない', st.display !== 'none', `display=${st.display}`)
rec('1-9 input は視覚的に隠れている（不可視かつ極小で流れの外）',
  st.opacity === '0' && st.position === 'absolute' && st.boxW <= 2 && st.boxH <= 2,
  `opacity=${st.opacity} position=${st.position} 実寸=${st.boxW}x${st.boxH}`)
rec('1-9 キーボード到達時は :focus-visible が成立する', st.focusVisible === true)
rec('1-9 フォーカス中のカードにリングが出る',
  st.siblingClass === 'c-radioCard__replace' && /solid 2px/.test(st.outline ?? ''), `outline=${st.outline}`)
await shoot(page, dir, '02-focus-ring')

// 矢印キーで選択が動く（name を共有する native radio グループの標準挙動）
await page.keyboard.press('ArrowDown')
await page.waitForTimeout(400)
const afterDown = await readTiming(page)
rec('1-9 ArrowDown で選択が隣へ移る', afterDown === OTHER[entry], `${entry} → ${afterDown}`)

await page.keyboard.press('ArrowUp')
await page.waitForTimeout(400)
const afterUp = await readTiming(page)
rec('1-9 ArrowUp で元の選択へ戻る', afterUp === entry, `${afterDown} → ${afterUp}`)

// Tab でグループを抜ける（radio グループは 1 タブストップ）
await page.keyboard.press('Tab')
const leftGroup = await page.evaluate(() => document.activeElement?.getAttribute('name') !== 'introCheckmarkTiming')
rec('1-9 Tab でグループを抜けて次の要素へ', leftGroup === true)

// クリック操作ではリングを出さない（:focus-visible）
await selectTiming(page, OTHER[entry])
const clicked = await page.evaluate((v) => {
  const input = document.querySelector(`input[name="introCheckmarkTiming"][value="${v}"]`)
  return { fv: input.matches(':focus-visible'), outline: getComputedStyle(input.nextElementSibling).outline }
}, OTHER[entry])
rec('1-9 クリック時はリングを出さない', clicked.fv === false && !/solid 2px/.test(clicked.outline), `outline=${clicked.outline}`)
rec('1-9 クリックでも選択できる', (await readTiming(page)) === OTHER[entry])
await shoot(page, dir, '03-after-click')

// ---- 後始末: 既定値に戻して保存する ----
await selectTiming(page, 'goal_started')
await saveStyles(page)
console.log('  （後始末: タイミングを goal_started に戻して保存）')

await browser.close()

const ng = results.filter((r) => !r.ok)
console.log(`\n${results.length - ng.length}/${results.length} 件 OK`)
if (ng.length) { console.log('NG: ' + ng.map((r) => r.id).join(', ')); process.exit(1) }
