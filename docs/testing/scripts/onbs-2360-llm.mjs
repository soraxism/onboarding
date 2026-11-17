/**
 * ONBS-2360 の確認: AI チャットの AI モデルに gpt-6.1-terra（推論あり／なし）を足し、既定を推論なしにした。
 *
 * 検証用プロダクトに AI チャットを 1 件作り、AI モデルを切り替えながら次を確かめる。
 * 項目番号はドキュメントリポジトリの docs/features/ONBS-2360/2026-11-17_test-checklist.md の dev 節。
 *
 * - D11 新規作成したチャットの AI モデルが「gpt-6.1-terra（推論なし）」で、設定に reasoning_effort: none が入る
 * - D1  選択肢の並び
 * - D3/D4 選んだモデルが保存され、再読み込み後も選ばれている（チャット詳細 API の data.llm で確かめる）
 * - D5〜D8 プレビューから質問して応答が返る（OpenAI に渡した値は AI-API のログで別途照合する）
 *
 *   node docs/testing/scripts/onbs-2360-llm.mjs [--product next|legacy] [--chat <チャットID>] [--headed]
 *   node docs/testing/scripts/onbs-2360-llm.mjs --chat <チャットID> --enduser
 *   node docs/testing/scripts/onbs-2360-llm.mjs --chat <チャットID> --dify
 *   node docs/testing/scripts/onbs-2360-llm.mjs --cleanup
 *
 * `--enduser`（D9）: 推論ありにして表示条件を `user_id=onbs2360` に絞って公開し、デモサイトから質問する。
 * 公開済みの設定を読む経路（AI-API の userEnv=prod）を通すため。他の人のデモ表示に出ないよう条件で絞る。
 * `--dify`（D10）: Dify 連携をダミーの API キーで保存してからオフに戻し、既定モデル（推論なし）に戻ることを見る。
 * Dify へは質問しない（API キーはダミー）。
 *
 * dev は他の人も使うため、名前は `[自動検証] ` で始め、確認が終わったら `--cleanup` で消す。
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
  buildTourName,
} from './lib/manage.mjs'

const envKey = 'dev'
const headless = !process.argv.includes('--headed')
const cleanup = process.argv.includes('--cleanup')
const probe = process.argv.includes('--probe')
const enduser = process.argv.includes('--enduser')
const dify = process.argv.includes('--dify')
// 表示条件。デモサイトをこのクエリ付きで開いたときだけ出る
const DEMO_USER_ID = 'onbs2360'
const productKey = process.argv.includes('--product')
  ? process.argv[process.argv.indexOf('--product') + 1]
  : 'next'

const env = getEnv(envKey)
const credentials = loadCredentials(envKey)
const product = env.products[productKey]
if (!product) throw new Error('--product は next|legacy')

const CHAT_NAME = buildTourName('ONBS-2360', 'LLM')
// 作成済みのチャットを使い回す（作り直すと検証用のチャットが増えるため）
const reuseChatId = process.argv.includes('--chat')
  ? process.argv[process.argv.indexOf('--chat') + 1]
  : null

/** 画面の表記（manage-web の toLLMModelLabel と同じ規則） */
const toLabel = (m) =>
  !m.reasoning_effort ? m.model : `${m.model}（${m.reasoning_effort === 'none' ? '推論なし' : '推論あり'}）`

/** 保存されるはずの settings.llm（推論の度合いが空のモデルは model だけ） */
const toLlm = (m) => (m.reasoning_effort ? { model: m.model, reasoning_effort: m.reasoning_effort } : { model: m.model })

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const outDir = path.join(ARTIFACT_DIR, `${stamp}_onbs-2360`)
fs.mkdirSync(outDir, { recursive: true })

const log = (message) => console.log(`  ${message}`)
const results = []
const record = (id, ok, detail) => {
  results.push({ id, ok, detail })
  log(`${ok ? 'OK ' : 'NG '} ${id} — ${detail}`)
}

/**
 * プロダクトを切り替えてから目的のページへ移る。
 *
 * Why: 先にページを開いてから切り替えると、切替の再読み込みでダッシュボードへ流される。
 */
