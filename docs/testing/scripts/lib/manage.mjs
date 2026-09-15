import path from 'node:path'
import { loadPlaywright, loadCredentials } from './env.mjs'

const DEMO_BASE = 'https://dev.onboarding.co.jp/demo/onb-web-refactor/'

/**
 * 検証環境（manual-test-runbook.md の「環境」と対応）。
 *
 * **デモサイトは dev / prod で同じホスト。** `env` と `type` のクエリで
 * どの配信を読むかが決まるだけなので、BASIC 認証も共通。
 */
export const ENVS = {
  dev: {
    key: 'dev',
    manageHost: 'dev-manage.onboarding-app.io',
    accountId: 146,
    accountName: 'エンドユーザーリファクタ移行期間用',
    ignitionBase: 'https://dev-api.onboarding-app.io/v1/onboarding-init',
    products: {
      /** 旧 JS（use_refactored_onboarding_init 無効）が配信される */
      legacy: { key: 'legacy', label: 'リファクタ前', productId: 247, demoUrl: DEMO_BASE },
      /** 新 TS（use_refactored_onboarding_init 有効）が配信される */
      next: { key: 'next', label: 'リファクタ後', productId: 248, demoUrl: `${DEMO_BASE}?type=new` },
    },
  },
  prod: {
    key: 'prod',
    manageHost: 'manage.onboarding-app.io',
    accountId: 312,
    // dev と同名（動作確認専用ユーザーにはこのアカウントしか見えていない・2026-09-15 確認）
    accountName: 'エンドユーザーリファクタ移行期間用',
    ignitionBase: 'https://api.onboarding-app.io/v1/onboarding-init',
    products: {
      legacy: { key: 'legacy', label: 'リファクタ前', productId: 391, demoUrl: `${DEMO_BASE}?env=prod` },
      next: { key: 'next', label: 'リファクタ後', productId: 392, demoUrl: `${DEMO_BASE}?env=prod&type=new` },
    },
  },
}

/** 環境を取り出す。既定は dev（既存スクリプトが env を渡さないため） */
export function getEnv(key = 'dev') {
  const env = ENVS[key]
  if (!env) throw new Error(`env は ${Object.keys(ENVS).join('|')} のいずれか（指定値: ${key}）`)
  return env
}

/** 既定環境（dev）のプロダクト。env を意識しない既存スクリプト向け */
export const PRODUCTS = ENVS.dev.products

export const ACCOUNT_NAME = ENVS.dev.accountName

/**
 * 検証で作るツアーの名前。
 *
 * 同じ dev 環境を他の人も使うため、機械的に作ったものだと分かる名前にする。
 * 後始末で消す対象を絞り込むときもこの接頭辞で拾う。
 *
 * @param {string} ticket 例 'ONBS-1991'
 * @param {string} suffix 用途が分かる短い語
 */
export function buildTourName(ticket, suffix) {
  const today = new Date()
  const ymd = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('')
  return `[自動検証] ${ticket}_${ymd}_${suffix}`
}

/** 自動検証で作ったツアーかどうか */
export function isGeneratedTourName(name) {
  return typeof name === 'string' && name.startsWith('[自動検証] ')
}

/**
 * 管理画面自身で動いている Onboarding のガイドを止める。
 *
 * dev の管理画面には本番の埋め込みタグが入っており、ツアーが自動再生されると
 * ハイライト用のオーバーレイ（`.g-shape`）が画面を覆ってクリックを遮る。
 * 配信スクリプトの取得を落として、ガイドそのものを起動させない。
 *
 * 落とすのは管理画面から出たリクエストだけに限る。デモサイトも同じ配信APIを
 * 叩いているため、URL だけで判定すると検証対象のガイドまで止まってしまう。
 *
 * ページを開く前に呼ぶこと。
 *
 * @param {import('playwright').BrowserContext} context
 */
export async function blockSelfGuides(context, envKey = 'dev') {
  const manageHost = getEnv(envKey).manageHost
  await context.route(/onboarding-init/, (route) => {
    let from = ''
    try {
      from = route.request().frame()?.url() ?? ''
    } catch {
      // service worker 等、frame を持たないリクエストは対象外
    }
    return from.includes(manageHost) ? route.abort() : route.continue()
  })
}

