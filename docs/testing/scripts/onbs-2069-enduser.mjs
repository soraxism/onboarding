/**
 * ONBS-2069 エンドユーザー側の確認。
 *
 * デモサイトをスマートフォンとして開き、配信された ai_chats と
 * 新UI（下部フローティング）の挙動を確かめる。
 *
 * 新旧どちらの配信 JS でも同じ結果になることを見るため、legacy / next の両方で回す。
 *
 *   node docs/testing/scripts/onbs-2069-enduser.mjs [--product legacy|next|both] [--headed]
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadPlaywright, loadCredentials, ARTIFACT_DIR } from './lib/env.mjs'
import { getEnv } from './lib/manage.mjs'

const envKey = 'dev'
const headless = !process.argv.includes('--headed')
const productArg = process.argv.includes('--product')
  ? process.argv[process.argv.indexOf('--product') + 1]
  : 'both'
// 検証用AIチャットの表示条件（user_id の一致）に合わせる
const userId = process.argv.includes('--user-id')
  ? process.argv[process.argv.indexOf('--user-id') + 1]
  : '1'

const env = getEnv(envKey)
const credentials = loadCredentials(envKey)

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const outDir = path.join(ARTIFACT_DIR, `${stamp}_onbs-2069-enduser`)
fs.mkdirSync(outDir, { recursive: true })

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`  ${ok ? 'OK ' : 'NG '} ${label}${detail ? ` — ${detail}` : ''}`)
}

const SHADOW_HOST = 'onb-ai-chat-app'

/** Shadow DOM の中を覗く。AI チャットは shadow root 配下に描画される */
const inShadow = (page, selector) =>
  page.evaluate(
    ([hostId, target]) => {
      const root = document.getElementById(hostId)?.shadowRoot
      const el = root?.querySelector(target)
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return {
        text: (el.textContent ?? '').trim().slice(0, 60),
        top: Math.round(rect.top),
        height: Math.round(rect.height),
        visible: rect.height > 0 && rect.width > 0,
      }
    },
    [SHADOW_HOST, selector]
  )

const clickInShadow = (page, selector) =>
  page.evaluate(
    ([hostId, target]) => {
      const root = document.getElementById(hostId)?.shadowRoot
      const el = root?.querySelector(target)
      if (!el) return false
      el.click()
      return true
    },
    [SHADOW_HOST, selector]
  )

