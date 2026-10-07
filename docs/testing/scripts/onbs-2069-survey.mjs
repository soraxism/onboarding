/**
 * ONBS-2069 の確認に使える状態かを調べる（読み取りのみ）。
 *
 * - 検証用プロダクト（legacy / next）に AI チャットがあるか
 * - 配信タグが ai_chats を返すか（AI 利用フラグが有効か）
 * - 返ってくる trigger に mobile_ui_type が載っているか
 *
 * 設定の変更は一切行わない。
 *
 *   node docs/testing/scripts/onbs-2069-survey.mjs [--env dev|prod] [--headed]
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadCredentials, ARTIFACT_DIR } from './lib/env.mjs'
import {
  getEnv,
  launchBrowser,
  loginToManage,
  blockSelfGuides,
  switchToProduct,
} from './lib/manage.mjs'

const envKey = process.argv.includes('--env')
  ? process.argv[process.argv.indexOf('--env') + 1]
  : 'dev'
const headless = !process.argv.includes('--headed')

const env = getEnv(envKey)
const credentials = loadCredentials(envKey)

const stamp = new Date()
  .toISOString()
  .replace(/[-:T]/g, '')
  .slice(0, 15)
const outDir = path.join(ARTIFACT_DIR, `${stamp}_onbs-2069-survey`)
fs.mkdirSync(outDir, { recursive: true })

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`  ${ok ? 'OK ' : 'NG '} ${label}${detail ? ` — ${detail}` : ''}`)
}

/**
 * 配信タグ（ignition URL）の本文から ai_chats の中身を取り出す。
 *
 * Why: 管理画面のページから fetch すると CORS で弾かれる。配信タグは誰でも取れる
 * 静的なレスポンスなので、about:blank の素のページから取りに行く。
 */
const fetchAiChats = async (context, productId) => {
  const url = `${env.ignitionBase}?aid=${env.accountId}&pid=${productId}`
  const page = await context.newPage()
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
    if (!response || !response.ok()) {
      return { error: `配信タグが ${response?.status() ?? '応答なし'}` }
    }
    const body = await response.text()

    const marker = body.indexOf('"ai_chats"')
    if (marker < 0) return { chats: [], note: 'ai_chats のキーが無い' }

    const start = body.indexOf('[', marker)
    if (start < 0) return { chats: [], note: 'ai_chats の配列が無い' }
    let depth = 0
    let end = -1
    for (let i = start; i < body.length; i++) {
      if (body[i] === '[') depth++
      else if (body[i] === ']') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end < 0) return { chats: [], note: 'ai_chats の配列が閉じていない' }

    const raw = body.slice(start, end + 1)
    try {
      return { chats: JSON.parse(raw), raw }
    } catch {
      return { chats: null, raw: raw.slice(0, 200) }
    }
  } finally {
    await page.close()
  }
}

const main = async () => {
  const { browser, context } = await launchBrowser({
    credentials: credentials.manage,
    headless,
  })
  await blockSelfGuides(context, envKey)
  const page = await context.newPage()

  try {
    console.log(`\n[1] 管理画面（${env.manageHost}）`)
    await loginToManage(page, credentials.manage)
    record(true, 'ログイン')

    for (const product of Object.values(env.products)) {
      console.log(`\n[2] AIチャット一覧 — ${product.label}（pid=${product.productId}）`)
      await page.goto(new URL('/ai/chats', credentials.manage.url).href, {
        waitUntil: 'domcontentloaded',
      })
      await page.waitForLoadState('networkidle')
      await switchToProduct(page, product, env.accountName)
      await page.waitForTimeout(2500)

      const shot = path.join(outDir, `ai-chats_${product.key}.png`)
      await page.screenshot({ path: shot, fullPage: true })

      const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
      record(true, '画面の文言（先頭200字）', bodyText.slice(0, 200))
      console.log(`      スクリーンショット: ${shot}`)

      const chatLinks = await page
        .locator('a[href*="/ai/chats/"]')
        .evaluateAll((nodes) =>
          nodes
            .map((n) => ({
              href: n.getAttribute('href') ?? '',
              text: (n.textContent ?? '').trim().slice(0, 40),
            }))
            .filter((item) => /\/ai\/chats\/[0-9a-f]{8,}/.test(item.href))
        )
      const unique = [...new Map(chatLinks.map((c) => [c.href, c])).values()]
      record(
        unique.length > 0,
        `AIチャットの登録数: ${unique.length} 件`,
        unique.map((c) => c.text).join(' / ').slice(0, 120)
      )
    }

    console.log('\n[3] 配信タグの ai_chats')
    for (const product of Object.values(env.products)) {
      const { chats, error, note, raw } = await fetchAiChats(context, product.productId)
      const label = `${product.label}（pid=${product.productId}）`
      if (error) {
        record(false, label, error)
        continue
      }
      if (chats === null) {
        record(false, label, `JSON として読めない: ${raw}`)
        continue
      }
      if (chats.length === 0) {
        record(
          false,
          label,
          note ?? 'ai_chats が空（AI利用フラグ無効 / 未公開 / 上限到達のいずれか）'
        )
        continue
      }
      record(true, label, `${chats.length} 件`)
      record(
        chats.every((c) => c?.trigger?.mobile_ui_type !== undefined),
        '  mobile_ui_type',
        chats.map((c) => c?.trigger?.mobile_ui_type ?? '(無し)').join(',')
      )
      record(
        true,
        '  window.shortcuts',
        chats.map((c) => (c?.window?.shortcuts ? 'あり' : 'なし')).join(',')
      )
    }
  } finally {
    await browser.close()
  }

  const ng = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - ng}/${results.length} 件 OK`)
  console.log(`成果物: ${outDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