/**
 * ブラウザを起動する。
 *
 * BASIC 認証は httpCredentials で通す（管理画面・デモサイトで ID/PW が異なるため、
 * どちらを使うかを呼び出し側が指定する）。
 *
 * @param {{ credentials: {basicId: string, basicPw: string}, headless?: boolean }} options
 */
export async function launchBrowser({ credentials, headless = true }) {
  const { chromium } = loadPlaywright()
  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({
    // BASIC 認証が無い環境（prod の管理画面）では basicId が null になる。
    // 空の資格情報を渡すと 401 の再試行で落ちるため、丸ごと省く
    ...(credentials.basicId
      ? { httpCredentials: { username: credentials.basicId, password: credentials.basicPw } }
      : {}),
    viewport: { width: 1440, height: 900 },
    locale: 'ja-JP',
  })
  return { browser, context }
}

/**
 * 管理画面へログインする。
 *
 * 2要素認証が有効なアカウントでは成立しない（コード入力を突破できない）。
 * 無効なアカウントを credentials.local.md に設定しておくこと。
 *
 * @param {import('playwright').Page} page
 * @param {ReturnType<typeof loadCredentials>['manage']} manage
 */
export async function loginToManage(page, manage) {
  // 拡張機能ありのコンテキストでは、起動直後の navigation が content script と
  // ぶつかって ERR_ABORTED になることがある。一度だけリトライする
  try {
    await page.goto(new URL('/login', manage.url).href, { waitUntil: 'domcontentloaded' })
  } catch {
    await page.waitForTimeout(2000)
    await page.goto(new URL('/login', manage.url).href, { waitUntil: 'domcontentloaded' })
  }

  // 入力欄は id で引く。メール欄は type="text" なので type セレクタでは拾えない
  const emailInput = page.locator('#email')
  await emailInput.waitFor({ state: 'visible', timeout: 15000 })
  await emailInput.fill(manage.loginId)
  await page.locator('#password').fill(manage.loginPw)

  // 入力の検証が通るまで送信ボタンは disabled のまま
  const submit = page.locator('button[type="submit"]')
  await submit.waitFor({ state: 'visible' })
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]')
      return button instanceof HTMLButtonElement && !button.disabled
    },
    { timeout: 10000 }
  )
  await submit.click()

  // ログインが通ると /login から離れる
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })
}

/** ログイン済みか（/login に留まっていないか）で判定する */
export function isLoggedIn(page) {
  return !new URL(page.url()).pathname.startsWith('/login')
}

/**
 * ヘッダーのテナント切替で、検証用アカウントの指定プロダクトへ切り替える。
 *
 * `/guides?product_id=248` のようなクエリでは切り替わらない（アプリが保持している
 * 現在のプロダクトが優先され、URL からクエリが落ちる）。ヘッダーの切替を操作する。
 *
 * @param {import('playwright').Page} page
 * @param {typeof PRODUCTS.legacy} product
 */
export async function switchToProduct(page, product, accountName = ACCOUNT_NAME) {
  const currentName = page.locator('.headerTenants__mainName')
  await currentName.waitFor({ state: 'visible', timeout: 20000 })
  if ((await currentName.innerText()).trim() === product.label) return

  await page.locator('.headerTenants__toggle').click()

  // プロダクト名だけでは他アカウントと衝突しうるので、アカウントのまとまりの中から選ぶ。
  // アカウント名が分かっていない環境ではドロップダウン全体から選ぶ
  const scope = accountName
    ? page.locator('.headerTenants__dropdown > div').filter({
        has: page.locator('.headerTenants__dropdown__accountName', { hasText: accountName }),
      })
    : page.locator('.headerTenants__dropdown')
  await scope
    .locator('.headerTenants__dropdown__productName')
    .getByText(product.label, { exact: true })
    .first()
    .click()

  await page.waitForFunction(
    (name) =>
      document.querySelector('.headerTenants__mainName')?.textContent?.trim() === name,
    product.label,
    { timeout: 30000 }
  )
  await page.waitForLoadState('networkidle')
}

/**
 * 指定プロダクトのガイド一覧を開く。
 *
 * @param {import('playwright').Page} page
 * @param {typeof PRODUCTS.legacy} product
 * @param {{url: string}} manage credentials.local.md の管理画面情報
 */
