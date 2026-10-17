// 利用規約の共通部分を、各製品の利用規約のページに組み込む（SPEC §2.2）。
//
// 共通部分の原本は public/legal/terms-common.html（英語は public/en/legal/terms-common.html）にあり、
// 他の法務文書と同じ形で書くが、配信はしない（public/.assetsignore）。
// 各製品の規約のページの末尾にある <div class="legal-common" data-legal-common="terms"> の中に、
// 次のことをして書き込む。
//
//   - 共通部分の章・条に、固有の部分の続きの番号を振る（Pawgress なら第9章・第22条から）。id も振る
//   - 固有の部分から共通部分への参照（<a data-ref="…">）に、番号の文言とリンク先を入れる
//   - 規約のページの改定日を「固有の部分の改定日（data-revised-own）と共通部分の改定日の新しいほう」にする
//   - 改定履歴に、共通部分の改定を規約の改定として加える
//
// 同じ入力からは、何度流しても同じ結果になる。scripts/ops.mjs の check / ci / deploy が最初に流すので、
// GitHub に push すれば組み込まれた規約がデプロイされる（SPEC §7.7）。手元では node scripts/ops.mjs legal でも流せる。
//
// 依存を持ち込まないため、HTML は決まった書き方を前提に正規表現で読む（SPEC §1.2）。
// 書き方から外れたものはエラーにして止める。黙って崩れた規約を作らない。

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const PUBLIC_DIR = join(REPO, 'public')

// 組み込むかたまりの名前と、言語ごとの原本
export const COMMON_SOURCES = {
  terms: { ja: 'legal/terms-common.html', en: 'en/legal/terms-common.html' },
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export class LegalBuildError extends Error {}

function fail(file, message) {
  throw new LegalBuildError(`${file}: ${message}`)
}

// ---------- 表記 ----------

export function formatDate(date, lang) {
  const [y, m, d] = date.split('-').map(Number)
  return lang === 'en' ? `${d} ${MONTHS[m - 1]} ${y}` : `${y}年${m}月${d}日`
}

function chapterHeading(number, title, lang) {
  return lang === 'en' ? `Chapter ${number}. ${title}` : `第${number}章　${title}`
}

function articleHeading(number, title, lang) {
  return lang === 'en' ? `Article ${number}. ${title}` : `第${number}条（${title}）`
}

// 英語の号は小文字のローマ数字にする（Article 30(1)(i)）
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx']

function refText(number, item, subitem, lang) {
  if (lang === 'en') {
    return `Article ${number}${item ? `(${item})` : ''}${subitem ? `(${ROMAN[subitem - 1]})` : ''}`
  }
  return `第${number}条${item ? `第${item}項` : ''}${subitem ? `第${subitem}号` : ''}`
}

// ---------- 原本を読む ----------

// 条の本文の項と号の数を読む。外側の ol の li が項、その中の ol の li が号。
// 返すのは項ごとの号の数（[0, 2, 0] なら第1〜3項があり、第2項に第1・2号がある）
function listShape(body) {
  const shape = []
  let depth = 0
  for (const [tag] of body.matchAll(/<\/?ol\b|<li\b/g)) {
    if (tag === '<ol') depth += 1
    else if (tag === '</ol') depth -= 1
    else if (depth === 1) shape.push(0)
    else if (depth === 2 && shape.length > 0) shape[shape.length - 1] += 1
  }
  return shape
}

// 共通部分の原本から、章・条・改定日・改定履歴を読む
export function parseCommon(html, file) {
  const revised = html.match(/<time\b[^>]*\bdata-revised\b[^>]*\bdatetime="(\d{4}-\d{2}-\d{2})"/)?.[1]
  if (!revised) fail(file, '改定日（<time data-revised datetime="YYYY-MM-DD">）が無い')

  const chapters = []
  const pattern =
    /<h2 data-common-chapter="([^"]+)">([\s\S]*?)<\/h2>|<section data-common-article="([^"]+)">\s*<h3>([\s\S]*?)<\/h3>([\s\S]*?)<\/section>/g
  for (const match of html.matchAll(pattern)) {
    if (match[1]) {
      chapters.push({ key: match[1], title: match[2].trim(), articles: [] })
      continue
    }
    const chapter = chapters.at(-1)
    if (!chapter) fail(file, `条「${match[3]}」が章（h2 data-common-chapter）より前にある`)
    const body = match[5]
    if (/<(?:div|section|h[1-6])\b/.test(body)) fail(file, `条「${match[3]}」の本文に div / section / 見出しがある。本文は段落とリストだけにする`)
    chapter.articles.push({ key: match[3], title: match[4].trim(), body, shape: listShape(body) })
  }
  if (chapters.length === 0) fail(file, '章（h2 data-common-chapter）が無い')

  const keys = chapters.flatMap((chapter) => chapter.articles.map((article) => article.key))
  const duplicate = keys.find((key, index) => keys.indexOf(key) !== index)
  if (duplicate) fail(file, `条の名前「${duplicate}」が重複している`)

  const historyTable = html.match(/<table\b[^>]*\bdata-common-history\b[^>]*>([\s\S]*?)<\/table>/)?.[1]
  if (!historyTable) fail(file, '改定履歴の表（data-common-history）が無い')
  const history = [...historyTable.matchAll(/<tr>\s*<td><time datetime="(\d{4}-\d{2}-\d{2})">[^<]*<\/time><\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)].map(
    (row) => ({ date: row[1], text: row[2].trim() }),
  )
  if (history.length === 0) fail(file, '改定履歴の表に行が無い')

  return { revised, chapters, history }
}

// ---------- 規約のページに組み込む ----------

const BLOCK_OPEN = /<div class="legal-common" data-legal-common="([^"]+)">/

