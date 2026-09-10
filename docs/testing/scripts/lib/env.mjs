import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** onboarding リポジトリのルート（docs/testing/scripts/lib から 4 つ上） */
export const REPO_ROOT = path.resolve(HERE, '../../../..')
export const TESTING_DIR = path.join(REPO_ROOT, 'docs/testing')
export const ARTIFACT_DIR = path.join(TESTING_DIR, 'artifacts')

/**
 * playwright を読み込む。
 *
 * このリポジトリは docs/ しか管理していないため node_modules を持たない。
 * 同じ階層にある onboarding-e2e-test の依存を借りて解決する。
 */
export function loadPlaywright() {
  const e2eRoot = path.join(REPO_ROOT, 'onboarding-e2e-test')
  if (!fs.existsSync(path.join(e2eRoot, 'node_modules/playwright'))) {
    throw new Error(
      `playwright が見つかりません。${e2eRoot} で npm ci を実行してください`
    )
  }
  const require = createRequire(path.join(e2eRoot, 'package.json'))
  return require('playwright')
}

/**
 * credentials.local.md から認証情報を読む。
 *
 * 値を追跡対象のファイルへ書かないための仕組みなので、
 * 読み取った値をログやスクリーンショットへ出さないこと。
 *
 * @returns {{manage: {url: string, basicId: string, basicPw: string, loginId: string, loginPw: string}, demo: {basicId: string, basicPw: string}}}
 */
export function loadCredentials() {
  const file = path.join(TESTING_DIR, 'credentials.local.md')
  if (!fs.existsSync(file)) {
    throw new Error(
      `${file} がありません。credentials.sample.md をコピーして作成してください`
    )
  }
  const text = fs.readFileSync(file, 'utf-8')

  // `| 項目 | 値 |` 形式の表から拾う
  const pick = (section, label) => {
    const sectionBody = text.split(/^## /m).find((s) => s.startsWith(section))
    if (!sectionBody) throw new Error(`credentials.local.md に「${section}」の節がありません`)
    const row = sectionBody
      .split('\n')
      .find((line) => line.startsWith('|') && line.includes(label))
    if (!row) throw new Error(`credentials.local.md の「${section}」に「${label}」がありません`)
    const value = row.split('|')[2]?.trim()
    if (!value || value.startsWith('<')) {
      throw new Error(`credentials.local.md の「${label}」が未記入です`)
    }
    return value
  }

  return {
    manage: {
      url: pick('管理画面', '| URL '),
      basicId: pick('管理画面', 'BASIC認証 ID'),
      basicPw: pick('管理画面', 'BASIC認証 PW'),
      loginId: pick('管理画面', 'ログイン ID'),
      loginPw: pick('管理画面', 'ログイン PW'),
    },
    demo: {
      basicId: pick('エンドユーザー側デモサイト', 'BASIC認証 ID'),
      basicPw: pick('エンドユーザー側デモサイト', 'BASIC認証 PW'),
    },
  }
}

/** 実行のたびに作る成果物ディレクトリ（スクリーンショット等） */
export function prepareArtifactDir(name) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)
  const dir = path.join(ARTIFACT_DIR, `${stamp}_${name}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
