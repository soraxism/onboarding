/**
 * 本番ツアーの公開 / 下書き（公開停止）を切り替える。
 *
 * 同じ URL に複数のツアーが公開されていると、**どれが配信されるかはサーバーが決める**。
 * 既存ツアーが配信を握っていて検証用ツアーが届かないときに、既存側を一時的に
 * 下書きへ落とすために使う。**確認が終わったら必ず publish で戻すこと。**
 *
 *   node docs/testing/scripts/onbs-1991/prod-toggle-publish.mjs --tour=8531 --action=draft
 *   node docs/testing/scripts/onbs-1991/prod-toggle-publish.mjs --tour=8531 --action=publish
 */
import { loadCredentials, prepareArtifactDir } from '../lib/env.mjs'
import { launchBrowser, loginToManage, blockSelfGuides, shoot } from '../lib/manage.mjs'
import { openTourEdit, publishTour } from './lib.mjs'

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? def : hit.slice(`--${name}=`.length)
}
const tourId = Number(arg('tour'))
const action = arg('action')
if (!tourId || !['draft', 'publish'].includes(action)) throw new Error('--tour と --action=draft|publish が必要')

const c = loadCredentials('prod')
const dir = prepareArtifactDir(`prod-${action}-${tourId}`)
const { browser, context } = await launchBrowser({ credentials: c.manage, headless: true })
await blockSelfGuides(context, 'prod')
const page = await context.newPage()
await loginToManage(page, c.manage)
await openTourEdit(page, c.manage, tourId)
await page.waitForTimeout(1500)

if (action === 'draft') {
  // ヘッダーの出方が状態で変わる。
  // 未公開の変更がある → 「変更内容を公開する」＋ expand_more（中に「下書きにする」）
  // 変更が無い         → 「下書きにする」ボタンが直接出る
  if (await page.locator('.publishBtn__icon').count()) {
    await page.locator('.publishBtn__icon').first().click()
    await page.waitForTimeout(800)
    const row = page.locator('.listRow').filter({ hasText: '下書きにする' }).locator('visible=true').first()
    await row.waitFor({ state: 'visible', timeout: 10000 })
    await row.click()
  } else {
    await page.locator('.publishBtn').getByText('下書きにする').first().click()
  }
  // 「公開設定」ダイアログが開く。下部の「下書きにする」を押すと確認が出る
  const modal = page.locator('.c-modal', { has: page.getByText('公開設定', { exact: true }) })
  const toDraft = modal.getByRole('button', { name: '下書きにする' }).first()
  await toDraft.waitFor({ state: 'visible', timeout: 15000 })
  await toDraft.click()
  await shoot(page, dir, '01_confirm')
  // 確認ダイアログ（ツアーを下書きにしますがよろしいですか？）の OK。
  // **出るまで待つこと。** isVisible() を即時に見ると出る前に素通りする
  const ok = page.getByRole('button', { name: 'OK', exact: true }).first()
  await ok.waitFor({ state: 'visible', timeout: 15000 })
  await ok.click()
  await ok.waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(5000)
} else {
  await publishTour(page)
}
await shoot(page, dir, '02_after')
console.log(`tour ${tourId}: ${action} 実行`)
await browser.close()
process.exit(0)