const gotoWithProduct = async (page, pathname) => {
  await page.goto(new URL('/guides', credentials.manage.url).href, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await switchToProduct(page, product, env.accountName)
  await page.goto(new URL(pathname, credentials.manage.url).href, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(2500)
}

/**
 * チャット詳細を開き、詳細取得 API のレスポンスを返す。
 *
 * Why: 保存された設定（settings.llm）は画面に出ない。画面が受け取ったレスポンスで確かめる
 */
const openChat = async (page, chatId) => {
  const responsePromise = page.waitForResponse(
    (res) =>
      res.request().method() === 'GET' &&
      // ページ自体（/ai/chats/{id}）ではなく API（/v1/products/{pid}/chats/{id}）を拾う
      new RegExp(`/v1/products/\\d+/chats/${chatId}(\\?|$)`).test(res.url()),
    { timeout: 30000 }
  )
  await page.goto(new URL(`/ai/chats/${chatId}`, credentials.manage.url).href, {
    waitUntil: 'domcontentloaded',
  })
  const body = await (await responsePromise).json()
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(2500)
  return body
}

const modelSelector = (page) => page.locator('.c-dropdownSelect__selector').first()

const probePage = async (page) => {
  await page.screenshot({ path: path.join(outDir, 'probe-edit.png'), fullPage: true })
  const info = await page.evaluate(() => {
    const hosts = [...document.querySelectorAll('*')]
      .filter((el) => el.shadowRoot)
      .map((el) => ({
        tag: el.tagName,
        id: el.id,
        cls: el.className?.toString?.() ?? '',
        inner: [...el.shadowRoot.querySelectorAll('textarea, input, button')]
          .slice(0, 15)
          .map((n) => `${n.tagName}.${n.className}[${n.getAttribute('placeholder') ?? n.textContent?.trim().slice(0, 20) ?? ''}]`),
      }))
    const iframes = [...document.querySelectorAll('iframe')].map((f) => f.src || f.id)
    return { hosts, iframes, url: location.href }
  })
  console.log(JSON.stringify(info, null, 2))
}

const doCleanup = async (page) => {
  await gotoWithProduct(page, '/ai/chats')
  const isTarget = (t) => t.startsWith('[自動検証] ONBS-2360')

  // 公開中のものは削除できないため、先に下書きへ戻す
  for (;;) {
    const active = page.locator('li.listDataRow', { hasText: '[自動検証] ONBS-2360' }).filter({ hasText: 'アクティブ' }).first()
    if ((await active.count()) === 0) break
    await active.locator('.listDataColumn', { hasText: '[自動検証] ONBS-2360' }).first().click()
    await page.waitForURL(/\/ai\/chats\/[0-9a-f]{8,}/, { timeout: 30000 })
    await page.waitForTimeout(2500)
    // Why: 未公開の変更があると「下書きにする」は公開ボタン横のメニューに隠れる。見えなければ開いてから探す
    let toDraft = page.getByRole('button', { name: /下書きにする/ }).first()
    if (!(await toDraft.isVisible().catch(() => false))) {
      const headerButtons = page.locator('header, [class*="Header" i]').first().locator('button')
      const n = await headerButtons.count()
      if (n > 0) await headerButtons.nth(n - 1).click()
      await page.waitForTimeout(1500)
      toDraft = page.getByText(/下書きにする/).first()
    }
    await toDraft.click()
    await page.waitForTimeout(1200)
    const confirm = page.getByRole('button', { name: /下書きにする|はい|OK/ }).last()
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await page.waitForTimeout(2500)
    log('下書きに戻した')
    await gotoWithProduct(page, '/ai/chats')
  }

  // 同じ名前のチャットが複数あることがあるため、名前ではなく行ごとにチェックを入れる
  const rows = page.locator('li.listDataRow').filter({ hasText: '[自動検証] ONBS-2360' })
  const count = await rows.count()
  if (count === 0) {
    log('消す対象はない')
    return
  }
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i)
    const name = (await row.locator('.listDataColumn').first().innerText()).trim()
    if (!isTarget(name)) continue
    const input = row.locator('input[type="checkbox"]').first()
    const label = row.locator('label').first()
    if (await label.isVisible().catch(() => false)) await label.click()
    await page.waitForTimeout(500)
    if (!(await input.isChecked().catch(() => false))) await input.check({ force: true })
  }
  log(`消す対象: ${count} 件`)
  await page.getByRole('button', { name: /削除/ }).first().click()
  await page.waitForTimeout(1200)
  const confirm = page.getByRole('button', { name: /削除する|はい|OK/ }).last()
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await page.waitForTimeout(2500)
  await gotoWithProduct(page, '/ai/chats')
  const left = await page.locator('li.listDataRow').filter({ hasText: '[自動検証] ONBS-2360' }).count()
  await page.screenshot({ path: path.join(outDir, 'cleanup.png'), fullPage: true })
  log(`削除した（残り ${left} 件）`)
}

