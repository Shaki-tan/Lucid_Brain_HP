// プライバシーポリシーが事実として書いている HP の設定が、崩れていないかを確かめる。
// 何を守るかの正は Docs/PRIVACY_SETTINGS.md である（SPEC §7.5・§8.4）。
//
// 設定を正当に変えるときは、先にプライバシーポリシーを改定し、Docs/PRIVACY_SETTINGS.md とこの検査の期待値を直す。
// この検査を通すために、検査の側だけを緩めない。
//
// 依存を持ち込まないため、ソースを決まった書き方の前提で正規表現で読む（SPEC §1.2）。
//
//   node tests/check-privacy-settings.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SETTINGS_DOC = 'Docs/PRIVACY_SETTINGS.md'

// ブラウザから外部へ送ってよい先。CSP の指令ごとに持つ（Docs/PRIVACY_SETTINGS.md の行5・6）
const CSP_ALLOWED_HOSTS = {
  'script-src': ['https://static.cloudflareinsights.com'],
  'connect-src': ['https://cloudflareinsights.com'],
}
// サーバ（Worker）から送ってよい先（行6）
const SERVER_ALLOWED_ORIGINS = ['https://api.stripe.com']
// ログに出してはいけない項目（行3）。session_id は末尾（session_tail）なら可
const FORBIDDEN_LOG_KEYS = /^(e_?mail|.*_email|ip|ip_address|client_ip|remote_ip|name|.*_name|address|.*_address|customer.*|session_id|sessionId|session)$/i
// 自サイトの絶対 URL（canonical・hreflang・og:url が持つ）
const SITE_ORIGIN = 'https://lucidbrain.jp'

let hasFailure = false

function fail(row, message) {
  console.log(`NG  [${SETTINGS_DOC} 行${row}] ${message}`)
  hasFailure = true
}

function ok(row, message) {
  console.log(`OK  [行${row}] ${message}`)
}

function read(path) {
  return readFileSync(join(REPO, path), 'utf8')
}

function list(dir, extensions) {
  return readdirSync(join(REPO, dir)).flatMap((entry) => {
    const path = `${dir}/${entry}`
    if (statSync(join(REPO, path)).isDirectory()) return list(path, extensions)
    return extensions.some((ext) => entry.endsWith(ext)) ? [path] : []
  })
}

// 行コメントとブロックコメントを外す。URL の // を壊さないよう、行頭か空白の後の // だけを行コメントとみなす
function stripJsComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

const serverFiles = [...list('functions', ['.js']), 'worker.js']
const publicJs = list('public', ['.js'])
const publicHtml = list('public', ['.html'])

// ---------- 行1: 呼び出しログ ----------

console.log('== 呼び出しログ ==')
ok(1, 'invocation_logs: false は tests/check-wrangler.mjs が見ている')

// ---------- 行4: Cookie ----------

console.log('')
console.log('== Cookie ==')
{
  let found = 0
  for (const file of [...publicJs, ...serverFiles]) {
    const source = stripJsComments(read(file))
    for (const pattern of [/document\.cookie/, /\bcookieStore\b/, /set-cookie/i]) {
      if (pattern.test(source)) {
        fail(4, `${file} に ${pattern.source} がある（本サイト自身は Cookie を設定しない）`)
        found += 1
      }
    }
  }
  if (found === 0) ok(4, `Cookie を扱うコードが無い（${publicJs.length + serverFiles.length} ファイル）`)
}

// ---------- 行5・6・7: CSP ----------