function indentOf(html, index) {
  const lineStart = html.lastIndexOf('\n', index) + 1
  return html.slice(lineStart, index).match(/^\s*/)[0]
}

function renderCommon(common, firstChapter, firstArticle, lang, indent) {
  const lines = []
  let chapterNumber = firstChapter
  let articleNumber = firstArticle
  const numbers = new Map()
  for (const chapter of common.chapters) {
    lines.push(`${indent}  <h2 id="chapter-${chapterNumber}">${chapterHeading(chapterNumber, chapter.title, lang)}</h2>`)
    lines.push('')
    for (const article of chapter.articles) {
      numbers.set(article.key, { number: articleNumber, shape: article.shape })
      lines.push(`${indent}  <h3 id="article-${articleNumber}">${articleHeading(articleNumber, article.title, lang)}</h3>`)
      // 本文は原本の字下げのまま入れる。原本は section の中なので1段深い
      for (const line of article.body.replace(/^\s*\n|\n\s*$/g, '').split('\n')) {
        lines.push(line.replace(/^ {10}/, `${indent}  `))
      }
      lines.push('')
      articleNumber += 1
    }
    chapterNumber += 1
  }
  return { html: lines.join('\n').replace(/\n+$/, ''), numbers }
}

// 固有の部分の参照（<a data-ref="名前" data-ref-item="項" data-ref-subitem="号">）を埋める
function fillRefs(html, numbers, lang, file) {
  return html.replace(/<a\b([^>]*?)\bdata-ref="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g, (all, before, key, after) => {
    const attrs = before + after
    const target = numbers.get(key)
    if (!target) fail(file, `参照「${key}」に当たる共通部分の条が無い`)
    const { number, shape } = target
    const item = attrs.match(/\bdata-ref-item="(\d+)"/)?.[1]
    const subitem = attrs.match(/\bdata-ref-subitem="(\d+)"/)?.[1]
    if (subitem && !item) fail(file, `参照「${key}」に号だけがあって項が無い`)
    if (item && !(item >= 1 && item <= shape.length)) fail(file, `参照「${key}」の第${item}項が、共通部分の条に無い`)
    if (subitem && !(subitem >= 1 && subitem <= shape[item - 1])) fail(file, `参照「${key}」の第${item}項第${subitem}号が、共通部分の条に無い`)
    const itemAttr = item ? ` data-ref-item="${item}"` : ''
    const subitemAttr = subitem ? ` data-ref-subitem="${subitem}"` : ''
    return `<a href="#article-${number}" data-ref="${key}"${itemAttr}${subitemAttr}>${refText(number, item, subitem, lang)}</a>`
  })
}

// 改定日を「固有の部分と共通部分の新しいほう」にする
function fillRevised(html, commonRevised, lang, file) {
  const pattern = /<time data-revised data-revised-own="(\d{4}-\d{2}-\d{2})" datetime="[^"]*">[^<]*<\/time>/
  const own = html.match(pattern)?.[1]
  if (!own) fail(file, '固有の部分の改定日（<time data-revised data-revised-own="YYYY-MM-DD" datetime="…">）が無い')
  const latest = own > commonRevised ? own : commonRevised
  return html.replace(
    pattern,
    `<time data-revised data-revised-own="${own}" datetime="${latest}">${formatDate(latest, lang)}</time>`,
  )
}

