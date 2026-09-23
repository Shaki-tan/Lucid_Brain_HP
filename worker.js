// Workers（静的アセット + Functions）のエントリポイント。
//
// functions/api/*.js の自動ルーティングに問題が生じたため、明示的なルーティングに切り替えている。
// 各ハンドラの実装自体は functions/api/*.js をそのまま再利用する（ロジックの重複を避けるため）。
//
// URL に一致する静的ファイルがあれば、Cloudflare はこの Worker を通さずにそのファイルを配る（SPEC §8.1）。
// この Worker に入ってくるのは、一致するファイルが無いリクエスト（/api/* と、存在しない URL）だけである。
// そのため、全リクエストに効かせたい処理（www の転送など）をここに書いても効かない。
//
// 分岐の if が増え続けないよう、ルートはテーブルで持つ（SPEC §8.2）。

import { onRequestPost as checkoutPost } from './functions/api/checkout.js'
import { onRequestPost as webhookPost } from './functions/api/webhook.js'
import { onRequestGet as downloadGet } from './functions/api/download.js'
import { onRequestGet as downloadFreeGet } from './functions/api/download-free.js'
import { onRequestGet as regionGet } from './functions/api/region.js'

const ROUTES = [
  { method: 'POST', path: '/api/checkout', handler: checkoutPost },
  { method: 'POST', path: '/api/webhook', handler: webhookPost },
  { method: 'GET', path: '/api/download', handler: downloadGet },
  { method: 'GET', path: '/api/download-free', handler: downloadFreeGet },
  { method: 'GET', path: '/api/region', handler: regionGet },
]

const API_PREFIX = '/api/'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (!url.pathname.startsWith(API_PREFIX)) {
      // 一致するファイルが無かった URL。404 ページの選び方は wrangler.jsonc の assets 設定に従う。
      return env.ASSETS.fetch(request)
    }

    const matchedPath = ROUTES.filter((route) => route.path === url.pathname)
    if (matchedPath.length === 0) {
      return new Response('Not found', { status: 404 })
    }

    const route = matchedPath.find((candidate) => candidate.method === request.method)
    if (!route) {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: matchedPath.map((candidate) => candidate.method).join(', ') },
      })
    }

    return route.handler({ request, env, ctx })
  },
}
