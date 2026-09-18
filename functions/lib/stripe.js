// Stripe API 呼び出しのラッパ。APIバージョンの固定もここ1箇所で行う（SPEC §7.5 放置耐性）。
//
// Stripe-Version を指定しないとアカウント既定のバージョンに追従し、ある日突然壊れる。
// 明示的に固定することで、Stripe 側が新版を出しても本サイトの挙動は変わらない。
// 上げるときはこの定数を書き換え、テストモードで購入からダウンロードまでを通す。
//
// 注意: この値は Stripe ダッシュボード（開発者 > API バージョン）に実在する版と一致している必要がある。
// 公開前に実値を確認すること（SPEC §7.5 リリース前チェックリスト3番と同時に行う）。
export const STRIPE_API_VERSION = '2025-08-27.basil'

const STRIPE_API_BASE = 'https://api.stripe.com/v1'

export class StripeError extends Error {
  constructor(status, body) {
    super(`stripe request failed: ${status}`)
    this.name = 'StripeError'
    this.status = status
    this.body = body
  }
}

async function stripeFetch(env, path, { method = 'GET', params = null } = {}) {
  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Stripe-Version': STRIPE_API_VERSION,
  }
  if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded'

  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers,
    body: params ? params.toString() : undefined,
  })

  if (!res.ok) {
    throw new StripeError(res.status, await res.text())
  }
  return res.json()
}

export function createCheckoutSession(env, params) {
  return stripeFetch(env, '/checkout/sessions', { method: 'POST', params })
}

// expand は Stripe の展開指定（例: ['subscription']）。
// サブスクの可否判定で session から subscription を引くために使う（SPEC §8.2）。
export function retrieveCheckoutSession(env, sessionId, expand = []) {
  const query = new URLSearchParams()
  expand.forEach((field, index) => query.set(`expand[${index}]`, field))
  const suffix = query.toString() ? `?${query}` : ''
  return stripeFetch(env, `/checkout/sessions/${encodeURIComponent(sessionId)}${suffix}`)
}
