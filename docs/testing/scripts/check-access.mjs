/**
 * テスト環境への疎通確認
 *
 * 管理画面へログインできるか、デモサイトでガイドが動くかを確認する。
 * 手動テストを始める前の入口として、環境と認証情報が揃っているかをここで切り分ける。
 *
 * 使い方:
 *   node docs/testing/scripts/check-access.mjs
 *   node docs/testing/scripts/check-access.mjs --headed   # ブラウザを表示する
 */
import { loadCredentials, prepareArtifactDir } from './lib/env.mjs'
import {
  PRODUCTS,
  launchBrowser,
  loginToManage,
  isLoggedIn,
  blockSelfGuides,
  openGuideList,
  shoot,
} from './lib/manage.mjs'

const headed = process.argv.includes('--headed')

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  OK ' : '  NG '} ${name}${detail ? ` — ${detail}` : ''}`)
}

const main = async () => {
  const credentials = loadCredentials()
  const dir = prepareArtifactDir('check-access')
  console.log(`成果物: ${dir}\n`)

  console.log('[1] 管理画面')
  {
    const { browser, context } = await launchBrowser({
      credentials: credentials.manage,
      headless: !headed,
    })
    // 管理画面自身のガイドがオーバーレイでクリックを遮るため止める
    await blockSelfGuides(context)
    const page = await context.newPage()
    try {
      await loginToManage(page, credentials.manage)
      const loggedIn = isLoggedIn(page)
      record('ログイン', loggedIn, loggedIn ? page.url() : '/login から遷移しない')
      await shoot(page, dir, '01_manage-after-login')

      for (const product of Object.values(PRODUCTS)) {
        let switched = false
        try {
          await openGuideList(page, product, credentials.manage)
          // ヘッダーの表示が切り替わって初めて「そのプロダクトを見ている」と言える
          switched =
            (await page.locator('.headerTenants__mainName').innerText()).trim() ===
            product.label
        } catch (e) {
          record(`ガイド一覧（${product.label}）`, false, e.message.split('\n')[0])
          continue
        }
        record(
          `ガイド一覧（${product.label} / product_id=${product.productId}）`,
          switched,
          switched ? '' : 'プロダクトが切り替わらない'
        )
        await shoot(page, dir, `02_guides-${product.key}`)
      }
    } finally {
      await browser.close()
    }
  }

  console.log('\n[2] エンドユーザー側デモサイト')
  {
    const { browser, context } = await launchBrowser({
      credentials: credentials.demo,
      headless: !headed,
    })
    const page = await context.newPage()
    try {
      for (const product of Object.values(PRODUCTS)) {
        // ガイドの通信が続くため networkidle は待たない（待つとタイムアウトする）
        await page.goto(product.demoUrl, { waitUntil: 'load' })

        // 埋め込みタグが動くと STANDSUnit が生える
        const unit = await page
          .waitForFunction(
            () => {
              const u = window.STANDSUnit
              return u && u.opt ? { tourId: u.opt.tourID, pid: u.pid } : null
            },
            { timeout: 15000 }
          )
          .then((handle) => handle.jsonValue())
          .catch(() => null)

        record(
          `ガイド配信 ${product.key}（${product.label}）`,
          Boolean(unit),
          unit ? `pid=${unit.pid} tourID=${unit.tourId || '(未設定)'}` : 'STANDSUnit が生成されない'
        )
        await shoot(page, dir, `03_demo-${product.key}`)
      }
    } finally {
      await browser.close()
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