const createChat = async (page) => {
  await gotoWithProduct(page, '/ai/chats')
  await page.getByRole('button', { name: /作成する/ }).click()
  await page.waitForURL(/\/ai\/chats\/[0-9a-f]{8,}/, { timeout: 30000 })
  await page.waitForTimeout(2500)
  const chatId = page.url().match(/\/ai\/chats\/([0-9a-f]+)/)?.[1] ?? ''
  log(`チャットID: ${chatId}`)

  await page.getByText('名称未設定').first().click()
  await page.waitForTimeout(800)
  const nameInput = page.locator('input:visible').first()
  await nameInput.fill(CHAT_NAME)
  await nameInput.press('Enter')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.waitForTimeout(1500)

  const prompt = page.getByPlaceholder(/命令文/).first()
  if (await prompt.isVisible().catch(() => false)) {
    await prompt.fill('ONBS-2360 の動作確認用です。質問には 1 文で簡潔に答えてください。')
    await prompt.blur()
    await page.waitForTimeout(1500)
  }
  return chatId
}

const sameLlm = (actual, expected) => JSON.stringify(actual ?? {}) === JSON.stringify(expected)

/**
 * プレビューのチャット欄（shadow DOM の中）にあるボットの吹き出し。
 *
 * Why: エラーの文言（`.error`）は応答の有無にかかわらず DOM にあり、見た目では判定できない。
 * エラーは WebSocket の受信内容で判定し、ここでは応答の本文だけを読む
 */
const previewState = (page) =>
  page.evaluate(() => {
    const root = document.getElementById('onb-ai-chat-app-manage')?.shadowRoot
    if (!root) return { bots: [] }
    return { bots: [...root.querySelectorAll('[class*="historyItemBot__body"]')].map((n) => n.innerText.trim()) }
  })

/**
 * プレビューから質問を送り、応答が出そろうまで待つ。
 *
 * Why: 応答はストリーミングで少しずつ届く。最後の吹き出しが 4 秒変わらなくなったら届き終えたとみなす
 */
const askInPreview = async (page, question) => {
  const before = (await previewState(page)).bots.length
  // Playwright の CSS ロケータは open な shadow root の中まで届く
  await page.locator('#onb-ai-chat-app-manage textarea').first().fill(question)
  await page.locator('#onb-ai-chat-app-manage button', { hasText: '送信' }).first().click()
  const started = Date.now()
  let last = ''
  let stableSince = Date.now()
  let state = { bots: [] }
  while (Date.now() - started < 120000) {
    await page.waitForTimeout(1000)
    state = await previewState(page)
    const answer = state.bots.length > before ? state.bots.at(-1) : ''
    if (answer !== last) {
      last = answer
      stableSince = Date.now()
    } else if (answer && Date.now() - stableSince > 4000) {
      break
    }
  }
  return { answer: last, seconds: Math.round((Date.now() - started) / 1000) }
}

const selectModel = async (page, label) => {
  await modelSelector(page).scrollIntoViewIfNeeded()
  await modelSelector(page).click()
  await page.waitForTimeout(800)
  const saved = page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && /\/provider_code/.test(res.url()),
    { timeout: 30000 }
  )
  await page.locator('.c-dropdownSelect__item', { hasText: new RegExp(`^${label.replace(/[()（）.]/g, '\\$&')}$`) }).first().click()
  const res = await saved
  return { status: res.status(), body: res.request().postDataJSON() }
}

