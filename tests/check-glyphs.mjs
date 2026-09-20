// サイトに出ている文字が、フォントのサブセット範囲に収まっているかを確認する（SPEC §7.5）。
//
// セルフホストのフォントはサブセットしてある（容量のため）。範囲外の文字を本文に書くと、
// その字だけ豆腐（□）になる。文言を足したときに気づけないのが最も困るため、機械で検出する。
//
// フォントのバイナリは解析しない。woff2 の cmap を読むには Brotli 展開と glyf 変換の解釈が要り、
// 依存を持たないという方針（SPEC §1.2）と釣り合わない。
// 代わりに「サブセット生成の入力である文字セットファイル」と突き合わせる。
// 生成コマンドが同じファイルを --text-file に取るため、入力と生成物は一致している。
//
// フォントが未配置のあいだは何も確認せず通す。導入した時点から自動的に有効になる。
//
//   node tests/check-glyphs.mjs

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const PUBLIC_DIR = join(ROOT, 'public')
const FONTS_DIR = join(PUBLIC_DIR, 'assets', 'fonts')
const CHARSET_DIR = join(ROOT, 'scripts', 'font-subset')

// サブセットの入力。ここに無い文字は豆腐になる
const CHARSET_FILES = ['charset-base-ja.txt', 'charset-joyo.txt', 'charset-latin.txt']

// 文字として数えないもの（描画されない、またはフォントを要しない）
const IGNORED = new Set([...' \t\r\n​﻿'])

let hasFailure = false

function fail(message) {
  console.log(`NG  ${message}`)
  hasFailure = true
}

function listFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...listFiles(full))
    else found.push(full)
  }
  return found
}

// 画面に出る文字だけを取り出す。タグ・HTMLコメント・JSの行コメントは描画されない
function visibleText(file) {
  let text = readFileSync(file, 'utf8')
  if (file.endsWith('.html')) {
    text = text.replace(/<!--[\s\S]*?-->/g, '')
    // <head> 内で画面に出るのは <title> だけ。他は属性値も含めて描画されない
    const head = text.match(/<head>([\s\S]*?)<\/head>/)
    const title = head ? (head[1].match(/<title>([\s\S]*?)<\/title>/) ?? ['', ''])[1] : ''
    text = text.replace(/<head>[\s\S]*?<\/head>/, '')
    // alt / aria-label は支援技術が読む。フォントは要らないが、表示に回ることもあるので含める
    const attrs = [...text.matchAll(/(?:alt|aria-label|content|data-pick)="([^"]*)"/g)].map((m) => m[1])
    text = text.replace(/<[^>]+>/g, ' ')
    text = [title, ...attrs, text].join(' ')
  } else if (file.endsWith('.js') || file.endsWith('.mjs')) {
    text = text.replace(/^\s*\/\/.*$/gm, '')
  }
  return text
}

console.log('== フォントのサブセット範囲 ==')

const fontFiles = existsSync(FONTS_DIR)
  ? readdirSync(FONTS_DIR).filter((name) => name.endsWith('.woff2'))
  : []

if (fontFiles.length === 0) {
  console.log('  フォントが未配置のため確認しない（public/assets/fonts/*.woff2 が無い）')
  console.log('  導入手順は scripts/font-subset/README.md にある')
  process.exit(0)
}

// ---------- 1. 入力ファイルが揃っているか ----------
const covered = new Set()
for (const name of CHARSET_FILES) {
  const file = join(CHARSET_DIR, name)
  if (!existsSync(file)) {
    fail(`${name} が無い。サブセットの入力が欠けている（scripts/font-subset/README.md）`)
    continue
  }
  for (const ch of readFileSync(file, 'utf8')) {
    if (!IGNORED.has(ch)) covered.add(ch)
  }
}
if (hasFailure) {
  console.log('')
  console.log('サブセットの入力が揃っていない。')
  process.exit(1)
}
console.log(`  サブセットに含まれる文字: ${covered.size} 字`)

// ---------- 2. サイトの文字が収まっているか ----------
const missing = new Map() // 文字 -> それが出てくるファイル

for (const file of listFiles(PUBLIC_DIR)) {
  if (!/\.(html|js|mjs|json)$/.test(file)) continue
  const where = relative(PUBLIC_DIR, file).split(sep).join('/')
  for (const ch of visibleText(file)) {
    if (IGNORED.has(ch) || covered.has(ch)) continue
    // ASCII 制御文字は無視する
    if (ch.charCodeAt(0) < 0x20) continue
    if (!missing.has(ch)) missing.set(ch, new Set())
    missing.get(ch).add(where)
  }
}

if (missing.size > 0) {
  fail(`サブセットに無い文字が ${missing.size} 種ある。この字は豆腐（□）になる`)
  for (const [ch, files] of [...missing].slice(0, 40)) {
    const code = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
    console.log(`      ${ch}  U+${code}  ${[...files].slice(0, 3).join(', ')}`)
  }
  if (missing.size > 40) console.log(`      … 他 ${missing.size - 40} 種`)
  console.log('')
  console.log('      対処: その字を scripts/font-subset/charset-joyo.txt に足し、フォントを作り直して')
  console.log('            ファイル名のバージョンを上げる（tokens.css の url() も同時に変える）')
}

console.log('')
console.log(hasFailure ? 'サブセットの範囲外の文字がある。' : 'サイトの文字はすべてサブセットに収まっている。')
process.exit(hasFailure ? 1 : 0)
