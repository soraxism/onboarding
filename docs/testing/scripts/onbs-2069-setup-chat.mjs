/**
 * ONBS-2069 の確認用 AI チャットを dev に用意する。
 *
 * 新UI（下部フローティング）を設定したチャットを 1 件作り、初回選択肢も入れて公開する。
 * 確認が終わったら `--cleanup` で消す。
 *
 *   node docs/testing/scripts/onbs-2069-setup-chat.mjs [--product next|legacy] [--headed]
 *   node docs/testing/scripts/onbs-2069-setup-chat.mjs --cleanup
 *
 * dev は他の人も使うため、名前は `[自動検証] ` で始める（運用は docs/testing/README.md）。
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
const productKey = process.argv.includes('--product')
  ? process.argv[process.argv.indexOf('--product') + 1]
  : 'next'

const env = getEnv(envKey)
const credentials = loadCredentials(envKey)
const product = env.products[productKey]
if (!product) throw new Error('--product は next|legacy')

const CHAT_NAME = buildTourName('ONBS-2069', '新UI')
const SHORTCUTS = [
  '宿泊者専用ラウンジで男鹿の塩クッキーはいただけますか？',
  'デザートにババヘラアイスは出ますか？',
  'クラフトサケとのペアリングコースはありますか？',
]

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const outDir = path.join(ARTIFACT_DIR, `${stamp}_onbs-2069-setup`)
fs.mkdirSync(outDir, { recursive: true })

const log = (message) => console.log(`  ${message}`)

/**
 * プロダクトを切り替えてから目的のページへ移る。
 *
 * Why: 先にページを開いてから切り替えると、切替の再読み込みでダッシュボードへ流される。
 */
const gotoWithProduct = async (page, pathname) => {
  await page.goto(new URL('/guides', credentials.manage.url).href, {
    waitUntil: 'domcontentloaded',
  })
  // Why: 管理画面は配信ログ等の通信が続くため networkidle が来ないことがある。
  // 待てたら待つ程度に留め、要素の出現で判断する
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await switchToProduct(page, product, env.accountName)
  await page.goto(new URL(pathname, credentials.manage.url).href, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(2500)
}

/** 一覧から名前で行を探し、その行のチェックボックスを入れる */
const checkRowByName = async (page, name) => {
  const row = page.locator('li.listDataRow', { hasText: name }).first()
  if ((await row.count()) === 0) return false
  // チェックボックスは見た目用の要素に隠れているため、包んでいる label を押す
  const label = row.locator('label').first()
  if (await label.isVisible().catch(() => false)) await label.click()
  else await row.locator('input[type="checkbox"]').first().check({ force: true })
  return true
}

/**
 * 公開中のチャットを下書きへ戻す。
 *
 * Why: 公開中のままでは削除できない仕様のため、消す前に下書きへ落とす。
 */
const unpublishByName = async (page, name) => {
  const row = page.locator('li.listDataRow', { hasText: name }).first()
  if ((await row.count()) === 0) return false
  const status = (await row.innerText()).replace(/\s+/g, ' ')
  if (!status.includes('アクティブ')) return false

  await row.locator('.listDataColumn', { hasText: name }).first().click()
  await page.waitForURL(/\/ai\/chats\/[0-9a-f]{8,}/, { timeout: 30000 })
  await page.waitForTimeout(2500)

  // Why: 未公開の変更があると「下書きにする」は公開ボタン横のドロップダウンに隠れる。
  // 見えていなければ開いてから探す
  let toDraft = page.getByRole('button', { name: /下書きにする/ }).first()
  if (!(await toDraft.isVisible().catch(() => false))) {
    const headerButtons = page.locator('header, [class*="Header" i]').first().locator('button')
    const count = await headerButtons.count()
    if (count > 0) await headerButtons.nth(count - 1).click()
    await page.waitForTimeout(1500)
    toDraft = page.getByText(/下書きにする/).first()
  }
  if (!(await toDraft.isVisible().catch(() => false))) {
    log(`  「下書きにする」が見つからない: ${name}`)
    return false
  }
  await toDraft.click()
  await page.waitForTimeout(1200)
  const confirm = page.getByRole('button', { name: /下書きにする|はい|OK/ }).last()
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await page.waitForTimeout(2500)
  log(`  下書きにした: ${name}`)
  return true
}

const doCleanup = async (page) => {
  await gotoWithProduct(page, '/ai/chats')
  // Why: 名前を付ける前に失敗した分は「名称未設定」で残る。取り残さないよう対象に含める
  //      （操作してよいのは検証用プロダクトの中だけ、という前提で消す）
  const targets = await page
    .locator('.listDataColumn')
    .evaluateAll((nodes) =>
      nodes
        .map((n) => (n.textContent ?? '').trim())
        .filter((t) => t.startsWith('[自動検証] ONBS-2069') || t === '名称未設定')
    )
  const unique = [...new Set(targets)]
  if (unique.length === 0) {
    log('消す対象はない')
    return
  }
  log(`消す対象: ${unique.join(' / ')}`)

  // 公開中のものは下書きへ戻してからでないと消せない
  for (const name of unique) {
    await unpublishByName(page, name)
    await gotoWithProduct(page, '/ai/chats')
  }

  for (const name of unique) await checkRowByName(page, name)

  await page.getByRole('button', { name: /削除/ }).click()
  await page.waitForTimeout(1200)
  // 確認ダイアログ
  const confirm = page.getByRole('button', { name: /削除する|はい|OK/ }).last()
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: path.join(outDir, 'cleanup.png'), fullPage: true })
  log('削除した')
}

