// Workers(静的アセット + Git連携ビルド)のエントリーポイント。
// functions/api/*.js の自動ルーティングに問題が生じたため、明示的なルーティングに切り替えている。
// 各ハンドラの実装自体は functions/api/*.js をそのまま再利用する（ロジックの重複を避けるため）。

import { onRequestPost as checkoutPost } from "./functions/api/checkout.js"
import { onRequestPost as webhookPost } from "./functions/api/webhook.js"
import { onRequestGet as downloadGet } from "./functions/api/download.js"
import { onRequestGet as downloadFreeGet } from "./functions/api/download-free.js"

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const context = { request, env, ctx }

    if (url.pathname === "/api/checkout" && request.method === "POST") {
      return checkoutPost(context)
    }
    if (url.pathname === "/api/webhook" && request.method === "POST") {
      return webhookPost(context)
    }
    if (url.pathname === "/api/download" && request.method === "GET") {
      return downloadGet(context)
    }
    if (url.pathname === "/api/download-free" && request.method === "GET") {
      return downloadFreeGet(context)
    }

    // 上記以外は静的アセットへフォールバック
    return env.ASSETS.fetch(request)
  },
}