const verifyModels = async (page, chatId, wsFrames, llmModels) => {
  // 選択肢に出るのは利用可能なモデルだけ（dev では gpt-4.1 等が利用不可になっている）。並びは priority 昇順
  const available = llmModels.filter((m) => m.is_available).sort((a, b) => a.priority - b.priority)
  const EXPECTED_ORDER = available.map(toLabel)
  // 既定（推論なし）以外を順に選び、最後に既定へ戻して終える
  const defaultModel = available.find((m) => m.default_flag)
  const TARGETS = [...available.filter((m) => m !== defaultModel), defaultModel]
    .filter(Boolean)
    .map((m) => ({ label: toLabel(m), llm: toLlm(m) }))
  log(`利用不可のため確かめないモデル: ${llmModels.filter((m) => !m.is_available).map(toLabel).join(' / ') || 'なし'}`)

  // --- D1 選択肢の並び ---
  await modelSelector(page).scrollIntoViewIfNeeded()
  await modelSelector(page).click()
  await page.waitForTimeout(800)
  const options = (await page.locator('.c-dropdownSelect__item').allInnerTexts()).map((t) => t.trim())
  await page.screenshot({ path: path.join(outDir, 'd1-options.png'), fullPage: false })
  await page.keyboard.press('Escape')
  await modelSelector(page).click().catch(() => {})
  await page.waitForTimeout(500)
  record('D1', JSON.stringify(options) === JSON.stringify(EXPECTED_ORDER), options.join(' / '))

  for (const [index, target] of TARGETS.entries()) {
    log(`--- ${target.label} ---`)
    // 画面を開き直して、開いたままのドロップダウン等の影響を消す
    await openChat(page, chatId)
    const saved = await selectModel(page, target.label)
    const detail = await openChat(page, chatId)
    const shown = (await modelSelector(page).innerText()).trim()
    record(
      `保存 ${target.label}`,
      saved.status === 200 && sameLlm(detail.data?.llm, target.llm) && shown === target.label,
      `PATCH ${saved.status} options=${JSON.stringify(saved.body?.options)} / 再読み込み後の表示「${shown}」 / data.llm=${JSON.stringify(detail.data?.llm)}`
    )

    const framesBefore = wsFrames.length
    const { answer, seconds } = await askInPreview(page, `動作確認${index + 1}: 日本の首都はどこですか？`)
    await page.screenshot({ path: path.join(outDir, `answer-${index + 1}.png`), fullPage: false })
    const frames = wsFrames.slice(framesBefore)
    fs.writeFileSync(path.join(outDir, `ws-${index + 1}.json`), JSON.stringify(frames, null, 2))
    const errors = frames.filter((f) => /error|Error|"status":\s*[45]\d\d/.test(f))
    record(
      `応答 ${target.label}`,
      answer.length > 0 && errors.length === 0,
      `${seconds}秒「${answer.slice(0, 80)}」 / 受信 ${frames.length} 件${errors.length ? ` / エラー: ${errors.join(' | ').slice(0, 300)}` : ''}`
    )
  }
}

/** 管理画面が API へ送る認証ヘッダーを控える（表示条件の更新に使う） */
const captureApi = (page) => {
  const api = { base: null, headers: null }
  page.on('request', async (req) => {
    const m = req.url().match(/^(https:\/\/[^/]+\/v1\/products\/\d+)\/chats/)
    // Why: プリフライト（OPTIONS）には認証ヘッダーが無い。GET から拾う
    if (m && req.method() === 'GET' && !api.headers) {
      api.base = m[1]
      api.headers = await req.allHeaders()
    }
  })
  return api
}

/** 公開する（ヘッダーの「公開する」→ 公開設定モーダルの「公開する」） */
const publish = async (page) => {
  await page.getByRole('button', { name: /公開する/ }).first().click()
  await page.waitForTimeout(1500)
  const confirm = page.getByRole('button', { name: /公開する|はい|OK/ }).last()
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await page.waitForTimeout(3000)
}

