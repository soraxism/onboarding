import fs from 'node:fs'
import path from 'node:path'
import { loadPlaywright, REPO_ROOT } from './env.mjs'

/**
 * 検証対象の拡張機能。
 *
 * path は「読み込ませるビルド成果物（manifest.json があるディレクトリ）」。
 * ソースを直接読み込むことはできないので、確認前に build を通しておく必要がある。
 */
export const EXTENSIONS = {
  preview: {
    key: 'preview',
    label: 'プレビュー拡張',
    repo: 'onboarding-web',
    path: path.join(REPO_ROOT, 'onboarding-web/build/dev/ext-preview'),
    build: 'npm run build_preview:dev',
    /** version.json（dev）でこの値以上でないと管理画面が更新を要求する */
    versionKey: 'CHROME_EXTENSION_LATEST_VERSION',
  },
  viewer: {
    key: 'viewer',
    label: 'ビューワー拡張',
    repo: 'onboarding-web',
    path: path.join(REPO_ROOT, 'onboarding-web/build/dev/ext-viewer-general'),
    build: 'npm run build_viewer:dev',
    versionKey: null,
  },
  editor: {
    key: 'editor',
    label: 'エディタ拡張',
    repo: 'Onboarding-Editor-Extension',
    path: path.join(REPO_ROOT, 'Onboarding-Editor-Extension/package'),
    build: 'npm run build:ext_dev',
    versionKey: 'EDITOR_CHROME_EXTENSION_LATEST_VERSION',
  },
}

/** 管理画面が参照する拡張機能の最新バージョン定義 */
export const VERSION_JSON_URL =
  'https://onboarding-chrome-extension.s3.ap-northeast-1.amazonaws.com/version.json'

/**
 * 拡張機能を読み込んだブラウザを起動する。
 *
 * Manifest V3 の拡張機能は旧ヘッドレスでは読み込まれない（service worker が登録されない）。
 * 新ヘッドレスなら読み込めるが、この環境の playwright 1.45 には `channel: 'chromium'` の
 * 実体が無い。そこで `headless: false` のまま `--headless=new` を渡して新ヘッドレスで起動する。
 * 画面にウィンドウは出ないので、通常の確認はこのままでよい。
 *
 * @param {{ credentials: {basicId: string, basicPw: string}, keys: string[], headed?: boolean, userDataDir?: string, recordVideoDir?: string }} options
 */
export async function launchWithExtensions({
  credentials,
  keys,
  headed = false,
  userDataDir = '',
  recordVideoDir,
}) {
  const targets = keys.map((key) => {
    const ext = EXTENSIONS[key]
    if (!ext) throw new Error(`未知の拡張機能: ${key}`)
    if (!fs.existsSync(path.join(ext.path, 'manifest.json'))) {
      throw new Error(
        `${ext.label} のビルドがありません: ${ext.path}\n` +
          `${ext.repo} で ${ext.build} を実行してください`
      )
    }
    return ext
  })

  const paths = targets.map((ext) => ext.path).join(',')
  const { chromium } = loadPlaywright()
  const context = await chromium.launchPersistentContext(userDataDir, {
    // headed 指定時のみ実ウィンドウを出す。既定は新ヘッドレス（上記コメント参照）
    headless: false,
    args: [
      ...(headed ? [] : ['--headless=new']),
      `--disable-extensions-except=${paths}`,
      `--load-extension=${paths}`,
    ],
    httpCredentials: { username: credentials.basicId, password: credentials.basicPw },
    viewport: { width: 1440, height: 900 },
    locale: 'ja-JP',
    ...(recordVideoDir ? { recordVideo: { dir: recordVideoDir } } : {}),
  })
  return { context, extensions: targets }
}

/**
 * 拡張機能の service worker を、chrome API が使える状態になるまで待って返す。
 *
 * 登録直後は `sw.evaluate` の中で chrome が未定義になることがあるため暖機する。
 * 複数の拡張機能を読み込んだ場合は `match`（url に含まれる文字列）で絞る。
 *
 * @param {import('playwright').BrowserContext} context
 * @param {{ match?: string, timeoutMs?: number }} [options]
 */
export async function waitForExtensionWorker(context, { match, timeoutMs = 20000 } = {}) {
  const deadline = Date.now() + timeoutMs
  const find = () =>
    context.serviceWorkers().find((sw) => (match ? sw.url().includes(match) : true))

  let worker = find()
  while (!worker && Date.now() < deadline) {
    await context.waitForEvent('serviceworker', { timeout: Math.max(1, deadline - Date.now()) })
    worker = find()
  }
  if (!worker) throw new Error(`service worker が登録されませんでした (match=${match ?? 'any'})`)

  while (Date.now() < deadline) {
    const version = await worker
      .evaluate(() => globalThis.chrome?.runtime?.getManifest?.().version)
      .catch(() => undefined)
    if (version) {
      return { worker, id: worker.url().split('/')[2], version }
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('service worker で chrome API が使えるようになりませんでした')
}

/**
 * 管理画面から拡張機能へ送るメッセージの宛先 ID を、いま読み込んでいる拡張機能へ差し替える。
 *
 * 管理画面は Chrome ウェブストア版の固定 ID を宛先にしている。unpacked で読み込むと ID が
 * 毎回変わるため、そのままでは「編集」ボタンからエディタが起動しない。
 * `chrome.runtime.sendMessage` の第1引数だけを差し替えることで、管理画面側の
 * パラメータ組み立て（operation_token の取得等）は本来の経路のまま検証できる。
 *
 * ページを開く前に呼ぶこと（addInitScript のため）。
 *
 * @param {import('playwright').Page} page
 * @param {string} extensionId 差し替え先（waitForExtensionWorker が返す id）
 */
export async function routeManageMessagesTo(page, extensionId) {
  await page.addInitScript((id) => {
    const send = globalThis.chrome?.runtime?.sendMessage
    if (typeof send !== 'function') return
    globalThis.chrome.runtime.sendMessage = function (...args) {
      // (extensionId, message, ...) の形のときだけ宛先を差し替える
      if (typeof args[0] === 'string') args[0] = id
      return send.apply(this, args)
    }
  }, extensionId)
}

/**
 * ツールバーのアイコンクリックと同じ経路でエディタを開く。
 *
 * Playwright は拡張機能のツールバーアイコンを押せないため、
 * background が `chrome.action.onClicked` で送っているのと同じメッセージを直接送る。
 *
 * @param {import('playwright').Worker} worker エディタ拡張の service worker
 */
export async function openEditorFromToolbar(worker) {
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (!tab?.id) throw new Error('アクティブなタブが見つかりません')
    chrome.tabs.sendMessage(tab.id, { action: 'open_editor' })
  })
}

/** 拡張機能の chrome.storage.local を空にする（テスト間の状態持ち越しを断つ） */
export async function clearExtensionStorage(worker) {
  await worker.evaluate(() => chrome.storage.local.clear())
}
