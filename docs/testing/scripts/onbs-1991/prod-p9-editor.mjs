/**
 * ONBS-1991 P-9（本番のエディタ拡張）。
 *
 * ストア審査が通った prod 版で、イントロの「チェックのタイミング」を変更でき、
 * 管理画面へ反映されること、**チェック色だけを変えてもタイミングが消えないこと**を確認する。
 *
 * ストア版と同じコミットから prod ビルドしたものを unpacked で読み込む
 * （Playwright はストアからインストールした拡張機能を操作できないため）。
 *
 *   node docs/testing/scripts/onbs-1991/prod-p9-editor.mjs --tour=9036 --ext=<package ディレクトリ>
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import {
  getEnv, loginToManage, blockSelfGuides, applyBasicAuthByHost, openGuideList,
  openEditorOnSite, shoot,
} from '../lib/manage.mjs'
import { launchWithExtensions, waitForExtensionWorker, routeManageMessagesTo } from '../lib/extensions.mjs'
import {
  waitForEditor, expandTreePanel, openIntroInEditor, selectTaskList,
  readTaskListMenu, openTimingPulldown, chooseTiming, setCheckColor, closePanels,
} from './lib-editor.mjs'
import { openTourEdit, openIntroStyles, readTiming, readCheckmarkColor } from './lib.mjs'

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? def : hit.slice(`--${name}=`.length)
}
const ENV = getEnv('prod')
const product = ENV.products[arg('product', 'next')]
const manageTourId = Number(arg('tour'))
const tourName = arg('name', '[自動検証] ONBS-1991_20260916_チェックマーク')
const extPath = arg('ext')
// 同じ色を入れ直すと変更が起きず PUT が飛ばない。再実行時は別の色を渡す
const newColor = arg('color', '00FF00').toUpperCase()
if (!manageTourId || !extPath) throw new Error('--tour と --ext は必須')

const results = []
const rec = (id, ok, detail = '') => {
  results.push({ id, ok, detail })
  console.log(`  ${ok ? 'OK ' : 'NG '} ${id}${detail ? ` — ${detail}` : ''}`)
}

const c = loadCredentials('prod')
const dir = prepareArtifactDir('onbs1991-prod-p9')
console.log(`環境: prod / ${product.label}（pid=${product.productId}）/ tour ${manageTourId}`)
console.log('成果物:', dir, '\n')

const { context } = await launchWithExtensions({
  credentials: c.demo,
  keys: ['editor'],
  pathOverrides: { editor: extPath },
})
await applyBasicAuthByHost(context, c)
await blockSelfGuides(context, 'prod')
const { id, version } = await waitForExtensionWorker(context)
console.log(`  エディタ拡張: version=${version}（unpacked id=${id.slice(0, 12)}…）`)
rec('P-9 前提 prod 版が読み込めている', version === '1.53.0', `version=${version}`)

const page = context.pages()[0] ?? (await context.newPage())
await routeManageMessagesTo(page, id)
await loginToManage(page, c.manage)
await openGuideList(page, product, c.manage, ENV.accountName)

const ed = await openEditorOnSite(page, context, { name: tourName, type: 'ツアー' })
await waitForEditor(ed)
await expandTreePanel(ed)
await openIntroInEditor(ed)
await shoot(ed, dir, '01_intro-open')

// メニューに「チェック色」「チェックのタイミング」が並ぶ
await selectTaskList(ed)
const menu = await readTaskListMenu(ed)
rec('P-9 インラインメニューの項目', menu.open && menu.labels.includes('チェック色') && menu.labels.includes('チェックのタイミング'),
  `labels=${JSON.stringify(menu.labels)} 現在値=${menu.value}`)
await shoot(ed, dir, '02_menu')

// プルダウンに選択肢が 2 つ
const options = await openTimingPulldown(ed)
const texts = options.map((o) => o.text)
rec('P-9 選択肢が 2 つ', texts.some((t) => t.includes('ゴールの表示')) && texts.some((t) => t.includes('ゴールの完了')),
  texts.join(' / '))
await shoot(ed, dir, '03_pulldown')

// 「ゴールの完了」を選ぶ
const target = texts.find((t) => t.includes('ゴールの完了'))
await chooseTiming(ed, target)
await closePanels(ed).catch(() => {})
await shoot(ed, dir, '04_after-choose')

// 管理画面に反映されているか
const check = await context.newPage()
await routeManageMessagesTo(check, id)
await openTourEdit(check, c.manage, manageTourId)
await openIntroStyles(check)
const t1 = await readTiming(check)
rec('P-9 拡張で変えたタイミングが管理画面に反映', t1 === 'last_step_displayed', `管理画面=${t1}`)
await shoot(check, dir, '05_manage-after-editor')
await check.close()

// チェック色だけ変えてもタイミングが残る（intro-style の部分更新）
// 別タブを開いた後はエディタ側の選択が外れていることがあるので、選び直してから操作する
await ed.bringToFront()
await openIntroInEditor(ed)
await selectTaskList(ed)
const puts = []
ed.on('request', (r) => { if (r.method() === 'PUT' && /intro-style/.test(r.url())) puts.push(r.postData() ?? '') })
await setCheckColor(ed, newColor)
await ed.waitForTimeout(3000)
await closePanels(ed).catch(() => {})
await shoot(ed, dir, '06_after-color')
const body = puts[puts.length - 1] ?? ''
// **送るのは変更したキーだけ**（ONBS-1991 で部分更新にした）。
// タイミングを載せないのが正しく、消えないことは API 側のマージで担保される
rec('P-9 色変更の PUT は変更キーだけを送る（部分更新）',
  new RegExp(newColor, 'i').test(body) && !/checkmarkTiming/.test(body),
  `PUT ${puts.length} 回 body=${body.slice(0, 140)}`)

const check2 = await context.newPage()
await routeManageMessagesTo(check2, id)
await openTourEdit(check2, c.manage, manageTourId)
await openIntroStyles(check2)
const t2 = await readTiming(check2)
const shown = await readCheckmarkColor(check2)
rec('P-9 色だけ変えてもタイミングが消えない', t2 === 'last_step_displayed', `タイミング=${t2}`)
rec('P-9 変えた色が反映', shown.replace('#', '').toLowerCase() === newColor.toLowerCase(), `色=${shown}`)
await shoot(check2, dir, '07_manage-after-color')

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 件 OK`)
const ng = results.filter((r) => !r.ok)
if (ng.length) console.log('NG:', ng.map((r) => r.id).join(', '))
await context.close()
process.exit(ng.length ? 1 : 0)