const run = async (product) => {
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
  const page = await context.newPage()


  const shot = async (name) => {
    const file = path.join(outDir, `${product.key}_${name}.png`)
    await page.screenshot({ path: file })
    return file
  }

  try {
    console.log(`\n=== ${product.label}（pid=${product.productId}）===`)
    // Why: 検証用のAIチャットは表示条件に user_id の一致を要求する。
    // クエリを付けないとマウント対象が無く、何も確認できない
    const url = new URL(product.demoUrl)
    url.searchParams.set('user_id', userId)
    await page.goto(url.href, { waitUntil: 'load' })
    await page.waitForFunction(() => typeof window.STANDSUnit !== 'undefined', {
      timeout: 30000,
    })
    // AI チャットのマウントは表示条件の評価後なので、少し待つ
    await page.waitForTimeout(6000)

    // 配信データは XHR ではなく配信JSと一体で返り、res_data の中に入る
    const aiChats = await page.evaluate(
      () => window.STANDSUnit?.responseData?.res_data?.ai_chats ?? null
    )
    record(aiChats !== null, '配信データの ai_chats を取得')
    if (aiChats) {
      record(aiChats.length > 0, `ai_chats: ${aiChats.length} 件`)
      for (const chat of aiChats) {
        const t = chat.trigger ?? {}
        const w = chat.window ?? {}
        record(
          t.mobile_ui_type !== undefined,
          `  ${t.text ?? ''} mobile_ui_type=${t.mobile_ui_type ?? '(無し)'}`,
          `is_hidden=${t.is_hidden} / shortcuts=${w.shortcuts ? `${w.shortcuts.items?.length ?? 0}件(enabled=${w.shortcuts.enabled})` : 'なし'}`
        )
      }
    }

    const host = await page.evaluate(
      (id) => Boolean(document.getElementById(id)),
      SHADOW_HOST
    )
    record(host, 'AIチャットがマウントされている')
    if (!host) return

    // --- ページトップ: フローティングは出ない ---
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(800)
    const atTop = await inShadow(page, '.floating')
    record(atTop === null, '3-1 ページトップではフローティングが出ない')
    await shot('01-top')

    // --- 100px 超スクロール: 出る ---
    await page.evaluate(() => window.scrollTo(0, 400))
    await page.waitForTimeout(1200)
    const scrolled = await inShadow(page, '.floating')
    record(scrolled?.visible === true, '3-2 スクロールするとフローティングが出る',
      scrolled ? `top=${scrolled.top} height=${scrolled.height}` : '出ない')
    await shot('02-scrolled')

    const chip = await inShadow(page, '.floating__chip')
    const message = await inShadow(page, '.floating__message')
    record(
      Boolean(chip || message),
      chip ? '3-7 初回選択肢が表示される' : '3-11 最初のメッセージが1行表示される',
      (chip ?? message)?.text ?? ''
    )

    if (chip) {
      // --- 横スクロールと端のぼかし ---
      const edges = () =>
        page.evaluate((id) => {
          const root = document.getElementById(id)?.shadowRoot
          const body = root?.querySelector('.floating__body')
          const scroller = root?.querySelector('.floating__scroller')
          if (!body || !scroller) return null
          return {
            start: body.classList.contains('is-start-faded'),
            end: body.classList.contains('is-end-faded'),
            scrollLeft: Math.round(scroller.scrollLeft),
            clientWidth: scroller.clientWidth,
            scrollWidth: scroller.scrollWidth,
          }
        }, SHADOW_HOST)

      const chipCount = await page.evaluate(
        (id) => document.getElementById(id)?.shadowRoot?.querySelectorAll('.floating__chip').length ?? 0,
        SHADOW_HOST
      )
      record(chipCount > 0, `3-7 初回選択肢の件数: ${chipCount} 件`)

      const atStart = await edges()
      record(
        atStart?.scrollWidth > atStart?.clientWidth,
        '  横スクロールできる状態',
        atStart ? `scrollWidth=${atStart.scrollWidth} > clientWidth=${atStart.clientWidth}` : ''
      )
      record(
        atStart?.start === false && atStart?.end === true,
        '3-8 始端では右端だけがぼける',
        `start=${atStart?.start} end=${atStart?.end}`
      )

      // 中間まで送る
      await page.evaluate((id) => {
        const el = document.getElementById(id)?.shadowRoot?.querySelector('.floating__scroller')
        if (el) el.scrollLeft = Math.floor((el.scrollWidth - el.clientWidth) / 2)
      }, SHADOW_HOST)
      await page.waitForTimeout(800)
      const atMiddle = await edges()
      record(
        atMiddle?.start === true && atMiddle?.end === true,
        '3-9 中間では両端がぼける',
        `start=${atMiddle?.start} end=${atMiddle?.end}`
      )
      await shot('02b-fade-middle')

      // 終端まで送る
      await page.evaluate((id) => {
        const el = document.getElementById(id)?.shadowRoot?.querySelector('.floating__scroller')
        if (el) el.scrollLeft = el.scrollWidth
      }, SHADOW_HOST)
      await page.waitForTimeout(800)
      const atEnd = await edges()
      record(
        atEnd?.start === true && atEnd?.end === false,
        '3-10 終端では左端だけがぼける',
        `start=${atEnd?.start} end=${atEnd?.end}`
      )
      await shot('02c-fade-end')

      // 始端へ戻す（この後のクリック確認のため）
      await page.evaluate((id) => {
        const el = document.getElementById(id)?.shadowRoot?.querySelector('.floating__scroller')
        if (el) el.scrollLeft = 0
      }, SHADOW_HOST)
      await page.waitForTimeout(600)

      // --- 初回選択肢の押下で開いて送信される ---
      const chipText = chip.text
      await clickInShadow(page, '.floating__chip')
      await page.waitForTimeout(2500)
      const openedByChip = await inShadow(page, '.window.is-bottom-sheet')
      record(openedByChip?.visible === true, '3-16 初回選択肢の押下でチャットが開く')
      const bodyText = await page.evaluate(
        (id) => document.getElementById(id)?.shadowRoot?.querySelector('.windowBody')?.textContent ?? '',
        SHADOW_HOST
      )
      record(
        bodyText.includes(chipText.slice(0, 10)),
        '3-16 押した内容が送信される',
        `履歴に「${chipText.slice(0, 16)}」${bodyText.includes(chipText.slice(0, 10)) ? 'あり' : 'なし'}`
      )
      await shot('02d-chip-sent')

      // 閉じて元の状態へ戻す
      await clickInShadow(page, '.windowHandle')
      await page.waitForTimeout(1800)
    }

    // --- ページ最下段: 消える ---
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(1200)
    const atBottom = await inShadow(page, '.floating')
    record(atBottom === null, '3-3 ページ最下段ではフローティングが消える')
    await shot('03-bottom')

    // --- 戻ると再表示 ---
    await page.evaluate(() => window.scrollTo(0, 400))
    await page.waitForTimeout(1200)
    record((await inShadow(page, '.floating'))?.visible === true, '3-4 戻ると再表示される')

    // --- ハンドルバーで開く ---
    await clickInShadow(page, '.floating__handle')
    await page.waitForTimeout(1500)
    const sheet = await inShadow(page, '.window.is-bottom-sheet')
    const handle = await inShadow(page, '.windowHandle')
    const overlay = await inShadow(page, '.overlay')
    record(sheet?.visible === true, '3-15 ハンドルバー押下でチャットが開く',
      sheet ? `top=${sheet.top}` : '開かない')
    record(handle?.visible === true, '3-22 ボトムシート（上端にハンドルバー）')
    record(overlay?.visible === true, '3-23 オーバーレイが入る')
    record((await inShadow(page, '.floating')) === null, '開いている間はフローティングを出さない')
    await shot('04-opened')

    const overlayColor = await page.evaluate((id) => {
      const el = document.getElementById(id)?.shadowRoot?.querySelector('.overlay')
      return el ? getComputedStyle(el).backgroundColor : ''
    }, SHADOW_HOST)
    record(overlayColor === 'rgba(0, 0, 0, 0.4)', 'オーバーレイの濃度', overlayColor)

    // --- ハンドルバーで閉じる ---
    await clickInShadow(page, '.windowHandle')
    await page.waitForTimeout(1500)
    record((await inShadow(page, '.windowHeader')) === null, '3-18 ハンドルバー押下でチャットが閉じる')
    record((await inShadow(page, '.floating'))?.visible === true, '3-21 閉じるとフローティングに戻る')
    await shot('05-closed')
  } catch (error) {
    record(false, '実行中の例外', String(error).slice(0, 160))
  } finally {
    await browser.close()
  }
}

const main = async () => {
  const targets =
    productArg === 'both'
      ? Object.values(env.products)
      : [env.products[productArg]].filter(Boolean)
  if (targets.length === 0) throw new Error('--product は legacy|next|both')

  for (const product of targets) await run(product)

  const ng = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - ng}/${results.length} 件 OK`)
  console.log(`成果物: ${outDir}`)
  if (ng > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