export async function openGuideList(page, product, manage, accountName = ACCOUNT_NAME) {
  await page.goto(new URL('/guides', manage.url).href, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  await switchToProduct(page, product, accountName)
  await waitForGuideList(page)
}

/**
 * ガイド一覧の読み込み完了を待つ。
 *
 * `networkidle` の後にも一覧の取得（`/v2/guides`）が走るため、待たずに数えると
 * 「0 件」を掴む。件数表示が出るまで待つ。
 *
 * @param {import('playwright').Page} page
 */
export async function waitForGuideList(page, timeoutMs = 30000) {
  await page.waitForFunction(
    () => /^\d+ 件$/.test(document.body.innerText.match(/^\s*(\d+ 件)\s*$/m)?.[1] ?? ''),
    undefined,
    { timeout: timeoutMs }
  ).catch(() => {})
  await page.waitForTimeout(1500)
}

/**
 * host ごとに BASIC 認証ヘッダを付ける。
 *
 * `httpCredentials` はコンテキストに 1 組しか持てない。管理画面とデモサイトで
 * ID/PW が違うため、両方を 1 つのブラウザで開く確認（エディタ起動など）では
 * こちらを使ってリクエストごとに付け分ける。
 *
 * @param {import('playwright').BrowserContext} context
 * @param {ReturnType<import('./env.mjs').loadCredentials>} credentials
 */
export async function applyBasicAuthByHost(context, credentials) {
  const header = (cred) =>
    'Basic ' + Buffer.from(`${cred.basicId}:${cred.basicPw}`).toString('base64')

  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).host
    const cred = host.includes('dev-manage.onboarding-app.io')
      ? credentials.manage
      : host.includes('dev.onboarding.co.jp')
        ? credentials.demo
        : null
    if (!cred) return route.continue()
    return route.continue({
      headers: { ...route.request().headers(), Authorization: header(cred) },
    })
  })
}

/**
 * ガイド一覧のカードから「サイト上で編集」を選び、エディタが開いたタブを返す。
 *
 * エディタ拡張を読み込み、`routeManageMessagesTo` で宛先 ID を差し替えてあること。
 *
 * @param {import('playwright').Page} page ガイド一覧を開いている管理画面のページ
 * @param {import('playwright').BrowserContext} context
 * @param {{ index?: number, timeoutMs?: number }} [options] index はカードの位置（既定は先頭）
 * @returns {Promise<import('playwright').Page>} エディタが動いているタブ
 */
export async function openEditorOnSite(page, context, { name, type, index = 0, timeoutMs = 60000 } = {}) {
  const card = findGuideCard(page, { name, type, index })
  await card.waitFor({ state: 'visible', timeout: 20000 })
  await card.scrollIntoViewIfNeeded()
  await card.click({ button: 'right' })

  // メニュー行はアイコンのリガチャ文字を含むため、テキストの完全一致では拾えない。
  // 一覧には非表示のメニューが各カード分あるので、見えているものを選ぶ
  const row = page
    .locator('.listRow')
    .filter({ hasText: 'サイト上で編集' })
    .locator('visible=true')
    .first()
  await row.waitFor({ state: 'visible', timeout: 10000 })

  const opened = context.waitForEvent('page', { timeout: timeoutMs })
  await row.click()
  const editorPage = await opened
  await editorPage.waitForLoadState('load').catch(() => {})
  return editorPage
}

/**
 * ガイド一覧のカードを 1 枚返す。
 *
 * `.cardItem` がカードのルート。`[class*="cardItem"]` では中の要素まで拾ってしまい、
 * 右クリックしてもメニューが出ない。
 *
 * @param {import('playwright').Page} page
 * @param {{ name?: string, index?: number }} [options] name を渡すとタイトルで絞る
 */
export function findGuideCard(page, { name, type, index = 0 } = {}) {
  let cards = page.locator('.cardItem')
  if (name) cards = cards.filter({ has: page.getByText(name, { exact: true }) })
  // 同じ名前のガイドが種別違いで並ぶため、種別（ツアー / ポップアップ / ヒント）でも絞れるようにする
  if (type) cards = cards.filter({ hasText: type })
  return cards.nth(index)
}

/** スクリーンショットを撮って保存先を返す */
export async function shoot(page, dir, name) {
  const file = path.join(dir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  return file
}
