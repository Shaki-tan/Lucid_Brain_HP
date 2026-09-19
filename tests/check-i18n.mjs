// 日英ページの構造一致と hreflang の相互参照を確認する（SPEC §2.1 / §7.5）。
//
// 言語別に HTML を持つ構成では、片方だけ直して他方を忘れるのが最も起きやすい壊れ方である。
// 見出しの数とセクションIDの一致で、そのズレを検出する。
//
// 依存を持ち込まないため、ランナーに同梱の Node だけで動かす。package.json は作らない。
//
//   node tests/check-i18n.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const PUBLIC_DIR = join(ROOT, 'public')

let hasFailure = false

function fail(message) {
  console.log(`NG  ${message}`)
  hasFailure = true
}

function listHtml(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...listHtml(full))
    else if (entry.endsWith('.html')) found.push(full)
  }
  return found
}

// public/legal/privacy.html -> /legal/privacy
function toUrlPath(file) {
  const rel = relative(PUBLIC_DIR, file).split(sep).join('/')
  const withoutExt = rel.replace(/\.html$/, '')
  return '/' + withoutExt.replace(/(^|\/)index$/, '$1').replace(/\/$/, '')
}

function headings(html) {
  return [...html.matchAll(/<(h[1-6])\b[^>]*>/gi)].map((m) => m[1].toLowerCase())
}

function sectionIds(html) {
  return [...html.matchAll(/<(?:section|article|div)\b[^>]*\bid="([^"]+)"/gi)]
    .map((m) => m[1])
    .sort()
}

// 見出しの中に置いた id も構造の一部として見る
function anchorIds(html) {
  return [...html.matchAll(/<h[1-6]\b[^>]*\bid="([^"]+)"/gi)].map((m) => m[1]).sort()
}

function attr(html, pattern) {
  const match = html.match(pattern)
  return match ? match[1] : null
}

const files = listHtml(PUBLIC_DIR)
const byPath = new Map(files.map((file) => [toUrlPath(file), file]))

// ---------- 1. 日英の対応と構造の一致 ----------
console.log('== 日英ページの構造一致 ==')
let pairs = 0

for (const [urlPath, jaFile] of byPath) {
  if (urlPath.startsWith('/en')) continue

  const enPath = urlPath === '/' ? '/en' : '/en' + urlPath
  const enFile = byPath.get(enPath)

  if (!enFile) {
    fail(`${urlPath} に対応する英語ページ ${enPath} が無い`)
    continue
  }
  pairs += 1

  const ja = readFileSync(jaFile, 'utf8')
  const en = readFileSync(enFile, 'utf8')

  const jaHeadings = headings(ja).join(',')
  const enHeadings = headings(en).join(',')
  if (jaHeadings !== enHeadings) {
    fail(`${urlPath} と ${enPath} で見出しの構成が違う`)
    console.log(`      ja: ${jaHeadings}`)
    console.log(`      en: ${enHeadings}`)
  }

  const jaSections = sectionIds(ja).join(',')
  const enSections = sectionIds(en).join(',')
  if (jaSections !== enSections) {
    fail(`${urlPath} と ${enPath} でセクションIDが違う`)
    console.log(`      ja: ${jaSections}`)
    console.log(`      en: ${enSections}`)
  }

  const jaAnchors = anchorIds(ja).join(',')
  const enAnchors = anchorIds(en).join(',')
  if (jaAnchors !== enAnchors) {
    fail(`${urlPath} と ${enPath} で見出しのIDが違う`)
    console.log(`      ja: ${jaAnchors}`)
    console.log(`      en: ${enAnchors}`)
  }
}
console.log(`  ${pairs} 組を確認した`)

// ---------- 2. hreflang の相互参照 ----------
console.log('')
console.log('== hreflang の相互参照 ==')

const declared = new Map()
for (const file of files) {
  const html = readFileSync(file, 'utf8')
  declared.set(toUrlPath(file), {
    file,
    canonical: attr(html, /<link rel="canonical" href="([^"]+)"/),
    ja: attr(html, /<link rel="alternate" hreflang="ja" href="([^"]+)"/),
    en: attr(html, /<link rel="alternate" hreflang="en" href="([^"]+)"/),
    xDefault: attr(html, /<link rel="alternate" hreflang="x-default" href="([^"]+)"/),
  })
}

for (const [urlPath, meta] of declared) {
  if (!meta.ja || !meta.en) {
    fail(`${urlPath}: hreflang が日英そろっていない`)
    continue
  }

  // 自己参照であること
  const self = urlPath.startsWith('/en') ? meta.en : meta.ja
  if (meta.canonical !== self) {
    fail(`${urlPath}: canonical が自分の言語の hreflang と一致しない（${meta.canonical} / ${self}）`)
  }

  // 相手側が同じ組を宣言していること
  const counterpartUrl = urlPath.startsWith('/en')
    ? (urlPath === '/en' ? '/' : urlPath.slice(3))
    : (urlPath === '/' ? '/en' : '/en' + urlPath)
  const counterpart = declared.get(counterpartUrl)
  if (!counterpart) continue

  if (counterpart.ja !== meta.ja || counterpart.en !== meta.en) {
    fail(`${urlPath} と ${counterpartUrl} で hreflang の組が食い違っている`)
    console.log(`      ${urlPath}: ja=${meta.ja} en=${meta.en}`)
    console.log(`      ${counterpartUrl}: ja=${counterpart.ja} en=${counterpart.en}`)
  }

  // x-default は日本語を指す（SPEC §2.1）
  if (meta.xDefault !== meta.ja) {
    fail(`${urlPath}: x-default が日本語版を指していない（${meta.xDefault}）`)
  }
}
console.log(`  ${declared.size} ページを確認した`)

console.log('')
console.log(hasFailure ? '日英の構造にズレがある。' : '日英の構造は一致している。')
process.exit(hasFailure ? 1 : 0)
