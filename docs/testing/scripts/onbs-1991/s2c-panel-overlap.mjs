/** ONBS-1991 §2 追加確認: タイミングパネルがカラーピッカーの操作を妨げない（レビュー指摘の再発防止） */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { PRODUCTS, loginToManage, blockSelfGuides, applyBasicAuthByHost, openGuideList, openEditorOnSite, shoot } from '../lib/manage.mjs'
import { launchWithExtensions, waitForExtensionWorker, routeManageMessagesTo } from '../lib/extensions.mjs'
import { waitForEditor, expandTreePanel, openIntroInEditor, selectTaskList, EDITOR_HOST } from './lib-editor.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s2c')
console.log('成果物:', dir, '\n')
const { context } = await launchWithExtensions({ credentials: c.demo, keys: ['editor'] })
await applyBasicAuthByHost(context, c)
await blockSelfGuides(context)
const { id } = await waitForExtensionWorker(context)
const page = context.pages()[0] ?? (await context.newPage())
await routeManageMessagesTo(page, id)
await loginToManage(page, c.manage)
await openGuideList(page, PRODUCTS.next, c.manage)
const ed = await openEditorOnSite(page, context, { name: '空テスト', type: 'ツアー' })
await waitForEditor(ed)
await expandTreePanel(ed)
await openIntroInEditor(ed)
await selectTaskList(ed)

const panelState = () =>
  ed.evaluate((host) => {
    const sr = document.querySelector(host).shadowRoot
    const findText = (t) =>
      [...sr.querySelectorAll('*')].some((e) => {
        const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ')
        return own.includes(t) && e.getBoundingClientRect().width > 0
      })
    const picker = [...sr.querySelectorAll('.v-color-picker-edit input, .v-color-picker input')].find(
      (e) => e.getBoundingClientRect().width > 0
    )
    return {
      timingPanel: findText('チェックマークを付けるタイミング'),
      colorPicker: Boolean(picker),
    }
  }, EDITOR_HOST)

// (a) 選択直後: パネルは勝手に開かない
const s0 = await panelState()
rec('a. 選択しただけではタイミングパネルが開かない', !s0.timingPanel, JSON.stringify(s0))

// (b) 「チェックのタイミング」を押すと開く
await ed.evaluate((host) => {
  const sr = document.querySelector(host).shadowRoot
  const value = sr.querySelector('.taskListMenu .checkmarkTimingBtn__value')
  value?.closest('[class*="EditorBtn"], button, [role="button"]')?.click()
}, EDITOR_HOST)
await ed.waitForTimeout(1200)
const s1 = await panelState()
rec('b. ボタンでパネルが開く', s1.timingPanel, JSON.stringify(s1))
await shoot(ed, dir, '01_timing-open')

// (c) 開いたまま「チェック色」を押す → タイミングパネルが閉じ、カラーピッカーが操作できる
await ed.evaluate((host) => {
  const sr = document.querySelector(host).shadowRoot
  const label = [...sr.querySelectorAll('.taskListMenu [class*="EditorBtn__label"]')].find(
    (e) => e.textContent.trim() === 'チェック色'
  )
  label?.closest('[class*="EditorBtn"], button, [role="button"]')?.click()
}, EDITOR_HOST)
await ed.waitForTimeout(1500)
const s2 = await panelState()
rec('c. チェック色を押すとタイミングパネルが閉じ、ピッカーが出る', !s2.timingPanel && s2.colorPicker, JSON.stringify(s2))
await shoot(ed, dir, '02_color-open')

// (d) 画面外クリックでピッカーも閉じる
await ed.mouse.click(20, 400)
await ed.waitForTimeout(1200)
const s3 = await panelState()
rec('d. 画面外クリックで閉じる', !s3.timingPanel && !s3.colorPicker, JSON.stringify(s3))

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await context.close()
process.exit(ng.length ? 1 : 0)
