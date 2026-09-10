import path from 'node:path'
import { loadPlaywright, loadCredentials } from './env.mjs'

/** 検証で使うプロダクト（manual-test-runbook.md の「環境」と対応） */
export const PRODUCTS = {
  /** 旧 JS（use_refactored_onboarding_init 無効）が配信される */
  legacy: {
    key: 'legacy',
    label: 'リファクタ前',
    productId: 247,
    demoUrl: 'https://dev.onboarding.co.jp/demo/onb-web-refactor/',
  },
  /** 新 TS（use_refactored_onboarding_init 有効）が配信される */
  next: {
    key: 'next',
    label: 'リファクタ後',
    productId: 248,
    demoUrl: 'https://dev.onboarding.co.jp/demo/onb-web-refactor/?type=new',
  },
}

export const ACCOUNT_NAME = 'エンドユーザーリファクタ移行期間用'

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
    httpCredentials: { username: credentials.basicId, password: credentials.basicPw },
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
  await page.goto(new URL('/login', manage.url).href, { waitUntil: 'domcontentloaded' })

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
 * 指定プロダクトのガイド一覧を開く。
 *
 * @param {import('playwright').Page} page
 * @param {typeof PRODUCTS.legacy} product
 */
export async function openGuideList(page, product) {
  const base = new URL('/guides', PRODUCTS.baseUrl ?? page.url()).origin
  await page.goto(`${base}/guides?product_id=${product.productId}`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForLoadState('networkidle')
}

/** スクリーンショットを撮って保存先を返す */
export async function shoot(page, dir, name) {
  const file = path.join(dir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  return file
}