// 改定履歴に共通部分の改定を加える。固有の部分の行（data-history-own）は手で書き、そのまま残す。
// 同じ日付・同じ内容の行は1つにまとめる（規約の制定と共通部分の制定が同じ日のとき等）
function fillHistory(html, commonHistory, lang, file) {
  const tbodyPattern = /(<table\b[^>]*\bdata-legal-history\b[^>]*>[\s\S]*?<tbody>)([\s\S]*?)(\n\s*<\/tbody>)/
  const match = html.match(tbodyPattern)
  if (!match) fail(file, '改定履歴の表（<table data-legal-history> の tbody）が無い')

  const rowIndent = indentOf(html, html.indexOf(match[0]) + match[1].length + match[2].indexOf('<tr'))
  const own = [...match[2].matchAll(/<tr data-history-own>\s*<td><time datetime="(\d{4}-\d{2}-\d{2})">[^<]*<\/time><\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)].map(
    (row) => ({ date: row[1], text: row[2].trim(), kind: 'own' }),
  )
  if (own.length === 0) fail(file, '改定履歴に固有の部分の行（<tr data-history-own>）が無い')

  const rows = [...own]
  for (const entry of commonHistory) {
    if (!rows.some((row) => row.date === entry.date && row.text === entry.text)) rows.push({ ...entry, kind: 'common' })
  }
  rows.sort((a, b) => (a.date === b.date ? (a.kind === 'own' ? -1 : 1) : a.date < b.date ? -1 : 1))

  const body = rows
    .map(
      (row) =>
        `${rowIndent}<tr data-history-${row.kind}><td><time datetime="${row.date}">${formatDate(row.date, lang)}</time></td><td>${row.text}</td></tr>`,
    )
    .join('\n')
  return html.replace(tbodyPattern, `$1\n${body}$3`)
}

// 1つの規約のページを組み立てる。組み立てた HTML を返す
export function buildPage(html, file, readCommon) {
  const open = html.match(BLOCK_OPEN)
  if (!open) return html
  const name = open[1]
  if (!COMMON_SOURCES[name]) fail(file, `知らない共通部分「${name}」`)
  if (html.match(new RegExp(BLOCK_OPEN.source, 'g')).length > 1) fail(file, '共通部分のかたまりが2つ以上ある')

  const lang = /^en[\\/]/.test(file) ? 'en' : 'ja'
  const common = readCommon(name, lang)

  const openIndex = open.index
  const contentStart = openIndex + open[0].length
  const closeIndex = html.indexOf('</div>', contentStart)
  if (closeIndex < 0) fail(file, '共通部分のかたまりが閉じていない')

  // 固有の部分（かたまりより前）の章・条の数を数え、その続きの番号を振る
  const head = html.slice(0, openIndex)
  const chapterCount = (head.match(/<h2 id="chapter-\d+"/g) ?? []).length
  const articleCount = (head.match(/<h3 id="(?:article-\d+|refund)"/g) ?? []).length
  if (chapterCount === 0 || articleCount === 0) fail(file, '固有の部分の章（h2 id="chapter-N"）か条（h3 id="article-N"）が見つからない')

  const indent = indentOf(html, openIndex)
  const rendered = renderCommon(common, chapterCount + 1, articleCount + 1, lang, indent)
  let result = `${head}${open[0]}\n${rendered.html}\n${indent}${html.slice(closeIndex)}`

  result = fillRefs(result, rendered.numbers, lang, file)
  result = fillRevised(result, common.revised, lang, file)
  result = fillHistory(result, common.history, lang, file)
  return result
}

// ---------- まとめて流す ----------

function listHtml(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return listHtml(full)
    return entry.endsWith('.html') ? [full] : []
  })
}

// Windows の作業コピーは CRLF のことがある（core.autocrlf）。LF にそろえて組み立て、元の改行で書き戻す
function readText(full) {
  const raw = readFileSync(full, 'utf8')
  return { text: raw.replace(/\r\n/g, '\n'), eol: raw.includes('\r\n') ? '\r\n' : '\n' }
}

// public/ の中の、共通部分のかたまりを持つページをすべて組み立てる。
// write が false なら書き込まず、組み立てた結果だけを返す（検査で使う）
export function buildLegal({ write = true } = {}) {
  const cache = new Map()
  const readCommon = (name, lang) => {
    const path = COMMON_SOURCES[name][lang]
    if (!cache.has(path)) cache.set(path, parseCommon(readText(join(PUBLIC_DIR, path)).text, path))
    return cache.get(path)
  }

  const results = []
  for (const full of listHtml(PUBLIC_DIR)) {
    const file = relative(PUBLIC_DIR, full).split(sep).join('/')
    const { text: html, eol } = readText(full)
    if (!BLOCK_OPEN.test(html)) continue
    const built = buildPage(html, file, readCommon)
    const isChanged = built !== html
    if (write && isChanged) writeFileSync(full, built.replace(/\n/g, eol))
    results.push({ file, isChanged, built })
  }
  return results
}

// 直接流したとき（node scripts/legal/build.mjs）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    for (const { file, isChanged } of buildLegal()) console.log(`${isChanged ? '更新' : 'そのまま'}  public/${file}`)
  } catch (error) {
    if (!(error instanceof LegalBuildError)) throw error
    console.error(`組み立てを止めた: ${error.message}`)
    process.exitCode = 1
  }
}
