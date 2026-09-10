/** ONBS-1991 §2-4〜2-6 拡張機能と管理画面の往復 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import {
  PRODUCTS, launchBrowser, loginToManage, blockSelfGuides, applyBasicAuthByHost,
  openGuideList, openEditorOnSite, shoot,
} from '../lib/manage.mjs'
import { launchWithExtensions, waitForExtensionWorker, routeManageMessagesTo } from '../lib/extensions.mjs'
import { TOURS, openTourEdit, openIntroStyles, readTiming, readCheckmarkColor, setCheckmarkColor, selectTiming, saveStyles } from './lib.mjs'
import { waitForEditor, expandTreePanel, openIntroInEditor, selectTaskList, readTaskListMenu, setCheckColor } from './lib-editor.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s2b')
console.log('成果物:', dir, '\n')

/** 管理画面を開いてイントロスタイルの現在値を読む（毎回新しいブラウザで） */
async function readAdmin() {
  const { browser, context } = await launchBrowser({ credentials: c.manage, headless: true })
  await blockSelfGuides(context)
  const page = await context.newPage()
  await loginToManage(page, c.manage)
  await openGuideList(page, PRODUCTS.next, c.manage)
  await openTourEdit(page, c.manage, TOURS.next.id)
  await openIntroStyles(page)
  const timing = await readTiming(page)
  const color = await readCheckmarkColor(page)
  return { browser, page, timing, color }
}

// ===== 2-4: §2 で拡張機能から goal_started に変えた → 管理画面に反映されているか =====
{
  const { browser, timing, color } = await readAdmin()
  rec('2-4', timing === 'goal_started', `管理画面の表示=${timing}（拡張機能で変更した値） 背景色=${color}`)
  await browser.close()
}

// ===== 2-5 準備: 管理画面で「ゴールの完了」を保存 =====
{
  const { browser, page } = await readAdmin()
  await selectTiming(page, 'last_step_displayed')
  await saveStyles(page)
  await browser.close()
  console.log('  （準備）管理画面で last_step_displayed を保存')
}

// ===== 2-5: 拡張機能でチェック色だけを変更 =====
{
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

  const puts = []
  ed.on('request', (r) => { if (r.method() === 'PUT' && /intro-style/.test(r.url())) puts.push(r.postData() ?? '') })
  await setCheckColor(ed, '00FF00')
  await ed.waitForTimeout(3000)
  await shoot(ed, dir, '01_color-changed')
  const body = puts[puts.length - 1] ?? ''
  rec('2-5a 色変更のPUTにタイミングが同梱される', /last_step_displayed/.test(body) && /00ff00/i.test(body),
    `PUT ${puts.length} 回 body=${body.slice(0, 160)}`)
  await context.close()
}

// ===== 2-5: 管理画面を再度開く → タイミングが残っている =====
{
  const { browser, timing, color } = await readAdmin()
  rec('2-5b', timing === 'last_step_displayed' && (color ?? '').toLowerCase() === '00ff00',
    `タイミング=${timing} 背景色=${color}`)
  await browser.close()
}

// ===== 2-6: 拡張機能でタイミング変更 → 管理画面で背景色だけ保存 → 拡張機能で確認 =====
{
  // 拡張機能で goal_started へ
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
  const { openTimingPulldown, chooseTiming } = await import('./lib-editor.mjs')
  await openTimingPulldown(ed)
  await chooseTiming(ed, 'ゴールの表示（いずれかのステップが表示）')
  await ed.waitForTimeout(2500)
  console.log('  （準備）拡張機能で goal_started へ変更')
  await context.close()
}
{
  // 管理画面で背景色だけ保存
  const { browser, page, timing } = await readAdmin()
  if (timing !== 'goal_started') rec('2-6a 拡張機能の変更が管理画面に届く', false, `timing=${timing}`)
  await setCheckmarkColor(page, '46a6ff')
  await saveStyles(page)
  await browser.close()
  console.log('  （準備）管理画面で背景色 46a6ff だけ保存')
}
{
  // 拡張機能で確認
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
  const menu = await readTaskListMenu(ed)
  rec('2-6', menu.value === 'ゴールの表示', `拡張機能のボタン表示=${menu.value}`)
  await shoot(ed, dir, '02_final-editor')
  await context.close()
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
process.exit(ng.length ? 1 : 0)
