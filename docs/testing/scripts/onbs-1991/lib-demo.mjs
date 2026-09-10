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

export const LS_KEYS = (tourId) => ({
  display: `onb_display_goals_${tourId}`,
  lastStep: `onb_last_step_displayed_goals_${tourId}`,
  complete: `onb_complete_goals_${tourId}`,
  checked: `onb_checked_goals_ids_${tourId}`,
  progress: `iGuider_data-${tourId}`,
})

/** 対象ツアーの LS キーを消して未着手状態を作る */
export async function clearTourStorage(page, tourId) {
  await page.evaluate((keys) => {
    for (const k of Object.values(keys)) localStorage.removeItem(k)
  }, LS_KEYS(tourId))
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

/** ランチャーを押してイントロを開く */
export async function openIntro(page) {
  await launcher(page).click({ force: true })
  await intro(page).waitFor({ state: 'visible', timeout: 15000 })
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
