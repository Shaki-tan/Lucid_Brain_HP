// POST /api/webhook
// Stripeからのイベント通知を受信する。用途は監査ログ・返金対応の記録に限定し、
// ダウンロード可否判定はここに依存しない（download.jsはStripe APIへの同期照会のみで完結する）。
// 署名検証・タイムスタンプ検証はStripe公式ドキュメントのWebhook署名方式に準拠する。

const SIGNATURE_TOLERANCE_SECONDS = 300

function parseSignatureHeader(header) {
  const parts = {}
  header.split(",").forEach((pair) => {
    const [key, value] = pair.split("=")
    if (key && value) parts[key] = value
  })
  return parts
}

function timingSafeEqual(a, b) {
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
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signedPayload = `${timestamp}.${payload}`
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload))
  const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")

  return timingSafeEqual(expected, signature)
}

export async function onRequestPost(context) {
  const { request, env } = context

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response("Server not configured", { status: 500 })
  }

  const payload = await request.text()
  const signatureHeader = request.headers.get("Stripe-Signature")

  const isValid = await verifyStripeSignature(payload, signatureHeader, env.STRIPE_WEBHOOK_SECRET)
  if (!isValid) {
    return new Response("Invalid signature", { status: 400 })
  }

  const event = JSON.parse(payload)

  if (event.type === "checkout.session.completed") {
    const session = event.data.object
    console.log("checkout.session.completed", session.id, session.payment_status)
  }

  return new Response("ok", { status: 200 })
}
