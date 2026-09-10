/**
 * 拡張機能の疎通確認
 *
 * プレビュー / ビューワー / エディタの各拡張機能を Playwright で読み込めるかを確認する。
 * 拡張機能が絡む確認を始める前の入口。ここが通らなければビルドか環境の問題。
 *
 * 使い方:
 *   node docs/testing/scripts/check-extensions.mjs
 *   node docs/testing/scripts/check-extensions.mjs --headed        # ウィンドウを表示する
 *   node docs/testing/scripts/check-extensions.mjs --only=editor   # 対象を絞る
 */
import { loadCredentials, prepareArtifactDir } from './lib/env.mjs'
import {
  PRODUCTS,
  loginToManage,
  blockSelfGuides,
  switchToProduct,
  applyBasicAuthByHost,
  openEditorOnSite,
  shoot,
} from './lib/manage.mjs'
import {
  EXTENSIONS,
  VERSION_JSON_URL,
  launchWithExtensions,
  waitForExtensionWorker,
  routeManageMessagesTo,
} from './lib/extensions.mjs'

const headed = process.argv.includes('--headed')
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1]
const keys = only ? only.split(',') : Object.keys(EXTENSIONS)

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  OK ' : '  NG '} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** "1.2.3" 同士を比較して a < b なら true */
const isOlder = (a, b) => {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d < 0
  }
  return false
}

const main = async () => {
  const credentials = loadCredentials()
  const dir = prepareArtifactDir('check-extensions')
  console.log(`成果物: ${dir}\n`)

  // 管理画面が要求する最新バージョン（dev）。取れなくても致命ではないので警告に留める
  let required = {}
  try {
    const res = await fetch(VERSION_JSON_URL)
    required = (await res.json()).dev ?? {}
  } catch {
    console.log('  ※ version.json を取得できませんでした。バージョン判定は省略します')
  }

  console.log('[1] 拡張機能の読み込み')
  for (const key of keys) {
    const ext = EXTENSIONS[key]
    let context
    try {
      ;({ context } = await launchWithExtensions({
        credentials: credentials.demo,
        keys: [key],
        headed,
      }))
      const { id, version } = await waitForExtensionWorker(context)
      record(`${ext.label} を読み込める`, true, `id=${id} version=${version}`)

      // 管理画面から起動する拡張機能は、version.json より古いと更新を要求されて起動できない
      const min = ext.versionKey ? required[ext.versionKey] : null
      if (min) {
        const ok = !isOlder(version, min)
        record(
          `${ext.label} のバージョンが dev の要求を満たす`,
          ok,
          ok ? `${version} >= ${min}` : `${version} < ${min}（管理画面が更新を要求する）`
        )
      }
    } catch (e) {
      record(`${ext.label} を読み込める`, false, e.message.split('\n')[0])
    } finally {
      if (context) await context.close().catch(() => {})
    }
  }

  // 拡張機能を読み込んだ状態でも BASIC 認証付きのデモサイトを開けること（httpCredentials の確認）
  if (keys.includes('preview')) {
    console.log('\n[2] 拡張機能ありでデモサイトを開く')
    let context
    try {
      ;({ context } = await launchWithExtensions({
        credentials: credentials.demo,
        keys: ['preview'],
        headed,
      }))
      await waitForExtensionWorker(context)
      const page = await context.newPage()
      const product = PRODUCTS.next
      // ガイドの通信が続くため networkidle は待たない
      await page.goto(product.demoUrl, { waitUntil: 'load' })
      const unit = await page
        .waitForFunction(() => (window.STANDSUnit?.opt ? { pid: window.STANDSUnit.pid } : null), {
          timeout: 15000,
        })
        .then((h) => h.jsonValue())
        .catch(() => null)
      record(
        `デモサイト（${product.label}）が開ける`,
        Boolean(unit),
        unit ? `pid=${unit.pid}` : 'STANDSUnit が生成されない'
      )
      await shoot(page, dir, '01_demo-with-preview-ext')
    } catch (e) {
      record('デモサイトが開ける', false, e.message.split('\n')[0])
    } finally {
      if (context) await context.close().catch(() => {})
    }
  }

  // 管理画面「サイト上で編集」からエディタが起動するところまで通す。
  // unpacked で読み込むと拡張機能 ID が毎回変わるので、管理画面が送る宛先を差し替える。
  if (keys.includes('editor')) {
    console.log('\n[3] 管理画面からエディタを起動する')
    let context
    try {
      ;({ context } = await launchWithExtensions({
        credentials: credentials.demo,
        keys: ['editor'],
        headed,
      }))
      await applyBasicAuthByHost(context, credentials)
      await blockSelfGuides(context)

      const { id, version } = await waitForExtensionWorker(context)
      const page = context.pages()[0] ?? (await context.newPage())
      await routeManageMessagesTo(page, id)
      await loginToManage(page, credentials.manage)

      // 管理画面が拡張機能を認識できるか（宛先の差し替えが効いているか）
      const answered = await page.evaluate(
        (extId) =>
          new Promise((resolve) => {
            chrome.runtime.sendMessage(extId, 'installed?', (r) =>
              resolve(chrome.runtime.lastError ? null : r)
            )
          }),
        id
      )
      record(
        '管理画面が拡張機能を認識する',
        answered === version,
        answered ? `installed? -> ${answered}` : '応答なし'
      )

      await page.goto(new URL('/guides', credentials.manage.url).href, {
        waitUntil: 'domcontentloaded',
      })
      await page.waitForLoadState('networkidle')
      await switchToProduct(page, PRODUCTS.next)

      const editorPage = await openEditorOnSite(page, context)
      // エディタの編集バーが出れば起動できている
      const barVisible = await editorPage
        .getByText('公開設定をする')
        .first()
        .waitFor({ state: 'visible', timeout: 30000 })
        .then(() => true)
        .catch(() => false)
      record(
        'エディタが対象サイト上で起動する',
        barVisible,
        barVisible ? editorPage.url() : '編集バーが出ない'
      )
      await shoot(editorPage, dir, '02_editor')
    } catch (e) {
      record('管理画面からエディタを起動する', false, e.message.split('\n')[0])
    } finally {
      if (context) await context.close().catch(() => {})
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 件 OK`)
  if (failed.length) {
    console.log('失敗:', failed.map((f) => f.name).join(' / '))
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
