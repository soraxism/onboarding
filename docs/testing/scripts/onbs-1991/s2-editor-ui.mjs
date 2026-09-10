/** ONBS-1991 §2 エディタ拡張の設定UI（2-1〜2-3 + 管理画面との往復の起点） */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import {
  PRODUCTS, loginToManage, blockSelfGuides, applyBasicAuthByHost, openGuideList,
  openEditorOnSite, shoot,
} from '../lib/manage.mjs'
import { launchWithExtensions, waitForExtensionWorker, routeManageMessagesTo } from '../lib/extensions.mjs'
import {
  waitForEditor, expandTreePanel, openIntroInEditor, selectTaskList,
  readTaskListMenu, openTimingPulldown, chooseTiming,
} from './lib-editor.mjs'

const results = []
const rec = (id, ok, detail = '') => { results.push({ id, ok, detail }); console.log(`  ${ok ? 'OK ' : 'NG '} ${id} ${detail}`) }

const c = loadCredentials()
const dir = prepareArtifactDir('onbs1991-s2')
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
await shoot(ed, dir, '01_intro-open')

// 2-1 ゴール一覧を選択するとメニューに「チェック色」「チェックのタイミング」が並ぶ
await selectTaskList(ed)
const menu = await readTaskListMenu(ed)
rec('2-1', menu.open && menu.labels.includes('チェック色') && menu.labels.includes('チェックのタイミング'),
  `open=${menu.open} labels=${JSON.stringify(menu.labels)} 現在値=${menu.value}`)
await shoot(ed, dir, '02_menu')

// 2-2 プルダウンに2つの選択肢が全文表示
const items = await openTimingPulldown(ed)
const vis = items.filter((i) => i.visible).map((i) => i.text)
rec('2-2',
  vis.includes('ゴールの表示（いずれかのステップが表示）') && vis.includes('ゴールの完了（最後のステップが表示）'),
  JSON.stringify(vis))
await shoot(ed, dir, '03_pulldown')

// 2-3 「ゴールの表示」を選ぶ（§1 で last_step_displayed にしてあるので、切り替わりを見る）
// 保存リクエスト（intro-style PUT）を捕まえる
const puts = []
ed.on('request', (r) => {
  if (r.method() === 'PUT' && /intro-style/.test(r.url())) puts.push({ url: r.url(), body: r.postData() })
})
await chooseTiming(ed, 'ゴールの表示（いずれかのステップが表示）')
const after = await readTaskListMenu(ed)
await shoot(ed, dir, '04_after-choose')
rec('2-3a ボタン表示が変わる', after.value === 'ゴールの表示', `表示=${after.value}`)
await ed.waitForTimeout(3000)
rec('2-3b 保存APIが飛ぶ', puts.length > 0,
  puts.length ? `${puts[0].url.replace(/.*\/v1\//, '')} body=${(puts[0].body || '').slice(0, 160)}` : 'PUT intro-style が観測されない')

// 戻す（管理画面側の続きの §2-5/2-6 は goal_started 起点でやるためこのまま）
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await context.close()
process.exit(ng.length ? 1 : 0)