console.log('')
console.log('== CSP（public/_headers） ==')
{
  const headers = read('public/_headers')
  const policies = [...headers.matchAll(/^\s*Content-Security-Policy:\s*(.+)$/gim)].map((match) => match[1])
  if (policies.length === 0) fail(5, 'public/_headers に Content-Security-Policy が無い')
  for (const policy of policies) {
    const directives = new Map(
      policy.split(';').map((part) => part.trim().split(/\s+/)).filter((tokens) => tokens[0]).map(([name, ...values]) => [name.toLowerCase(), values]),
    )
    for (const [name, values] of directives) {
      const allowed = CSP_ALLOWED_HOSTS[name] ?? []
      for (const value of values) {
        if (/^'(self|none|unsafe-inline|unsafe-eval|strict-dynamic)'$/.test(value) || /^'(nonce|sha\d+)-/.test(value)) continue
        if (value === 'data:' && name === 'img-src') continue
        if (value === '*' || /^[a-z][a-z0-9+.-]*:$/i.test(value) || value.includes('*')) {
          fail(5, `CSP の ${name} にワイルドカード（${value}）がある`)
        } else if (!allowed.includes(value)) {
          fail(5, `CSP の ${name} が外部（${value}）を許している。許してよいのは ${allowed.join('・') || '自サイトだけ'}`)
        }
      }
    }
    // 指令が無いと default-src に落ちる。default-src が自サイトだけなので、無い指令は自サイトだけになる
    if (!directives.has('default-src')) fail(5, 'CSP に default-src が無い')
    if (!directives.has('form-action')) fail(7, 'CSP に form-action が無い（default-src では縛れない）')
  }
  if (!hasFailure) ok('5・6・7', '外部のホストは Web Analytics の2つだけ。frame-src・form-action は自サイトだけ')
}

// ---------- 行5・6・7: HTML ----------

console.log('')
console.log('== HTML（public/） ==')
{
  const before = hasFailure
  const isExternal = (url) => /^(https?:)?\/\//i.test(url.trim())
  for (const file of publicHtml) {
    const html = read(file)
    for (const [tag, name] of html.matchAll(/<(iframe|embed|object|frame)\b[^>]*>/gi)) {
      fail(5, `${file} に <${name}> がある（外部の埋め込みは入れない）`)
    }
    for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
      const src = tag.match(/\bsrc="([^"]*)"/i)?.[1]
      if (src !== undefined && isExternal(src)) fail(5, `${file} に外部の <script src="${src}"> がある`)
    }
    for (const [tag] of html.matchAll(/<form\b[^>]*>/gi)) {
      const action = tag.match(/\baction="([^"]*)"/i)?.[1]
      if (action !== undefined && isExternal(action)) fail(7, `${file} に外部へ送る <form action="${action}"> がある`)
    }
    for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
      const rel = tag.match(/\brel="([^"]*)"/i)?.[1]?.toLowerCase() ?? ''
      const href = tag.match(/\bhref="([^"]*)"/i)?.[1] ?? ''
      // canonical・hreflang は自サイトの絶対 URL を持つ。読み込みではない
      if (/\b(canonical|alternate)\b/.test(rel)) {
        if (!href.startsWith(SITE_ORIGIN + '/')) fail(5, `${file} の <link rel="${rel}"> が自サイトの外（${href}）を指している`)
        continue
      }
      if (isExternal(href)) fail(5, `${file} の <link rel="${rel}"> が外部（${href}）を読み込む`)
    }
    for (const [tag] of html.matchAll(/<(img|source|video|audio)\b[^>]*>/gi)) {
      const src = tag.match(/\bsrcset="([^"]*)"|\bsrc="([^"]*)"/i)
      const value = src?.[1] ?? src?.[2]
      if (value && isExternal(value)) fail(5, `${file} に外部の画像・メディア（${value}）がある`)
    }
  }
  if (hasFailure === before) ok('5・6・7', `外部の読み込み・埋め込み・送信が無い（${publicHtml.length} ページ）`)
}

// ---------- 行6: サーバからの送信先 ----------

console.log('')
console.log('== サーバからの送信先（functions/・worker.js） ==')
{
  const before = hasFailure
  for (const file of serverFiles) {
    const source = stripJsComments(read(file))
    for (const [url] of source.matchAll(/\bhttps?:\/\/[^\s'"`)]+/g)) {
      if (!SERVER_ALLOWED_ORIGINS.some((origin) => url === origin || url.startsWith(origin + '/'))) {
        fail(6, `${file} に Stripe 以外への URL（${url}）がある`)
      }
    }
  }
  if (hasFailure === before) ok(6, `外部への URL は ${SERVER_ALLOWED_ORIGINS.join('・')} だけ（${serverFiles.length} ファイル）`)
}

// ---------- 行3: ログの項目 ----------

console.log('')
console.log('== ログの項目（functions/） ==')
{
  const before = hasFailure
  let calls = 0
  for (const file of serverFiles) {
    const source = stripJsComments(read(file))
    if (file !== 'functions/lib/log.js' && /\bconsole\.\w+\s*\(/.test(source)) {
      fail(3, `${file} が console を直に呼んでいる。ログは functions/lib/log.js の logInfo / logError を通す`)
    }
    for (const match of source.matchAll(/\blog(?:Info|Error)\s*\(/g)) {
      // 呼び出しの括弧の中を、対応する閉じ括弧まで取る
      let depth = 0
      let end = match.index + match[0].length - 1
      for (; end < source.length; end += 1) {
        if (source[end] === '(') depth += 1
        else if (source[end] === ')' && --depth === 0) break
      }
      const args = source.slice(match.index + match[0].length, end)
      if (file === 'functions/lib/log.js' && /^\s*event\b/.test(args)) continue
      calls += 1
      const keys = [...args.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*(?=[:,}])/g)].map((key) => key[1])
      for (const key of keys) {
        if (FORBIDDEN_LOG_KEYS.test(key)) fail(3, `${file} のログに「${key}」の項目がある（氏名・メール・IP・session_id の全体は出さない）`)
      }
    }
  }
  if (hasFailure === before) ok(3, `ログの呼び出し ${calls} か所に、出してはいけない項目が無い`)
}

console.log('')
console.log(hasFailure ? `プライバシーポリシーの記載と食い違う設定がある（${SETTINGS_DOC}）。` : 'HP の設定は、プライバシーポリシーの記載と合っている。')
process.exit(hasFailure ? 1 : 0)