const verifyEnduser = async (page, chatId, api, context) => {
  log('--- D9 公開してデモサイトから質問 ---')
  let detail = await openChat(page, chatId)
  const target = { label: 'gpt-6.1-terra（推論あり）', llm: { model: 'gpt-6.1-terra', reasoning_effort: 'medium' } }
  if (!sameLlm(detail.data?.llm, target.llm)) await selectModel(page, target.label)

  const conditions = [
    { type: 'Parameter', items: [{ key: 'user_id', value: DEMO_USER_ID, comparison_option: 'match' }], operator: 'and' },
  ]
  const res = await context.request.patch(`${api.base}/chats/${chatId}/display_setting`, {
    headers: { ...api.headers, 'content-type': 'application/json' },
    data: { name: '', operator: 'and', conditions },
  })
  log(`表示条件 user_id=${DEMO_USER_ID}: PATCH ${res.status()}`)
  if (res.status() !== 200) throw new Error(`表示条件を更新できない: ${await res.text()}`)

  await openChat(page, chatId)
  await publish(page)
  detail = await openChat(page, chatId)
  log(`公開状態: ${detail.data?.status} / data.llm=${JSON.stringify(detail.data?.llm)}`)
  await page.screenshot({ path: path.join(outDir, 'd9-published.png') })
  if (detail.data?.status !== 'published') throw new Error('公開できていない')

  // --- デモサイト ---
  const { browser } = await launchBrowser({ credentials: credentials.manage, headless })
  const demoContext = await browser.newContext({
    httpCredentials: { username: credentials.demo.basicId, password: credentials.demo.basicPw },
    locale: 'ja-JP',
    viewport: { width: 1440, height: 900 },
  })
  const demo = await demoContext.newPage()
  const frames = []
  demo.on('websocket', (ws) =>
    ws.on('framereceived', (f) => typeof f.payload === 'string' && frames.push(f.payload.slice(0, 500)))
  )
  try {
    const url = new URL(product.demoUrl)
    url.searchParams.set('user_id', DEMO_USER_ID)
    await demo.goto(url.href, { waitUntil: 'load' })
    await demo.waitForFunction(() => typeof window.STANDSUnit !== 'undefined', { timeout: 30000 })
    await demo.waitForTimeout(6000)
    const aiChats = await demo.evaluate(() => window.STANDSUnit?.responseData?.res_data?.ai_chats ?? [])
    const mine = aiChats.find((c) => c.id === chatId || c.chat_setting_id === chatId)
    log(`配信された ai_chats: ${aiChats.length} 件（このチャット: ${mine ? 'あり' : 'なし'}）`)
    await demo.screenshot({ path: path.join(outDir, 'd9-demo-top.png') })
    const buttons = await demo.evaluate(() =>
      [...(document.getElementById('onb-ai-chat-app')?.shadowRoot?.querySelectorAll('button, [role="button"]') ?? [])]
        .map((b) => `${b.className}::${(b.textContent ?? '').trim().slice(0, 20)}`)
    )
    log(`ランチャー候補: ${buttons.join(' | ')}`)
    if (probe) return

    // ランチャーを押してチャット欄を開く
    await demo.locator('#onb-ai-chat-app [class*="trigger"], #onb-ai-chat-app [class*="launcher"]').first().click()
    await demo.waitForTimeout(2000)
    const textarea = demo.locator('#onb-ai-chat-app textarea').first()
    await textarea.fill('動作確認D9: 日本の首都はどこですか？')
    await demo.locator('#onb-ai-chat-app button', { hasText: '送信' }).first().click()
    const started = Date.now()
    let answer = ''
    let stableSince = Date.now()
    while (Date.now() - started < 120000) {
      await demo.waitForTimeout(1000)
      const now = await demo.evaluate(() =>
        [...(document.getElementById('onb-ai-chat-app')?.shadowRoot?.querySelectorAll('[class*="historyItemBot__body"]') ?? [])]
          .map((n) => n.innerText.trim())
          .at(-1) ?? ''
      )
      if (now !== answer) {
        answer = now
        stableSince = Date.now()
      } else if (answer && frames.some((f) => f.includes('end_of_message')) && Date.now() - stableSince > 3000) {
        break
      }
    }
    await demo.screenshot({ path: path.join(outDir, 'd9-demo-answer.png') })
    fs.writeFileSync(path.join(outDir, 'ws-d9.json'), JSON.stringify(frames, null, 2))
    const errors = frames.filter((f) => /error|Error|"status":\s*[45]\d\d/.test(f))
    record(
      'D9',
      answer.length > 0 && frames.some((f) => f.includes('end_of_message')) && errors.length === 0,
      `デモサイトで「${answer.slice(0, 80)}」 / 受信 ${frames.length} 件${errors.length ? ` / エラー: ${errors.join(' | ').slice(0, 300)}` : ''}`
    )
  } finally {
    await browser.close()
  }
}

