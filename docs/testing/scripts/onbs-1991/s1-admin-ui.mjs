/** ONBS-1991 §1 管理画面の設定UI */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, launchBrowser, loginToManage, blockSelfGuides, openGuideList, shoot } from '../lib/manage.mjs'
import {
  TOURS, openTourEdit, openIntroStyles, readTiming, readCheckmarkColor, setCheckmarkColor,
  selectTiming, saveStyles, checkmarkSection, clickCheckmarkDefault,
} from './lib.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s1')
console.log('成果物:', dir, '\n')
const { browser, context } = await launchBrowser({ credentials: c.manage, headless: true })
await blockSelfGuides(context)
const page = await context.newPage()
await loginToManage(page, c.manage)
await openGuideList(page, PRODUCTS.next, c.manage)
await openTourEdit(page, c.manage, TOURS.next.id)
await openIntroStyles(page)
await shoot(page, dir, '01_intro-tab')

// 1-1 チェックマークのセクションに背景色とタイミングが並ぶ
const sectionText = (await checkmarkSection(page).innerText()).replace(/\s+/g, ' ')
rec('1-1', /背景色/.test(sectionText) && /チェックマークを付けるタイミング/.test(sectionText), `「${sectionText.slice(0, 110)}…」`)

// 1-2 選択肢が2つ・文言・縦並び
const opts = await page.evaluate(() => {
  const rs = [...document.querySelectorAll('input[name="introCheckmarkTiming"]')]
  const group = rs[0]?.closest('[class*="radioCardGroup"]')
  const cs = group ? getComputedStyle(group) : null
  return {
    values: rs.map((r) => r.value),
    labels: rs.map((r) => (r.closest('label') ?? r.parentElement)?.innerText.trim().replace(/\s+/g, ' ')),
    groupClass: group?.className ?? null,
    flexDirection: cs?.flexDirection ?? null,
    // 枠内で折り返さずに読めるか（ラベルの行数）
    lines: rs.map((r) => {
      const el = (r.closest('label') ?? r.parentElement).querySelector('span, p, div') ?? r.parentElement
      return Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || '20'))
    }),
  }
})
rec('1-2', opts.values.length === 2 && opts.flexDirection === 'column',
  `値=${JSON.stringify(opts.values)} 縦並び=${opts.flexDirection} 文言=${JSON.stringify(opts.labels)}`)
await shoot(page, dir, '02_checkmark-section')

// 1-3 未保存のツアーは「ゴールの表示」
const before = await readTiming(page)
const colorBefore = await readCheckmarkColor(page)
rec('1-3', before === 'goal_started', `選択=${before} / 背景色=${colorBefore}`)

// 1-4 「ゴールの完了」を選び保存 → 再度開く
await selectTiming(page, 'last_step_displayed')
await saveStyles(page)
await page.waitForTimeout(1500)
await openIntroStyles(page)
const after14 = await readTiming(page)
rec('1-4', after14 === 'last_step_displayed', `再オープン後=${after14}`)
await shoot(page, dir, '03_after-save')

// 1-5 デフォルトに戻す → 背景色だけ戻り、タイミングは変わらない
const colorBeforeReset = await readCheckmarkColor(page)
await clickCheckmarkDefault(page)
const timing15 = await readTiming(page)
const color15 = await readCheckmarkColor(page)
rec('1-5', timing15 === 'last_step_displayed' && (color15 ?? '').toLowerCase().includes('46a6ff'),
  `タイミング=${timing15}（変わらないこと） 背景色 ${colorBeforeReset} → ${color15}`)
await shoot(page, dir, '04_after-default')

// 1-6 背景色を変えて保存 → 両方保存されている
await setCheckmarkColor(page, 'ff0000')
await saveStyles(page)
await page.waitForTimeout(1500)
await openIntroStyles(page)
const t16 = await readTiming(page), c16 = await readCheckmarkColor(page)
rec('1-6', t16 === 'last_step_displayed' && (c16 ?? '').toLowerCase().includes('ff0000'), `タイミング=${t16} 背景色=${c16}`)
await shoot(page, dir, '05_both-saved')

// 1-7 リロードしても保持
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle').catch(() => {})
await page.getByText('表示スタイル設定').first().waitFor({ state: 'visible', timeout: 30000 })
await openIntroStyles(page)
const t17 = await readTiming(page), c17 = await readCheckmarkColor(page)
rec('1-7', t17 === 'last_step_displayed' && (c17 ?? '').toLowerCase().includes('ff0000'), `タイミング=${t17} 背景色=${c17}`)
await shoot(page, dir, '06_after-reload')

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await browser.close()
process.exit(ng.length ? 1 : 0)
