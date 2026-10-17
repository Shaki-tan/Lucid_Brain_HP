// 利用規約の共通部分の組み込み（scripts/legal/build.mjs）の結果を確かめる（SPEC §2.2）。
//
//   - 組み込みが最新であること（原本や固有の部分を直したのに組み立て直していない、を拾う）
//   - 固有の部分から共通部分への参照（data-ref）がすべて埋まり、ページ内の条を指していること
//   - 規約のページの改定日が「固有の部分の改定日と共通部分の改定日の新しいほう」であること。
//     これが崩れると、共通部分だけを改定したときの consentVersion の上げ忘れを check-consent.mjs が拾えない
//   - 原本が配信されないこと（public/.assetsignore に書かれ、sitemap.xml に無いこと）
//
// ops.mjs の check / ci は組み立ての後にこれを流す。単独で流すと、組み立て忘れも拾える。
//
//   node tests/check-legal-common.mjs

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLegal, COMMON_SOURCES, LegalBuildError, parseCommon } from '../scripts/legal/build.mjs'

const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public')

let hasFailure = false

function fail(message) {
  console.log(`NG  ${message}`)
  hasFailure = true
}

function read(path) {
  return readFileSync(join(PUBLIC_DIR, path), 'utf8').replace(/\r\n/g, '\n')
}

// ---------- 原本が配信されないこと ----------

const ignorePath = join(PUBLIC_DIR, '.assetsignore')
const ignored = existsSync(ignorePath)
  ? readFileSync(ignorePath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  : []
const sitemap = read('sitemap.xml')
for (const sources of Object.values(COMMON_SOURCES)) {
  for (const path of Object.values(sources)) {
    if (!existsSync(join(PUBLIC_DIR, path))) fail(`原本 public/${path} が無い`)
    if (!ignored.includes(path)) fail(`原本 public/${path} が public/.assetsignore に無い（配信されてしまう）`)
    const url = `/${path.replace(/\.html$/, '')}`
    if (sitemap.includes(`${url}<`)) fail(`原本 ${url} が sitemap.xml に載っている`)
  }
}

// ---------- 組み込みの結果 ----------

let results = []
try {
  results = buildLegal({ write: false })
} catch (error) {
  if (!(error instanceof LegalBuildError)) throw error
  fail(`組み立てが止まる: ${error.message}`)
}
if (!hasFailure && results.length === 0) fail('共通部分を組み込むページ（data-legal-common）が1つも無い')

for (const { file, isChanged, built } of results) {
  console.log(`  public/${file}`)
  if (isChanged) fail(`public/${file}: 組み込みが古い。node scripts/ops.mjs legal を流す`)

  const ids = new Set([...built.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]))
  const refs = [...built.matchAll(/<a\b([^>]*\bdata-ref="[^"]+"[^>]*)>([\s\S]*?)<\/a>/g)]
  for (const [, attrs, text] of refs) {
    const key = attrs.match(/\bdata-ref="([^"]+)"/)[1]
    const target = attrs.match(/\bhref="#([^"]+)"/)?.[1]
    if (!target || !ids.has(target)) fail(`public/${file}: 参照「${key}」がページ内の条を指していない（href="#${target ?? ''}"）`)
    if (!text.trim()) fail(`public/${file}: 参照「${key}」の文言が空`)
  }
  console.log(`    参照 ${refs.length} か所`)

  const lang = /^en\//.test(file) ? 'en' : 'ja'
  const name = built.match(/data-legal-common="([^"]+)"/)[1]
  const commonPath = COMMON_SOURCES[name][lang]
  const common = parseCommon(read(commonPath), commonPath)
  const revised = built.match(/<time data-revised data-revised-own="(\d{4}-\d{2}-\d{2})" datetime="(\d{4}-\d{2}-\d{2})">/)
  if (!revised) {
    fail(`public/${file}: 改定日（data-revised-own）が無い`)
  } else {
    const [, own, shown] = revised
    const latest = own > common.revised ? own : common.revised
    if (shown !== latest) fail(`public/${file}: 改定日が ${shown}（固有の部分 ${own}・共通部分 ${common.revised} の新しいほうは ${latest}）`)
    console.log(`    改定日 ${shown}（固有の部分 ${own}・共通部分 ${common.revised}）`)
  }
}

console.log('')
console.log(hasFailure ? '利用規約の共通部分の組み込みに問題がある。' : '利用規約の共通部分は正しく組み込まれている。')
process.exit(hasFailure ? 1 : 0)
