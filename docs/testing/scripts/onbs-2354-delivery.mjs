/**
 * ONBS-2354 API-Next の依存更新後の配信確認。
 *
 * デモサイトを新旧の配信 JS で開き、v2api の onboarding-init が 200 で返ること、
 * 配信データ（ツアー・ヒント・AI チャット）が取れて画面に出ることを確かめる。
 * あわせて、重複したカスタムパラメーターを付けた onboarding-init を直接呼び、
 * 500 にならない（以前と同じく最後の値で判定される）ことを確かめる。
 *
 *   node docs/testing/scripts/onbs-2354-delivery.mjs [--env dev|prod] [--headed]
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadPlaywright, loadCredentials, ARTIFACT_DIR } from './lib/env.mjs'
import { getEnv } from './lib/manage.mjs'

const envKey = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'dev'
const headless = !process.argv.includes('--headed')
const env = getEnv(envKey)
const credentials = loadCredentials('dev')

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const outDir = path.join(ARTIFACT_DIR, `${stamp}_onbs-2354-${envKey}`)
fs.mkdirSync(outDir, { recursive: true })

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`  ${ok ? 'OK ' : 'NG '} ${label}${detail ? ` — ${detail}` : ''}`)
}

const isV2Init = (url) => /v2api[^/]*\/.*onboarding-init/.test(url)

const { chromium } = loadPlaywright()
const browser = await chromium.launch({ headless })
let initUrl = null

for (const product of Object.values(env.products)) {
  console.log(`\n=== ${product.label}（pid=${product.productId}）===`)
  const context = await browser.newContext({
    httpCredentials: { username: credentials.demo.basicId, password: credentials.demo.basicPw },
    locale: 'ja-JP',
    viewport: { width: 1280, height: 900 },
  })
  const page = await context.newPage()
  const v2 = []
  page.on('response', async (res) => {
    if (!isV2Init(res.url())) return
    v2.push({ status: res.status(), url: res.url() })
    // デプロイ前後で応答を比べるため、本文を残す（検証用プロダクトの配信設定のみ）
    const body = await res.text().catch(() => '')
    fs.writeFileSync(path.join(outDir, `${product.key}_init_${v2.length}.json`), body)
  })
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 120))
  })

  try {
    // 検証用 AI チャットの表示条件（user_id の一致）に合わせる
    const url = new URL(product.demoUrl)
    url.searchParams.set('user_id', '1')
    await page.goto(url.href, { waitUntil: 'load' })
    await page.waitForFunction(() => typeof window.STANDSUnit !== 'undefined', { timeout: 30000 })
    await page.waitForTimeout(6000)

    record(v2.length > 0, 'v2api の onboarding-init を呼んでいる', `${v2.length} 回`)
    record(v2.every((r) => r.status === 200), 'onboarding-init が 200', v2.map((r) => r.status).join(','))
    if (v2[0]) initUrl ??= v2[0].url

    const summary = await page.evaluate(() => {
      const d = window.STANDSUnit?.responseData
      if (!d) return null
      const r = d.res_data ?? {}
      const g = d.guide_data ?? {}
      const count = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0)
      return {
        keys: Object.keys(d).length,
        tours: count(g.tours ?? r.tours),
        hints: count(r.hints ?? g.hints),
        aiChats: count(r.ai_chats),
        aiHints: count(r.ai_hints),
        customEvents: count(d.product_custom_events),
      }
    })
    record(summary !== null, '配信データを受け取った', summary ? JSON.stringify(summary) : '')

    const shown = await page.evaluate(() => ({
      aiChat: Boolean(document.getElementById('onb-ai-chat-app')),
      onbNodes: document.querySelectorAll('[id^="onb"], [class*="onb-"]').length,
    }))
    record(shown.onbNodes > 0, '配信 JS が画面に要素を出している', `onb 要素 ${shown.onbNodes} 個`)
    record(shown.aiChat === (summary?.aiChats > 0), 'AI チャットの表示が配信データと一致', `表示=${shown.aiChat}`)
    record(consoleErrors.length === 0, 'コンソールエラーなし', consoleErrors.slice(0, 3).join(' | '))
    await page.screenshot({ path: path.join(outDir, `${product.key}.png`) })
  } catch (e) {
    record(false, '実行中に失敗', String(e).slice(0, 200))
  } finally {
    await context.close()
  }
}

// 重複したカスタムパラメーター（axios が配列を key[]=a&key[]=b で送る形）
console.log('\n=== 重複したカスタムパラメーター ===')
if (initUrl) {
  const ctx = await browser.newContext()
  for (const extra of ['onbs2354_tag%5B%5D=1&onbs2354_tag%5B%5D=2', 'onbs2354_tag=a&onbs2354_tag=b']) {
    const res = await ctx.request.get(`${initUrl}&${extra}`)
    record(res.status() === 200, `重複あり（${decodeURIComponent(extra.split('&')[0].split('=')[0])}）で 200`, String(res.status()))
  }
  await ctx.close()
} else {
  record(false, 'onboarding-init の URL が取れず、直接の確認ができない')
}

await browser.close()
const ng = results.filter((r) => !r.ok).length
console.log(`\n${results.length - ng}/${results.length} 件 OK（成果物: ${outDir}）`)
process.exit(ng ? 1 : 0)