const doSetup = async (page) => {
  await gotoWithProduct(page, '/ai/chats')

  log(`チャットを作成: ${CHAT_NAME}`)
  await page.getByRole('button', { name: /作成する/ }).click()
  await page.waitForURL(/\/ai\/chats\/[0-9a-f]{8,}/, { timeout: 30000 })
  await page.waitForTimeout(2500)
  const chatId = page.url().match(/\/ai\/chats\/([0-9a-f]+)/)?.[1] ?? ''
  log(`チャットID: ${chatId}`)

  // --- 名前 ---
  // Why: 作成直後は「名称未設定」。dev は他の人も使うため、機械で作ったと分かる名前にする
  await page.getByText('名称未設定').first().click()
  await page.waitForTimeout(800)
  const nameInput = page.locator('input:visible').first()
  await nameInput.fill(CHAT_NAME)
  await nameInput.press('Enter')
  // Why: 入力欄が開いたままだと、後続の input セレクタがこれを掴んで別の値を書き込む
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.waitForTimeout(1500)

  // --- プロンプト（空だと公開できない想定のため埋める）---
  const prompt = page.getByPlaceholder(/命令文/).first()
  if (await prompt.isVisible().catch(() => false)) {
    await prompt.fill('ONBS-2069 の表示確認用です。質問には簡潔に答えてください。')
    await prompt.blur()
    await page.waitForTimeout(1500)
  }

  // --- 初回選択肢を有効にして項目を入れる ---
  log('初回選択肢を設定')
  // Why: チェックボックスは隠されていて click が届かない。包んでいる label を押す
  const field = page.locator('.shortcutsField')
  await field.locator('label.toggleSwitch').click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: path.join(outDir, '03-shortcuts-on.png'), fullPage: true })

  const enabled = await field
    .locator('input.toggleSwitch__input')
    .isChecked()
    .catch(() => false)
  log(`  初回選択肢の有効化: ${enabled ? 'ON' : 'OFF'}`)

  // 項目を追加していく。入力欄は初回選択肢のブロック内に限って拾う
  for (let i = 0; i < SHORTCUTS.length; i++) {
    const addButton = field.locator('.shortcutsField__addButton button').last()
    if (await addButton.isVisible().catch(() => false)) {
      await addButton.click()
      await page.waitForTimeout(1200)
    }
    const inputs = field.locator('input[type="text"]:visible')
    const count = await inputs.count()
    if (count === 0) {
      log('  入力欄が出ない')
      break
    }
    await inputs.nth(count - 1).fill(SHORTCUTS[i])
    await inputs.nth(count - 1).blur()
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: path.join(outDir, '04-shortcuts-filled.png'), fullPage: true })
  log(`  入力した選択肢: ${await field.locator('input[type="text"]:visible').count()} 欄`)

  // --- ランチャー: 新UI（フローティング）を選ぶ ---
  log('スマートフォンでの表示形式をフローティングへ')
  await page.getByText('ランチャー', { exact: true }).first().click()
  await page.waitForTimeout(2500)
  const floating = page.locator('label', { hasText: 'フローティング' }).first()
  await floating.click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: path.join(outDir, '05-launcher.png'), fullPage: true })

  // --- 公開 ---
  log('公開する')
  await page.getByRole('button', { name: /公開する/ }).first().click()
  await page.waitForTimeout(1500)
  const confirm = page.getByRole('button', { name: /公開する|はい|OK/ }).last()
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: path.join(outDir, '06-published.png'), fullPage: true })

  log(`完了。チャットID: ${chatId}`)
}

const main = async () => {
  const { browser, context } = await launchBrowser({
    credentials: credentials.manage,
    headless,
  })
  await blockSelfGuides(context, envKey)
  const page = await context.newPage()
  try {
    await loginToManage(page, credentials.manage)
    log(`ログイン / 対象: ${product.label}（pid=${product.productId}）`)
    if (cleanup) await doCleanup(page)
    else await doSetup(page)
  } finally {
    await browser.close()
  }
  console.log(`成果物: ${outDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
