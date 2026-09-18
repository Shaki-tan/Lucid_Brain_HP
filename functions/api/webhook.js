// POST /api/webhook
//
// Stripe からのイベント通知を受信する。
// 用途は「Stripe 側で起きたことに気づくための通知」であり、記録の保存先ではない（SPEC §8.1 / §8.4）。
// ダウンロード可否判定はここに依存しない（download.js は Stripe API への同期照会のみで完結する）。
// 署名検証・タイムスタンプ検証は Stripe 公式ドキュメントの Webhook 署名方式に準拠する。

import { text } from '../lib/http.js'
import { logInfo } from '../lib/log.js'

const SIGNATURE_TOLERANCE_SECONDS = 300

function parseSignatureHeader(header) {
  const parts = {}
  header.split(',').forEach((pair) => {
    const [key, value] = pair.split('=')
    if (key && value) parts[key] = value
  })
  return parts
}

function isEqualFixedTime(a, b) {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

async function verifyStripeSignature(payload, header, secret) {
  if (!header) return false

  const { t: timestamp, v1: signature } = parseSignatureHeader(header)
  if (!timestamp || !signature) return false

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signedPayload = `${timestamp}.${payload}`
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload))
  const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')

  return isEqualFixedTime(expected, signature)
}

export async function onRequestPost(context) {
  const { request, env } = context

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return text('Server not configured', 500)
  }

  const payload = await request.text()
  const signatureHeader = request.headers.get('Stripe-Signature')

  const isValid = await verifyStripeSignature(payload, signatureHeader, env.STRIPE_WEBHOOK_SECRET)
  if (!isValid) {
    return text('Invalid signature', 400)
  }

  let event
  try {
    event = JSON.parse(payload)
  } catch {
    return text('Invalid payload', 400)
  }

  // 残すのはイベント種別とIDだけにする。金額・購入者・同意の記録は Stripe 側にあり、
  // Workers Logs に二重に持つと管理対象が増えるだけである（SPEC §8.4 原則3）。
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.expired':
    case 'payment_intent.payment_failed':
      logInfo('stripe_webhook', { type: event.type, id: event.data?.object?.id ?? null })
      break
    case 'charge.dispute.created':
      // 異議申し立てへの対応（証拠提出等）はスコープ外（Payment Disputes 権限は「なし」のまま）。
      // 証拠として提出できる同意の版と時刻は、該当決済のメタデータにある（SPEC §8.4）。
      logInfo('stripe_webhook', { type: event.type, id: event.data?.object?.id ?? null })
      break
    default:
      break
  }

  return text('ok', 200)
}
