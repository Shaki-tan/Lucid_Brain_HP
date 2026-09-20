// 手元で public/ を見るための静的サーバー（§7.5）。
//
//   node scripts/preview.mjs        → http://127.0.0.1:8788/
//   node scripts/preview.mjs 9000   → ポートを変える
//
// `wrangler dev` の代わりではない。/api/* は動かないため、決済とダウンロードは確認できない。
// それらを触るときは `npx wrangler dev` を使う。
//
// このサーバーの役目は2つある。
//
//   1. キャッシュを排除して「いま public/ に入っているもの」を見る
//      Cache-Control: no-store を必ず返す。リロードすれば必ず最新が出る。
//
//   2. 本番と同じ条件で見る
//      public/_headers の CSP・セキュリティヘッダと、public/_redirects の転送を適用する。
//      「ローカルでは出るのに Cloudflare 経由だと崩れる」の原因は、たいていこの2つである。
//      Cache-Control だけは _headers の値を使わず no-store で上書きする（役目1を守るため）。
//      --no-rules を付けると、この適用をやめて素のまま配信する。
//
// 拡張子なしURL（/legal/terms）とディレクトリ（/products/pawgress/）、404 の返し方は
// wrangler.jsonc の html_handling / not_found_handling と同じ規則で解決する。
//
// 依存を入れない。Node 標準ライブラリだけで動くため、npm install もダウンロードも起きない。

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join, extname, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(REPO, 'public')

const args = process.argv.slice(2)
const useRules = !args.includes('--no-rules')
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 8788)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

// ---------- _headers / _redirects ----------

// パターンを正規表現にする。`*` は1つ以上の任意文字、`:name` は1区切りとして扱う。
// 注意: Cloudflare の実装は末尾の `*` を中心に解釈する。ここはそれより緩いので、
// 「ローカルでは当たるが本番では当たらない」規則を見つけたら警告を出す（下の warnMidWildcard）。
function toRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '[^/]+')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function readIfExists(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

// public/_headers を [{ pattern, regexp, headers }] にする
function parseHeaders() {
  const rules = []
  let current = null
  for (const raw of readIfExists(join(ROOT, '_headers')).split('\n')) {
    const line = raw.replace(/\r$/, '')
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (!/^\s/.test(line)) {
      current = { pattern: trimmed, regexp: toRegExp(trimmed), headers: [] }
      rules.push(current)
      continue
    }
    const at = trimmed.indexOf(':')
    if (at < 0 || !current) continue
    current.headers.push([trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim()])
  }
  return rules
}

// public/_redirects を [{ regexp, to, status }] にする
function parseRedirects() {
  const rules = []
  for (const raw of readIfExists(join(ROOT, '_redirects')).split('\n')) {
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const [from, to, status] = trimmed.split(/\s+/)
    if (!from || !to) continue
    rules.push({ from, regexp: toRegExp(from), to, status: Number(status ?? 302) })
  }
  return rules
}

const headerRules = useRules ? parseHeaders() : []
const redirectRules = useRules ? parseRedirects() : []

// 中間に `*` を含むパターンは、Cloudflare 側では当たらない可能性がある。
// 当たらないと、そのパスには既定の規則（_headers の /*）が適用される。
function warnMidWildcard() {
  const suspicious = [...headerRules, ...redirectRules]
    .map((rule) => rule.pattern ?? rule.from)
    .filter((pattern) => /\*[^*]/.test(pattern))
  if (suspicious.length > 0) {
    console.log('')
    console.log('注意: パスの途中に * を含む規則がある。Cloudflare 側では当たらないことがある。')
    suspicious.forEach((pattern) => console.log(`  ${pattern}`))
    console.log('  ローカルでは当たるため、本番との差になりうる。実機で応答ヘッダを確認する。')
  }
}

function headersFor(urlPath) {
  const applied = {}
  for (const rule of headerRules) {
    if (!rule.regexp.test(urlPath)) continue
    for (const [key, value] of rule.headers) applied[key] = value
  }
  // 役目1を守る。_headers の Cache-Control は使わない。
  delete applied['Cache-Control']
  return applied
}

function redirectFor(urlPath) {
  for (const rule of redirectRules) {
    if (rule.regexp.test(urlPath)) return rule
  }
  return null
}

// ---------- 静的アセットの解決 ----------

async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

// public/ の外へ出させない。`..` を含むパスは先頭から落とす
function toLocalPath(urlPath) {
  const cleaned = normalize(decodeURIComponent(urlPath)).replace(/^([/\\]?\.\.)+/, '')
  return join(ROOT, cleaned)
}

// wrangler.jsonc の html_handling: auto-trailing-slash と同じ解決をする
async function resolveFile(urlPath) {
  const base = toLocalPath(urlPath)
  if (await isFile(base)) return base
  if (await isFile(base + '.html')) return base + '.html'
  const indexFile = join(base, 'index.html')
  if (await isFile(indexFile)) return indexFile
  return null
}

// not_found_handling: 404-page と同じく、最も近い親の 404.html を探す（/en/ 配下は /en/404.html）
async function resolveNotFound(urlPath) {
  const segments = urlPath.split('/').filter(Boolean)
  while (segments.length > 0) {
    segments.pop()
    const candidate = join(ROOT, ...segments, '404.html')
    if (await isFile(candidate)) return candidate
  }
  const root404 = join(ROOT, '404.html')
  return (await isFile(root404)) ? root404 : null
}

const server = createServer(async (request, response) => {
  const urlPath = new URL(request.url, 'http://127.0.0.1').pathname

  // /api/* は Worker が処理する。このサーバーは持たないので、黙って壊れるより明示する
  if (urlPath.startsWith('/api/')) {
    response.writeHead(501, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end('このサーバーは /api/* を持たない。npx wrangler dev を使う。')
    console.log(`501 ${urlPath}`)
    return
  }

  const found = await resolveFile(urlPath)

  // 実体が無いときだけ転送を見る。_redirects は静的アセットより後に効く
  if (!found) {
    const redirect = redirectFor(urlPath)
    if (redirect) {
      response.writeHead(redirect.status, { Location: redirect.to, 'Cache-Control': 'no-store' })
      response.end()
      console.log(`${redirect.status} ${urlPath} -> ${redirect.to}`)
      return
    }
  }

  const file = found ?? (await resolveNotFound(urlPath))
  const status = found ? 200 : 404

  if (!file) {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found')
    console.log(`404 ${urlPath}`)
    return
  }

  response.writeHead(status, {
    ...headersFor(urlPath),
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    // ここが本題。確認中に古いものが出ないようにする
    'Cache-Control': 'no-store',
  })
  response.end(await readFile(file))
  console.log(`${status} ${urlPath}`)
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`ポート ${PORT} は使用中。別のポートを指定する: node scripts/preview.mjs ${PORT + 1}`)
    process.exit(1)
  }
  throw error
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`preview: http://127.0.0.1:${PORT}/`)
  console.log(`root:    ${ROOT}`)
  if (useRules) {
    console.log(`rules:   _headers ${headerRules.length}件 / _redirects ${redirectRules.length}件 を適用（Cache-Control は no-store で上書き）`)
    warnMidWildcard()
  } else {
    console.log('rules:   --no-rules のため _headers / _redirects を適用しない')
  }
  console.log('停止は Ctrl+C。')
})
