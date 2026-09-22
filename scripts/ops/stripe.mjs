// セットアップ用の Stripe API 呼び出し。Worker 側のラッパ（functions/lib/stripe.js）とは別に持つ。
// あちらは決済時の最小限の呼び出しだけを持ち、商品・価格・Webhook を作る権限を必要としないため。
// API バージョンだけはあちらの定数を共有する。Webhook の送信形式を Worker と揃えるため。

import { STRIPE_API_VERSION, toPriceKey } from '../../functions/lib/stripe.js'

const STRIPE_API_BASE = 'https://api.stripe.com/v1'

export class StripeApiError extends Error {}

// sk_test_ / rk_live_ などからモードを読む。形が違えば null
export function getKeyMode(key) {
  return /^(sk|rk)_(test|live)_/.exec(key ?? '')?.[2] ?? null
}

// ネストしたオブジェクトを Stripe の form 形式（a[b][0]=c）にする
function toForm(value, prefix, form = new URLSearchParams()) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => toForm(item, `${prefix}[${index}]`, form))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) toForm(item, prefix ? `${prefix}[${key}]` : key, form)
  } else if (value !== undefined) {
    form.append(prefix, String(value))
  }
  return form
}

export function createStripeClient(key) {
  async function request(method, path, params = null, { isNotFoundOk = false } = {}) {
    const form = params ? toForm(params, '') : null
    const isGet = method === 'GET'
    const url = `${STRIPE_API_BASE}${path}${isGet && form ? `?${form}` : ''}`
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Stripe-Version': STRIPE_API_VERSION,
        ...(!isGet && form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: !isGet && form ? form.toString() : undefined,
    })
    if (res.status === 404 && isNotFoundOk) return null
    const body = await res.json()
    if (!res.ok) throw new StripeApiError(`Stripe ${method} ${path} が ${res.status}: ${body.error?.message ?? ''}`)
    return body
  }

  return {
    get: (path, params, options) => request('GET', path, params, options),
    post: (path, params) => request('POST', path, params),
    del: (path) => request('DELETE', path),
  }
}

// 商品はレジストリのプロダクトIDをそのまま Stripe の商品IDにする。検索せずに引けるため
export async function ensureProduct(client, productId, name) {
  const found = await client.get(`/products/${productId}`, null, { isNotFoundOk: true })
  if (!found) return { product: await client.post('/products', { id: productId, name }), action: '作成' }
  if (!found.active || found.name !== name) {
    return { product: await client.post(`/products/${productId}`, { active: true, name }), action: '更新' }
  }
  return { product: found, action: 'そのまま' }
}

// 価格は lookup_key（<product>_<plan>）で引く。Price は金額を変えられないため、
// レジストリと食い違っていたら新しく作って lookup_key を移し、古いものは無効にする。
export async function ensurePrice(client, { productId, planId, plan }) {
  if (plan.checkoutMode !== 'payment') {
    throw new StripeApiError(`${productId}:${planId} は買い切りではない。サブスクの価格は導入時に別途起こす（SPEC §8.2）`)
  }
  const lookupKey = toPriceKey(productId, planId)
  const { data } = await client.get('/prices', { lookup_keys: [lookupKey], active: true })
  const current = data[0] ?? null
  const isMatching =
    current &&
    current.product === productId &&
    current.unit_amount === plan.unitAmount &&
    current.currency === plan.currency &&
    current.type === 'one_time'
  if (isMatching) return { price: current, action: 'そのまま' }

  const price = await client.post('/prices', {
    product: productId,
    unit_amount: plan.unitAmount,
    currency: plan.currency,
    // LP は税込表示である
    tax_behavior: 'inclusive',
    lookup_key: lookupKey,
    transfer_lookup_key: true,
  })
  if (current) await client.post(`/prices/${current.id}`, { active: false })
  return { price, action: current ? `作り直し（旧 ${current.id} は無効化）` : '作成' }
}

export async function listWebhookEndpoints(client) {
  const { data } = await client.get('/webhook_endpoints', { limit: 100 })
  return data
}

// 署名シークレットは作成時にしか返らない。取り直すには作り直すしかない
export async function createWebhookEndpoint(client, url, events) {
  return client.post('/webhook_endpoints', {
    url,
    enabled_events: events,
    api_version: STRIPE_API_VERSION,
    description: 'scripts/ops.mjs stripe が作成',
  })
}