const verifyDify = async (page, chatId) => {
  log('--- D10 Dify 連携をオン → オフ ---')
  const saveDify = async () => {
    const saved = page.waitForResponse(
      (res) => res.request().method() === 'PATCH' && /\/provider_code/.test(res.url()),
      { timeout: 30000 }
    )
    // Dify の欄が最初のカードなので、最初の「保存」が Dify のもの
    await page.getByRole('button', { name: '保存', exact: true }).first().click()
    const res = await saved
    return { status: res.status(), body: res.request().postDataJSON() }
  }

  await openChat(page, chatId)
  await page.getByText('外部連携', { exact: true }).first().click()
  await page.waitForTimeout(2500)
  await page.locator('label.toggleSwitch').first().click()
  await page.waitForTimeout(1500)
  await page.getByPlaceholder(/^app-x+$/).fill('app-onbs2360dummy00000000000') // 形式（app- ＋ 24 文字）だけ満たすダミー
  // アプリ名（最初の入力欄）も埋める。空だと保存できないことがある
  const appName = page.locator('input[type="text"]:visible').first()
  if (!(await appName.inputValue())) await appName.fill('[自動検証] ONBS-2360')
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(outDir, 'd10-dify-on-before-save.png'), fullPage: true })
  const on = await saveDify()
  log(`オン: PATCH ${on.status} provider_code=${on.body?.provider_code}`)

  await openChat(page, chatId)
  await page.getByText('外部連携', { exact: true }).first().click()
  await page.waitForTimeout(2500)
  await page.locator('label.toggleSwitch').first().click()
  await page.waitForTimeout(1500)
  const off = await saveDify()
  const detail = await openChat(page, chatId)
  const shown = (await modelSelector(page).innerText()).trim()
  await page.screenshot({ path: path.join(outDir, 'd10-dify-off.png'), fullPage: true })
  const expected = { model: 'gpt-6.1-terra', reasoning_effort: 'none' }
  record(
    'D10',
    on.status === 200 && on.body?.provider_code === 'dify' && off.status === 200 &&
      sameLlm(off.body?.options, expected) && sameLlm(detail.data?.llm, expected) && shown === 'gpt-6.1-terra（推論なし）',
    `オフの PATCH ${off.status} options=${JSON.stringify(off.body?.options)} / 表示「${shown}」 / data.llm=${JSON.stringify(detail.data?.llm)} / provider_code=${detail.data?.provider_code}`
  )
}

const main = async () => {
  const { browser, context } = await launchBrowser({ credentials: credentials.manage, headless })
  await blockSelfGuides(context, envKey)
  const page = await context.newPage()
  try {
    await loginToManage(page, credentials.manage)
    log(`ログイン / 対象: ${product.label}（pid=${product.productId}）`)
    if (cleanup) {
      await doCleanup(page)
      return
    }
    // AI チャットの通信（WebSocket）の受信内容を控え、エラーが返っていないかを見る
    const wsFrames = []
    page.on('websocket', (ws) => {
      ws.on('framereceived', (frame) => {
        if (typeof frame.payload === 'string') wsFrames.push(frame.payload.slice(0, 500))
      })
    })

    const api = captureApi(page)
    if (reuseChatId) {
      await gotoWithProduct(page, '/ai/chats')
      const reused = await openChat(page, reuseChatId)
      if (enduser) {
        await verifyEnduser(page, reuseChatId, api, context)
        return
      }
      if (dify) {
        await verifyDify(page, reuseChatId)
        return
      }
      await verifyModels(page, reuseChatId, wsFrames, reused.llm_models)
      return
    }
    const chatId = await createChat(page)
    const detail = await openChat(page, chatId)
    record(
      'D11',
      (await modelSelector(page).innerText()).trim() === 'gpt-6.1-terra（推論なし）' &&
        detail.data?.llm?.model === 'gpt-6.1-terra' &&
        detail.data?.llm?.reasoning_effort === 'none',
      `表示「${(await modelSelector(page).innerText()).trim()}」 / data.llm=${JSON.stringify(detail.data?.llm)}`
    )
    if (probe) {
      await probePage(page)
      return
    }
    await verifyModels(page, chatId, wsFrames, detail.llm_models)
  } finally {
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2))
    await browser.close()
  }
  console.log(`成果物: ${outDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
