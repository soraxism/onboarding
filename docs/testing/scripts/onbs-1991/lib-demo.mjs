/**
 * エンドユーザー側デモサイトの操作（ONBS-1991 の確認用）。
 *
 * セレクタは onboarding-e2e-test の scripts/locators/ と同じものを使う。
 */

/**
 * 検証ツアー（リファクタ後 / product_id=248）
 *
 * [自動検証] ONBS-1991_20260910_チェックマーク（管理画面の tour id = 1447）。
 * 既存の「空テスト」はステップが iframe 内要素をターゲットにしていて進行できないため、
 * target を空（センターモーダル）にしたステップだけで新規に作った。
 */
export const NEXT_TOUR = {
  manageTourId: 1447,
  tourId: '24c023c580c61f426769ed91c7ce0427',
  /** ステップ 3 つのゴール */
  goal3: 'ff75ead2158ad85a6429383b292ce9e5',
  /** ステップ 1 つのゴール（§4-9 の境界確認用） */
  goal1: '6ad979882198c861a263e38223689c40',
}

/**
 * legacy（旧JS / product_id=247）側の検証ツアー
 * [自動検証] ONBS-1991_20260910_チェックマーク（管理画面の tour id = 1448）
 */
export const LEGACY_TOUR = {
  manageTourId: 1448,
  tourId: 'a832c86bd96b003eef2cbe6b87891628',
  goal3: '3ad10d8405048791a6ed5fe7bfe28dbb',
  goal1: '77531bc530badba80397a3617a3a6dfc',
}

export const LS_KEYS = (tourId) => ({
  display: `onb_display_goals_${tourId}`,
  lastStep: `onb_last_step_displayed_goals_${tourId}`,
  complete: `onb_complete_goals_${tourId}`,
  checked: `onb_checked_goals_ids_${tourId}`,
  progress: `iGuider_data-${tourId}`,
})

/**
 * 対象ツアーの LS キーを消して未着手状態を作る。
 *
 * ONBS-1969 のクリア耐性（sync iframe が写しを持ち、消すと復元する）があるため、
 * メインの localStorage だけでなく sync iframe 側の写しも消す。
 *
 * NOTE: 逆に「値を書いてリロード」はできない。初期化時の overwriteLocalStorage() が
 * sync 側の写しで上書きするため、書いた値は消える。状態は実操作で作ること。
 * dev 配信には `STANDSTest.flushSyncStorage()` があり、そちらの方が確実なので優先して使う。
 */
export async function clearTourStorage(page, tourId) {
  // dev/local 配信が公開しているテスト用APIがあればそれを使う（両側を確実に消す）
  const flushed = await page
    .evaluate(async () => {
      if (!window.STANDSTest?.flushSyncStorage) return false
      await window.STANDSTest.flushSyncStorage()
      return true
    })
    .catch(() => false)
  if (flushed) return

  const keys = Object.values(LS_KEYS(tourId))
  await page.evaluate((ks) => {
    for (const k of ks) localStorage.removeItem(k)
  }, keys)
  for (const frame of page.frames()) {
    if (!frame.url().includes('/sync/sync.html')) continue
    await frame
      .evaluate((ks) => {
        const hit = Object.keys(localStorage).filter((k) => ks.some((t) => k.includes(t) || k === t))
        for (const k of hit) localStorage.removeItem(k)
        // キー名が加工されている場合に備え、tourId を含むものも消す
        return hit.length
      }, keys)
      .catch(() => {})
    await frame
      .evaluate((tourId) => {
        for (const k of Object.keys(localStorage)) if (k.includes(tourId)) localStorage.removeItem(k)
      }, tourId)
      .catch(() => {})
  }
}

/** LS の状態を読む（JSON はパースして返す） */
export async function readTourStorage(page, tourId) {
  return page.evaluate((keys) => {
    const read = (k) => {
      const v = localStorage.getItem(k)
      if (v === null) return null
      try { return JSON.parse(v) } catch { return v }
    }
    return Object.fromEntries(Object.entries(keys).map(([name, k]) => [name, read(k)]))
  }, LS_KEYS(tourId))
}

/** デモページを開いて STANDSUnit の初期化を待つ */
export async function openDemo(page, url) {
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => window.STANDSUnit?.opt && window.STANDSUnit?.steps, { timeout: 30000 })
  await page.waitForTimeout(1500)
}

/** ランチャーのボタン（バッジ数の取得にも使う） */
export const launcher = (page) => page.locator('.iguider-btn')

/** ランチャーの未完了バッジの数字を読む（無ければ null） */
export async function readBadgeCount(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('.iguider-btn')
    if (!btn) return null
    const badge = btn.querySelector('.iguider-btn-batch, [class*="batch"], [class*="badge"]')
    const text = (badge?.textContent ?? '').trim()
    return text === '' ? null : Number(text)
  })
}

/** イントロ（ゴール一覧モーダル）のコンテナ */
export const intro = (page) =>
  page.locator('.g-modal-pos > .g-modal-size', { has: page.locator('#stands_gGoals:visible') })

/** ランチャーを押してイントロを開く（既に開いていればそのまま） */
export async function openIntro(page) {
  if (await intro(page).isVisible().catch(() => false)) return
  await launcher(page).click({ force: true })
  await intro(page).waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(800)
}

/** イントロを閉じる（開いていなければ何もしない） */
export async function closeIntro(page) {
  const i = intro(page)
  if (!(await i.isVisible().catch(() => false))) return
  await i.locator('.g-modal-close').first().click({ force: true })
  await page.waitForTimeout(800)
}

/** ゴール行のチェック状態を読む（check / nocheck / 見つからない）。DOM を読むだけなので開閉不要 */
export async function readGoalCheck(page, goalId) {
  return page.evaluate((id) => {
    const item = document.querySelector(`.stands-step-item[data-goalid="${id}"]`)
    if (!item) return '(ゴール行なし)'
    const icon = item.querySelector('.stands-step-item-inner-box div')
    const cls = icon?.className ?? ''
    if (cls.includes('stands-step-item-check')) return 'check'
    if (cls.includes('stands-step-item-nocheck')) return 'nocheck'
    return `(不明: ${cls})`
  }, goalId)
}

/** ゴールがカテゴリのアコーディオン内にある場合に開く */
export async function ensureGoalVisible(page, goalId) {
  const item = page.locator(`.stands-step-item[data-goalid="${goalId}"]`)
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await item.isVisible().catch(() => false)) return
    // 閉じているカテゴリの見出しを順に開く
    const titles = page.locator('.stands-category-title')
    const n = await titles.count()
    for (let i = 0; i < n; i++) await titles.nth(i).click({ force: true }).catch(() => {})
    await page.waitForTimeout(1000)
  }
}

/** イントロのゴールをクリックしてツアーを開始する */
export async function startGoal(page, goalId) {
  await ensureGoalVisible(page, goalId)
  const item = page.locator(`.stands-step-item[data-goalid="${goalId}"]`)
  await item.waitFor({ state: 'visible', timeout: 10000 })
  await item.click({ force: true })
  // ステップのモーダルが出るまで待つ
  await page.locator('.g-modal-pos .g-modal-next').first().waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(800)
}

/** ステップの「次へ / 終了」を押す */
export async function clickNext(page) {
  await page.locator('.g-modal-pos .g-modal-next').first().click({ force: true })
  await page.waitForTimeout(1200)
}

/** ステップの × でツアーを閉じる */
export async function closeStep(page) {
  await page.locator('.g-modal-pos .gAction > .g-modal-close').first().click({ force: true })
  await page.waitForTimeout(1200)
}
