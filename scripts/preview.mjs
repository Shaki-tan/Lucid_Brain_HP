// 手元で public/ を見るための静的サーバー（§7.5）。
//
//   node scripts/preview.mjs        → http://127.0.0.1:8788/
//   node scripts/preview.mjs 9000   → ポートを変える
//
// `wrangler dev` の代わりではない。/api/* は動かないため、決済とダウンロードは確認できない。
// それらを触るときは `npx wrangler dev` を使う。
//
// このスクリプトの目的は1つで、「いま public/ に入っているもの」をキャッシュ抜きで目視することである。
//   - Cache-Control: no-store を必ず返す。ブラウザに一切残らないので、古い表示が出ることがない
//   - 拡張子なしURL（/legal/terms）とディレクトリ（/products/pawgress/）を wrangler と同じ規則で解決する
//   - 存在しないURLは、最も近い親の 404.html を 404 で返す（wrangler.jsonc の not_found_handling と同じ）
//   - 依存を入れない。Node 標準ライブラリだけで動くため、npm install もダウンロードも起きない

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const PORT = Number(process.argv[2] ?? 8788)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

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
  const file = found ?? (await resolveNotFound(urlPath))
  const status = found ? 200 : 404

  if (!file) {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found')
    console.log(`404 ${urlPath}`)
    return
  }

  response.writeHead(status, {
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
  console.log('Cache-Control: no-store を返すため、リロードすれば必ず最新が出る。停止は Ctrl+C。')
})
