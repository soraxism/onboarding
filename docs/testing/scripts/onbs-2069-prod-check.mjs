/**
 * ONBS-2069 の prod 確認。
 *
 * バックエンド（`Onboarding-API-Next` / `onboarding-manage-api`）だけを先行リリースした段階で、
 *   - 配信レスポンスに `trigger.mobile_ui_type` が載るか
 *   - 旧ライブラリ（prod の配信JSが抱える 1.34.0）が従来どおり動くか（デグレ確認）
 * を見る。読み取りのみで、prod のデータは一切変更しない。
 *
 *   node docs/testing/scripts/onbs-2069-prod-check.mjs [--bust <任意の文字列>] [--headed]
 *
 * **配信レスポンスは Cloudflare にキャッシュされる。** デモサイトをそのまま開くと
 * `cf-cache-status: HIT` の古い内容（27時間前など）が返り、API を直しても反映されて
 * いないように見える。そのためこのスクリプトは v2api へのリクエストにだけ一意なクエリを
 * 足してキャッシュを外す。`--bust` は実行のたびに変えること（同じ値だと今度はその値で
 * キャッシュされる）。
 *
 * キャッシュは管理画面からの保存（manage-api の `invalidate_product_cache`）で
 * `pcode:{product_code}` タグのパージが走る。API のデプロイだけでは飛ばない。
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadPlaywright, loadCredentials, ARTIFACT_DIR } from './lib/env.mjs'
import { getEnv } from './lib/manage.mjs'

const envKey = 'prod'
const headless = !process.argv.includes('--headed')
const bust = process.argv.includes('--bust')
  ? process.argv[process.argv.indexOf('--bust') + 1]
  : `onbs2069-${process.pid}`

const env = getEnv(envKey)
const credentials = loadCredentials(envKey)
const product = env.products.next

const outDir = path.join(ARTIFACT_DIR, 'onbs-2069-prod')
fs.mkdirSync(outDir, { recursive: true })

const results = []
const record = (ok, label, detail = '') => {
  results.push(ok)
  console.log(`  ${ok ? 'OK ' : 'NG '} ${label}${detail ? ` — ${detail}` : ''}`)
}

const SHADOW_HOST = 'onb-ai-chat-app'

/** Shadow DOM の中を覗く。AIチャットは shadow root 配下に描画される */
const peek = (page, selector) =>
  page.evaluate(
    ([hostId, target]) => {
      const el = document.getElementById(hostId)?.shadowRoot?.querySelector(target)
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return {
        text: (el.textContent ?? '').trim().slice(0, 40),
        visible: rect.width > 0 && rect.height > 0,
      }
    },
    [SHADOW_HOST, selector]
  )

const tap = (page, selector) =>
  page.evaluate(
    ([hostId, target]) => {
      const el = document.getElementById(hostId)?.shadowRoot?.querySelector(target)
      if (!el) return false
      el.click()
      return true
    },
    [SHADOW_HOST, selector]
  )

const main = async () => {
  const { chromium, devices } = loadPlaywright()
  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    httpCredentials: {
      username: credentials.demo.basicId,
      password: credentials.demo.basicPw,
    },
    locale: 'ja-JP',
  })

  // Cloudflare のキャッシュを外す。足すのは配信APIのリクエストだけ
  await context.route('**/v2api.onboarding-app.io/onboarding-init*', (route) => {
    const url = new URL(route.request().url())
    url.searchParams.set('_cb', bust)
    route.continue({ url: url.toString() })
  })

  const page = await context.newPage()
  try {
    console.log(`=== ${product.label}（pid=${product.productId}）/ bust=${bust} ===`)
    await page.goto(product.demoUrl, { waitUntil: 'load' })
    await page.waitForFunction(() => typeof window.STANDSUnit !== 'undefined', {
      timeout: 30000,
    })
    // AIチャットのマウントは表示条件の評価後なので、少し待つ
    await page.waitForTimeout(6000)

    const chats = await page.evaluate(
      () => window.STANDSUnit?.responseData?.res_data?.ai_chats ?? []
    )
    record(chats.length > 0, `ai_chats: ${chats.length} 件`)
    for (const chat of chats) {
      const trigger = chat.trigger ?? {}
      record(
        trigger.mobile_ui_type !== undefined,
        '配信レスポンスに mobile_ui_type が載る',
        `"${trigger.text ?? ''}" = ${JSON.stringify(trigger.mobile_ui_type)}`
      )
    }

    record(
      await page.evaluate((id) => Boolean(document.getElementById(id)), SHADOW_HOST),
      'AIチャットがマウントされる'
    )
    const trigger = await peek(page, '.trigger')
    record(trigger?.visible === true, 'ランチャーが従来どおり表示される', trigger?.text ?? '出ない')
    // 表示形式が launcher のチャットでは、配信JSが新しくてもフローティングは出ないのが正しい
    record((await peek(page, '.floating')) === null, 'launcher 設定ではフローティングが出ない')
    await page.screenshot({ path: path.join(outDir, 'prod-01-launcher.png') })

    await tap(page, '.trigger')
    await page.waitForTimeout(2500)
    record((await peek(page, '.window'))?.visible === true, 'ランチャー押下でチャットが開く')
    await page.screenshot({ path: path.join(outDir, 'prod-02-opened.png') })
  } catch (error) {
    record(false, '実行中の例外', String(error).slice(0, 160))
  } finally {
    await browser.close()
  }

  const ng = results.filter((r) => !r).length
  console.log(`\n${results.length - ng}/${results.length} 件 OK`)
  console.log(`成果物: ${outDir}`)
  if (ng > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
